import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireApiSession, resolveClientScope } from "@/server/session";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("clientId");
  const scope = resolveClientScope(s.user, requested);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const filter = searchParams.get("filter");
  const search = searchParams.get("q");
  // Quality filter : "all" (tout), "qualified" (≥6, défaut), "pepites" (≥8)
  const quality = searchParams.get("quality") ?? "qualified";
  // withLead : par défaut "true" = ne retourner que les triggers avec un Lead
  // créé (exploitable commercialement). "false" = inclure les orphelins
  // (en cours d'enrichissement Pappers). "all" = tout sans condition.
  const withLead = searchParams.get("withLead") ?? "true";

  const where: Prisma.TriggerWhereInput = { deletedAt: null };
  if (scope.clientId) where.clientId = scope.clientId;
  if (filter === "hot") where.isHot = true;
  else if (filter === "combo") where.isCombo = true;
  else if (filter === "new") where.status = "NEW";
  if (quality === "qualified") where.score = { gte: 6 };
  else if (quality === "pepites") where.score = { gte: 8 };
  if (withLead === "true") {
    where.lead = { isNot: null };
  }
  if (search) {
    where.OR = [
      { companyName: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
      { industry: { contains: search, mode: "insensitive" } },
    ];
  }

  // sourceCode visible UNIQUEMENT pour ADMIN + COMMERCIAL (pas client final).
  // Le moat tient : le client ne sait pas d'où vient le lead, mais ton équipe oui.
  const showSource = s.user.role === "ADMIN" || s.user.role === "COMMERCIAL";

  const triggers = await db.trigger.findMany({
    where,
    // Ordre : isHot → score → dataQuality lead (29/04 : trie les pépites avec
    // contact actionable en premier) → capturedAt.
    orderBy: [
      { isHot: "desc" },
      { score: "desc" },
      { lead: { dataQuality: "desc" } },
      { capturedAt: "desc" },
    ],
    take: 200,
    select: {
      id: true,
      companyName: true,
      companySiret: true,
      companyNaf: true,
      industry: true,
      region: true,
      size: true,
      type: true,
      title: true,
      detail: true,
      score: true,
      scoreReason: true,
      isHot: true,
      isCombo: true,
      status: true,
      capturedAt: true,
      sourceCode: showSource ? true : false,
      lead: {
        select: {
          id: true,
          dataQuality: true,
          emailConfidence: true,
          email: true,
          kasprPhone: true,
          phone: true,
          pitchJson: true,
          callBriefJson: true,
          linkedinDmJson: true,
        },
      },
    },
  });

  // Pour les triggers en combo : enrichir avec la liste de sources distinctes
  // détectées sur la même boîte (sur 30j). Permet aux commerciaux de comprendre
  // pourquoi le lead est en combo et quelles sources ont matché.
  if (showSource) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const comboTriggers = triggers.filter((t) => t.isCombo);
    if (comboTriggers.length > 0) {
      const byCompany = new Map<string, string[]>();
      const sirets = comboTriggers.map((t) => t.companySiret).filter(Boolean) as string[];
      const names = comboTriggers.map((t) => t.companyName);
      const siblings = await db.trigger.findMany({
        where: {
          clientId: scope.clientId ?? undefined,
          deletedAt: null,
          capturedAt: { gte: since },
          OR: [
            sirets.length > 0 ? { companySiret: { in: sirets } } : {},
            { companyName: { in: names } },
          ],
        },
        select: { companySiret: true, companyName: true, sourceCode: true },
      });
      for (const sib of siblings) {
        const key = sib.companySiret ?? sib.companyName.toLowerCase();
        const set = byCompany.get(key) ?? [];
        const prefix = (sib.sourceCode ?? "").split(".")[0] || "?";
        if (!set.includes(prefix)) set.push(prefix);
        byCompany.set(key, set);
      }
      for (const t of triggers) {
        if (!t.isCombo) continue;
        const key = t.companySiret ?? t.companyName.toLowerCase();
        (t as { comboSources?: string[] }).comboSources = byCompany.get(key) ?? [];
      }
    }
  }

  return NextResponse.json(triggers);
}
