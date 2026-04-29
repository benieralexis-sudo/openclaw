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
  Activity,
  ArrowUpRight,
  Calendar,
  Flame,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useScope } from "@/hooks/use-scope";
import { cn, formatRelativeFr } from "@/lib/utils";
import { ActivityStatsSection } from "@/components/dashboard/activity-stats-section";

interface DashboardData {
  kpis: {
    signals24h: { value: number; delta: number };
    hotPepites: { value: number; delta: number };
    bookedWeek: { value: number; delta: number };
    avgDelayMin: { value: number };
  };
  pipeline: Array<{ label: string; value: number; color: string }>;
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
      {/* KPI Grid */}
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
            label="Pépites ≥ 9/10"
            value={kpis?.hotPepites.value}
            delta={kpis?.hotPepites.delta}
            icon={Flame}
            accent="fire"
            isLoading={isLoading}
            deltaLabel="nouvelles"
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
          <KpiCard
            label="Délai signal → vous"
            value={kpis?.avgDelayMin.value}
            suffix="min"
            icon={Activity}
            accent="info"
            isLoading={isLoading}
            deltaLabel="moyenne 7j"
          />
        </div>
      </section>

      {/* Activité commerciale temps réel */}
      <ActivityStatsSection activeClientId={activeClientId} />

      {/* Pépites + Pipeline */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Pépites */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500" />
                Pépites du jour
              </CardTitle>
              <CardDescription>Les signaux les plus chauds détectés sur les dernières 24h</CardDescription>
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
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 text-orange-600">
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
                        <Badge variant="score" size="md" className="shrink-0">
                          {t.score}/10
                        </Badge>
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
    brand: "bg-brand-50 text-brand-600",
    fire: "bg-orange-50 text-orange-600",
    success: "bg-emerald-50 text-emerald-600",
    info: "bg-cyan-50 text-cyan-600",
  }[accent];

  return (
    <Card className="overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="px-5 pt-5">
        <div className="flex items-start justify-between">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentBg}`}>
            <Icon className="h-4 w-4" strokeWidth={2} />
          </div>
          {delta !== undefined && delta !== 0 && (
            <Badge variant={delta > 0 ? "success" : "danger"} size="sm">
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {delta > 0 ? `+${delta}` : delta}
            </Badge>
          )}
        </div>
        <p className="mt-4 text-[12px] font-medium uppercase tracking-wider text-ink-500">{label}</p>
        <div className="mt-1 flex items-baseline gap-1">
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <>
              <span className="font-display text-3xl font-bold tracking-tight text-ink-900 tabular-nums">
                {value ?? 0}
              </span>
              {suffix && <span className="text-sm text-ink-500">{suffix}</span>}
            </>
          )}
        </div>
        <p className="mt-1 mb-5 text-xs text-ink-500">
          {deltaLabel ?? (delta !== undefined ? "vs hier" : "")}
        </p>
      </div>
    </Card>
  );
}
