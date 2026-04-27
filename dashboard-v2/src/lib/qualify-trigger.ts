import "server-only";
import { getAnthropic, BRIEF_MODEL } from "@/lib/anthropic";
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

const SYSTEM = `Tu es un expert sales B2B FR. Tu évalues un signal d'achat (lead) sur 10 selon :
- ICP fit : la boîte correspond-elle au profil cible (industrie, taille, region) ?
- Signal strength : le signal est-il un vrai déclencheur d'achat (levée, hire clé, tender) ou juste du bruit ?
- Persona match : le contact ciblable est-il un décisionnaire (CTO, CEO, Founder) ou périphérique (RH, Junior) ?
- Freshness : signal très récent <7j = boost, ancien >30j = malus.

Réponds UNIQUEMENT en JSON : {"score": 1-10, "reason": "1 phrase max 100 chars"}.

Échelle :
- 9-10 : signal HOT, à attaquer dans les 24h (levée fraîche + ICP parfait)
- 7-8 : qualifié, à mettre dans la queue commerciale
- 5-6 : à valider manuellement, doute sur ICP fit
- 1-4 : pas pour ce client (hors ICP, signal faible)`;

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
      model: BRIEF_MODEL,
      max_tokens: 200,
      system: SYSTEM,
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
