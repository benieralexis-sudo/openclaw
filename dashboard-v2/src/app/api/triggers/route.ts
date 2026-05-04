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
  // Quality filter (par défaut "actionable" depuis 04/05/2026 Phase 4 recovery) :
  //  - "actionable" : combined ≥ 35 OU has_contact (email/phone) → cache les
  //                   inactionables sans tier ni contact (~55 leads filtrés)
  //  - "qualified" : score Opus ≥ 6 (Pépites + Qualifiés)
  //  - "pepites"   : score Opus ≥ 8 (Pépites uniquement)
  //  - "all"       : tout (audit/debug)
  const quality = searchParams.get("quality") ?? "actionable";
  // withLead : par défaut "true" = ne retourner que les triggers avec un Lead
  // créé (exploitable commercialement). "false" = inclure les orphelins
  // (en cours d'enrichissement Pappers). "all" = tout sans condition.
  const withLead = searchParams.get("withLead") ?? "true";

  const where: Prisma.TriggerWhereInput = { deletedAt: null };
  if (scope.clientId) where.clientId = scope.clientId;
  if (filter === "hot") where.isHot = true;
  else if (filter === "combo") where.isCombo = true;
  else if (filter === "new") where.status = "NEW";
  if (quality === "qualified") {
    where.score = { gte: 6 };
  } else if (quality === "pepites") {
    where.score = { gte: 8 };
  } else if (quality === "actionable") {
    // Filtre intelligent (Phase 4 recovery 04/05) :
    // Garde les Triggers qui ont SOIT priorityScore élevé SOIT fitScore élevé
    // SOIT au moins un canal de contact (email/phone). Cache uniquement les
    // "vraiment morts" (Faible <35 sans aucun contact).
    where.OR = [
      // Combined score ≥ 35 (Tiède+) — approximation côté DB :
      // priorityScore élevé (≥10 → contribue ≥28 au combined)
      { priorityScore: { gte: 10 } },
      // OR Lead avec fitScore ≥ 35 (≥ Tiède sur fit seul)
      { lead: { fitScore: { gte: 35 } } },
      // OR Lead avec contact (au moins email)
      { lead: { email: { not: null } } },
      // OR Pépite Opus≥7 (signal contextuel fort, peut justifier malgré scores bas)
      { score: { gte: 7 } },
    ];
  }
  if (withLead === "true") {
    // Combine avec le filtre OR ci-dessus via AND implicite Prisma
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
    // Ordre v3.9+ (chantier D1) : priorityScore en priorité (composite intelligent
    // score×fraîcheur+multi-source). Fallback isHot+score+capturedAt+dataQuality
    // pour les triggers pas encore recomputés (priorityScore null).
    orderBy: [
      { priorityScore: { sort: "desc", nulls: "last" } },
      { isHot: "desc" },
      { score: "desc" },
      { capturedAt: "desc" },
      { lead: { dataQuality: "desc" } },
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
      // Chantier D1 — Scores intelligents v3.9+ (rendus visibles en UI)
      priorityScore: true,
      freshnessScore: true,
      multiSourceBoost: true,
      lead: {
        select: {
          id: true,
          dataQuality: true,
          emailConfidence: true,
          emailSourceCount: true,
          email: true,
          kasprPhone: true,
          phoneFullenrich: true,
          phone: true,
          linkedinUrl: true,
          linkedinSource: true,
          personaTier: true,
          personaSource: true,
          bouncedAt: true,
          doNotContact: true,
          doNotContactReason: true,
          pitchJson: true,
          callBriefJson: true,
          linkedinDmJson: true,
          // Chantier D1 — Fit Score v4.2 (rendu visible en UI)
          fitScore: true,
          fitScoreBreakdown: true,
          linkedinProfileEnrichedAt: true,
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

  // Dedup cross-source : 29/04 audit terrain — Asys ressort 2× car 2 sources
  // (theirstack + apify) ont détecté la même boîte avec scores différents.
  // On collapse à 1 ligne par (clientId, companySiret OR companyName), en
  // gardant le trigger au score le plus élevé (et hot=true en priorité).
  // Les autres triggers restent en DB pour audit/cross-source merge, mais
  // l'UI affiche la pépite synthétisée.
  const dedupKey = (t: typeof triggers[number]): string =>
    `${t.companySiret ?? t.companyName.toLowerCase()}`;
  const byKey = new Map<string, typeof triggers[number]>();
  for (const t of triggers) {
    const k = dedupKey(t);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, t);
      continue;
    }
    // Keep the one with higher score; tie-break on isHot then capturedAt
    const aBetter =
      t.score > existing.score ||
      (t.score === existing.score && t.isHot && !existing.isHot) ||
      (t.score === existing.score && t.isHot === existing.isHot && t.capturedAt > existing.capturedAt);
    if (aBetter) byKey.set(k, t);
  }
  const deduped = Array.from(byKey.values()).sort((a, b) => {
    // Chantier D1 : priorityScore prioritaire (composite intelligent v3.9+).
    // Triggers sans priorityScore (pas encore recomputés) en fin de liste.
    const ap = a.priorityScore ?? -1;
    const bp = b.priorityScore ?? -1;
    if (ap !== bp) return bp - ap;
    if (a.isHot !== b.isHot) return a.isHot ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
  });

  return NextResponse.json(deduped);
}
