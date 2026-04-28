"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Flame, Target, Zap, Sparkles, Award, ListFilter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useScope } from "@/hooks/use-scope";
import { cn, formatRelativeFr } from "@/lib/utils";

interface Trigger {
  id: string;
  companyName: string;
  industry: string | null;
  region: string | null;
  size: string | null;
  type: string;
  title: string;
  detail: string | null;
  score: number;
  scoreReason?: string | null;
  isHot: boolean;
  isCombo: boolean;
  status: "NEW" | "CONTACTED" | "REPLIED" | "BOOKED" | "WON" | "LOST" | "IGNORED";
  capturedAt: string;
  sourceCode?: string | null;          // visible si ADMIN/COMMERCIAL
  comboSources?: string[];             // sources distinctes si combo
}

// Mapping sourceCode → badge label + couleur pour commerciaux
const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  rodz: { label: "Rodz", color: "bg-purple-100 text-purple-700 border-purple-200" },
  theirstack: { label: "TheirStack", color: "bg-blue-100 text-blue-700 border-blue-200" },
  "trigger-engine": { label: "Bot FR", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  apify: { label: "Apify", color: "bg-amber-100 text-amber-700 border-amber-200" },
};
function sourcePrefix(sc: string | null | undefined): string | null {
  if (!sc) return null;
  return sc.split(".")[0] ?? null;
}

const FILTER_LABELS: Record<string, { label: string; icon: typeof Target }> = {
  all: { label: "Tous", icon: Target },
  hot: { label: "Pépites ≥ 9", icon: Flame },
  combo: { label: "Combo", icon: Sparkles },
  new: { label: "À traiter", icon: Zap },
};

const STATUS_LABEL: Record<Trigger["status"], { variant: "warning" | "info" | "brand" | "success" | "default"; label: string }> = {
  NEW: { variant: "warning", label: "À traiter" },
  CONTACTED: { variant: "info", label: "Contacté" },
  REPLIED: { variant: "brand", label: "Répondu" },
  BOOKED: { variant: "success", label: "RDV booké" },
  WON: { variant: "success", label: "Gagné" },
  LOST: { variant: "default", label: "Perdu" },
  IGNORED: { variant: "default", label: "Ignoré" },
};

type Quality = "all" | "qualified" | "pepites";
const QUALITY_LABELS: Record<Quality, { label: string; icon: typeof Target; tip: string }> = {
  all: { label: "Tous", icon: ListFilter, tip: "Tous les leads, même score 1-5 (debug)" },
  qualified: { label: "Qualifiés", icon: Target, tip: "Score Opus ≥ 6, prêts à approcher" },
  pepites: { label: "Pépites", icon: Award, tip: "Score Opus ≥ 8, attaque immédiate" },
};

export default function TriggersPage() {
  const { activeClientId } = useScope();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = React.useState<keyof typeof FILTER_LABELS>("all");
  const [quality, setQuality] = React.useState<Quality>("qualified");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ["triggers", activeClientId, activeFilter, quality, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set("clientId", activeClientId);
      if (activeFilter !== "all") params.set("filter", activeFilter);
      params.set("quality", quality);
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/triggers?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur chargement triggers");
      return res.json();
    },
    refetchInterval: 30 * 1000, // Live data every 30s
  });

  // Compteurs réels (sans filter ni quality, juste search) — pour ne pas se rafraîchir au switch tab
  const { data: allTriggers = [] } = useQuery<Trigger[]>({
    queryKey: ["triggers", activeClientId, "_counts", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set("clientId", activeClientId);
      params.set("quality", "all");
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/triggers?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur chargement triggers");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  const counts: Record<keyof typeof FILTER_LABELS, number> = React.useMemo(
    () => ({
      all: allTriggers.length,
      hot: allTriggers.filter((t) => t.isHot).length,
      combo: allTriggers.filter((t) => t.isCombo).length,
      new: allTriggers.filter((t) => t.status === "NEW").length,
    }),
    [allTriggers],
  );

  const qualityCounts: Record<Quality, number> = React.useMemo(
    () => ({
      all: allTriggers.length,
      qualified: allTriggers.filter((t) => t.score >= 6).length,
      pepites: allTriggers.filter((t) => t.score >= 8).length,
    }),
    [allTriggers],
  );

  const columns: ColumnDef<Trigger>[] = [
    {
      accessorKey: "companyName",
      header: "Entreprise",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm",
              row.original.isHot
                ? "bg-gradient-to-br from-orange-100 to-amber-100 text-orange-600"
                : "bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600",
            )}
          >
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-ink-900 truncate">{row.original.companyName}</div>
            <div className="text-[11.5px] text-ink-500 truncate">
              {[row.original.industry, row.original.region].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "title",
      header: "Signal détecté",
      cell: ({ row }) => (
        <div className="min-w-0 max-w-xs">
          <div className="text-[13.5px] font-medium text-ink-800 truncate">{row.original.title}</div>
          {row.original.detail && (
            <div className="text-[11.5px] text-ink-500 truncate">{row.original.detail}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "score",
      header: "Score",
      cell: ({ row }) => {
        const s = row.original.score;
        const variant = s >= 9 ? "fire" : s >= 7 ? "score" : s >= 5 ? "info" : "warning";
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={variant} size="md" className="font-mono tabular-nums shrink-0">
              {s}/10
            </Badge>
            {row.original.isCombo && (
              <Badge variant="brand" size="sm" className="shrink-0" title={
                row.original.comboSources?.length
                  ? `Combo : ${row.original.comboSources.map((p) => SOURCE_LABEL[p]?.label ?? p).join(" + ")}`
                  : "Multi-source détecté"
              }>
                <Sparkles className="h-2.5 w-2.5" />
                Combo
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "source",
      header: "Source",
      cell: ({ row }) => {
        const prefix = sourcePrefix(row.original.sourceCode);
        if (!prefix) return <span className="text-[11px] text-ink-400">—</span>;
        const cfg = SOURCE_LABEL[prefix];
        const sources = row.original.comboSources?.length
          ? row.original.comboSources
          : [prefix];
        return (
          <div className="flex flex-wrap gap-1">
            {sources.map((p) => {
              const c = SOURCE_LABEL[p] ?? { label: p, color: "bg-ink-100 text-ink-700 border-ink-200" };
              return (
                <span
                  key={p}
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium",
                    c.color,
                  )}
                  title={`Détecté via ${c.label}${row.original.sourceCode && p === prefix ? ` (${row.original.sourceCode})` : ""}`}
                >
                  {c.label}
                </span>
              );
            })}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Statut",
      cell: ({ row }) => {
        const cfg = STATUS_LABEL[row.original.status];
        return (
          <Badge variant={cfg.variant} size="sm" dot>
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "capturedAt",
      header: "Détecté",
      cell: ({ row }) => (
        <span className="font-mono text-[11.5px] text-ink-500 tabular-nums">
          {formatRelativeFr(row.original.capturedAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Voir le brief"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/triggers/${row.original.id}` as never);
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={activeFilter} onValueChange={(v) => setActiveFilter(v as keyof typeof FILTER_LABELS)}>
            <TabsList className="bg-white border border-ink-200 shadow-xs">
              {(Object.entries(FILTER_LABELS) as [keyof typeof FILTER_LABELS, (typeof FILTER_LABELS)[string]][]).map(([key, f]) => {
                const Icon = f.icon;
                return (
                  <TabsTrigger key={key} value={key} className="gap-1.5 group">
                    <Icon className="h-3.5 w-3.5" />
                    <span>{f.label}</span>
                    <span className="ml-1 rounded bg-ink-100 px-1.5 py-0 text-[10.5px] font-mono tabular-nums text-ink-600 group-data-[state=active]:bg-brand-50 group-data-[state=active]:text-brand-700">
                      {counts[key]}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          <Tabs value={quality} onValueChange={(v) => setQuality(v as Quality)}>
            <TabsList className="bg-white border border-ink-200 shadow-xs">
              {(Object.entries(QUALITY_LABELS) as [Quality, (typeof QUALITY_LABELS)[Quality]][]).map(([key, q]) => {
                const Icon = q.icon;
                return (
                  <TabsTrigger key={key} value={key} className="gap-1.5 group" title={q.tip}>
                    <Icon className="h-3.5 w-3.5" />
                    <span>{q.label}</span>
                    <span className="ml-1 rounded bg-ink-100 px-1.5 py-0 text-[10.5px] font-mono tabular-nums text-ink-600 group-data-[state=active]:bg-brand-50 group-data-[state=active]:text-brand-700">
                      {qualityCounts[key]}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Rechercher entreprise, secteur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72"
          />
          {/* Filter button retiré 28/04 — non implémenté, induit en erreur */}
        </div>
      </div>

      {triggers.length > 0 || isLoading ? (
        <DataTable
          columns={columns}
          data={triggers}
          loading={isLoading}
          pageSize={25}
          onRowClick={(t) => router.push(`/triggers/${t.id}` as never)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Target}
              title="Aucun trigger ne matche ces critères"
              description={
                activeClientId
                  ? "Affinez votre filtre ou attendez les prochains signaux. Le moteur scanne en continu."
                  : "Sélectionnez un client dans la barre du haut pour voir ses triggers."
              }
              action={
                <Button variant="secondary" onClick={() => { setActiveFilter("all"); setSearch(""); }}>
                  Réinitialiser les filtres
                </Button>
              }
              className="border-0 rounded-none bg-transparent"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
