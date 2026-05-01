import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireApiSession, resolveClientScope } from "@/server/session";
import { generateCopyForLead } from "@/lib/copy-runner";

export const maxDuration = 60; // Opus 4 contextes en 1 → ~20-40s

/**
 * POST /api/leads/[id]/copy
 * GET  /api/leads/[id]/copy
 *
 * Génère (POST) ou lit (GET) les 4 contextes commerciaux en 1 seul appel
 * Opus : coldMail / warmMail / linkedinDm / callBrief.
 *
 * Cache 7j sur copyGeneratedAt. ?force=true pour régénérer.
 *
 * Avantage vs les 3 endpoints séparés (pitch/linkedin-dm/call-brief) :
 *  - 1 clic UI = 4 contenus prêts (vs 3 attentes)
 *  - 1 appel Opus = -25-50% tokens vs 3 appels indépendants
 *  - Adaptation tonalité par Persona Tier (A/B/C)
 *  - warmMail (mail post-LinkedIn) qui manquait
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      pitchJson: true,
      warmMailJson: true,
      linkedinDmJson: true,
      callBriefJson: true,
      copyGeneratedAt: true,
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const generatedAt = lead.copyGeneratedAt;
  const fresh = generatedAt && Date.now() - generatedAt.getTime() < 7 * 24 * 60 * 60 * 1000;

  return NextResponse.json({
    payload: {
      coldMail: lead.pitchJson,
      warmMail: lead.warmMailJson,
      linkedinDm: lead.linkedinDmJson,
      callBrief: lead.callBriefJson,
    },
    cached: !!lead.copyGeneratedAt,
    fresh: !!fresh,
    generatedAt: lead.copyGeneratedAt?.toISOString() ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;
  if (s.user.role !== "ADMIN" && s.user.role !== "COMMERCIAL") {
    return NextResponse.json({ error: "Réservé ADMIN/COMMERCIAL" }, { status: 403 });
  }
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "true";

  // Vérif scope avant de cramer des tokens Opus
  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, clientId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });
  const scope = resolveClientScope(s.user, lead.clientId);
  if (!scope.ok || (scope.clientId !== null && scope.clientId !== lead.clientId)) {
    return NextResponse.json({ error: "Hors périmètre" }, { status: 403 });
  }

  const result = await generateCopyForLead({ leadId: id, force });

  if (!result.ok) {
    const status =
      result.code === "lead_not_found"
        ? 404
        : result.code === "lead_blocked" || result.code === "no_trigger"
          ? 400
          : 502;
    return NextResponse.json({ error: result.error, code: result.code, detail: result.detail }, { status });
  }

  return NextResponse.json(result);
}
