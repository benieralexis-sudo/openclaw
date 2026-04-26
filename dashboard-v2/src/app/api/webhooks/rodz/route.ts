import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, TriggerType, TriggerStatus, EmailStatus, LeadStatus } from "@prisma/client";
import { db } from "@/lib/db";

export const runtime = "nodejs"; // crypto natif Node, pas Edge

// Tolerance pour les replays / décalage horloge (5 min)
const TIMESTAMP_TOLERANCE_S = 5 * 60;

// ──────────────────────────────────────────────────────────────────────
// Mapping Rodz signal type → TriggerType Prisma
// ──────────────────────────────────────────────────────────────────────

const SIGNAL_TYPE_MAP: Record<string, TriggerType> = {
  fundraising: TriggerType.FUNDRAISING,
  "mergers-acquisitions": TriggerType.FUNDRAISING,
  "job-changes": TriggerType.LEADERSHIP_CHANGE,
  "job-offers": TriggerType.HIRING_KEY,
  "republished-job-offers": TriggerType.HIRING_KEY,
  "recruitment-campaign": TriggerType.HIRING_KEY,
  "company-followers": TriggerType.OTHER,
  "company-page-engagement": TriggerType.OTHER,
  "social-mentions": TriggerType.OTHER,
  "social-reactions": TriggerType.OTHER,
  "influencer-engagement": TriggerType.OTHER,
  "competitor-relationships": TriggerType.OTHER,
  "company-registration": TriggerType.EXPANSION,
  "public-tenders": TriggerType.REGULATORY,
};

// Score par défaut selon le type — peut être affiné plus tard avec Opus
const DEFAULT_SCORE: Record<string, number> = {
  fundraising: 9,
  "mergers-acquisitions": 9,
  "job-changes": 8,
  "job-offers": 7,
  "republished-job-offers": 6,
  "recruitment-campaign": 8,
  "public-tenders": 8,
  "company-registration": 6,
  "company-followers": 4,
  "company-page-engagement": 5,
  "social-mentions": 5,
  "social-reactions": 4,
  "influencer-engagement": 5,
  "competitor-relationships": 6,
};

// ──────────────────────────────────────────────────────────────────────
// HMAC verification (cf. doc Rodz : timestamp + "." + body)
// ──────────────────────────────────────────────────────────────────────

function verifySignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  if (!signature) return { ok: false, reason: "missing X-Webhook-Signature" };
  if (!timestamp) return { ok: false, reason: "missing X-Webhook-Timestamp" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "timestamp non numérique" };
  const ageS = Math.abs(Date.now() / 1000 - ts);
  if (ageS > TIMESTAMP_TOLERANCE_S) {
    return { ok: false, reason: `timestamp hors tolérance (${ageS}s)` };
  }

  const message = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(message).digest("hex");

  // timingSafeEqual exige des Buffer de même longueur
  const expectedBuf = Buffer.from(expected, "hex");
  let signatureBuf: Buffer;
  try {
    signatureBuf = Buffer.from(signature, "hex");
  } catch {
    return { ok: false, reason: "signature non-hex" };
  }
  if (expectedBuf.length !== signatureBuf.length) {
    return { ok: false, reason: "signature longueur ≠ expected" };
  }
  if (!timingSafeEqual(expectedBuf, signatureBuf)) {
    return { ok: false, reason: "signature invalide" };
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
// Types payload Rodz (subset commun à tous les signaux)
// ──────────────────────────────────────────────────────────────────────

interface RodzWebhookCompany {
  name: string;
  industry?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
  website?: string | null;
  siret?: string | null;
  siren?: string | null;
  size?: string | null;
  naf?: string | null;
}

interface RodzWebhookContact {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
}

interface RodzWebhookSignal {
  id: string; // ID du signal Rodz (= RodzSignal.rodzSignalId chez nous)
  type: string;
  name: string;
  last_signal?: string | null;
  last_signal_date?: string | null;
  // Champs spécifiques fundraising / m&a / jobs / ... — tout en optionnel
  funding_amount?: number;
  funding_currency?: string;
  funding_stage?: string;
  funding_type?: string;
  announcement_date?: string;
  article_source_url?: string;
  article_summary?: string;
  article_use_of_funds?: string;
  investors?: string[];
  // ...
  [key: string]: unknown;
}

interface RodzWebhookPayload {
  signal: RodzWebhookSignal;
  company: RodzWebhookCompany;
  contact?: RodzWebhookContact | null;
  is_test?: boolean;
  is_replay?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Construction du titre + détail à partir du payload signal
// ──────────────────────────────────────────────────────────────────────

function buildTitleDetail(p: RodzWebhookPayload): { title: string; detail: string } {
  const s = p.signal;
  const company = p.company.name;

  // Fundraising : "Levée Series A — €5M"
  if (s.type === "fundraising" || s.type === "mergers-acquisitions") {
    const amount = s.funding_amount
      ? `${(s.funding_amount / 1_000_000).toFixed(s.funding_amount >= 10_000_000 ? 0 : 1)}M${s.funding_currency === "EUR" ? "€" : s.funding_currency ?? ""}`
      : "";
    const stage = s.funding_stage ? ` ${s.funding_stage}` : "";
    return {
      title: `Levée${stage}${amount ? ` — ${amount}` : ""}`,
      detail: typeof s.article_summary === "string" ? s.article_summary : "",
    };
  }
  // Job changes : "Nouveau CTO chez X"
  if (s.type === "job-changes") {
    const title =
      typeof s.new_job_title === "string"
        ? `Nouveau ${s.new_job_title}`
        : `Changement de poste`;
    return {
      title,
      detail:
        typeof s.previous_company === "string"
          ? `Vient de ${s.previous_company}`
          : "",
    };
  }
  // Job offers : "Recrutement Head of Sales"
  if (s.type === "job-offers" || s.type === "republished-job-offers" || s.type === "recruitment-campaign") {
    return {
      title:
        typeof s.job_title === "string"
          ? `Recrutement — ${s.job_title}`
          : `Offre d'emploi détectée`,
      detail: typeof s.job_description === "string" ? s.job_description.slice(0, 400) : "",
    };
  }
  // Public tenders
  if (s.type === "public-tenders") {
    return {
      title:
        typeof s.tender_title === "string"
          ? `Marché public — ${s.tender_title}`
          : "Marché public",
      detail: typeof s.tender_description === "string" ? s.tender_description.slice(0, 400) : "",
    };
  }
  // Fallback
  return {
    title: `${s.name ?? s.type} — ${company}`,
    detail: typeof s.article_summary === "string" ? s.article_summary : "",
  };
}

// ──────────────────────────────────────────────────────────────────────
// POST handler
// ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1) Lire le body BRUT pour HMAC
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");

  // 2) Vérification signature (sauf si webhook test sans secret configuré)
  const secret = process.env.RODZ_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[rodz-webhook] RODZ_WEBHOOK_SECRET non configuré");
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 500 });
  }
  const verif = verifySignature(rawBody, signature, timestamp, secret);
  if (!verif.ok) {
    console.warn(`[rodz-webhook] signature rejetée : ${verif.reason}`);
    return NextResponse.json({ error: verif.reason }, { status: 401 });
  }

  // 3) Parse payload
  let payload: RodzWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RodzWebhookPayload;
  } catch (e) {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!payload.signal?.id) {
    return NextResponse.json(
      { error: "Payload sans signal.id" },
      { status: 400 },
    );
  }

  // 4) Retrouver le RodzSignal en DB → clientId
  const dbSignal = await db.rodzSignal.findUnique({
    where: { rodzSignalId: payload.signal.id },
    select: { id: true, clientId: true, signalType: true, deletedAt: true },
  });
  if (!dbSignal || dbSignal.deletedAt) {
    console.warn(
      `[rodz-webhook] signal Rodz inconnu en DB : ${payload.signal.id} (peut-être supprimé)`,
    );
    // 200 quand même pour que Rodz n'essaie pas de retry à l'infini
    return NextResponse.json({ status: "ignored", reason: "signal_unknown" });
  }

  // 5) Si is_test/is_replay : juste log et compter, pas de Trigger créé
  if (payload.is_test) {
    console.log(`[rodz-webhook] test reçu pour signal ${payload.signal.id} ✓`);
    return NextResponse.json({
      status: "ok",
      mode: "test",
      signalType: payload.signal.type,
      company: payload.company.name,
    });
  }

  // 6) Création Trigger + Lead
  const triggerType =
    SIGNAL_TYPE_MAP[payload.signal.type] ?? TriggerType.OTHER;
  const score = DEFAULT_SCORE[payload.signal.type] ?? 5;
  const isHot = score >= 9;
  const { title, detail } = buildTitleDetail(payload);

  const trigger = await db.trigger.create({
    data: {
      clientId: dbSignal.clientId,
      sourceCode: `rodz.${payload.signal.type}`,
      sourceUrl:
        typeof payload.signal.article_source_url === "string"
          ? payload.signal.article_source_url
          : null,
      capturedAt: new Date(),
      publishedAt:
        typeof payload.signal.announcement_date === "string"
          ? new Date(payload.signal.announcement_date)
          : null,
      companyName: payload.company.name,
      companySiret: payload.company.siret ?? payload.company.siren ?? null,
      companyNaf: payload.company.naf ?? null,
      industry: payload.company.industry ?? null,
      region: payload.company.location ?? null,
      size: payload.company.size ?? null,
      type: triggerType,
      title: title.slice(0, 200),
      detail: detail ? detail.slice(0, 1000) : null,
      rawPayload: payload as unknown as Prisma.InputJsonValue,
      score,
      isHot,
      isCombo: false, // calculé plus tard via aggrégation cross-signaux
      status: TriggerStatus.NEW,
    },
  });

  // 7) Lead si contact fourni (persona targeting activé chez Rodz)
  if (payload.contact && payload.contact.email) {
    const fullName =
      payload.contact.full_name ??
      ([payload.contact.first_name, payload.contact.last_name]
        .filter(Boolean)
        .join(" ") || null);

    await db.lead.create({
      data: {
        clientId: dbSignal.clientId,
        triggerId: trigger.id,
        firstName: payload.contact.first_name ?? null,
        lastName: payload.contact.last_name ?? null,
        fullName,
        jobTitle: payload.contact.job_title ?? null,
        linkedinUrl: payload.contact.linkedin_url ?? null,
        email: payload.contact.email,
        emailStatus: EmailStatus.VALID, // Rodz garantit l'enrichissement email
        phone: payload.contact.phone ?? null,
        companyName: payload.company.name,
        companySiret: payload.company.siret ?? payload.company.siren ?? null,
        status: LeadStatus.ENRICHED,
        enrichedAt: new Date(),
      },
    });
  }

  // 8) Counters sur le RodzSignal
  await db.rodzSignal.update({
    where: { id: dbSignal.id },
    data: {
      leadsReceived: { increment: 1 },
      lastLeadAt: new Date(),
    },
  });

  return NextResponse.json({
    status: "ok",
    triggerId: trigger.id,
    isHot,
    score,
  });
}
