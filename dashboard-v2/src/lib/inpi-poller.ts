import "server-only";

/**
 * Sprint 1 (10/05/2026) — Poller INPI Marques pour dashboard-v2.
 *
 * INPI = Institut National de la Propriété Industrielle.
 * Détecte les dépôts de marques par les sociétés FR (signal "nouveau produit
 * en préparation" — typiquement 6-12 mois avant lancement).
 *
 * Auth : compte DATA INPI (INPI_USERNAME/PASSWORD) via session XSRF + login.
 * Limitation : ApplicantIdentifier (SIREN) pas renvoyé dans la réponse →
 * lookup SIRENE séparé via Pappers attributeSirene.
 *
 * Indexation INPI hebdo (vendredi) → fenêtre 30j suffisante (cron 24h).
 *
 * Note : la complexité INPI (auth multi-step + ISO-8859-1 + ApplicantIdentifier
 * absent) fait qu'en pratique on a 1202 events sur 6 mois côté bot. Source
 * utile mais coûteuse à maintenir. Migration ici pour completer Sprint 1
 * (objectif : shut down bot Sprint 2).
 */

import { XMLParser } from "fast-xml-parser";
import { Prisma, TriggerStatus, TriggerType } from "@prisma/client";
import { db } from "@/lib/db";
import { attributeSirene, getEntreprise } from "@/lib/pappers";
import { matchesClientIcp, type ClientIcp } from "@/lib/client-icp-matcher";

const GATEWAY = "https://api-gateway.inpi.fr";
const SEED_URL = `${GATEWAY}/services/uaa/api/authenticate`;
const LOGIN_URL = `${GATEWAY}/auth/login`;
const SEARCH_MARQUES = `${GATEWAY}/services/apidiffusion/api/marques/search`;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: true,
});

type CookieJar = Map<string, string>;

interface InpiSession {
  jar: CookieJar | null;
  expiresAt: number;
}

const _session: InpiSession = { jar: null, expiresAt: 0 };

function updateJar(jar: CookieJar, res: Response): void {
  const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const kv = c.split(";")[0];
    if (!kv) continue;
    const i = kv.indexOf("=");
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function authenticate(): Promise<CookieJar | null> {
  const user = process.env.INPI_USERNAME;
  const pwd = process.env.INPI_PASSWORD;
  if (!user || !pwd) {
    console.warn("[inpi-poller] INPI_USERNAME/PASSWORD not configured — skipping");
    return null;
  }

  // Re-use session if still valid (~30 min)
  if (_session.jar && Date.now() < _session.expiresAt) return _session.jar;

  const jar: CookieJar = new Map();

  try {
    const seed = await fetch(SEED_URL, { signal: AbortSignal.timeout(10_000) });
    updateJar(jar, seed);
    if (!jar.get("XSRF-TOKEN")) {
      console.warn("[inpi-poller] no XSRF-TOKEN");
      return null;
    }

    const loginRes = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(jar),
        "X-XSRF-TOKEN": jar.get("XSRF-TOKEN") ?? "",
      },
      body: JSON.stringify({ username: user, password: pwd }),
      signal: AbortSignal.timeout(10_000),
    });
    updateJar(jar, loginRes);
    if (!loginRes.ok) {
      console.warn(`[inpi-poller] login failed HTTP ${loginRes.status}`);
      return null;
    }

    _session.jar = jar;
    _session.expiresAt = Date.now() + 25 * 60_000; // 25 min safety
    return jar;
  } catch (e) {
    console.warn(
      `[inpi-poller] auth failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

interface InpiMarque {
  applicationNumber?: string;
  mark?: string;
  applicationDate?: string;
  deposant?: string;
  classNumbers?: string[];
}

async function searchMarques(
  jar: CookieJar,
  fromDate: string,
): Promise<InpiMarque[]> {
  try {
    const body = {
      query: `[ApplicationDate=${fromDate}:99991231] ET [ApplicantIdentifier=*]`,
      paging: { from: 0, size: 200 },
      fields: ["ApplicationNumber", "Mark", "DEPOSANT", "ApplicationDate", "ClassNumber"],
    };
    const res = await fetch(SEARCH_MARQUES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/xml",
        Cookie: cookieHeader(jar),
        "X-XSRF-TOKEN": jar.get("XSRF-TOKEN") ?? "",
        "X-Forwarded-For": "82.65.0.1",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const bodyPreview = (await res.text().catch(() => "")).slice(0, 300);
      // 13/05/2026 nuit — Audit Alexis : 0 trigger INPI en 90 jours. Investigation
      // a confirmé que api-gateway.inpi.fr `/services/apidiffusion/api/marques/
      // search` retourne HTTP 500 systématique côté SERVEUR INPI (avec auth XSRF
      // correcte ET avec body {} minimal). C'est une panne côté INPI, pas
      // notre code. Notre auth XSRF est conforme à la doc.
      // Action long-terme : migrer vers le bulk FTP/SFTP INPI (MAJ hebdo
      // vendredi) si la gateway reste HS. Voir agent investigation 13/05.
      console.warn(
        `[inpi-poller] search HTTP ${res.status} | body: ${bodyPreview}`,
      );
      if (res.status === 500) {
        console.warn(
          `[inpi-poller] API INPI down côté serveur (panne récurrente depuis ~12/05). Re-tester dans 24h ou switch vers bulk FTP.`,
        );
      }
      return [];
    }
    const xml = await res.text();
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const items = (parsed?.items as { item?: unknown } | undefined)?.item ?? [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        applicationNumber: String(obj.ApplicationNumber ?? ""),
        mark: String(obj.Mark ?? ""),
        applicationDate: String(obj.ApplicationDate ?? ""),
        deposant: String(obj.DEPOSANT ?? ""),
      };
    });
  } catch (e) {
    console.warn(
      `[inpi-poller] search failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

export interface InpiPollerResult {
  clientId: string;
  marquesFetched: number;
  candidatesProcessed: number;
  sireneResolved: number;
  triggersCreated: number;
  triggersSkippedDup: number;
  triggersSkippedIcp: number;
  errors: string[];
}

export async function pollInpiForClient(
  clientId: string,
  opts: { lookbackDays?: number } = {},
): Promise<InpiPollerResult> {
  const result: InpiPollerResult = {
    clientId,
    marquesFetched: 0,
    candidatesProcessed: 0,
    sireneResolved: 0,
    triggersCreated: 0,
    triggersSkippedDup: 0,
    triggersSkippedIcp: 0,
    errors: [],
  };

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, icp: true, status: true, deletedAt: true },
  });
  if (!client || client.deletedAt || client.status !== "ACTIVE") {
    result.errors.push(`Client ${clientId} not active or deleted`);
    return result;
  }
  const icp = (client.icp as ClientIcp | null) ?? {};

  const jar = await authenticate();
  if (!jar) {
    result.errors.push("INPI auth failed (credentials missing or invalid)");
    return result;
  }

  const lookbackDays = opts.lookbackDays ?? 30;
  const fromDate = new Date(Date.now() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  const marques = await searchMarques(jar, fromDate);
  result.marquesFetched = marques.length;

  for (const m of marques) {
    if (!m.deposant || !m.mark) continue;
    result.candidatesProcessed += 1;

    // SIREN lookup via Pappers
    let sireneSiren: string | null = null;
    let pappersData: Awaited<ReturnType<typeof getEntreprise>> | null = null;
    try {
      const sireneHit = await attributeSirene(m.deposant);
      if (sireneHit?.siren) {
        sireneSiren = sireneHit.siren;
        result.sireneResolved += 1;
        try {
          pappersData = await getEntreprise(sireneSiren);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore SIRENE failure
    }

    // ICP filter
    const icpCheck = matchesClientIcp(
      pappersData
        ? {
            code_naf: pappersData.code_naf ?? null,
            tranche_effectif: pappersData.tranche_effectif ?? null,
            siege: pappersData.siege
              ? {
                  region: pappersData.siege.region,
                  code_postal: pappersData.siege.code_postal,
                }
              : null,
          }
        : null,
      m.deposant,
      icp,
    );
    if (!icpCheck.ok) {
      result.triggersSkippedIcp += 1;
      continue;
    }

    const sourceUrl = `inpi:marque:${m.applicationNumber}`;

    // Idempotence
    const existing = await db.trigger.findFirst({
      where: { clientId, sourceCode: "inpi.trademark", sourceUrl },
      select: { id: true },
    });
    if (existing) {
      result.triggersSkippedDup += 1;
      continue;
    }

    try {
      await db.trigger.create({
        data: {
          clientId,
          sourceCode: "inpi.trademark",
          sourceUrl,
          capturedAt: new Date(),
          publishedAt: m.applicationDate
            ? new Date(
                m.applicationDate.length === 8
                  ? `${m.applicationDate.slice(0, 4)}-${m.applicationDate.slice(4, 6)}-${m.applicationDate.slice(6, 8)}`
                  : m.applicationDate,
              )
            : new Date(),
          companyName: m.deposant,
          companySiret: sireneSiren,
          companyNaf: pappersData?.code_naf ?? null,
          type: TriggerType.TRADEMARK,
          title: `INPI marque déposée — "${m.mark}" par ${m.deposant}`,
          detail: `Marque "${m.mark}" déposée par ${m.deposant} le ${m.applicationDate} (numéro ${m.applicationNumber})`,
          rawPayload: m as unknown as Prisma.InputJsonValue,
          score: 6, // signal moyen (6-12 mois avant launch)
          scoreReason: `INPI dépôt marque ${m.applicationDate}`,
          status: TriggerStatus.NEW,
        },
      });
      result.triggersCreated += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${m.deposant}: ${msg.slice(0, 150)}`);
    }
  }

  console.log(
    `[inpi-poller] ${clientId}: ${result.triggersCreated} created / ${result.marquesFetched} fetched (${result.sireneResolved} sirene resolved, ${result.triggersSkippedIcp} icp-filter, ${result.triggersSkippedDup} dup)`,
  );

  return result;
}
