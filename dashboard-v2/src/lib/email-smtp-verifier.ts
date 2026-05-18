import "server-only";
import * as net from "node:net";
import * as dns from "node:dns/promises";

/**
 * email-smtp-verifier — vérification SMTP réelle d'une adresse email.
 *
 * Approche :
 * 1. DNS MX lookup → récupère le mail server du domain
 * 2. TCP connect (port 25) sur le MX
 * 3. SMTP handshake : EHLO → MAIL FROM → RCPT TO
 * 4. Parse la réponse :
 *    - 250 OK net + random@domain rejeté → VALID
 *    - 250 OK + random@domain aussi 250 → CATCH_ALL (suspect)
 *    - 550/551/553 → INVALID
 *    - timeout / 421 / 451 / connect refused → UNKNOWN
 *
 * Précision attendue : ~75-85% (vs 95%+ MillionVerifier).
 * Gratuit. ~3-8s par email selon serveur cible.
 *
 * Limites connues :
 * - Gmail/Outlook/Yahoo bloquent souvent RCPT TO sans auth → résultat
 *   souvent UNKNOWN ou CATCH_ALL.
 * - Microsoft 365 corp avec blue-shield → connection refused → UNKNOWN.
 * - Greylisting → 451 temporaire → UNKNOWN.
 *
 * Usage : await verifyEmailSMTP("paul@collective.work")
 *         → { status: "VALID", detail: "RCPT TO 250 OK, catch-all NO" }
 */

export type EmailVerifyStatus = "VALID" | "INVALID" | "CATCH_ALL" | "UNKNOWN";

export interface EmailVerifyResult {
  status: EmailVerifyStatus;
  detail: string;
  durationMs: number;
}

const SMTP_TIMEOUT_MS = 10_000;
const SMTP_PORT = 25;
const HELO_DOMAIN = process.env.SMTP_VERIFY_HELO_DOMAIN ?? "ifind.fr";
const MAIL_FROM = process.env.SMTP_VERIFY_MAIL_FROM ?? "verify@ifind.fr";

interface SMTPResponse {
  code: number;
  message: string;
}

/**
 * Connecte un socket TCP, parse les réponses SMTP, retourne les codes des
 * RCPT TO sur l'email cible ET un email random (pour détecter catch-all).
 */
async function smtpProbe(
  mxHost: string,
  email: string,
): Promise<{ targetCode: number; randomCode: number; logs: string[] } | { error: string; logs: string[] }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(SMTP_TIMEOUT_MS);
    const logs: string[] = [];
    let buffer = "";
    let stage:
      | "greeting"
      | "ehlo"
      | "mail_from"
      | "rcpt_target"
      | "rcpt_random"
      | "quit"
      | "done" = "greeting";
    let targetCode = 0;
    let randomCode = 0;
    const domain = email.split("@")[1] ?? "";
    const randomLocal = `verify_random_${Math.random().toString(36).slice(2, 12)}`;
    const randomEmail = `${randomLocal}@${domain}`;

    const send = (cmd: string) => {
      logs.push(`> ${cmd}`);
      socket.write(`${cmd}\r\n`);
    };

    const finish = (result: ReturnType<typeof smtpProbe> extends Promise<infer R> ? R : never) => {
      try { socket.end(); } catch {/* */}
      try { socket.destroy(); } catch {/* */}
      resolve(result);
    };

    const parseResponses = (chunk: string): SMTPResponse[] => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      // dernière ligne incomplète → garde dans buffer
      buffer = lines.pop() ?? "";
      const responses: SMTPResponse[] = [];
      let currentCode = 0;
      let currentMsg = "";
      for (const line of lines) {
        const m = line.match(/^(\d{3})([- ])(.*)$/);
        if (!m) continue;
        const code = parseInt(m[1]!, 10);
        const sep = m[2]!;
        const text = m[3]!;
        if (sep === "-") {
          // multi-line continue
          if (currentCode === 0) currentCode = code;
          currentMsg += text + "\n";
        } else {
          if (currentCode === 0) currentCode = code;
          currentMsg += text;
          responses.push({ code: currentCode, message: currentMsg });
          currentCode = 0;
          currentMsg = "";
        }
      }
      return responses;
    };

    socket.on("data", (data) => {
      const responses = parseResponses(data.toString("utf8"));
      for (const resp of responses) {
        logs.push(`< ${resp.code} ${resp.message.slice(0, 80)}`);
        switch (stage) {
          case "greeting":
            if (resp.code !== 220) {
              return finish({ error: `Greeting unexpected: ${resp.code}`, logs });
            }
            stage = "ehlo";
            send(`EHLO ${HELO_DOMAIN}`);
            break;
          case "ehlo":
            if (resp.code !== 250) {
              return finish({ error: `EHLO failed: ${resp.code}`, logs });
            }
            stage = "mail_from";
            send(`MAIL FROM:<${MAIL_FROM}>`);
            break;
          case "mail_from":
            if (resp.code !== 250) {
              return finish({ error: `MAIL FROM failed: ${resp.code}`, logs });
            }
            stage = "rcpt_target";
            send(`RCPT TO:<${email}>`);
            break;
          case "rcpt_target":
            targetCode = resp.code;
            stage = "rcpt_random";
            send(`RCPT TO:<${randomEmail}>`);
            break;
          case "rcpt_random":
            randomCode = resp.code;
            stage = "quit";
            send("QUIT");
            break;
          case "quit":
            stage = "done";
            return finish({ targetCode, randomCode, logs });
          case "done":
            break;
        }
      }
    });

    socket.on("error", (err) => {
      finish({ error: `socket error: ${err.message}`, logs });
    });
    socket.on("timeout", () => {
      finish({ error: "socket timeout", logs });
    });

    socket.connect(SMTP_PORT, mxHost);
  });
}

// V1 18/05/2026 — Cache in-process des résultats SMTP par email.
// La cascade multi-pattern génère jusqu'à 5 emails par lead, et plusieurs leads
// peuvent partager le même domaine → sans cache on probe les MX 100+ fois sur
// les mêmes serveurs en quelques minutes (politesse + perf).
//
// TTL 7j : les MX rarement changent leur acceptance pattern. Cache vidé au
// restart Next.js.
const cache = new Map<string, { result: EmailVerifyResult; expiresAt: number }>();
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const CACHE_MAX_ENTRIES = 1000;

function cacheGet(email: string): EmailVerifyResult | null {
  const entry = cache.get(email);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(email);
    return null;
  }
  return entry.result;
}

function cacheSet(email: string, result: EmailVerifyResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Eviction LRU naïve : supprime la plus ancienne entrée
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(email, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function clearSmtpVerifyCache(): void {
  cache.clear();
}

/**
 * Vérifie un email via DNS MX + SMTP RCPT TO. Cache 7j en mémoire.
 * Retourne VALID/INVALID/CATCH_ALL/UNKNOWN avec détail textuel.
 */
export async function verifyEmailSMTP(email: string): Promise<EmailVerifyResult> {
  // Cache hit avant tout traitement
  const cached = cacheGet(email);
  if (cached) {
    return { ...cached, detail: `${cached.detail} (cached)` };
  }

  const start = Date.now();
  const fail = (status: EmailVerifyStatus, detail: string): EmailVerifyResult => {
    const result: EmailVerifyResult = {
      status,
      detail,
      durationMs: Date.now() - start,
    };
    // On cache même les INVALID syntaxiques (réflexe défensif : si quelqu'un
    // passe le même email 100x, on évite 100 ms par appel).
    cacheSet(email, result);
    return result;
  };

  if (!email || !email.includes("@")) {
    return fail("INVALID", "syntactically invalid (no @)");
  }
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length < 1 || domain.length < 4 || !domain.includes(".")) {
    return fail("INVALID", "syntactically invalid (local/domain)");
  }

  // 1. DNS MX lookup
  let mxRecords: Array<{ exchange: string; priority: number }>;
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch (e) {
    // Pas de MX → essaie A record (RFC 5321 fallback rare)
    try {
      const a = await dns.resolve4(domain);
      if (a.length === 0) return fail("INVALID", `no MX, no A record for ${domain}`);
      mxRecords = [{ exchange: domain, priority: 0 }];
    } catch {
      return fail("INVALID", `domain ${domain} has no MX/A: ${e instanceof Error ? e.message : "?"}`);
    }
  }
  if (!mxRecords || mxRecords.length === 0) {
    return fail("INVALID", `no MX for ${domain}`);
  }

  // Tri par priorité (plus bas = plus prioritaire)
  mxRecords.sort((a, b) => a.priority - b.priority);

  // 2. Tente le 1er MX en priorité
  const mxHost = mxRecords[0]!.exchange;
  const probe = await smtpProbe(mxHost, email);

  if ("error" in probe) {
    return fail("UNKNOWN", `SMTP probe failed: ${probe.error}`);
  }

  const { targetCode, randomCode } = probe;

  // 3. Interprétation
  const targetAccepted = targetCode === 250 || targetCode === 251;
  const randomAccepted = randomCode === 250 || randomCode === 251;
  const targetRejected = targetCode === 550 || targetCode === 551 || targetCode === 553;

  if (targetAccepted && randomAccepted) {
    // Le serveur accepte n'importe quoi → catch-all (souvent Gmail Workspace
    // ou Microsoft 365 mal configuré). Email cible probablement valide
    // mais pas garanti.
    return fail(
      "CATCH_ALL",
      `target ${targetCode} + random ${randomCode} (catch-all detected)`,
    );
  }
  if (targetAccepted && !randomAccepted) {
    return fail("VALID", `target ${targetCode} OK + random rejected ${randomCode}`);
  }
  if (targetRejected) {
    return fail("INVALID", `target rejected ${targetCode}`);
  }
  // 4xx (greylisting, throttling) → UNKNOWN
  return fail("UNKNOWN", `target ${targetCode} (deferred or blocked)`);
}
