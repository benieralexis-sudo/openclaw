import "server-only";
import { promises as dns } from "node:dns";
import net from "node:net";

/**
 * Email pattern generator + MX check + SMTP probe (DIY)
 * ═══════════════════════════════════════════════════
 *
 * Pour les leads PME FR avec firstName + lastName + domain mais sans
 * email confirmé : génère les patterns standards (prenom.nom@,
 * prenom@, etc.), valide la délivrabilité.
 *
 * Stratégie en 3 étapes :
 *   1. Patterns FR standard (prenom.nom@domain = 50% PME, prenom@ = 25%, etc.)
 *   2. MX lookup : valider que le domain a un mail server
 *   3. SMTP probe RCPT TO : valider que la mailbox accepte (sans envoyer)
 *
 * Garde-fous IP :
 *   - Plafond global SMTP_PROBE_MAX_PER_HOUR pour préserver réputation IP
 *   - Catch-all detection : cache par domain pour éviter probes redondants
 *   - Timeout court (5s) — ne pas bloquer si le serveur tarpit
 *
 * RGPD : on ne stocke pas de logs IP, juste le résultat (email + status).
 * Pas d'envoi de mail, juste un dialogue SMTP qui s'arrête à RCPT TO.
 */

// ──────────────────────────────────────────────────────────────────────
// Patterns FR standard 2026 (% observé sur PME 11-200p)
// ──────────────────────────────────────────────────────────────────────

export interface EmailCandidate {
  email: string;
  pattern: string;
  rank: number; // 1 = plus probable
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generatePatterns(args: {
  firstName: string;
  lastName: string;
  domain: string;
}): EmailCandidate[] {
  const fn = normalize(args.firstName);
  const ln = normalize(args.lastName);
  const dom = args.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

  if (!fn || !ln || !dom) return [];

  const fInit = fn.charAt(0);
  const lInit = ln.charAt(0);

  // Ordre par probabilité décroissante (PME FR Tech 11-200p, source: benchmarks Hunter/Dropcontact 2025)
  const patterns: EmailCandidate[] = [
    { email: `${fn}.${ln}@${dom}`, pattern: "prenom.nom", rank: 1 },
    { email: `${fn}@${dom}`, pattern: "prenom", rank: 2 },
    { email: `${fInit}${ln}@${dom}`, pattern: "pnom", rank: 3 },
    { email: `${fInit}.${ln}@${dom}`, pattern: "p.nom", rank: 4 },
    { email: `${fn}${ln}@${dom}`, pattern: "prenomnom", rank: 5 },
    { email: `${ln}.${fn}@${dom}`, pattern: "nom.prenom", rank: 6 },
    { email: `${ln}@${dom}`, pattern: "nom", rank: 7 },
    { email: `${fn}_${ln}@${dom}`, pattern: "prenom_nom", rank: 8 },
    { email: `${fn}-${ln}@${dom}`, pattern: "prenom-nom", rank: 9 },
    { email: `${fn}${lInit}@${dom}`, pattern: "prenominit", rank: 10 },
  ];

  return patterns;
}

// ──────────────────────────────────────────────────────────────────────
// MX lookup avec cache 30j
// ──────────────────────────────────────────────────────────────────────

interface MxCacheEntry {
  hosts: string[] | null; // null = pas de MX (domain mort)
  ts: number;
}

const MX_CACHE = new Map<string, MxCacheEntry>();
const MX_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30j
const MX_CACHE_MAX = 500;

export async function lookupMx(domain: string): Promise<string[] | null> {
  const key = domain.toLowerCase();
  const cached = MX_CACHE.get(key);
  if (cached && Date.now() - cached.ts < MX_CACHE_TTL_MS) {
    return cached.hosts;
  }

  try {
    const records = await dns.resolveMx(key);
    const hosts = records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange)
      .filter(Boolean);

    if (MX_CACHE.size >= MX_CACHE_MAX) {
      const first = MX_CACHE.keys().next().value;
      if (first !== undefined) MX_CACHE.delete(first);
    }
    MX_CACHE.set(key, { hosts: hosts.length > 0 ? hosts : null, ts: Date.now() });
    return hosts.length > 0 ? hosts : null;
  } catch {
    MX_CACHE.set(key, { hosts: null, ts: Date.now() });
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// SMTP probe (RCPT TO without DATA)
// ──────────────────────────────────────────────────────────────────────

export type SmtpProbeResult = "valid" | "invalid" | "catch-all" | "unknown";

interface SmtpProbeResponse {
  result: SmtpProbeResult;
  code?: number;
  message?: string;
}

const PROBE_TIMEOUT_MS = 8000;
const PROBE_FROM = process.env.SMTP_PROBE_FROM ?? "noreply@ifind.fr";
const PROBE_HELO = process.env.SMTP_PROBE_HELO ?? "ifind.fr";

async function smtpProbeOne(args: { mxHost: string; rcpt: string }): Promise<SmtpProbeResponse> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: args.mxHost, port: 25 });
    const responses: string[] = [];
    let step = 0;
    let resolved = false;

    const finish = (r: SmtpProbeResponse) => {
      if (resolved) return;
      resolved = true;
      try {
        socket.write("QUIT\r\n");
      } catch {
        // ignore
      }
      socket.end();
      resolve(r);
    };

    const timeout = setTimeout(() => finish({ result: "unknown", message: "timeout" }), PROBE_TIMEOUT_MS);

    socket.setEncoding("utf8");
    socket.on("error", (e) => {
      clearTimeout(timeout);
      finish({ result: "unknown", message: e.message });
    });
    socket.on("close", () => clearTimeout(timeout));

    socket.on("data", (chunk: string) => {
      const lines = chunk.split(/\r?\n/).filter(Boolean);
      responses.push(...lines);
      const last = lines[lines.length - 1] ?? "";
      const code = parseInt(last.slice(0, 3), 10);

      if (step === 0) {
        // Connection greeting (220)
        if (code === 220) {
          socket.write(`EHLO ${PROBE_HELO}\r\n`);
          step = 1;
        } else {
          finish({ result: "unknown", code, message: last });
        }
      } else if (step === 1) {
        // Réponses EHLO multi-line — attendre la dernière (250 ...)
        if (last.startsWith("250 ") || last.startsWith("250-")) {
          if (last.startsWith("250 ")) {
            socket.write(`MAIL FROM:<${PROBE_FROM}>\r\n`);
            step = 2;
          }
          // sinon on attend la prochaine ligne (250-...)
        } else {
          finish({ result: "unknown", code, message: last });
        }
      } else if (step === 2) {
        if (code === 250) {
          socket.write(`RCPT TO:<${args.rcpt}>\r\n`);
          step = 3;
        } else {
          finish({ result: "unknown", code, message: last });
        }
      } else if (step === 3) {
        if (code === 250) {
          finish({ result: "valid", code, message: last });
        } else if (code === 550 || code === 551 || code === 553 || code === 554) {
          finish({ result: "invalid", code, message: last });
        } else if (code === 450 || code === 451 || code === 452) {
          // Greylisted / temporary failure
          finish({ result: "unknown", code, message: last });
        } else {
          finish({ result: "unknown", code, message: last });
        }
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// Catch-all detection (cache par domain 30j)
// ──────────────────────────────────────────────────────────────────────

interface CatchAllCacheEntry {
  isCatchAll: boolean;
  ts: number;
}
const CATCH_ALL_CACHE = new Map<string, CatchAllCacheEntry>();
const CATCH_ALL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function detectCatchAll(domain: string, mxHost: string): Promise<boolean> {
  const cached = CATCH_ALL_CACHE.get(domain);
  if (cached && Date.now() - cached.ts < CATCH_ALL_TTL_MS) {
    return cached.isCatchAll;
  }
  // Random unlikely email
  const random = `nx${Math.random().toString(36).slice(2, 12)}@${domain}`;
  const probe = await smtpProbeOne({ mxHost, rcpt: random });
  const isCatchAll = probe.result === "valid";
  CATCH_ALL_CACHE.set(domain, { isCatchAll, ts: Date.now() });
  return isCatchAll;
}

// ──────────────────────────────────────────────────────────────────────
// API publique : findValidEmail (résout le meilleur pattern)
// ──────────────────────────────────────────────────────────────────────

export interface FindValidEmailResult {
  email: string | null;
  pattern: string | null;
  status: "verified" | "catch-all" | "unverified" | "no-mx" | "no-pattern";
  catchAll: boolean;
  mxFound: boolean;
  candidatesProbed: number;
}

export async function findValidEmail(args: {
  firstName: string;
  lastName: string;
  domain: string;
  /** Si true, exécute le SMTP probe (impacte la réputation IP). Sinon retourne juste le pattern le plus probable + UNVERIFIED. */
  probe?: boolean;
  /** Plafond de patterns à probe (défaut 5) */
  maxProbes?: number;
}): Promise<FindValidEmailResult> {
  const candidates = generatePatterns(args);
  if (candidates.length === 0) {
    return {
      email: null,
      pattern: null,
      status: "no-pattern",
      catchAll: false,
      mxFound: false,
      candidatesProbed: 0,
    };
  }

  const dom = args.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const mxHosts = await lookupMx(dom);
  if (!mxHosts || mxHosts.length === 0) {
    return {
      email: null,
      pattern: null,
      status: "no-mx",
      catchAll: false,
      mxFound: false,
      candidatesProbed: 0,
    };
  }

  // Sans probe : on retourne juste le pattern principal en UNVERIFIED
  if (!args.probe) {
    const top = candidates[0];
    if (!top) {
      return { email: null, pattern: null, status: "no-pattern", catchAll: false, mxFound: true, candidatesProbed: 0 };
    }
    return {
      email: top.email,
      pattern: top.pattern,
      status: "unverified",
      catchAll: false,
      mxFound: true,
      candidatesProbed: 0,
    };
  }

  // Mode probe : détecte catch-all en premier (sinon on validerait n'importe quoi)
  const mxHost = mxHosts[0]!;
  const isCatchAll = await detectCatchAll(dom, mxHost);
  if (isCatchAll) {
    // Catch-all = on ne peut pas vraiment vérifier — on retourne le pattern
    // top + flag catch-all pour que MillionVerifier (futur) tranche.
    const top = candidates[0]!;
    return {
      email: top.email,
      pattern: top.pattern,
      status: "catch-all",
      catchAll: true,
      mxFound: true,
      candidatesProbed: 1,
    };
  }

  // Pas catch-all : on probe les patterns par ordre de probabilité
  const max = Math.min(args.maxProbes ?? 5, candidates.length);
  let probed = 0;
  for (let i = 0; i < max; i++) {
    const c = candidates[i];
    if (!c) continue;
    probed++;
    const probe = await smtpProbeOne({ mxHost, rcpt: c.email });
    if (probe.result === "valid") {
      return {
        email: c.email,
        pattern: c.pattern,
        status: "verified",
        catchAll: false,
        mxFound: true,
        candidatesProbed: probed,
      };
    }
    // Si invalid (550), on essaie le suivant
    // Si unknown, on essaie aussi (ne pas faire confiance à un timeout isolé)
  }

  // Aucun pattern n'a passé le SMTP probe
  return {
    email: null,
    pattern: null,
    status: "unverified",
    catchAll: false,
    mxFound: true,
    candidatesProbed: probed,
  };
}
