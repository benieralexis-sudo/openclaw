// Sprint 3 (10/05/2026) — Generateur HTML/text email digest hebdomadaire.
//
// Pure function : prend liste de leads + brand + periode → retourne
// { subject, html, text } pretes a envoyer via Resend.
//
// Format inspire du bot trigger-engine claude-brain/digest-email.js mais
// adapte pour le format dashboard-v2 (Trigger + Lead + briefV2Json).

import type { BrandConfig } from "@/lib/delivery-config";

export interface DigestLead {
  triggerId: string;
  companyName: string;
  companyNaf: string | null;
  size: string | null;
  region: string | null;
  sourceCode: string;
  score: number;
  scoreReason: string | null;
  capturedAt: Date;
  /** Brief V2 si disponible (verdict + thesis + opener) */
  briefV2: {
    verdict: "OUI" | "NON" | "ENRICH";
    confidence: number;
    thesis: string;
    opener: string;
  } | null;
  /** Lead associe : email + linkedin + decision maker */
  lead: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
  } | null;
}

export interface DigestBuildResult {
  subject: string;
  html: string;
  text: string;
  /** Stats utilisees pour observability */
  stats: { total: number; pepites: number; avg_score: number };
}

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "https://app-v2.ifind.fr";

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function priorityBadge(score: number): { label: string; bg: string; fg: string } {
  if (score >= 9) return { label: "🔥 Pepite", bg: "#FEE2E2", fg: "#991B1B" };
  if (score >= 7) return { label: "⚡ Tres chaud", bg: "#FED7AA", fg: "#9A3412" };
  if (score >= 5) return { label: "💡 Qualifie", bg: "#FEF3C7", fg: "#92400E" };
  return { label: "📋 Standard", bg: "#E5E7EB", fg: "#374151" };
}

function formatLeadRow(lead: DigestLead, brand: BrandConfig): string {
  const badge = priorityBadge(lead.score);
  const dashLink = `${DASHBOARD_URL}/triggers/${lead.triggerId}`;
  const opener = lead.briefV2?.opener?.slice(0, 200) ?? lead.scoreReason?.slice(0, 200) ?? "";
  const verdictBadge = lead.briefV2?.verdict
    ? `<span style="background:${lead.briefV2.verdict === "OUI" ? "#D1FAE5" : lead.briefV2.verdict === "NON" ? "#FEE2E2" : "#FEF3C7"};color:${lead.briefV2.verdict === "OUI" ? "#065F46" : lead.briefV2.verdict === "NON" ? "#991B1B" : "#92400E"};padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px">${lead.briefV2.verdict} ${lead.briefV2.confidence}%</span>`
    : "";

  const contactBits: string[] = [];
  if (lead.lead?.email) contactBits.push(`📧 <a href="mailto:${escapeHtml(lead.lead.email)}" style="color:${brand.primaryColor};text-decoration:none">${escapeHtml(lead.lead.email)}</a>`);
  if (lead.lead?.phone) contactBits.push(`📞 ${escapeHtml(lead.lead.phone)}`);
  if (lead.lead?.linkedinUrl) contactBits.push(`<a href="${escapeHtml(lead.lead.linkedinUrl)}" style="color:${brand.primaryColor};text-decoration:none">LinkedIn</a>`);

  const personaName = lead.lead?.fullName ? `<div style="font-size:13px;color:#4B5563;margin-top:4px">👤 ${escapeHtml(lead.lead.fullName)}</div>` : "";
  const contactLine = contactBits.length > 0 ? `<div style="font-size:13px;color:#4B5563;margin-top:4px">${contactBits.join(" • ")}</div>` : "";

  return `
<tr>
  <td style="padding:14px 12px;border-bottom:1px solid #E5E7EB;vertical-align:top">
    <div>
      <span style="background:${badge.bg};color:${badge.fg};padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600">${badge.label}</span>
      ${verdictBadge}
      <span style="color:#9CA3AF;font-size:12px;margin-left:8px">${lead.sourceCode}</span>
    </div>
    <div style="font-size:16px;font-weight:600;margin-top:8px">
      <a href="${dashLink}" style="color:#111827;text-decoration:none">${escapeHtml(lead.companyName)}</a>
    </div>
    <div style="font-size:13px;color:#6B7280;margin-top:2px">
      ${[lead.companyNaf, lead.size, lead.region].filter(Boolean).map(escapeHtml).join(" • ")}
    </div>
    ${personaName}
    ${contactLine}
    ${opener ? `<div style="margin-top:10px;padding:10px;background:#F9FAFB;border-left:3px solid ${brand.primaryColor};font-size:13px;color:#374151;line-height:1.5;border-radius:2px">${escapeHtml(opener)}${opener.length >= 200 ? "..." : ""}</div>` : ""}
    <div style="margin-top:10px">
      <a href="${dashLink}" style="display:inline-block;background:${brand.primaryColor};color:#fff;padding:6px 14px;border-radius:4px;font-size:13px;text-decoration:none;font-weight:500">Voir le brief →</a>
    </div>
  </td>
</tr>
`;
}

function formatLeadText(lead: DigestLead, idx: number): string {
  const dashLink = `${DASHBOARD_URL}/triggers/${lead.triggerId}`;
  const verdict = lead.briefV2 ? `[V2:${lead.briefV2.verdict} ${lead.briefV2.confidence}%]` : "";
  const contact: string[] = [];
  if (lead.lead?.fullName) contact.push(lead.lead.fullName);
  if (lead.lead?.email) contact.push(lead.lead.email);
  if (lead.lead?.phone) contact.push(lead.lead.phone);
  return `
${idx}. ${lead.companyName} (score=${lead.score}) ${verdict}
   ${[lead.companyNaf, lead.size, lead.region].filter(Boolean).join(" • ")}
   Source: ${lead.sourceCode}
   ${contact.length ? "Contact: " + contact.join(" | ") : ""}
   ${lead.briefV2?.opener?.slice(0, 200) ?? lead.scoreReason?.slice(0, 200) ?? ""}
   → ${dashLink}
`;
}

export function buildWeeklyDigest(opts: {
  clientName: string;
  leads: DigestLead[];
  periodStart: Date;
  periodEnd: Date;
  brand: BrandConfig;
}): DigestBuildResult {
  const { clientName, leads, periodStart, periodEnd, brand } = opts;
  // Tri : score desc puis pepite first
  const sorted = [...leads].sort((a, b) => b.score - a.score);
  const pepites = sorted.filter((l) => l.score >= 9);
  const avgScore = sorted.length > 0
    ? Math.round((sorted.reduce((s, l) => s + l.score, 0) / sorted.length) * 10) / 10
    : 0;

  const periodLabel = `${periodStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${periodEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;

  const subject = sorted.length === 0
    ? `${brand.senderName} — aucun lead chaud cette semaine`
    : pepites.length > 0
      ? `${brand.senderName} — ${sorted.length} leads (${pepites.length} pepite${pepites.length > 1 ? "s" : ""}) — ${periodLabel}`
      : `${brand.senderName} — ${sorted.length} leads cette semaine — ${periodLabel}`;

  const headerLogo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.senderName)}" style="max-height:40px;margin-bottom:12px"/>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;line-height:1.5">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px">
    <div style="background:${brand.primaryColor};padding:24px;border-radius:8px 8px 0 0;color:#fff">
      ${headerLogo}
      <div style="font-size:22px;font-weight:700">Vos leads de la semaine</div>
      <div style="margin-top:6px;font-size:14px;opacity:0.9">${sorted.length} lead${sorted.length > 1 ? "s" : ""} qualifie${sorted.length > 1 ? "s" : ""}${pepites.length > 0 ? ` — dont ${pepites.length} pepite${pepites.length > 1 ? "s" : ""}` : ""} • ${periodLabel}</div>
    </div>
    <div style="background:#fff;padding:0;border-radius:0 0 8px 8px">
      ${sorted.length === 0
        ? '<div style="padding:32px;text-align:center;color:#6B7280">Aucun lead chaud cette semaine. Le moteur tourne en continu — surveillez votre dashboard pour les nouvelles opportunites.</div>'
        : `<table style="width:100%;border-collapse:collapse">${sorted.map((l) => formatLeadRow(l, brand)).join("")}</table>`}
    </div>
    <div style="margin-top:20px;padding:16px;background:#F9FAFB;border-radius:8px;font-size:12px;color:#6B7280;text-align:center">
      <div>Brief complet sur <a href="${DASHBOARD_URL}/triggers" style="color:${brand.primaryColor};text-decoration:none;font-weight:500">votre dashboard ${escapeHtml(brand.senderName)}</a></div>
      <div style="margin-top:8px">Score moyen : ${avgScore}/10 • Genere par le moteur ${escapeHtml(brand.senderName)} pour ${escapeHtml(clientName)}</div>
    </div>
  </div>
</body>
</html>`;

  const text = sorted.length === 0
    ? `${brand.senderName} — aucun lead chaud cette semaine.\n\nLe moteur tourne en continu, surveillez ${DASHBOARD_URL}/triggers`
    : `${brand.senderName} — Vos leads de la semaine (${periodLabel})

${sorted.length} lead${sorted.length > 1 ? "s" : ""} qualifie${sorted.length > 1 ? "s" : ""}${pepites.length > 0 ? `, dont ${pepites.length} pepite${pepites.length > 1 ? "s" : ""}` : ""}. Score moyen : ${avgScore}/10.

${sorted.map((l, i) => formatLeadText(l, i + 1)).join("")}

---
Voir tous les briefs : ${DASHBOARD_URL}/triggers
`;

  return {
    subject,
    html,
    text,
    stats: { total: sorted.length, pepites: pepites.length, avg_score: avgScore },
  };
}
