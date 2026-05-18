"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpRight,
  Calendar,
  Diamond,
  Flame,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useScope } from "@/hooks/use-scope";
import { cn, formatRelativeFr } from "@/lib/utils";
import { ActivityStatsSection } from "@/components/dashboard/activity-stats-section";
import { PillarHealthBanner } from "@/components/triggers/pillar-health-banner";
import { PillarsOverviewSection, type PillarSummaryItem } from "@/components/dashboard/pillars-overview-section";
import { CombosSection, type ComboItem } from "@/components/dashboard/combos-section";
import {
  getCombinedScore,
  getCombinedTier,
  getCombinedLabel,
  getCombinedColors,
  getV2Tier,
  getV2Label,
  getV2Variant,
  formatV2Badge,
} from "@/lib/score-display";
import type { TodoItem } from "@/lib/todo-today";
import { Sparkles, Mail, Phone as PhoneIcon, Linkedin } from "lucide-react";

interface DashboardData {
  kpis: {
    signals24h: { value: number; delta: number };
    hotPepites: { value: number; delta: number };
    bookedWeek: { value: number; delta: number };
    avgDelayMin: { value: number };
    // V1 17/05 — KPIs stratégie catalogue
    pepiteCombo7d: { value: number };
    diamantCombo7d: { value: number };
  };
  pipeline: Array<{ label: string; value: number; color: string }>;
  todoToday: TodoItem[];
  recentTriggers: Array<{
    id: string;
    companyName: string;
    industry: string | null;
    region: string | null;
    title: string;
    detail: string | null;
    score: number;
    isCombo: boolean;
    capturedAt: string;
    // Refactor V2-only Session 2 — verdict V2 natif
    briefV2Json?: { verdict?: "OUI" | "ENRICH" | "NON"; confidence?: number } | null;
    lead?: {
      id: string;
      email: string | null;
      kasprPhone: string | null;
      phone: string | null;
      pitchJson: unknown;
      callBriefJson: unknown;
      linkedinDmJson: unknown;
      status: string;
    } | null;
  }>;
  // V1 17/05 — Stratégie catalogue
  pillarsSummary: PillarSummaryItem[];
  combos: ComboItem[];
}

export default function DashboardPage() {
  const { activeClientId, activeClient, role } = useScope();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard", activeClientId],
    queryFn: async () => {
      const params = activeClientId ? `?clientId=${activeClientId}` : "";
      const res = await fetch(`/api/dashboard${params}`);
      if (!res.ok) throw new Error("Erreur chargement dashboard");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  const kpis = data?.kpis;
  const pipelineMax = Math.max(1, ...(data?.pipeline.map((p) => p.value) ?? [1]));

  // Header contextuel pour les CLIENT (Frédéric DTL) : message bienvenue
  // distinct du dashboard ADMIN. Permet à Frédéric de comprendre que ce
  // qu'il voit = SES leads (pas tout le moteur iFIND).
  const isClient = role === "client" || role === "editor" || role === "viewer";

  return (
    <div className="space-y-6">
      {isClient && activeClient && (
        <div className="rounded-md border border-brand-200 bg-brand-50 px-4 py-3">
          <div className="text-[12.5px] text-ink-700">
            Bienvenue sur le dashboard de <strong className="text-ink-900">{activeClient.name}</strong>.
            Vous voyez ici <strong>vos leads identifiés</strong> ainsi que le pipeline RDV
            géré par votre commercial dédié.
          </div>
        </div>
      )}

      {/* V1 17/05 — Bannière santé des 3 piliers : signal vivant / tiède / froid.
          Visible uniquement si un client est sélectionné (admin avec un scope ou client login). */}
      {activeClientId && <PillarHealthBanner clientId={activeClientId} />}

      {/* KPI Grid — V1 17/05 : remplacement "Délai signal" (technique) par
          "Diamants" (stratégie catalogue : 3 piliers convergents). */}
      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Signaux 24h"
            value={kpis?.signals24h.value}
            delta={kpis?.signals24h.delta}
            icon={Zap}
            accent="brand"
            isLoading={isLoading}
          />
          <KpiCard
            label="Pépites 7j"
            value={kpis?.pepiteCombo7d?.value ?? kpis?.hotPepites.value}
            icon={Flame}
            accent="fire"
            isLoading={isLoading}
            deltaLabel="2+ piliers convergents"
          />
          <KpiCard
            label="Diamants 7j"
            value={kpis?.diamantCombo7d?.value ?? 0}
            icon={Diamond}
            accent="brand"
            isLoading={isLoading}
            deltaLabel="3 piliers convergents"
          />
          <KpiCard
            label="RDV cette semaine"
            value={kpis?.bookedWeek.value}
            delta={kpis?.bookedWeek.delta}
            icon={Calendar}
            accent="success"
            isLoading={isLoading}
            deltaLabel="vs sem -1"
          />
        </div>
      </section>

      {/* V1 17/05 — Tes 3 piliers : nb leads 7j+30j+Pépites par pilier. */}
      <PillarsOverviewSection
        pillars={data?.pillarsSummary ?? []}
        isLoading={isLoading}
      />

      {/* V1 17/05 — Combos du jour : Pépites (2 piliers) et Diamants (3 piliers). */}
      <CombosSection combos={data?.combos ?? []} isLoading={isLoading} />

      {/* Activité commerciale temps réel */}
      <ActivityStatsSection activeClientId={activeClientId} />

      {/* Chantier D3 (01/05) — Ma todo du jour : top 5 leads à appeler MAINTENANT
          (priorityScore composite v3.9 + fitScore v4.2, dédup par société). */}
      <TodoTodaySection todoToday={data?.todoToday ?? []} isLoading={isLoading} />

      {/* Pépites + Pipeline */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* V1 17/05 — Renommé "Signaux brûlants 24h" : score Opus ≥ 9 ou
            verdict OUI ≥ 85 %. Inclut les Pépites combo mais aussi les
            signaux 1-pilier très convaincants (fallback Opus ≥ 85). */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-brand-700" />
                Signaux brûlants 24h
              </CardTitle>
              <CardDescription>Les leads les plus chauds détectés sur les dernières 24h (score élevé, peu importe le nombre de piliers)</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 text-brand-600" asChild>
              <a href="/triggers?filter=hot">
                Voir tout
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ul className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center gap-3 py-2">
                    <Skeleton className="h-9 w-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-6 w-12 rounded-md" />
                  </li>
                ))}
              </ul>
            ) : data?.recentTriggers.length ? (
              <ul className="divide-y divide-ink-100">
                {data.recentTriggers.map((t) => {
                  const hasContent = !!(t.lead?.pitchJson || t.lead?.callBriefJson || t.lead?.linkedinDmJson);
                  const hasContact = !!(t.lead?.email || t.lead?.kasprPhone || t.lead?.phone);
                  const statusLabel = !t.lead
                    ? { text: "À enrichir", color: "bg-ink-100 text-ink-600" }
                    : !hasContact
                    ? { text: "Sans contact", color: "bg-amber-100 text-amber-700" }
                    : !hasContent
                    ? { text: "À briefer", color: "bg-blue-100 text-blue-700" }
                    : t.lead.status === "CONTACTED"
                    ? { text: "Contacté", color: "bg-purple-100 text-purple-700" }
                    : { text: "Prêt à envoyer", color: "bg-emerald-100 text-emerald-700" };
                  return (
                    <li key={t.id} className="first:pt-0 last:pb-0">
                      <Link
                        href={`/triggers/${t.id}` as never}
                        className="flex items-center gap-3 py-3 group transition-colors hover:bg-ink-50/50 -mx-2 px-2 rounded"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 border border-brand-200">
                          <Zap className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-[13.5px] font-medium text-ink-900 truncate">{t.title}</p>
                            <span className="font-mono text-[11px] text-ink-400 shrink-0">
                              {formatRelativeFr(t.capturedAt)}
                            </span>
                          </div>
                          <p className="text-xs text-ink-500 truncate">
                            {t.companyName}
                            {t.industry && ` · ${t.industry}`}
                            {t.region && ` · ${t.region}`}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                            statusLabel.color,
                          )}
                          title="Statut commercial"
                        >
                          {statusLabel.text}
                        </span>
                        {t.briefV2Json?.verdict ? (
                          <Badge
                            variant={getV2Variant(getV2Tier({ verdict: t.briefV2Json.verdict, confidence: t.briefV2Json.confidence }))}
                            size="md"
                            className="font-mono tabular-nums shrink-0"
                            title={getV2Label(getV2Tier({ verdict: t.briefV2Json.verdict, confidence: t.briefV2Json.confidence }))}
                          >
                            {formatV2Badge({ verdict: t.briefV2Json.verdict, confidence: t.briefV2Json.confidence })}
                          </Badge>
                        ) : (
                          <Badge variant="score" size="md" className="shrink-0" title="V2 absent (lead pre-Sprint 8)">
                            {t.score}/10
                          </Badge>
                        )}
                        {t.isCombo && (
                          <Badge variant="brand" size="sm" className="hidden md:inline-flex shrink-0">
                            Combo
                          </Badge>
                        )}
                        <ArrowUpRight className="h-3.5 w-3.5 text-ink-400 group-hover:text-brand-600 shrink-0 transition-colors" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-ink-500">
                Aucune pépite détectée sur les dernières 24h.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4 text-brand-600" />
              Pipeline RDV
            </CardTitle>
            <CardDescription>État de la conversion {activeClient ? `· ${activeClient.name}` : "global"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              [1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-8" />
                  </div>
                  <Skeleton className="h-1.5 w-full" />
                </div>
              ))
            ) : (
              data?.pipeline.map((step) => {
                const pct = (step.value / pipelineMax) * 100;
                return (
                  <div key={step.label}>
                    <div className="mb-1 flex items-baseline justify-between text-[13px]">
                      <span className="text-ink-700">{step.label}</span>
                      <span className="font-mono font-semibold tabular-nums text-ink-900">{step.value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={cn("h-full rounded-full transition-all", step.color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  accent,
  suffix,
  deltaLabel,
  isLoading,
}: {
  label: string;
  value?: number;
  delta?: number;
  icon: typeof Zap;
  accent: "brand" | "fire" | "success" | "info";
  suffix?: string;
  deltaLabel?: string;
  isLoading?: boolean;
}) {
  const accentBg = {
    brand: "bg-brand-50 text-brand-700 border border-brand-100",
    fire: "bg-brand-50 text-brand-700 border border-brand-100",
    success: "bg-emerald-50 text-emerald-700 border border-emerald-100",
    info: "bg-brand-50 text-brand-700 border border-brand-100",
  }[accent];

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 hover:border-brand-200 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`flex h-9 w-9 items-center justify-center rounded-md ${accentBg}`}>
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        {delta !== undefined && delta !== 0 && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${delta > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"}`}>
            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-1.5">
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <span className="font-display text-3xl font-semibold tracking-tight tabular-nums bg-gradient-to-br from-ink-900 via-brand-800 to-brand-700 bg-clip-text text-transparent">
              {value ?? 0}
            </span>
            {suffix && <span className="text-sm text-ink-500">{suffix}</span>}
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        {deltaLabel ?? (delta !== undefined ? "vs hier" : "")}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Chantier D3 (01/05) — Section "Ma todo du jour"
// Top 5 leads à appeler MAINTENANT, dédupliqués par société.
// Tri composite : priorityScore (v3.9) + fitScore × 0.3 (v4.2).
// ──────────────────────────────────────────────────────────────────────

function TodoTodaySection({
  todoToday,
  isLoading,
}: {
  todoToday: TodoItem[];
  isLoading: boolean;
}) {
  return (
    <section>
      <Card className="border-brand-200 bg-gradient-to-br from-brand-50/40 to-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" />
              Ma todo du jour
            </CardTitle>
            <CardDescription>
              Top 5 leads à appeler maintenant — tri par priorité composite (signal × fraîcheur × multi-source) + fit ICP
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 text-brand-600" asChild>
            <a href="/triggers">
              Voir tous
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ul className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <li key={i} className="flex items-center gap-3 rounded-md border border-ink-100 bg-white p-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-7 w-12 rounded" />
                </li>
              ))}
            </ul>
          ) : todoToday.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-200 bg-white p-6 text-center">
              <p className="text-[13px] text-ink-600">Pipeline en cours d'enrichissement.</p>
              <p className="mt-1 text-[11.5px] text-ink-400">Les leads avec priorityScore apparaîtront ici dès le prochain run.</p>
            </div>
          ) : (
            <ol className="space-y-2">
              {todoToday.map((t, idx) => {
                const fullName = [t.firstName, t.lastName].filter(Boolean).join(" ");
                // Score unifié 04/05/2026 (mockup validé) : remplace
                // l'affichage Priorité+Fit séparé par 1 colonne lisible.
                const combinedScore = getCombinedScore({
                  priorityScore: t.priorityScore,
                  fitScore: t.fitScore,
                });
                const tier = getCombinedTier(combinedScore);
                const tierLabel = getCombinedLabel(tier);
                const tierColors = getCombinedColors(tier);
                const tooltip =
                  combinedScore !== null
                    ? `Score ${combinedScore}/100 — ${tierLabel} (priorité ${t.priorityScore ?? "?"}, fit ${t.fitScore ?? "?"})`
                    : "Score non calculé";
                return (
                  <li key={t.id}>
                    <Link
                      href={`/triggers/${t.id}` as never}
                      className={cn(
                        "group flex items-center gap-3 rounded-md border bg-white p-3 transition-all",
                        "border-ink-100 hover:border-brand-300 hover:shadow-sm",
                      )}
                    >
                      {/* Rang + initials société */}
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-ink-400 w-4 text-center tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 text-[10.5px] font-bold text-brand-700">
                          {t.companyName.slice(0, 2).toUpperCase()}
                        </div>
                      </div>

                      {/* Nom + société + signal */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="text-[13.5px] font-medium text-ink-900 truncate">
                            {fullName || "Décideur à identifier"}
                          </p>
                          {t.jobTitle && (
                            <span className="text-[11px] text-ink-500 truncate">— {t.jobTitle}</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-500 truncate">
                          <span className="font-medium text-ink-700 truncate">{t.companyName}</span>
                          <span className="text-ink-300">·</span>
                          <span className="truncate">{t.title}</span>
                        </div>
                      </div>

                      {/* Score unifié + signaux contact */}
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="flex items-center gap-1 text-ink-400">
                          {t.hasEmail && <Mail className="h-3 w-3 text-emerald-600" />}
                          {t.hasPhone && <PhoneIcon className="h-3 w-3 text-brand-600" />}
                          {t.hasLinkedin && <Linkedin className="h-3 w-3 text-blue-600" />}
                        </div>
                        {combinedScore !== null ? (
                          <div
                            className="flex items-center gap-2"
                            title={tooltip}
                          >
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                              <div
                                className={cn("h-full rounded-full transition-all", tierColors.bar)}
                                style={{ width: `${Math.min(100, Math.max(0, combinedScore))}%` }}
                              />
                            </div>
                            <span
                              className={cn(
                                "font-mono text-[12px] font-bold tabular-nums",
                                tierColors.text,
                              )}
                            >
                              {combinedScore}
                            </span>
                            <span
                              className={cn(
                                "text-[11px] font-medium hidden sm:inline",
                                tierColors.text,
                              )}
                            >
                              {tierLabel}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-ink-400">—</span>
                        )}
                        <ArrowUpRight className="h-3.5 w-3.5 text-ink-400 group-hover:text-brand-600 transition-colors" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
