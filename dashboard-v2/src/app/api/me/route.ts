import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireApiSession } from "@/server/session";
import { db } from "@/lib/db";

type Prisma_UserUpdateInput = Prisma.UserUpdateInput;

export async function GET(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  // Lecture fraîche depuis la DB (la session Better Auth ne refresh
  // pas onboardingDone après update — on resync ici)
  const fresh = await db.user.findUnique({
    where: { id: s.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      clientId: true,
      scopeClientIds: true,
      onboardingDone: true,
      locale: true,
      timezone: true,
      preferences: true,
    },
  });
  if (!fresh) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  let client = null;
  if (fresh.clientId) {
    client = await db.client.findUnique({
      where: { id: fresh.clientId },
      select: { id: true, slug: true, name: true, plan: true, status: true },
    });
  }

  return NextResponse.json({
    id: fresh.id,
    email: fresh.email,
    name: fresh.name,
    role: fresh.role,
    clientId: fresh.clientId,
    client,
    scopeClientIds: fresh.scopeClientIds ?? [],
    onboardingDone: fresh.onboardingDone,
    locale: fresh.locale,
    timezone: fresh.timezone,
    preferences: fresh.preferences ?? null,
  });
}

const PreferencesSchema = z
  .object({
    digestWeekly: z.boolean().optional(),
    alertHotTrigger: z.boolean().optional(),
    alertNewReply: z.boolean().optional(),
    alertMeetingBooked: z.boolean().optional(),
    digestDay: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
  })
  .strict();

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  preferences: PreferencesSchema.optional(),
});

export async function PATCH(req: NextRequest) {
  const s = await requireApiSession(req);
  if (!s.ok) return s.response;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload invalide", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Merge préférences existantes pour préserver les clés non touchées
  let mergedPreferences: Record<string, unknown> | undefined;
  if (parsed.data.preferences) {
    const current = await db.user.findUnique({
      where: { id: s.user.id },
      select: { preferences: true },
    });
    const previous =
      current?.preferences && typeof current.preferences === "object"
        ? (current.preferences as Record<string, unknown>)
        : {};
    mergedPreferences = { ...previous, ...parsed.data.preferences };
  }

  const updateData: Prisma_UserUpdateInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.locale !== undefined) updateData.locale = parsed.data.locale;
  if (parsed.data.timezone !== undefined) updateData.timezone = parsed.data.timezone;
  if (mergedPreferences !== undefined) {
    updateData.preferences = mergedPreferences as Prisma.InputJsonValue;
  }

  const updated = await db.user.update({
    where: { id: s.user.id },
    data: updateData,
    select: {
      id: true,
      name: true,
      locale: true,
      timezone: true,
      preferences: true,
    },
  });

  return NextResponse.json(updated);
}
