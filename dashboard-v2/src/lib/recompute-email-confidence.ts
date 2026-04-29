import "server-only";
import { db } from "@/lib/db";
import { recomputeDataQualityForLead } from "@/lib/recompute-data-quality";

/**
 * Calcule emailConfidence (0-100) + emailSourceCount + le `email` final
 * pour un Lead à partir des 3 sources stockées séparément :
 *  - emailRodz       (Rodz findEmail status=Valid)
 *  - emailDropcontact (Dropcontact qualification=valid + non perso)
 *  - kasprWorkEmail  (Kaspr enrichLinkedInProfile)
 *
 * Stratégie :
 *  - 3 sources d'accord (même normalisation lowercase/trim) → 95
 *  - 2 sources d'accord → 85
 *  - 2 sources en conflit (3e absente) → 40 (ne pas envoyer)
 *  - 1 seule source → 50 (acceptable, mais à valider)
 *  - 3 sources mais 2 valeurs différentes (2 vs 1) → 70 (majorité l'emporte)
 *  - 3 sources toutes différentes → 30 (suspicion)
 *  - 0 source → 0
 *
 * `email` final = celui qui apparaît dans 2+ sources, sinon le premier non-vide
 * dans l'ordre de priorité Rodz > Dropcontact > Kaspr (Rodz et Dropcontact
 * sont vérifiés sortants, Kaspr vérifie au moment où il pose le data).
 */

function normalize(e: string | null | undefined): string | null {
  if (!e) return null;
  const trimmed = e.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export interface EmailConfidenceResult {
  email: string | null;
  emailConfidence: number;
  emailSourceCount: number;
}

export function computeEmailConfidence(
  emailRodz: string | null | undefined,
  emailDropcontact: string | null | undefined,
  kasprWorkEmail: string | null | undefined,
  emailFullenrich?: string | null | undefined,
): EmailConfidenceResult {
  const sources: Array<{ source: string; raw: string; norm: string }> = [];
  const r = normalize(emailRodz);
  const d = normalize(emailDropcontact);
  const k = normalize(kasprWorkEmail);
  const f = normalize(emailFullenrich);
  if (r) sources.push({ source: "rodz", raw: emailRodz!, norm: r });
  if (d) sources.push({ source: "dropcontact", raw: emailDropcontact!, norm: d });
  if (k) sources.push({ source: "kaspr", raw: kasprWorkEmail!, norm: k });
  if (f) sources.push({ source: "fullenrich", raw: emailFullenrich!, norm: f });

  const sourceCount = sources.length;
  if (sourceCount === 0) {
    return { email: null, emailConfidence: 0, emailSourceCount: 0 };
  }

  // Compte les occurrences par valeur normalisée
  const counts = new Map<string, { count: number; raw: string }>();
  for (const s of sources) {
    const cur = counts.get(s.norm);
    if (cur) cur.count++;
    else counts.set(s.norm, { count: 1, raw: s.raw });
  }
  const distinct = counts.size;

  // Trouve la valeur majoritaire
  let bestNorm = sources[0]!.norm;
  let bestCount = 0;
  let bestRaw = sources[0]!.raw;
  for (const [norm, info] of counts) {
    if (info.count > bestCount) {
      bestCount = info.count;
      bestNorm = norm;
      bestRaw = info.raw;
    }
  }

  let confidence = 0;
  if (sourceCount === 1) confidence = 50;
  else if (sourceCount === 2 && distinct === 1) confidence = 85;
  else if (sourceCount === 2 && distinct === 2) confidence = 40;
  else if (sourceCount === 3 && distinct === 1) confidence = 95;
  else if (sourceCount === 3 && distinct === 2) confidence = 70;
  else if (sourceCount === 3 && distinct === 3) confidence = 30;
  else if (sourceCount === 4 && distinct === 1) confidence = 98;
  else if (sourceCount === 4 && distinct === 2) confidence = 80;
  else if (sourceCount === 4 && distinct >= 3) confidence = 50;

  // Si conflit (multiple distincts) on prend l'ordre de priorité :
  // Rodz > Dropcontact > Kaspr > FullEnrich (Rodz est le plus vérifié,
  // FullEnrich est un waterfall donc moins déterministe).
  // Sinon la majorité gagne (déjà calculée plus haut).
  let email: string | null = bestRaw;
  if (sourceCount >= 2 && distinct >= 2) {
    // En cas de conflit où on n'a pas de majorité claire, on applique l'ordre
    if (bestCount === 1 || (bestCount * 2 <= sourceCount)) {
      if (r && emailRodz) email = emailRodz;
      else if (d && emailDropcontact) email = emailDropcontact;
      else if (k && kasprWorkEmail) email = kasprWorkEmail;
      else if (f && emailFullenrich) email = emailFullenrich;
      else email = null;
    }
  }

  return {
    email,
    emailConfidence: confidence,
    emailSourceCount: sourceCount,
  };
}

/**
 * Recalcule + écrit emailConfidence/emailSourceCount/email pour un Lead.
 * Appelé après chaque writer (Rodz, Dropcontact, Kaspr).
 */
export async function recomputeEmailConfidenceForLead(leadId: string): Promise<void> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      emailRodz: true,
      emailDropcontact: true,
      kasprWorkEmail: true,
      emailFullenrich: true,
      email: true,
      emailStatus: true,
      bouncedFromEmail: true,
    },
  });
  if (!lead) return;

  // Q8 — Si une source nous redonne l'email qui a déjà bounce, on l'ignore
  // (pas la peine de relancer un email rejeté → bounce immédiat → réputation).
  const bouncedNorm = lead.bouncedFromEmail?.trim().toLowerCase();
  const filterBounced = (e: string | null | undefined): string | null => {
    if (!e) return null;
    if (bouncedNorm && e.trim().toLowerCase() === bouncedNorm) return null;
    return e;
  };
  const result = computeEmailConfidence(
    filterBounced(lead.emailRodz),
    filterBounced(lead.emailDropcontact),
    filterBounced(lead.kasprWorkEmail),
    filterBounced(lead.emailFullenrich),
  );

  // Préserve l'email actuel si user l'a saisi manuellement et qu'aucune source
  // ne le contredit (cas rare où le commercial a corrigé à la main).
  const updates: Record<string, unknown> = {
    emailConfidence: result.emailConfidence,
    emailSourceCount: result.emailSourceCount,
  };
  if (result.email && result.email !== lead.email) {
    updates.email = result.email;
    // emailStatus reste UNVERIFIED par défaut. Resend webhook bounce
    // basculera à BOUNCED si la deliverability foire.
  } else if (!result.email && !lead.email) {
    // rien à faire
  }
  await db.lead.update({
    where: { id: leadId },
    data: updates,
  });
  // Cascade : email change → dataQuality bouge (concordance + presence email)
  await recomputeDataQualityForLead(leadId).catch(() => {});
}
