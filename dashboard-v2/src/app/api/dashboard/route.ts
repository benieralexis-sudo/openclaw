import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { combineScores, dedupTodoByCompany, type TodoItem } from "@/lib/todo-today";
import { getActivePillars } from "@/lib/signal-config";
import { SIGNAL_NAMES } from "@/lib/signal-mapping";

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("clientId");
  const scope = resolveClientScope(s.user, requested);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const where = scope.clientId
    ? { clientId: scope.clientId, deletedAt: null }
    : { deletedAt: null };

  // 12/05 nuit — Cache les triggers dont le Lead est en INCOMPLETE
  // (= sans persona enrichie, donc non actionable côté Fred).
  // Le retry tente jusqu'à J+7, après quoi HEAL 8C archive. Tant que
  // c'est INCOMPLETE, on ne pollue pas le dashboard avec des leads à demi cuits.
  const whereVisible = {
    ...where,
    OR: [
      { lead: null },
      { lead: { status: { not: "INCOMPLETE" as const } } },
    ],
  };

  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const sinceWeek = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const since48h = new Date(Date.now() - 48 * 60 * 60_000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  // Stratégie V1 (17/05) — Charge les 3 piliers actifs du client pour
  // calculer les stats par pilier et les combos. Ne tourne que si un
  // client est dans le scope (admin sans client → null = pas de stats).
  const activePillars = scope.clientId
    ? await getActivePillars(scope.clientId)
    : [];

  // V1 18/05 — Charge le statut crédits + cap du client (compteur dashboard).
  const clientCredits = scope.clientId
    ? await db.client.findUnique({
        where: { id: scope.clientId },
        select: {
          plan: true,
          creditsBalance: true,
          creditsMonthlyQuota: true,
          pepitesThisMonth: true,
          pepitesGuaranteed: true,
          creditsLastResetAt: true,
          activatedAt: true,
        },
      })
    : null;

  const [
    triggers24h,
    triggersPrev24h,
    pepites,
    pepitesPrev,
    bookedThisWeek,
    bookedPrevWeek,
    pipeline,
    recentTriggers,
    delaySamples,
    todoCandidates,
    pillarTriggers7d,
    pillarTriggers30d,
    comboCandidates,
  ] = await Promise.all([
    db.trigger.count({ where: { ...where, capturedAt: { gte: since24h } } }),
    db.trigger.count({
      where: { ...where, capturedAt: { gte: since48h, lt: since24h } },
    }),
    db.trigger.count({ where: { ...where, isHot: true, capturedAt: { gte: since24h } } }),
    db.trigger.count({
      where: { ...where, isHot: true, capturedAt: { gte: since48h, lt: since24h } },
    }),
    db.trigger.count({
      where: { ...where, status: "BOOKED", updatedAt: { gte: sinceWeek } },
    }),
    db.trigger.count({
      where: {
        ...where,
        status: "BOOKED",
        updatedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60_000), lt: sinceWeek },
      },
    }),
    db.trigger.groupBy({ by: ["status"], where, _count: true }),
    db.trigger.findMany({
      where: { ...whereVisible, isHot: true },
      orderBy: [{ score: "desc" }, { capturedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        companyName: true,
        industry: true,
        region: true,
        title: true,
        detail: true,
        score: true,
        isCombo: true,
        capturedAt: true,
        // Refactor V2-only Session 2 — expose verdict V2 au dashboard
        briefV2Json: true,
        lead: {
          select: {
            id: true,
            email: true,
            kasprPhone: true,
            phone: true,
            pitchJson: true,
            callBriefJson: true,
            linkedinDmJson: true,
            status: true,
          },
        },
      },
    }),
    // Échantillon pour calculer le délai signal → vous (capturedAt → publishedAt)
    db.trigger.findMany({
      where: {
        ...where,
        capturedAt: { gte: since24h },
        publishedAt: { not: null },
      },
      select: { capturedAt: true, publishedAt: true },
      take: 100,
    }),
    // Chantier D3 (01/05) — Todo du jour : tri par priorityScore composite
    // (intègre fraîcheur + multi-source v3.9). Overshoot 30 pour dédupliquer
    // par société côté code et obtenir 5 sociétés distinctes.
    db.trigger.findMany({
      where: {
        ...where,
        priorityScore: { not: null },
        // 12/05 nuit — Lead non INCOMPLETE.
        // 13/05 fix Sêmeia — autorise aussi triggers sans Lead direct (cas
        // ensureLeadsForAllTriggers skip 2e trigger d'une boîte déjà couverte
        // par un Lead actif). Sinon les briefs hot multi-source du 2e signal
        // (rss-levees post-wttj sur Sêmeia, isHot=t, priorityScore=24) sont
        // invisibles côté Fred sur la todo. Aligné sur triggers/route.ts:79.
        OR: [
          { lead: null },
          { lead: { status: { not: "INCOMPLETE" } } },
        ],
      },
      orderBy: [
        { priorityScore: { sort: "desc", nulls: "last" } },
        { capturedAt: "desc" },
      ],
      take: 30,
      select: {
        id: true,
        companyName: true,
        companySiret: true,
        title: true,
        score: true,
        priorityScore: true,
        freshnessScore: true,
        multiSourceBoost: true,
        capturedAt: true,
        lead: {
          select: {
            firstName: true,
            lastName: true,
            jobTitle: true,
            email: true,
            kasprWorkEmail: true,
            emailFullenrich: true,
            kasprPhone: true,
            phoneFullenrich: true,
            phone: true,
            linkedinUrl: true,
            fitScore: true,
          },
        },
      },
    }),
    // V1 17/05 — Triggers des 7 derniers jours sur les piliers du client.
    // Permet de calculer (a) leads par pilier 7j (b) combos cross-pillar 7j.
    activePillars.length > 0
      ? db.trigger.findMany({
          where: {
            ...where,
            signalCode: { in: activePillars },
            capturedAt: { gte: sinceWeek },
          },
          select: { companySiret: true, companyName: true, signalCode: true },
        })
      : Promise.resolve([] as { companySiret: string | null; companyName: string; signalCode: string | null }[]),
    // V1 17/05 — Idem sur 30j (volume info par pilier).
    activePillars.length > 0
      ? db.trigger.findMany({
          where: {
            ...where,
            signalCode: { in: activePillars },
            capturedAt: { gte: since30d },
          },
          select: { signalCode: true },
        })
      : Promise.resolve([] as { signalCode: string | null }[]),
    // V1 17/05 — Triggers combo (isCombo=true) candidats à l'affichage
    // "Combos du jour". Overshoot 30 pour dédupliquer par société.
    activePillars.length > 0
      ? db.trigger.findMany({
          where: {
            ...whereVisible,
            isCombo: true,
            capturedAt: { gte: sinceWeek },
            signalCode: { in: activePillars },
          },
          orderBy: [
            { priorityScore: { sort: "desc", nulls: "last" } },
            { capturedAt: "desc" },
          ],
          take: 30,
          select: {
            id: true,
            companyName: true,
            companySiret: true,
            industry: true,
            region: true,
            title: true,
            signalCode: true,
            score: true,
            priorityScore: true,
            capturedAt: true,
            briefV2Json: true,
            lead: {
              select: {
                id: true,
                email: true,
                kasprPhone: true,
                phone: true,
                status: true,
              },
            },
          },
        })
      : Promise.resolve([] as Array<{
          id: string;
          companyName: string;
          companySiret: string | null;
          industry: string | null;
          region: string | null;
          title: string;
          signalCode: string | null;
          score: number;
          priorityScore: number | null;
          capturedAt: Date;
          briefV2Json: unknown;
          lead: {
            id: string;
            email: string | null;
            kasprPhone: string | null;
            phone: string | null;
            status: string;
          } | null;
        }>),
  ]);

  // Calcul avgDelayMin : moyenne (capturedAt - publishedAt) en minutes
  let avgDelayMin = 0;
  if (delaySamples.length > 0) {
    const deltas = delaySamples
      .map((t) => {
        if (!t.publishedAt) return null;
        const delta = (t.capturedAt.getTime() - t.publishedAt.getTime()) / 60_000;
        return delta > 0 ? delta : null;
      })
      .filter((d): d is number => d !== null);
    if (deltas.length > 0) {
      avgDelayMin = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    }
  }

  const pipelineCounts = pipeline.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = p._count;
    return acc;
  }, {});

  const totalQualified =
    (pipelineCounts.NEW ?? 0) +
    (pipelineCounts.CONTACTED ?? 0) +
    (pipelineCounts.REPLIED ?? 0) +
    (pipelineCounts.BOOKED ?? 0);
  const contacted =
    (pipelineCounts.CONTACTED ?? 0) +
    (pipelineCounts.REPLIED ?? 0) +
    (pipelineCounts.BOOKED ?? 0);
  const replied = (pipelineCounts.REPLIED ?? 0) + (pipelineCounts.BOOKED ?? 0);
  const booked = pipelineCounts.BOOKED ?? 0;

  // V1 17/05 — Agrégation stats par pilier + combos cross-pillar.
  // Groupe les triggers 7j par société (SIRET prioritaire, sinon nom).
  // Une société peut avoir 1, 2 ou 3 signaux du client → combo si >= 2.
  const companyToPillars = new Map<string, Set<string>>();
  for (const t of pillarTriggers7d) {
    if (!t.signalCode) continue;
    const key = (t.companySiret || t.companyName).trim().toLowerCase();
    if (!companyToPillars.has(key)) companyToPillars.set(key, new Set());
    companyToPillars.get(key)!.add(t.signalCode);
  }

  // Compte global Pépite (2+ piliers) et Diamant (3+ piliers) sur 7j.
  let pepiteCount7d = 0;
  let diamantCount7d = 0;
  for (const set of companyToPillars.values()) {
    if (set.size >= 3) diamantCount7d += 1;
    else if (set.size >= 2) pepiteCount7d += 1;
  }

  // Pour chaque pilier : nb leads 7j, nb leads 30j, nb Pépites où ce pilier participe.
  // Une "Pépite participée" = société qui a >= 2 piliers ET dont ce pilier fait partie.
  const pillarStats: Record<string, { leads7d: number; leads30d: number; pepites7d: number }> = {};
  for (const code of activePillars) {
    pillarStats[code] = { leads7d: 0, leads30d: 0, pepites7d: 0 };
  }
  for (const t of pillarTriggers7d) {
    const stat = t.signalCode ? pillarStats[t.signalCode] : undefined;
    if (stat) stat.leads7d += 1;
  }
  for (const t of pillarTriggers30d) {
    const stat = t.signalCode ? pillarStats[t.signalCode] : undefined;
    if (stat) stat.leads30d += 1;
  }
  for (const [, set] of companyToPillars) {
    if (set.size >= 2) {
      for (const code of set) {
        const stat = pillarStats[code];
        if (stat) stat.pepites7d += 1;
      }
    }
  }

  const pillarsSummary = activePillars.map((code) => ({
    code,
    name: SIGNAL_NAMES[code] ?? code,
    leads7d: pillarStats[code]?.leads7d ?? 0,
    leads30d: pillarStats[code]?.leads30d ?? 0,
    pepites7d: pillarStats[code]?.pepites7d ?? 0,
  }));

  // Combos enrichis : pour chaque trigger combo candidat, on calcule les piliers
  // convergents (depuis companyToPillars déjà mappé), puis dédup par société,
  // top 5. Évite N requêtes DB supplémentaires.
  type ComboItem = {
    id: string;
    companyName: string;
    industry: string | null;
    region: string | null;
    title: string;
    signalCode: string | null;
    score: number;
    capturedAt: string;
    pillarsConverged: string[];
    pillarNames: string[];
    tier: "pepite" | "diamant";
    briefV2Json: unknown;
    hasContact: boolean;
    leadId: string | null;
  };
  const seenCompanies = new Set<string>();
  const combos: ComboItem[] = [];
  for (const t of comboCandidates) {
    const key = (t.companySiret || t.companyName).trim().toLowerCase();
    if (seenCompanies.has(key)) continue;
    const pillarsSet = companyToPillars.get(key);
    if (!pillarsSet || pillarsSet.size < 2) continue; // safety : doit avoir convergé sur 7j
    seenCompanies.add(key);
    const pillarsArr = [...pillarsSet].sort();
    combos.push({
      id: t.id,
      companyName: t.companyName,
      industry: t.industry,
      region: t.region,
      title: t.title,
      signalCode: t.signalCode,
      score: t.score,
      capturedAt: t.capturedAt.toISOString(),
      pillarsConverged: pillarsArr,
      pillarNames: pillarsArr.map((c) => SIGNAL_NAMES[c] ?? c),
      tier: pillarsSet.size >= 3 ? "diamant" : "pepite",
      briefV2Json: t.briefV2Json,
      hasContact: !!(t.lead?.email || t.lead?.kasprPhone || t.lead?.phone),
      leadId: t.lead?.id ?? null,
    });
    if (combos.length >= 5) break;
  }

  // Chantier D3 — Construction de la todo du jour : map → tri composite → dédup → top 5
  const todoMapped: TodoItem[] = todoCandidates.map((t) => ({
    id: t.id,
    companyName: t.companyName,
    companySiret: t.companySiret,
    firstName: t.lead?.firstName ?? null,
    lastName: t.lead?.lastName ?? null,
    jobTitle: t.lead?.jobTitle ?? null,
    title: t.title,
    score: t.score,
    priorityScore: t.priorityScore,
    freshnessScore: t.freshnessScore,
    multiSourceBoost: t.multiSourceBoost,
    fitScore: t.lead?.fitScore ?? null,
    capturedAt: t.capturedAt.toISOString(),
    hasEmail: !!(t.lead?.email || t.lead?.kasprWorkEmail || t.lead?.emailFullenrich),
    hasPhone: !!(t.lead?.kasprPhone || t.lead?.phoneFullenrich || t.lead?.phone),
    hasLinkedin: !!t.lead?.linkedinUrl,
  }));
  // Re-tri par combinedScore (priority + fit*0.3) puis dédup-by-company
  const todoSorted = [...todoMapped].sort((a, b) => {
    const ca = combineScores(a.priorityScore, a.fitScore);
    const cb = combineScores(b.priorityScore, b.fitScore);
    if (cb !== ca) return cb - ca;
    return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
  });
  const todoToday = dedupTodoByCompany(todoSorted).slice(0, 5);

  return NextResponse.json({
    kpis: {
      signals24h: { value: triggers24h, delta: triggers24h - triggersPrev24h },
      hotPepites: { value: pepites, delta: pepites - pepitesPrev },
      bookedWeek: { value: bookedThisWeek, delta: bookedThisWeek - bookedPrevWeek },
      avgDelayMin: { value: avgDelayMin },
      // V1 17/05 — KPIs stratégie catalogue : Pépites (combo 2+) et Diamants (3+) sur 7j.
      pepiteCombo7d: { value: pepiteCount7d },
      diamantCombo7d: { value: diamantCount7d },
    },
    pipeline: [
      { label: "Signaux qualifiés", value: totalQualified, color: "bg-brand-500" },
      { label: "Contactés", value: contacted, color: "bg-cyan-500" },
      { label: "Réponses positives", value: replied, color: "bg-amber-500" },
      { label: "RDV bookés", value: booked, color: "bg-emerald-500" },
    ],
    recentTriggers,
    todoToday,
    // V1 17/05 — Stratégie catalogue : 3 piliers + combos.
    pillarsSummary,
    combos,
    // V1 18/05 — Crédits + cap (visible uniquement clients GROWTH avec quota fini).
    credits: clientCredits
      ? (() => {
          // Cap visible quand : plan=GROWTH ET quota < 10000 ET balance pas
          // démesurément au-dessus du quota (sinon = dogfood/illimité).
          // iFIND a quota=60 mais balance=999970 → on le masque comme dogfood
          // pour pas afficher "0/60" trompeur.
          const isCapApplicable =
            clientCredits.plan === "GROWTH" &&
            clientCredits.creditsMonthlyQuota < 10000 &&
            clientCredits.creditsBalance <= clientCredits.creditsMonthlyQuota * 4;
          if (!isCapApplicable) return null;
          const used = Math.max(0, clientCredits.creditsMonthlyQuota - clientCredits.creditsBalance);
          const refDate =
            clientCredits.creditsLastResetAt ?? clientCredits.activatedAt ?? null;
          const daysSinceReset = refDate
            ? Math.floor((Date.now() - refDate.getTime()) / 86_400_000)
            : null;
          const daysUntilReset =
            daysSinceReset !== null ? Math.max(0, 30 - daysSinceReset) : null;
          return {
            balance: clientCredits.creditsBalance,
            monthlyQuota: clientCredits.creditsMonthlyQuota,
            used,
            pctUsed: Math.round((used / clientCredits.creditsMonthlyQuota) * 100),
            pepitesThisMonth: clientCredits.pepitesThisMonth,
            pepitesGuaranteed: clientCredits.pepitesGuaranteed,
            capReached: clientCredits.creditsBalance <= 0,
            daysSinceReset,
            daysUntilReset,
          };
        })()
      : null,
  });
}
