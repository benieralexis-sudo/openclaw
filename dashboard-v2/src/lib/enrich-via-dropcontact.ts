import "server-only";
import { db } from "@/lib/db";
import { submitBatch, pollBatchResult, type DropcontactInput, type DropcontactEnriched } from "@/lib/dropcontact";
import { enrichLinkedInProfile, isValidLinkedInUrl, pickPhone } from "@/lib/kaspr";

// ═══════════════════════════════════════════════════════════════════
// Pipeline : enrichir les Leads sans email via Dropcontact
// Input : Lead avec firstName + lastName + companyName, sans email
// Output : Lead.email + Lead.linkedinUrl + Lead.phone mis à jour
// Coût : 1 crédit Dropcontact / lead
// ═══════════════════════════════════════════════════════════════════

const BATCH_LIMIT = 50;

type EnrichResult = {
  picked: number;
  enrichedWithEmail: number;
  enrichedWithLinkedin: number;
  enrichedWithPhone: number;
  kasprChained: number;
  kasprMobileFound: number;
  jobMovesDetected: number;
  errors: Array<{ leadId: string; reason: string }>;
  creditsLeft: number;
};

// Plafond Kaspr par run pour ne jamais brûler les crédits par accident.
// 197 mobiles dispos / 30 leads/cycle / 6h cycle = on peut en faire jusqu'à 30
// par run mais on plafonne à 15 pour garder de la marge sur les pépites.
const KASPR_CHAIN_MAX_PER_RUN = 15;

function pickFirstEmail(enriched: DropcontactEnriched): string | null {
  const emails = enriched.email;
  if (!emails || emails.length === 0) return null;
  // Privilégie les emails "valid" si qualification présente
  const valid = emails.find((e) => e.qualification === "valid" || e.qualification === "ok");
  const picked = valid ?? emails[0];
  return picked?.email || null;
}

export async function enrichLeadsViaDropcontact(
  clientId: string,
  opts: { limit?: number } = {},
): Promise<EnrichResult> {
  const limit = Math.min(opts.limit ?? BATCH_LIMIT, BATCH_LIMIT);
  const result: EnrichResult = {
    picked: 0,
    enrichedWithEmail: 0,
    enrichedWithLinkedin: 0,
    enrichedWithPhone: 0,
    kasprChained: 0,
    kasprMobileFound: 0,
    jobMovesDetected: 0,
    errors: [],
    creditsLeft: -1,
  };

  // Eligibilité : Lead avec nom + entreprise mais sans email, jamais tenté Dropcontact
  const candidates = await db.lead.findMany({
    where: {
      clientId,
      deletedAt: null,
      OR: [{ email: null }, { email: "" }],
      firstName: { not: null },
      lastName: { not: null },
      companyName: { not: "" },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      companySiret: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  result.picked = candidates.length;
  if (candidates.length === 0) return result;

  const inputs: DropcontactInput[] = candidates.map((l) => ({
    first_name: l.firstName ?? undefined,
    last_name: l.lastName ?? undefined,
    company: l.companyName,
    num_siren: l.companySiret ?? undefined,
  }));

  let submitted: { requestId: string; creditsLeft: number };
  try {
    submitted = await submitBatch(inputs);
  } catch (e) {
    result.errors.push({ leadId: "*", reason: e instanceof Error ? e.message : String(e) });
    return result;
  }
  result.creditsLeft = submitted.creditsLeft;

  let enrichedRows: DropcontactEnriched[];
  try {
    enrichedRows = await pollBatchResult(submitted.requestId, 300_000);
  } catch (e) {
    result.errors.push({ leadId: "*", reason: `poll: ${e instanceof Error ? e.message : String(e)}` });
    return result;
  }

  // Mapping par index : Dropcontact garantit l'ordre input == output
  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i];
    const en = enrichedRows[i];
    if (!lead || !en) continue;
    const email = pickFirstEmail(en);
    const linkedinUrl = en.linkedin || null;
    let phone: string | null = en.mobile_phone || en.phone || null;

    // Détection job_move (signal d'achat MAJEUR) : si Dropcontact remonte un
    // changement de poste <6 mois sur le dirigeant, on log + booste le score.
    const jobMoveDetected = en.job_changed === true || !!en.previous_company;
    if (jobMoveDetected) result.jobMovesDetected++;

    if (!email && !linkedinUrl && !phone && !jobMoveDetected) continue;

    // Chaining Dropcontact → Kaspr : si on a un LinkedIn URL valide ET pas
    // encore de mobile, on déclenche Kaspr pour récupérer le mobile (Kaspr
    // 70-80% mobile vs Dropcontact 30-40%). Plafonné à KASPR_CHAIN_MAX_PER_RUN.
    let kasprWorkEmail: string | null = null;
    if (
      linkedinUrl &&
      !phone &&
      result.kasprChained < KASPR_CHAIN_MAX_PER_RUN &&
      isValidLinkedInUrl(linkedinUrl)
    ) {
      result.kasprChained++;
      const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
      try {
        const kr = await enrichLinkedInProfile({
          id: linkedinUrl,
          name: fullName,
          dataToGet: ["phone", "workEmail"],
        });
        if (kr.ok && kr.profile) {
          const kPhone = pickPhone(kr.profile.phones ?? kr.profile.phone ?? null);
          if (kPhone) {
            phone = kPhone;
            result.kasprMobileFound++;
          }
          const we = kr.profile.workEmail;
          kasprWorkEmail = typeof we === "string" ? we : we?.email ?? null;
        }
      } catch (e) {
        // Kaspr fail = silent. On a déjà Dropcontact, c'est un bonus.
        result.errors.push({
          leadId: lead.id,
          reason: `kaspr_chain: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    try {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          ...(email ? { email, emailStatus: "UNVERIFIED" } : {}),
          ...(linkedinUrl ? { linkedinUrl } : {}),
          ...(phone ? { phone } : {}),
          ...(kasprWorkEmail
            ? { kasprWorkEmail, kasprEnrichedAt: new Date() }
            : {}),
          status: "ENRICHED",
          enrichedAt: new Date(),
        },
      });
      if (email) result.enrichedWithEmail++;
      if (linkedinUrl) result.enrichedWithLinkedin++;
      if (phone) result.enrichedWithPhone++;
    } catch (e) {
      result.errors.push({ leadId: lead.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}
