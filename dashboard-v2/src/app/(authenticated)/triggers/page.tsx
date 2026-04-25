"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Filter, Flame, Target, Zap, Sparkles } from "lucide-react";
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
  isHot: boolean;
  isCombo: boolean;
  status: "NEW" | "CONTACTED" | "REPLIED" | "BOOKED" | "WON" | "LOST" | "IGNORED";
  capturedAt: string;
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

export default function TriggersPage() {
  const { activeClientId } = useScope();
  const [activeFilter, setActiveFilter] = React.useState<keyof typeof FILTER_LABELS>("all");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ["triggers", activeClientId, activeFilter, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set("clientId", activeClientId);
      if (activeFilter !== "all") params.set("filter", activeFilter);
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/triggers?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur chargement triggers");
      return res.json();
    },
    refetchInterval: 30 * 1000, // Live data every 30s
  });

  // Compteurs réels (sans le filter actif, juste search) — séparé pour ne pas se rafraîchir au switch tab
  const { data: allTriggers = [] } = useQuery<Trigger[]>({
    queryKey: ["triggers", activeClientId, "_counts", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set("clientId", activeClientId);
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
              <Badge variant="brand" size="sm" className="shrink-0">
                <Sparkles className="h-2.5 w-2.5" />
                Combo
              </Badge>
            )}
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
      cell: () => (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon-sm" aria-label="Voir détail">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Rechercher entreprise, secteur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72"
          />
          <Button variant="secondary" size="md" className="gap-1.5 shrink-0">
            <Filter className="h-3.5 w-3.5" />
            Filtres
          </Button>
        </div>
      </div>

      {triggers.length > 0 || isLoading ? (
        <DataTable
          columns={columns}
          data={triggers}
          loading={isLoading}
          pageSize={25}
          onRowClick={(t) => console.log("Open detail", t.id)}
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
