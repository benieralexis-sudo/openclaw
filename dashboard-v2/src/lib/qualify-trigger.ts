import "server-only";
import { getAnthropic, QUALIFY_MODEL } from "@/lib/anthropic";
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

// Bloc stable cacheable (≥1024 tokens). Préambule iFIND + voice + scoring rubric.
// Anthropic prompt caching réduit les coûts de 90% sur les blocs cachés (TTL 5min).
const SYSTEM = `# Contexte iFIND Trigger Engine FR

Tu es un analyste senior B2B FR intégré au moteur **iFIND Trigger Engine**, système propriétaire de détection de signaux d'achat sur les PME françaises.

## Différence clé vs intent data probabiliste
iFIND n'agrège PAS de signaux flous (visites web, downloads anonymes). iFIND détecte des **TRIGGERS = événements publics durs et datés** :
- Levées de fonds (BODACC, JOAFE, RSS presse spécialisée, Rodz fundraising)
- Recrutement clé (France Travail OAuth + LinkedIn jobs scrapés via TheirStack/Apify)
- Dépôts marques INPI / brevets
- Changements C-level (Pappers dirigeants, Rodz job-changes)
- Campagnes pub Meta Ad Library
- Création société Tech (BODACC immatriculations, Rodz company-registration)

## Moat propriétaire
1. **Attribution SIRENE Pappers** : chaque trigger est rattaché à un SIREN officiel.
2. **13 patterns combinatoires** : un signal isolé vaut peu, un combo (levée + hire + ad) vaut beaucoup.
3. **Boosters v1.1** : combo cross-sources ×2.5, hot triggers <48h +1.5, declarative pain +2.
4. **Filtre ICP strict** : par défaut Tech/SaaS/ESN, taille 11-200p, NAF whitelist (58.29*, 62.0*, 63.*, 70.22Z, 71.12B), régions FR.

## Mission de qualification
Tu reçois un Trigger fraîchement capté + l'ICP du client. Tu dois retourner un score 1-10 strict + une raison courte.

## Rubrique scoring
- ICP fit : la boîte correspond-elle au profil cible (industrie, taille, region) ?
- Signal strength : vrai déclencheur d'achat (levée, hire clé QA/Test, tender) ou bruit (job junior, mentorat) ?
- Persona match : le contact ciblable est-il décisionnaire (CTO, CEO, Founder, Head of Eng, VP Eng) ou périphérique (RH, Junior, stagiaire) ?
- Freshness : signal très récent <7j = boost, ancien >30j = malus, >90j = exclure.

## Règles de pénalité automatique
- Hors France (country_code != FR, GmbH/LLC/Ltd/Inc/Pty dans le nom) → score ≤ 2
- Holding / société de capitaux / cabinet comptable / mairie / agglomération → score ≤ 3
- ICP antiPersonas matché (concurrent direct ou client incompatible) → score ≤ 2
- Effectif > 200p si ICP exige PME (sauf instruction contraire) → score ≤ 4

## Format de réponse OBLIGATOIRE
Réponds UNIQUEMENT en JSON valide, sans markdown, sans préfixe : {"score": <int 1-10>, "reason": "<1 phrase max 100 chars>"}

## Échelle finale
- 9-10 : signal HOT, à attaquer dans les 24h (levée fraîche + ICP parfait + persona accessible)
- 7-8 : qualifié, à mettre dans la queue commerciale
- 5-6 : à valider manuellement, doute sur ICP fit
- 3-4 : marginal, hors-ICP léger ou signal faible
- 1-2 : à exclure (hors France, hors taille, secteur incompatible)

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
  const userPrompt = `CLIENT : ${trigger.client.name}
ICP : ${JSON.stringify({
    industries: icp.industries,
    sizes: icp.sizes,
    personaTitles: icp.personaTitles,
    keywordsHiring: icp.keywordsHiring,
    antiPersonas: icp.antiPersonas,
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
- Détail : ${trigger.detail ?? "(vide)"}
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
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });
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

  const isHot = opusScore >= 9;
  await db.trigger.update({
    where: { id: triggerId },
    data: { score: opusScore, scoreReason: reason, isHot },
  });

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
