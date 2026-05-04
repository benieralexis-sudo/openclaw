import "server-only";
import { getAnthropic, QUALIFY_MODEL } from "@/lib/anthropic";
import { buildCachedSystem } from "@/lib/anthropic-prompt";
import { db } from "@/lib/db";

/**
 * Qualifie un Trigger via Claude Opus 4.7 et écrit le score composite
 * dans Trigger.score (1-10) + Trigger.scoreReason.
 *
 * Utilisé en post-création par theirstack-poller et webhook Rodz pour
 * que le score Trigger reflète l'ICP fit réel (NAF + persona + freshness)
 * et pas juste la force du signal brut.
 *
 * Idempotent : skip si Trigger.scoreReason déjà rempli.
 */

interface QualifyResult {
  opusScore: number; // 1-10
  reason: string;
  isHot: boolean;
}

// Extrait la description complète depuis rawPayload (Apify/TheirStack/Rodz).
// Trigger.detail est tronqué à 600 chars en amont (apify-poller.ts:211/393/433),
// ce qui prive Opus des signaux durs : "200 collaborateurs", "3 jours en présentiel",
// "chez nos clients grands comptes", "7600 talents". On fallback sur detail si rien.
const FULL_DESC_MAX_CHARS = 4000;
const FULL_DESC_FIELDS = [
  "description",
  "descriptionText",
  "jobDescription",
  "summary",
  "fullDescription",
] as const;
function extractFullDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const f of FULL_DESC_FIELDS) {
    const v = p[f];
    if (typeof v === "string" && v.length > 100) {
      return v.slice(0, FULL_DESC_MAX_CHARS);
    }
  }
  return null;
}

// C4+C5 — Patterns rédhibitoires détectés dans le titre OU la description
// complète AVANT même le scoring Opus. Évite de cramer des tokens Opus sur
// des leads qu'on est sûr à 100% de rejeter (régie ESN, freelance/stage/
// alternance, présentiel obligatoire, mention oversize >250 collaborateurs).
//
// Si HIGH match → force score=2 + status=IGNORED, raison tracée. Skip Opus.
//
// Patterns issus de l'audit forensique 04/05 sur les 7 rejets Fred + 17
// patterns HIGH sur 39 leads (agent #3 audit total C). Ces 5 patterns
// auraient évité Byron, WeFiiT, Onepoint, INFORMATIS, ChapsVision, Vif,
// Deodis, Bizzdesign, L'Atelier, Hubvisory, Digistrat, Linkup Partner.
const PRE_OPUS_REJECT_PATTERNS: Array<{ pattern: RegExp; label: string; field: "title" | "description" | "both" }> = [
  // C4 — Régie ESN : "chez nos clients", "client final", "en régie",
  // "dans le cadre d'un projet [chez/client/partenaire]", "en immersion chez",
  // "intervention chez", "contrat de prestation chez"
  { pattern: /chez\s+(un\s+de\s+)?nos?\s+clients?|client\s+final|\ben\s+régie\b|sur\s+(le\s+)?site\s+du\s+client|consultant\s+en\s+régie|équipe.*chez\s+notre\s+client|mission\s+chez\s+(un\s+de\s+)?nos?\s+clients?|en\s+immersion\s+chez\s+nos?\s+(clients?|partenaires?)|dans\s+le\s+cadre\s+d['']un\s+projet\s+(chez|d['']envergure\s+chez|client)/i, label: "regie-esn", field: "description" },
  // C5a — Freelance / portage / mission courte dans le titre = pas un pain
  // QA pérenne, DTL vend du long terme. Aussi détecte "Independant".
  { pattern: /\b(freelance|indépendant|en\s+portage|portage\s+salarial|mission\s+courte|consultant\s+indépendant)\b/i, label: "freelance-indep", field: "title" },
  // C5b — Alternance / Stage / Apprenti dans le titre = recrutement junior,
  // pas un signal d'investissement QA structurel.
  { pattern: /\b(alternance|alternant|alternant\(e\)|apprenti|apprentissage|stage|stagiaire|stagiair\(e\))\b/i, label: "junior-contract", field: "title" },
  // C5c — Présentiel obligatoire : DTL est offshore Bucarest 100% remote.
  // Détecte "5 jours sur site", "100% présentiel", "aucun télétravail",
  // "obligatoire au bureau", "PAS DE FULL REMOTE NI SOUS TRAITANCE" etc.
  { pattern: /présentiel\s+obligatoire|5\s*jours?\s+(sur\s+site|de\s+présentiel|au\s+bureau|en\s+présentiel)|100\s*%\s+(présentiel|sur\s+site|on.?site)|aucun\s+télétravail|pas\s+de\s+(full\s+)?remote|obligatoire\s+au\s+bureau|sur\s+place\s+chez\s+(un\s+de\s+)?nos?\s+clients?/i, label: "onsite-only", field: "description" },
  // C5d — Mention oversize : si le texte annonce >250 collaborateurs/talents/
  // employés, c'est qu'on est sur une boîte hors-ICP DTL (PME 11-200).
  // 3 chiffres consécutifs avec mention de personnel.
  { pattern: /(?:[2-9]\d{2,}|\d{4,})\s*(collaborateurs?|talents?|salariés?|consultants?|employees?|employés?)\b/i, label: "oversized-text", field: "description" },
];

function preOpusRejectScan(
  title: string,
  description: string,
): { reject: boolean; label: string | null } {
  for (const { pattern, label, field } of PRE_OPUS_REJECT_PATTERNS) {
    if (field === "title" || field === "both") {
      if (pattern.test(title)) return { reject: true, label };
    }
    if (field === "description" || field === "both") {
      if (pattern.test(description)) return { reject: true, label };
    }
  }
  return { reject: false, label: null };
}

// Fix L — Détection des "aveux d'hedging" dans la reason d'Opus.
// Quand Opus donne un score >=7 mais avoue dans sa reason un mismatch ICP
// ("hors ICP", "non whitelist", "grand groupe", "atypique"…), on downgrade.
// Override le plancher trusted-sources : une levée Rodz scorée 8 sur
// "Audion AdTech hors ICP édition logiciels" doit retomber à 4.
//
// Sévérité variable selon présence d'un marqueur ICP positif fort :
// - Hedging seul → hard downgrade vers 4 (Audion, cobl, HrFlow)
// - Hedging + marqueur positif ("ICP fit", "parfait match", "signal QA fort")
//   → soft downgrade -2 min 5 (Kestra "ICP-fit software Paris mais NAF atypique"
//   reste à 6, ne tombe pas en rejet — Kestra est notre seul WON 30j).
const HEDGING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /hors\s+ICP/i, label: "hors-icp" },
  { pattern: /non\s+whitelist/i, label: "non-whitelist" },
  { pattern: /NAF\s+(?:non\s+)?(?:whitelist|atypique)/i, label: "naf-atypique" },
  { pattern: /\bdata\s+(?:incomplete|incomplet|manquante)/i, label: "data-incomplete" },
  { pattern: /\bà\s+(?:valider|confirmer)\s+manuellement/i, label: "a-valider-manuel" },
  { pattern: /\bgrand\s+groupe\b/i, label: "grand-groupe" },
  { pattern: />\s?(?:200|250|300|500|1000|2000|5000|10000)\s?p\b/i, label: "oversized" },
  { pattern: /(?:[2-9]|[1-9]\d)\s?\d{3}\s+(?:collaborateurs|talents|salariés|consultants|employees|employés)/i, label: "oversized-text" },
  { pattern: /signal\s+faible/i, label: "signal-faible" },
  { pattern: /hire\s+(?:généraliste|junior)\s+non\s+QA/i, label: "hire-non-qa" },
  { pattern: /industrie\s+non\s+résolu/i, label: "industrie-non-resolue" },
];
const POSITIVE_ICP_MARKERS: RegExp[] = [
  /\bICP[-\s]+(?:fit|parfait|match)/i,
  /parfait\s+match\s+ICP/i,
  /match\s+(?:parfait\s+)?ICP/i,
  /signal\s+QA\s+fort/i,
  /ICP\s+fit\s+software/i,
];
const HEDGING_HARD_FLOOR = 4;
const HEDGING_SOFT_DELTA = 2;
const HEDGING_SOFT_MIN = 5;
function detectOpusHedging(
  score: number,
  reason: string,
): { score: number; reason: string; matchedLabel: string | null; softened: boolean } {
  if (score < 7) return { score, reason, matchedLabel: null, softened: false };
  const hasPositiveMarker = POSITIVE_ICP_MARKERS.some((p) => p.test(reason));
  for (const { pattern, label } of HEDGING_PATTERNS) {
    if (pattern.test(reason)) {
      const newScore = hasPositiveMarker
        ? Math.max(score - HEDGING_SOFT_DELTA, HEDGING_SOFT_MIN)
        : Math.min(score, HEDGING_HARD_FLOOR);
      return {
        score: newScore,
        reason: `[Fix L hedging:${label}${hasPositiveMarker ? "/soft" : ""}] ${reason}`,
        matchedLabel: label,
        softened: hasPositiveMarker,
      };
    }
  }
  return { score, reason, matchedLabel: null, softened: false };
}

// Fix H1 (04/05) — Refonte SYSTEM prompt utilisant buildCachedSystem.
// Avant : SYSTEM local ~950 tokens dupliquait STABLE_PREAMBLE (Contexte/Moat/
// Boosters) → en dessous du seuil 1024 tk Anthropic → cache_control: ephemeral
// silencieusement IGNORÉ → ~$13/mois gaspillé sur ~30 calls/jour.
// Maintenant : QUALIFY_SPECIFIC contient UNIQUEMENT la spec qualify (mission,
// rubrique, pénalités, échelle, FEW-SHOTS, format). buildCachedSystem() ajoute
// le STABLE_PREAMBLE (~510 tk) → total ~1100 tk → cache OK.
//
// Few-shots ajoutés résolvent aussi la variance constatée Onepoint=4 vs
// ALTEN=2 (même profil ESN géante hors ICP, scorés différemment) en
// fournissant à Opus des ancres concrètes.
const QUALIFY_SPECIFIC = `

## Mission de qualification
Tu reçois un Trigger fraîchement capté + l'ICP du client. Retourne un score 1-10 strict + une raison courte (max 200 chars, citer 1 élément concret).

## Rubrique scoring (4 axes, poids égaux)
1. **ICP fit** — industrie / NAF whitelist / taille / région matchent ?
2. **Signal strength** — vrai déclencheur d'achat (levée fraîche, hire clé QA/Test senior, M&A, C-level change) vs bruit (job junior, alternance, mentorat, RH) ?
3. **Persona match** — décisionnaire (CTO, CEO, Founder, Head of Eng, VP Eng) vs périphérique (RH, junior, stagiaire) ?
4. **Freshness** — <7j = boost, >30j = malus, >90j = exclure.

## Fiabilité des sources (calibration)
- \`apify.wttj-jobs\` : board d'éditeurs SaaS FR — très haute fiabilité
- \`apify.linkedin-jobs\` : moyenne, vérifier ICP / pays
- \`apify.indeed-jobs\` : généraliste (souvent désactivé) — beaucoup de bruit
- \`rodz.fundraising\` / \`rodz.job-changes\` / \`rodz.mergers-acquisitions\` : signaux durs vérifiés
- \`bodacc.*\` / \`joafe.*\` / \`inpi.*\` : sources officielles, attribution SIREN garantie
- \`theirstack.buying-intent\` : déclaratif (utilise outils QA), vérifier industrie
- \`francetravail.tech\` : Pôle Emploi OAuth — souvent ESN qui sourcent pour client final

## Règles de pénalité automatique
- Hors France (country_code != FR, suffixes GmbH/AG/SE/BV/NV/Ltd/PLC/Inc/LLC/SpA/Srl/SL/SA dans le nom) → score ≤ 2
- Holding / SCI / cabinet comptable / mairie / agglo / université → score ≤ 3
- ICP antiPersonas matché (concurrent direct, ex: Capgemini, Sopra, Onepoint, Alten, Amaris) → score ≤ 2
- Effectif > 5× max ICP (ex: ICP 200p, lead >1000p) → score ≤ 2 systématique
- Effectif 1.5×-5× max ICP → score ≤ 4
- Régie ESN détectée ("chez nos clients", "client final", "en régie") → score ≤ 3
- Freelance / alternance / stage dans le titre → score ≤ 3
- NAF connu mais hors whitelist client → score ≤ 5
- Données critiques manquantes (NAF + taille tous deux non résolus) → score ≤ 5

## Échelle finale
- 9-10 : signal HOT, à attaquer dans les 24h (levée fraîche / hire QA Senior frais + ICP parfait + persona accessible)
- 7-8 : qualifié, queue commerciale (ICP fit fort, 1 doute mineur OK)
- 5-6 : à valider manuellement, doute sur ICP fit
- 3-4 : marginal, hors-ICP léger / signal faible / taille trop grande
- 1-2 : exclure (hors France, hors taille majeur, anti-persona)

## Few-shots (calibration)
- Éditeur SaaS FR 50p NAF 5829C, hire QA Engineer <7j, CTO accessible → 9
- ESN FR 80p NAF 6202A, hire QA Lead Paris <14j, taille à confirmer → 8
- Cabinet conseil 70.22Z FR 80p, hire QA Manager <30j → 6 (NAF border)
- Boîte FR taille inconnue NAF non résolu, hire QA générique → 4
- ESN 3000p hire QA pour client final assurance (régie) → 3
- Capgemini/Sopra/Atos/Onepoint/Alten/Amaris hire QA → 1 (anti-persona concurrent)
- Boîte allemande GmbH hire QA Berlin → 1 (hors-FR)
- Holding SCI / mairie / SAS de capitaux → 2 (hors ICP structurel)
- ALTEN 39000p toutes filiales — score 1, pas 4 (oversize 195× ICP)

## Format de réponse OBLIGATOIRE
Réponds UNIQUEMENT en JSON valide, sans markdown, sans préfixe :
{"score": <int 1-10>, "reason": "<1-2 phrases ≤200 chars citant 1 élément concret du trigger>"}

## Règles non négociables
- Ne JAMAIS recommander d'action LinkedIn auto (engagement = manuel humain).
- Réponses TOUJOURS en français sauf indication contraire.
- Si le signal manque d'informations critiques (NAF non résolu, taille inconnue), score ≤ 5 par prudence avec mention "data incomplete" dans reason.`;

export async function qualifyTrigger(
  triggerId: string,
  opts: { force?: boolean } = {},
): Promise<QualifyResult | null> {
  const trigger = await db.trigger.findUnique({
    where: { id: triggerId },
    include: { client: { select: { name: true, icp: true } } },
  });
  if (!trigger) return null;
  if (trigger.scoreReason && !opts.force) {
    return { opusScore: trigger.score, reason: trigger.scoreReason, isHot: trigger.isHot };
  }
  if (!trigger.client?.icp) return null;

  const icp = trigger.client.icp as Record<string, unknown>;
  const fullDesc = extractFullDescription(trigger.rawPayload);
  const detailToSend = fullDesc ?? trigger.detail ?? "(vide)";

  // C4+C5 — Pre-Opus reject scan : si pattern HIGH match (régie ESN, freelance,
  // alternance/stage, présentiel obligatoire, oversize >250p), on skip Opus
  // et on archive direct. Économise tokens + évite faux Brûlants en haut du dash.
  const preReject = preOpusRejectScan(trigger.title ?? "", fullDesc ?? trigger.detail ?? "");
  if (preReject.reject) {
    const rejectReason = `[C4-C5 pre-opus-reject:${preReject.label}] Pattern rédhibitoire détecté avant scoring Opus`;
    console.log(`[qualify-trigger.C4C5] ${triggerId}: IGNORED auto (${preReject.label})`);
    await db.trigger.update({
      where: { id: triggerId },
      data: {
        score: 2,
        scoreReason: rejectReason,
        isHot: false,
        status: "IGNORED",
      },
    });
    return { opusScore: 2, reason: rejectReason, isHot: false };
  }
  const userPrompt = `CLIENT : ${trigger.client.name}
ICP : ${JSON.stringify({
    industries: icp.industries,
    sizes: icp.sizes,
    naf_codes: icp.naf_codes, // C13 — NAF whitelist envoyée à Opus
    personaTitles: icp.personaTitles,
    keywordsHiring: icp.keywordsHiring,
    antiPersonas: icp.antiPersonas,
    preferredSignals: icp.preferredSignals, // C13 — pondération signaux DTL
    minScore: icp.minScore, // C13 — seuil de qualification
  })}

LEAD :
- Entreprise : ${trigger.companyName}
- SIRET/SIREN : ${trigger.companySiret ?? "non résolu"}
- NAF : ${trigger.companyNaf ?? "?"}
- Industrie : ${trigger.industry ?? "?"}
- Région : ${trigger.region ?? "?"}
- Taille : ${trigger.size ?? "?"}

SIGNAL :
- Type : ${trigger.type}
- Source : ${trigger.sourceCode}
- Titre : ${trigger.title}
- Détail : ${detailToSend}
- Capté : ${trigger.capturedAt.toISOString()}
- Publié : ${trigger.publishedAt?.toISOString() ?? "?"}

Évalue ce lead pour ${trigger.client.name}.`;

  let opusScore = 5;
  let reason = "Évaluation par défaut (Opus indisponible)";

  try {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      model: QUALIFY_MODEL,
      max_tokens: 200,
      system: buildCachedSystem(QUALIFY_SPECIFIC),
      messages: [{ role: "user", content: userPrompt }],
    });
    // Instrumentation cache (audit 03/05) : log structuré JSON pour mesurer
    // hit rate effectif sur 24-48h et calibrer estimation coût qualify.
    // Format compact pour parsing journalctl ultérieur.
    const u = resp.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    console.log(
      `[qualify-trigger.usage] ${JSON.stringify({
        triggerId,
        model: QUALIFY_MODEL,
        in: u.input_tokens ?? 0,
        out: u.output_tokens ?? 0,
        cache_create: u.cache_creation_input_tokens ?? 0,
        cache_read: u.cache_read_input_tokens ?? 0,
      })}`,
    );
    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { score?: number; reason?: string };
      if (typeof parsed.score === "number") {
        opusScore = Math.round(Math.min(10, Math.max(1, parsed.score)));
      }
      if (typeof parsed.reason === "string") reason = parsed.reason.slice(0, 200);
    }
  } catch (e) {
    console.warn(`[qualify-trigger] Opus error for ${triggerId}:`, e instanceof Error ? e.message : e);
    return null;
  }

  // Plancher de score pour sources fiables (signal d'achat fort garanti).
  // Une levée de fonds = cash frais + recrutements imminents + pression scaling
  // = signal d'achat majeur, mérite score 8. Job change CTO/Tech Lead idem.
  //
  // CONDITION 04/05 (C2) : le plancher s'applique UNIQUEMENT si secteur ICP-fit.
  // Une levée Audion (AdTech), Decade Energy (renewable), cobl (commerce gros)
  // ou HrFlow.ai (RH) ne mérite PAS un score 8 forcé pour DTL — ce ne sont pas
  // des éditeurs SaaS B2B / ESN tech. Sans ce check, le plancher trusted écrasait
  // l'analyse fine d'Opus et rendait Fix L obligé de rattraper en aval.
  const TRUSTED_SOURCES_MIN_SCORE: Record<string, number> = {
    "rodz.fundraising": 8,                    // levée = jackpot
    "rodz.mergers-acquisitions": 8,           // M&A = restructuring
    "rodz.job-changes": 8,                    // C-level change = budget freed
    "bodacc.capital-increase": 8,             // augmentation capital = pré-levée
    "trigger-engine.funding-recent": 8,       // levée détectée RSS presse spé
  };
  const minFloor = TRUSTED_SOURCES_MIN_SCORE[trigger.sourceCode];
  if (minFloor && opusScore < minFloor) {
    // Check 1 : NAF dans la whitelist ICP du client (icp.naf_codes)
    const icpNafCodes = (icp.naf_codes as string[] | undefined) ?? [];
    const naf = (trigger.companyNaf ?? "").replace(/\./g, "");
    const nafMatchIcp = icpNafCodes.some((c) => naf.startsWith(c.replace(/\./g, "")));
    // Check 2 : industry annoncée par la source contient un mot-clé ICP
    const icpIndustries = (icp.industries as string[] | undefined) ?? [];
    const industryStr = (trigger.industry ?? "").toLowerCase();
    const industryMatchIcp = icpIndustries.some((i) =>
      industryStr.includes(i.toLowerCase().split(/\s/)[0] ?? ""),
    );
    // Si AUCUN des deux signaux ICP-fit, on ne force PAS le plancher.
    // Le score Opus reste tel quel — Fix L et l'analyse fine décident.
    if (nafMatchIcp || industryMatchIcp) {
      reason = `[Score plancher ${minFloor}/10 source fiable + secteur ICP] ${reason}`;
      opusScore = minFloor;
    } else {
      console.log(
        `[qualify-trigger.C2] ${triggerId}: plancher ${minFloor} NON appliqué (secteur hors ICP) sourceCode=${trigger.sourceCode} naf=${trigger.companyNaf} industry=${trigger.industry}`,
      );
    }
  }

  // Fix L — Override le plancher trusted-source si Opus a détecté un mismatch
  // ICP dans sa propre reason. Évite "Audion 8 Rodz fundraising hors ICP édition".
  const hedged = detectOpusHedging(opusScore, reason);
  if (hedged.matchedLabel) {
    console.log(
      `[qualify-trigger.fix-L] ${triggerId}: ${opusScore} → ${hedged.score} (hedging:${hedged.matchedLabel}${hedged.softened ? "/soft" : ""})`,
    );
    opusScore = hedged.score;
    reason = hedged.reason;
  }

  const isHot = opusScore >= 9;

  // C3 — Filtre minScore client : si score final < icp.minScore, le trigger
  // ne sera jamais actionnable. Au lieu de le laisser pollute le pool dashboard
  // (audit 04/05 : 49 triggers score<5 visibles malgré minScore=7), on le
  // passe en IGNORED auto avec raison traceable. Le seuil minScore vient de
  // Client.icp.minScore (7 pour DTL). Sans minScore défini → pas de filtre.
  const icpMinScore = typeof icp.minScore === "number" ? icp.minScore : null;
  const belowMinScore = icpMinScore !== null && opusScore < icpMinScore;
  await db.trigger.update({
    where: { id: triggerId },
    data: {
      score: opusScore,
      scoreReason: belowMinScore
        ? `[C3 below_min_score:${opusScore}<${icpMinScore}] ${reason}`
        : reason,
      isHot,
      ...(belowMinScore ? { status: "IGNORED" as const } : {}),
    },
  });
  if (belowMinScore) {
    console.log(
      `[qualify-trigger.C3] ${triggerId}: IGNORED auto (score=${opusScore} < minScore=${icpMinScore})`,
    );
  }

  return { opusScore, reason, isHot };
}

/**
 * Qualifie tous les Triggers d'un client qui n'ont pas encore été évalués
 * par Opus (scoreReason = null). Limite par batch pour budget tokens.
 */
export async function qualifyPendingTriggers(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<{ qualified: number; errors: number }> {
  const limit = opts.limit ?? 30;
  const pending = await db.trigger.findMany({
    where: {
      clientId,
      scoreReason: null,
      deletedAt: null,
    },
    select: { id: true },
    take: limit,
    orderBy: { capturedAt: "desc" },
  });
  let qualified = 0;
  let errors = 0;
  for (const t of pending) {
    try {
      const r = await qualifyTrigger(t.id);
      if (r) qualified += 1;
    } catch {
      errors += 1;
    }
  }
  return { qualified, errors };
}
