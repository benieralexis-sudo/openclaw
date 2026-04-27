import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import {
  enrichLinkedInProfile,
  isValidLinkedInUrl,
  pickEmail,
  pickPhone,
  type KasprDataField,
} from "@/lib/kaspr";

export const maxDuration = 30;

// ──────────────────────────────────────────────────────────────────────
// POST /api/leads/[id]/enrich-kaspr — enrichissement LinkedIn → email + tel
// ──────────────────────────────────────────────────────────────────────
// - Auth ADMIN ou COMMERCIAL uniquement
// - Body : { linkedinUrl, name?, dataToGet? }
// - Si name absent : utilise lead.fullName ou firstName+lastName
// - Validation URL LinkedIn (regex linkedin.com/in/<id>)
// - Anti-double-charge : si Lead.kasprEnrichedAt < 7 jours → cache (sauf ?force=true)
// - Update Lead avec les data + audit log
// ──────────────────────────────────────────────────────────────────────

interface EnrichBody {
  linkedinUrl: string;
  name?: string;
  dataToGet?: KasprDataField[];
}

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  if (s.user.role !== "ADMIN" && s.user.role !== "COMMERCIAL") {
    return NextResponse.json(
      { error: "Réservé aux rôles ADMIN ou COMMERCIAL" },
      { status: 403 },
    );
  }

  const { id } = await params;

  // Parse body
  let body: EnrichBody;
  try {
    body = (await req.json()) as EnrichBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const linkedinUrl = (body.linkedinUrl || "").trim();
  if (!linkedinUrl) {
    return NextResponse.json(
      { error: "Champ requis : linkedinUrl" },
      { status: 400 },
    );
  }
  if (!isValidLinkedInUrl(linkedinUrl)) {
    return NextResponse.json(
      { error: "URL LinkedIn invalide (attendu: https://linkedin.com/in/<slug>)" },
      { status: 400 },
    );
  }

  // Lead + scope check
  const lead = await db.lead.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      firstName: true,
      lastName: true,
      fullName: true,
      jobTitle: true,
      linkedinUrl: true,
      email: true,
      kasprEnrichedAt: true,
      kasprWorkEmail: true,
      kasprPersonalEmail: true,
      kasprPhone: true,
      kasprTitle: true,
      kasprCreditsUsed: true,
      kasprResponseJson: true,
    },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });
  }

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  // Force flag via query string
  const force = req.nextUrl.searchParams.get("force") === "true";

  // Cache anti-double-charge : 7j
  if (
    !force &&
    lead.kasprEnrichedAt &&
    Date.now() - lead.kasprEnrichedAt.getTime() < CACHE_TTL_MS
  ) {
    return NextResponse.json({
      ok: true,
      used_cache: true,
      enrichedAt: lead.kasprEnrichedAt.toISOString(),
      profile: {
        workEmail: lead.kasprWorkEmail,
        personalEmail: lead.kasprPersonalEmail,
        phone: lead.kasprPhone,
        title: lead.kasprTitle,
        linkedinUrl: lead.linkedinUrl,
      },
    });
  }

  // Nom complet (fallback sur Lead)
  const name =
    (body.name?.trim() ||
      lead.fullName ||
      [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
      "") + "";
  if (!name) {
    return NextResponse.json(
      { error: "Nom complet requis (lead.fullName absent et 'name' non fourni dans body)" },
      { status: 400 },
    );
  }

  // Appel Kaspr
  const result = await enrichLinkedInProfile({
    id: linkedinUrl,
    name,
    dataToGet: body.dataToGet,
  });

  if (!result.ok) {
    if (result.error === "no_credits_left") {
      return NextResponse.json(
        { error: "Plus de crédits Kaspr — recharger l'abonnement", credits: result.credits },
        { status: 402 },
      );
    }
    if (result.error === "rate_limit_exceeded") {
      return NextResponse.json(
        { error: "Rate limit Kaspr atteint, réessaye dans 1 min", credits: result.credits },
        { status: 429 },
      );
    }
    if (result.error === "profile_not_found") {
      return NextResponse.json(
        {
          error:
            "Profil introuvable sur Kaspr (URL LinkedIn invalide ou personne pas dans la base Kaspr)",
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: `Kaspr error: ${result.error}` },
      { status: 502 },
    );
  }

  // Normalisation des champs Kaspr
  const profile = result.profile ?? {};
  const workEmail =
    pickEmail(profile.workEmail) ?? pickEmail(profile.workEmails) ?? null;
  const personalEmail =
    pickEmail(profile.directEmail) ?? pickEmail(profile.directEmails) ?? null;
  const phone = pickPhone(profile.phone) ?? pickPhone(profile.phones) ?? null;
  const title = (profile.title as string | undefined) ?? null;

  // Update Lead
  const updateData: Record<string, unknown> = {
    kasprEnrichedAt: new Date(),
    kasprWorkEmail: workEmail,
    kasprPersonalEmail: personalEmail,
    kasprPhone: phone,
    kasprTitle: title,
    kasprResponseJson: profile as object,
    kasprCreditsUsed: { increment: 1 },
    linkedinUrl,
  };

  // Si pas d'email principal sur le lead → set workEmail (priorité)
  if (!lead.email && workEmail) {
    updateData.email = workEmail;
  }
  // Pareil pour le téléphone (si pas de phone existant)
  // (On ne touche pas à phone si déjà setté pour ne pas écraser un meilleur format)

  await db.lead.update({
    where: { id: lead.id },
    data: updateData,
  });

  // Audit log
  try {
    await db.auditLog.create({
      data: {
        userId: s.user.id,
        clientId: lead.clientId,
        action: "lead.kaspr_enrich",
        entityType: "Lead",
        entityId: lead.id,
        metadata: {
          linkedinUrl,
          force,
          gotWorkEmail: !!workEmail,
          gotPersonalEmail: !!personalEmail,
          gotPhone: !!phone,
          creditsRemaining: result.credits,
        } as object,
      },
    });
  } catch {
    // non critique
  }

  return NextResponse.json({
    ok: true,
    used_cache: false,
    profile: {
      workEmail,
      personalEmail,
      phone,
      title,
      linkedinUrl,
      fullName: profile.fullName ?? name,
    },
    credits_remaining: result.credits,
  });
}
