import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiSession } from "@/server/session";
import { db } from "@/lib/db";
import { z } from "zod";

const PLAN_MRR_EUR: Record<string, number> = {
  GROWTH: 390, // offre publique unique depuis 09/05/2026
  LEADS_DATA: 199, // legacy DTL grandfathered
  CUSTOM: 0, // deals enterprise négociés à la main
};

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const enriched = searchParams.get("enriched") === "true";

  const u = s.user;
  let where: Prisma.ClientWhereInput = { deletedAt: null };

  switch (u.role) {
    case "CLIENT":
    case "EDITOR":
    case "VIEWER":
      if (!u.clientId) return NextResponse.json([]);
      where = { ...where, id: u.clientId };
      break;
    case "COMMERCIAL":
      where = { ...where, id: { in: u.scopeClientIds ?? [] } };
      break;
    case "ADMIN":
      break;
  }

  if (!enriched) {
    const clients = await db.client.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        industry: true,
        region: true,
        size: true,
        status: true,
        plan: true,
        activatedAt: true,
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(clients);
  }

  // Vue enrichie : counts triggers/opps/replies + last activity
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const clients = await db.client.findMany({
    where,
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
      primaryColor: true,
      activatedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          triggers: { where: { deletedAt: null, capturedAt: { gte: sevenDaysAgo } } },
          // Sprint 6 (10/05/2026) — opportunities + replies retires (tables droppees)
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const enrichedList = clients.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    legalName: c.legalName,
    industry: c.industry,
    region: c.region,
    size: c.size,
    status: c.status,
    plan: c.plan,
    contactEmail: c.contactEmail,
    primaryColor: c.primaryColor,
    activatedAt: c.activatedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    triggersLast7d: c._count.triggers,
    openOpportunities: 0, // Sprint 6 — Opportunity table droppee
    unreadReplies: 0, // Sprint 6 — Reply table droppee
    mrrEur: c.status === "ACTIVE" ? (PLAN_MRR_EUR[c.plan] ?? 0) : 0,
  }));

  return NextResponse.json(enrichedList);
}

// Sprint 4 (10/05/2026) — POST /api/clients
//
// Creation d'un nouveau client (ADMIN seulement).
// Auto-genere le slug depuis le nom si absent (kebab-case + dedup).
// ICP/delivery sont optionnels (configurables ensuite via UI).

const CreateClientSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "kebab-case only (a-z, 0-9, -)")
    .optional(),
  legalName: z.string().max(200).nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  size: z.string().max(20).nullable().optional(),
  plan: z.enum(["GROWTH", "LEADS_DATA", "CUSTOM"]).default("GROWTH"),
  status: z.enum(["PROSPECT", "ACTIVE", "PAUSED", "CHURNED"]).default("PROSPECT"),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  // ICP basique (peut etre enrichi ensuite via /clients/[id] tab Profil)
  icp: z
    .object({
      industries: z.array(z.string()).optional(),
      sizes: z.array(z.string()).optional(),
      regions: z.array(z.string()).optional(),
      naf_codes: z.array(z.string()).optional(),
      antiPersonas: z.array(z.string()).optional(),
      minScore: z.number().int().min(1).max(10).optional(),
      country_codes: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .partial()
    .nullable()
    .optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 50);
}

async function uniqueSlug(base: string): Promise<string> {
  const seed = base || "client";
  let candidate = seed;
  let n = 1;
  // Try seed, seed-2, seed-3, ... up to 99
  while (n < 100) {
    const exists = await db.client.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    n += 1;
    candidate = `${seed}-${n}`;
  }
  // Last resort : seed + timestamp suffix
  return `${seed}-${Date.now().toString(36)}`;
}

export async function POST(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  if (s.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ADMIN role required" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON body required" }, { status: 400 });

  const parsed = CreateClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation failed",
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Genere slug unique
  const slugBase = data.slug ? data.slug : slugify(data.name);
  const slug = await uniqueSlug(slugBase);

  try {
    const created = await db.client.create({
      data: {
        slug,
        name: data.name,
        legalName: data.legalName ?? null,
        industry: data.industry ?? null,
        region: data.region ?? null,
        size: data.size ?? null,
        plan: data.plan,
        status: data.status,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        primaryColor: data.primaryColor ?? null,
        icp: data.icp ?? Prisma.DbNull,
        activatedAt: data.status === "ACTIVE" ? new Date() : null,
      },
      select: { id: true, slug: true, name: true, status: true, plan: true },
    });

    await db.auditLog.create({
      data: {
        clientId: created.id,
        userId: s.user.id,
        action: "client.created",
        entityType: "Client",
        entityId: created.id,
        metadata: {
          slug: created.slug,
          name: created.name,
          plan: created.plan,
          status: created.status,
        },
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "create failed", detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }
}
