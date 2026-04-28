import "server-only";
import { db } from "@/lib/db";
import { submitBatch, pollBatchResult, type DropcontactInput, type DropcontactEnriched } from "@/lib/dropcontact";

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
  errors: Array<{ leadId: string; reason: string }>;
  creditsLeft: number;
};

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
    const phone = en.mobile_phone || en.phone || null;
    if (!email && !linkedinUrl && !phone) continue;

    try {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          ...(email ? { email, emailStatus: "UNVERIFIED" } : {}),
          ...(linkedinUrl ? { linkedinUrl } : {}),
          ...(phone ? { phone } : {}),
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
