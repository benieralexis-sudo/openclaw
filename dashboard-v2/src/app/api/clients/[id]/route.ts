import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ClientPlan, ClientStatus } from "@prisma/client";
import { requireApiSession } from "@/server/session";

const PLAN_MRR_EUR: Record<string, number> = {
  GROWTH: 390, // offre publique unique depuis 09/05/2026
  LEADS_DATA: 199, // legacy DTL grandfathered
  CUSTOM: 0, // deals enterprise négociés à la main
};

function canSeeClient(
  user: { role: string; clientId: string | null; scopeClientIds: string[] },
  clientId: string,
) {
  if (user.role === "ADMIN") return true;
  if (
    (user.role === "CLIENT" || user.role === "EDITOR" || user.role === "VIEWER") &&
    user.clientId === clientId
  )
    return true;
  if (user.role === "COMMERCIAL" && user.scopeClientIds.includes(clientId)) return true;
  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  if (!canSeeClient(s.user, id)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  // Bombora FR pivot (18/05/2026, Jour 5) — Refonte page client en langage commercial.
  // KPIs hardcodés à 0 supprimés. Remplacés par 4 vrais indicateurs :
  //   1. Leads livrés ce mois (vs promesse 60)
  //   2. Pépites livrées ce mois (vs garantie 6)
  //   3. Briefs prêts à envoyer (Leads NEW avec briefGeneratedAt)
  //   4. Date dernier signal détecté
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const client = await db.client.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      legalName: true,
      industry: true,
      region: true,
      size: true,
      status: true,
      plan: true,
      contactEmail: true,
      contactPhone: true,
      primaryColor: true,
      logoUrl: true,
      icp: true,
      activatedAt: true,
      pausedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          triggers: { where: { deletedAt: null, capturedAt: { gte: sevenDaysAgo } } },
        },
      },
      triggers: {
        where: { deletedAt: null },
        orderBy: { capturedAt: "desc" },
        take: 5,
        select: {
          id: true,
          companyName: true,
          title: true,
          score: true,
          capturedAt: true,
          isHot: true,
          isCombo: true,
          briefV2Json: true,
        },
      },
    },
  });

  if (!client) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Vrais KPIs commerciaux (Bombora FR Jour 5)
  // Statuts "livrés" : tout sauf ARCHIVED et INCOMPLETE (qui ne comptent pas
  // dans le quota commercial).
  const DELIVERED_STATUSES: Array<"NEW" | "ENRICHED" | "CONTACTABLE" | "CONTACTED" | "NOT_INTERESTED"> = [
    "NEW",
    "ENRICHED",
    "CONTACTABLE",
    "CONTACTED",
    "NOT_INTERESTED",
  ];

  const [
    leadsThisMonth,
    pepitesThisMonth,
    briefsReady,
    lastSignal,
  ] = await Promise.all([
    db.lead.count({
      where: {
        clientId: id,
        deletedAt: null,
        createdAt: { gte: startOfMonth },
        status: { in: DELIVERED_STATUSES },
      },
    }),
    db.lead.count({
      where: {
        clientId: id,
        deletedAt: null,
        createdAt: { gte: startOfMonth },
        fitScore: { gte: 80 },
        status: { in: DELIVERED_STATUSES },
      },
    }),
    db.lead.count({
      where: {
        clientId: id,
        deletedAt: null,
        status: "NEW",
        briefGeneratedAt: { not: null },
      },
    }),
    db.trigger.findFirst({
      where: { clientId: id, deletedAt: null },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
  ]);

  // Promesses contractuelles selon le plan
  const planPromises: Record<string, { monthlyLeads: number; monthlyPepites: number }> = {
    GROWTH: { monthlyLeads: 60, monthlyPepites: 6 },
    LEADS_DATA: { monthlyLeads: 30, monthlyPepites: 0 },
    FULL_SERVICE: { monthlyLeads: 60, monthlyPepites: 6 }, // legacy, garde pour compat
    CUSTOM: { monthlyLeads: 0, monthlyPepites: 0 },
  };
  const promised = planPromises[client.plan] ?? { monthlyLeads: 0, monthlyPepites: 0 };

  return NextResponse.json({
    id: client.id,
    slug: client.slug,
    name: client.name,
    legalName: client.legalName,
    industry: client.industry,
    region: client.region,
    size: client.size,
    status: client.status,
    plan: client.plan,
    contactEmail: client.contactEmail,
    contactPhone: client.contactPhone,
    primaryColor: client.primaryColor,
    logoUrl: client.logoUrl,
    icp: client.icp,
    activatedAt: client.activatedAt,
    pausedAt: client.pausedAt,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    metrics: {
      // Vrais KPIs (Bombora FR Jour 5)
      leadsThisMonth,
      leadsPromised: promised.monthlyLeads,
      pepitesThisMonth,
      pepitesPromised: promised.monthlyPepites,
      briefsReady,
      lastSignalAt: lastSignal?.capturedAt ?? null,
      triggersLast7d: client._count.triggers,
      mrrEur: client.status === "ACTIVE" ? (PLAN_MRR_EUR[client.plan] ?? 0) : 0,
    },
    recentTriggers: client.triggers,
  });
}

// V1 18/05 — Schéma ICP volontairement permissif.
// L'icp est un blob JSON freeform consommé par le pipeline (pollers, agents,
// scoring) : il contient les champs UI (industries, regions, antiPersonas, ...)
// ET des dizaines de clés métier (naf_codes, pitchVerbatim, signalPrimary,
// dynamicFewShots, personas, etc.) maintenues par les seeds et les agents.
// On valide donc seulement les champs édités par l'IcpEditor + on autorise
// le passthrough des autres clés pour ne pas les écraser à la sauvegarde.
// Les caps sont relevés pour absorber les listes réelles (iFIND : 50 anti-personas,
// DTL : > 40 keywords) sans bloquer la sauvegarde.
const IcpSchema = z
  .object({
    industries: z.array(z.string()).max(200).optional(),
    sizes: z.array(z.string()).max(50).optional(),
    regions: z.array(z.string()).max(60).optional(),
    minScore: z.number().int().min(1).max(10).optional(),
    antiPersonas: z.array(z.string()).max(200).optional(),
    notes: z.string().max(5000).optional(),
  })
  .passthrough();

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  legalName: z.string().max(160).nullable().optional(),
  industry: z.string().max(120).nullable().optional(),
  region: z.string().max(120).nullable().optional(),
  size: z.string().max(40).nullable().optional(),
  status: z.nativeEnum(ClientStatus).optional(),
  plan: z.nativeEnum(ClientPlan).optional(),
  contactEmail: z.string().email().max(200).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  primaryColor: z.string().max(20).nullable().optional(),
  icp: IcpSchema.nullable().optional(),
});

const EDITOR_ALLOWED_FIELDS: ReadonlyArray<keyof z.infer<typeof PatchSchema>> = [
  "icp",
  "contactEmail",
  "contactPhone",
];

// Champs additionnels autorisés au CLIENT/EDITOR pendant l'onboarding
// (avant que User.onboardingDone passe à true)
const ONBOARDING_EXTRA_FIELDS: ReadonlyArray<keyof z.infer<typeof PatchSchema>> = [
  "name",
  "legalName",
  "industry",
  "region",
  "size",
  "plan",
  "status",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  if (!canSeeClient(s.user, id)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Merge ICP partiel avec l'existant (évite d'écraser des clés non envoyées)
  const dataDraft: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.icp !== undefined && parsed.data.icp !== null) {
    const current = await db.client.findUnique({
      where: { id },
      select: { icp: true },
    });
    const previous =
      current?.icp && typeof current.icp === "object" && !Array.isArray(current.icp)
        ? (current.icp as Record<string, unknown>)
        : {};
    dataDraft.icp = { ...previous, ...parsed.data.icp };
  }

  // Restriction d'édition selon le rôle
  let data: Record<string, unknown> = dataDraft;
  if (s.user.role === "VIEWER" || s.user.role === "COMMERCIAL") {
    return NextResponse.json({ error: "Lecture seule" }, { status: 403 });
  }
  if (s.user.role === "CLIENT" || s.user.role === "EDITOR") {
    const allowed: ReadonlyArray<keyof z.infer<typeof PatchSchema>> = s.user.onboardingDone
      ? EDITOR_ALLOWED_FIELDS
      : [...EDITOR_ALLOWED_FIELDS, ...ONBOARDING_EXTRA_FIELDS];
    data = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) =>
        allowed.includes(key as keyof z.infer<typeof PatchSchema>),
      ),
    );
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Aucun champ éditable pour votre rôle" },
        { status: 403 },
      );
    }
  }

  // Audit auto activatedAt/pausedAt selon status (admin OU onboarding)
  if (parsed.data.status && data.status) {
    if (parsed.data.status === "ACTIVE") {
      data.activatedAt = data.activatedAt ?? new Date();
      data.pausedAt = null;
    } else if (parsed.data.status === "PAUSED") {
      data.pausedAt = new Date();
    }
  }

  const updated = await db.client.update({
    where: { id },
    data: data as Prisma_ClientUpdateInput,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      plan: true,
      contactEmail: true,
      contactPhone: true,
      icp: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(updated);
}

// Helper type alias pour cast
type Prisma_ClientUpdateInput = import("@prisma/client").Prisma.ClientUpdateInput;
