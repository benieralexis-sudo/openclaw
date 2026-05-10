import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

// API publique POST /api/public/waitlist
// Refonte v6 (10/05/2026) — formulaire d'inscription /signup en attente
// Stripe FR. Stocke en DB Waitlist + email Telegram interne pour
// onboarding manuel sous 24 h.
//
// PUBLIQUE = pas d'auth requise. Rate-limit basique IP-based.
// Pas de PII sensible (email + société + tel) → conforme RGPD.

const Body = z.object({
  email: z.string().email("Email invalide").max(200),
  firstName: z.string().min(1, "Prénom requis").max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  company: z.string().min(1, "Société requise").max(120),
  phone: z.string().max(40).optional(),
  volumeEstimate: z.enum(["30-60", "60-120", "120-200", "200+"]).optional(),
  industry: z.enum(["ESN", "SaaS", "Conseil", "Industrie", "Autre"]).optional(),
  message: z.string().max(2000).optional(),
  source: z.string().max(100).optional(),
});

// Rate-limit ultra basique en mémoire (suffisant pour MVP — Redis si scale).
const recentByIp = new Map<string, number>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const last = recentByIp.get(ip) ?? 0;
  // Cleanup old entries périodiquement
  if (recentByIp.size > 1000) {
    for (const [k, v] of recentByIp) if (now - v > WINDOW_MS) recentByIp.delete(k);
  }
  if (now - last < WINDOW_MS / MAX_PER_WINDOW) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez dans une minute." },
      { status: 429 },
    );
  }
  recentByIp.set(ip, now);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Données invalides", field: issue?.path.join(".") },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // Si email déjà inscrit, on update plutôt que dupliquer
  const existing = await db.waitlist.findFirst({ where: { email: data.email } });
  if (existing) {
    await db.waitlist.update({
      where: { id: existing.id },
      data: {
        firstName: data.firstName ?? existing.firstName,
        lastName: data.lastName ?? existing.lastName,
        company: data.company,
        phone: data.phone ?? existing.phone,
        volumeEstimate: data.volumeEstimate ?? existing.volumeEstimate,
        industry: data.industry ?? existing.industry,
        message: data.message ?? existing.message,
      },
    });
    return NextResponse.json({ ok: true, alreadyRegistered: true });
  }

  await db.waitlist.create({
    data: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      company: data.company,
      phone: data.phone,
      volumeEstimate: data.volumeEstimate,
      industry: data.industry,
      message: data.message,
      source: data.source ?? "/signup",
      ipAddress: ip,
      userAgent,
    },
  });

  // Notification Telegram interne pour onboarding manuel sous 24 h.
  // Best-effort : ne fait pas échouer la requête si l'envoi rate.
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChat = process.env.TELEGRAM_CHAT_ID;
  if (telegramToken && telegramChat) {
    const msg = [
      "🆕 *Nouvelle inscription waitlist iFIND*",
      "",
      `*Email* : ${data.email}`,
      data.firstName || data.lastName ? `*Nom* : ${[data.firstName, data.lastName].filter(Boolean).join(" ")}` : null,
      `*Société* : ${data.company}`,
      data.phone ? `*Téléphone* : ${data.phone}` : null,
      data.volumeEstimate ? `*Volume estimé* : ${data.volumeEstimate} leads/mois` : null,
      data.industry ? `*Secteur* : ${data.industry}` : null,
      data.message ? `*Message* : ${data.message.slice(0, 300)}` : null,
      "",
      "→ Onboarding manuel sous 24 h",
    ].filter(Boolean).join("\n");

    fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChat,
        text: msg,
        parse_mode: "Markdown",
      }),
    }).catch((e) => console.error("[waitlist] Telegram notif failed:", e));
  }

  return NextResponse.json({ ok: true });
}
