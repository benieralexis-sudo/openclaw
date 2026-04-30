import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/internal/signal-performance
 *
 * Performance commerciale par sourceCode (signal d'achat).
 * Agrège sur 30 jours : nb triggers détectés / leads enrichis / emails envoyés /
 * réponses positives/négatives/OOO / RDV bookés.
 *
 * Permet d'identifier :
 *  - Les sources qui underperform (à couper si conso $ > ROI)
 *  - Les sources qui surperforment (à doubler la fréquence cron)
 *
 * Query params :
 *  - clientId=...  (défaut : tous les clients)
 *  - days=30       (défaut 30j)
 *
 * Auth : header `x-cron-secret`.
 */

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const days = Number(url.searchParams.get("days") ?? "30");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 1. Triggers par sourceCode sur la fenêtre
  const triggers = await db.trigger.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      deletedAt: null,
      capturedAt: { gte: since },
    },
    select: {
      id: true,
      sourceCode: true,
      score: true,
      isHot: true,
      isCombo: true,
      lead: {
        select: {
          id: true,
          email: true,
          phone: true,
          kasprPhone: true,
          phoneFullenrich: true,
          linkedinUrl: true,
        },
      },
      opportunity: { select: { stage: true } },
    },
  });

  // 2. EmailActivity envoyé sur la fenêtre, par leadId
  const leadIds = triggers
    .map((t) => t.lead?.id)
    .filter((id): id is string => !!id);
  const emailActivities = leadIds.length
    ? await db.emailActivity.findMany({
        where: {
          leadId: { in: leadIds },
          sentAt: { gte: since },
        },
        select: {
          leadId: true,
          direction: true,
          replyClassification: true,
        },
      })
    : [];

  // Index par leadId : { sent: bool, repliedPositive: bool, repliedNegative: bool, ... }
  type LeadStats = {
    sent: number;
    received: number;
    replyPositive: number;
    replyNegative: number;
    replyOoo: number;
    replyUnsubscribe: number;
    replyNeutral: number;
  };
  const byLead = new Map<string, LeadStats>();
  for (const ea of emailActivities) {
    if (!byLead.has(ea.leadId)) {
      byLead.set(ea.leadId, {
        sent: 0,
        received: 0,
        replyPositive: 0,
        replyNegative: 0,
        replyOoo: 0,
        replyUnsubscribe: 0,
        replyNeutral: 0,
      });
    }
    const s = byLead.get(ea.leadId)!;
    if (ea.direction === "SENT") s.sent++;
    else {
      s.received++;
      switch (ea.replyClassification) {
        case "positive": s.replyPositive++; break;
        case "negative": s.replyNegative++; break;
        case "ooo": s.replyOoo++; break;
        case "unsubscribe": s.replyUnsubscribe++; break;
        case "neutral": s.replyNeutral++; break;
      }
    }
  }

  // 3. Group by sourceCode
  type SourceStats = {
    sourceCode: string;
    triggers: number;
    avgScore: number;
    hotCount: number;
    comboCount: number;
    leadsWithEmail: number;
    leadsWithPhone: number;
    leadsWithLinkedin: number;
    emailsSent: number;
    repliesReceived: number;
    repliesPositive: number;
    repliesNegative: number;
    repliesUnsubscribe: number;
    rdvBooked: number;
    replyRatePct: number; // replies / emailsSent × 100
    positiveReplyRatePct: number; // positive / emailsSent × 100
    rdvRatePct: number; // rdvBooked / emailsSent × 100
  };
  const grouped = new Map<string, SourceStats>();
  for (const t of triggers) {
    const sc = t.sourceCode ?? "unknown";
    if (!grouped.has(sc)) {
      grouped.set(sc, {
        sourceCode: sc,
        triggers: 0,
        avgScore: 0,
        hotCount: 0,
        comboCount: 0,
        leadsWithEmail: 0,
        leadsWithPhone: 0,
        leadsWithLinkedin: 0,
        emailsSent: 0,
        repliesReceived: 0,
        repliesPositive: 0,
        repliesNegative: 0,
        repliesUnsubscribe: 0,
        rdvBooked: 0,
        replyRatePct: 0,
        positiveReplyRatePct: 0,
        rdvRatePct: 0,
      });
    }
    const g = grouped.get(sc)!;
    g.triggers++;
    g.avgScore += t.score;
    if (t.isHot) g.hotCount++;
    if (t.isCombo) g.comboCount++;
    if (t.lead?.email) g.leadsWithEmail++;
    if (t.lead?.phone || t.lead?.kasprPhone || t.lead?.phoneFullenrich) g.leadsWithPhone++;
    if (t.lead?.linkedinUrl) g.leadsWithLinkedin++;
    const opp = t.opportunity?.stage;
    if (opp === "MEETING_SET" || opp === "PROPOSAL" || opp === "WON") g.rdvBooked++;
    if (t.lead?.id) {
      const ls = byLead.get(t.lead.id);
      if (ls) {
        g.emailsSent += ls.sent;
        g.repliesReceived += ls.received;
        g.repliesPositive += ls.replyPositive;
        g.repliesNegative += ls.replyNegative;
        g.repliesUnsubscribe += ls.replyUnsubscribe;
      }
    }
  }

  // Compute averages and rates
  for (const g of grouped.values()) {
    g.avgScore = g.triggers > 0 ? Math.round((g.avgScore / g.triggers) * 10) / 10 : 0;
    g.replyRatePct =
      g.emailsSent > 0
        ? Math.round((g.repliesReceived / g.emailsSent) * 1000) / 10
        : 0;
    g.positiveReplyRatePct =
      g.emailsSent > 0
        ? Math.round((g.repliesPositive / g.emailsSent) * 1000) / 10
        : 0;
    g.rdvRatePct =
      g.emailsSent > 0
        ? Math.round((g.rdvBooked / g.emailsSent) * 1000) / 10
        : 0;
  }

  // Trier par positiveReplyRatePct desc, fallback triggers desc
  const sorted = Array.from(grouped.values()).sort((a, b) => {
    if (a.positiveReplyRatePct !== b.positiveReplyRatePct) {
      return b.positiveReplyRatePct - a.positiveReplyRatePct;
    }
    return b.triggers - a.triggers;
  });

  // Verdict automatique pour chaque source
  const recommendations: Array<{ sourceCode: string; verdict: string; reason: string }> = [];
  for (const g of sorted) {
    if (g.triggers >= 5 && g.emailsSent === 0) {
      recommendations.push({
        sourceCode: g.sourceCode,
        verdict: "à exploiter",
        reason: `${g.triggers} triggers détectés mais 0 email envoyé — gap commercial`,
      });
    } else if (g.emailsSent >= 5 && g.replyRatePct === 0) {
      recommendations.push({
        sourceCode: g.sourceCode,
        verdict: "underperform",
        reason: `${g.emailsSent} emails 0 reply (${days}j) — revoir pitch ou couper signal`,
      });
    } else if (g.emailsSent >= 3 && g.positiveReplyRatePct >= 5) {
      recommendations.push({
        sourceCode: g.sourceCode,
        verdict: "à doubler",
        reason: `${g.positiveReplyRatePct}% reply positif sur ${g.emailsSent} emails — augmenter cadence cron`,
      });
    } else if (g.emailsSent >= 3 && g.repliesUnsubscribe / g.emailsSent > 0.1) {
      recommendations.push({
        sourceCode: g.sourceCode,
        verdict: "risque RGPD",
        reason: `${g.repliesUnsubscribe}/${g.emailsSent} unsubscribe — pitch trop pushy ou hors ICP`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    windowDays: days,
    clientId: clientId ?? "all",
    totalTriggers: triggers.length,
    totalEmailsSent: emailActivities.filter((e) => e.direction === "SENT").length,
    totalRepliesPositive: emailActivities.filter(
      (e) => e.direction === "RECEIVED" && e.replyClassification === "positive",
    ).length,
    bySource: sorted,
    recommendations,
  });
}
