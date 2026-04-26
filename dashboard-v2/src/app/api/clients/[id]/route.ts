import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ClientPlan, ClientStatus } from "@prisma/client";
import { requireApiSession } from "@/server/session";

const PLAN_MRR_EUR: Record<string, number> = {
  LEADS_DATA: 199,
  FULL_SERVICE: 890,
  CUSTOM: 0,
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

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startOfWeek = new Date();
  const endOfWeek = new Date();
  endOfWeek.setDate(endOfWeek.getDate() + 7);

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
          opportunities: {
            where: { deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
          },
          replies: { where: { deletedAt: null, status: "UNREAD" } },
        },
      },
      opportunities: {
        where: {
          deletedAt: null,
          stage: { in: ["WON", "LOST"] },
        },
        select: { stage: true, dealValueEur: true },
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
        },
      },
    },
  });

  if (!client) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Conversion close basée sur opps fermées
  const won = client.opportunities.filter((o) => o.stage === "WON").length;
  const closed = client.opportunities.length;
  const conversion = closed > 0 ? (won / closed) * 100 : 0;
  const wonValue = client.opportunities
    .filter((o) => o.stage === "WON")
    .reduce((sum, o) => sum + (o.dealValueEur ? Number(o.dealValueEur) : 0), 0);

  const meetingsThisWeek = await db.opportunity.count({
    where: {
      clientId: id,
      deletedAt: null,
      stage: "MEETING_SET",
      meetingDate: { gte: startOfWeek, lte: endOfWeek },
    },
  });

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
      triggersLast7d: client._count.triggers,
      openOpportunities: client._count.opportunities,
      unreadReplies: client._count.replies,
      conversionClosePct: Math.round(conversion),
      wonValueEur: wonValue,
      meetingsThisWeek,
      mrrEur: client.status === "ACTIVE" ? (PLAN_MRR_EUR[client.plan] ?? 0) : 0,
    },
    recentTriggers: client.triggers,
  });
}

const IcpSchema = z
  .object({
    industries: z.array(z.string()).max(40).optional(),
    sizes: z.array(z.string()).max(20).optional(),
    regions: z.array(z.string()).max(40).optional(),
    minScore: z.number().int().min(1).max(10).optional(),
    preferredSignals: z.array(z.string()).max(40).optional(),
    antiPersonas: z.array(z.string()).max(40).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

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

  // Restriction d'édition selon le rôle
  let data: Record<string, unknown> = parsed.data;
  if (s.user.role === "VIEWER" || s.user.role === "COMMERCIAL") {
    return NextResponse.json({ error: "Lecture seule" }, { status: 403 });
  }
  if (s.user.role === "CLIENT" || s.user.role === "EDITOR") {
    data = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) =>
        EDITOR_ALLOWED_FIELDS.includes(key as keyof z.infer<typeof PatchSchema>),
      ),
    );
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Aucun champ éditable pour votre rôle" },
        { status: 403 },
      );
    }
  }

  // ADMIN : audit auto activatedAt/pausedAt selon status
  if (s.user.role === "ADMIN" && parsed.data.status) {
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
