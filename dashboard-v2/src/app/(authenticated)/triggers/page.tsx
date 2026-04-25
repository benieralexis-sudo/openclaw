"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Filter, Flame, Target, Zap, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { cn, formatRelativeFr } from "@/lib/utils";

interface Trigger {
  id: string;
  company: string;
  industry: string;
  region: string;
  type: string;
  detail: string;
  score: number;
  status: "new" | "contacted" | "replied" | "booked" | "ignored";
  age: number; // minutes ago
  hot: boolean;
  combo: boolean;
}

const MOCK_TRIGGERS: Trigger[] = [
  {
    id: "trg_001",
    company: "Société Aéro Industriel",
    industry: "Industrie aéronautique",
    region: "Île-de-France",
    type: "Levée de fonds Série A",
    detail: "4,5 M€ — annonce officielle",
    score: 10,
    status: "new",
    age: 2,
    hot: true,
    combo: true,
  },
  {
    id: "trg_002",
    company: "ScaleUp Tech",
    industry: "SaaS B2B",
    region: "Lyon",
    type: "Recrutement Head of Sales",
    detail: "1er commercial — runway 18 mois",
    score: 9,
    status: "new",
    age: 8,
    hot: true,
    combo: false,
  },
  {
    id: "trg_003",
    company: "Maison Verte ETI",
    industry: "Agroalimentaire",
    region: "Pays de la Loire",
    type: "Dépôt INPI nouvelle marque",
    detail: "Lancement gamme produit Q3",
    score: 8,
    status: "contacted",
    age: 17,
    hot: false,
    combo: false,
  },
  {
    id: "trg_004",
    company: "TechFlow SAS",
    industry: "Logiciels",
    region: "Bordeaux",
    type: "Changement dirigeant",
    detail: "Nouveau CEO — ex-Salesforce",
    score: 8,
    status: "new",
    age: 45,
    hot: false,
    combo: true,
  },
  {
    id: "trg_005",
    company: "Innovat Manufacturing",
    industry: "Manufacturing",
    region: "Hauts-de-France",
    type: "Levée Série B",
    detail: "12 M€ + recrutement Sales",
    score: 10,
    status: "booked",
    age: 120,
    hot: true,
    combo: true,
  },
  {
    id: "trg_006",
    company: "DataFlow Analytics",
    industry: "Data / IA",
    region: "Paris",
    type: "Campagne Meta Ads",
    detail: "Doublement budget pub Q2",
    score: 7,
    status: "replied",
    age: 240,
    hot: false,
    combo: false,
  },
  {
    id: "trg_007",
    company: "GreenLogix",
    industry: "Logistique verte",
    region: "Marseille",
    type: "Recrutement CFO",
    detail: "Préparation levée probable",
    score: 8,
    status: "contacted",
    age: 360,
    hot: false,
    combo: false,
  },
];

const FILTERS = [
  { key: "all", label: "Tous", icon: Target, count: MOCK_TRIGGERS.length },
  { key: "hot", label: "Pépites ≥ 9", icon: Flame, count: MOCK_TRIGGERS.filter((t) => t.hot).length },
  { key: "combo", label: "Combo", icon: Sparkles, count: MOCK_TRIGGERS.filter((t) => t.combo).length },
  { key: "new", label: "À traiter", icon: Zap, count: MOCK_TRIGGERS.filter((t) => t.status === "new").length },
];

export default function TriggersPage() {
  const [activeFilter, setActiveFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    let list = MOCK_TRIGGERS;
    if (activeFilter === "hot") list = list.filter((t) => t.hot);
    else if (activeFilter === "combo") list = list.filter((t) => t.combo);
    else if (activeFilter === "new") list = list.filter((t) => t.status === "new");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.company.toLowerCase().includes(q) ||
          t.type.toLowerCase().includes(q) ||
          t.industry.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeFilter, search]);

  const columns: ColumnDef<Trigger>[] = [
    {
      accessorKey: "company",
      header: "Entreprise",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm",
              row.original.hot
                ? "bg-gradient-to-br from-orange-100 to-amber-100 text-orange-600"
                : "bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600",
            )}
          >
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-ink-900 truncate">{row.original.company}</div>
            <div className="text-[11.5px] text-ink-500 truncate">
              {row.original.industry} · {row.original.region}
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "type",
      header: "Signal détecté",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink-800 truncate">{row.original.type}</div>
          <div className="text-[11.5px] text-ink-500 truncate">{row.original.detail}</div>
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
            {row.original.combo && (
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
        const s = row.original.status;
        const map = {
          new: { variant: "warning" as const, label: "À traiter" },
          contacted: { variant: "info" as const, label: "Contacté" },
          replied: { variant: "brand" as const, label: "Répondu" },
          booked: { variant: "success" as const, label: "RDV booké" },
          ignored: { variant: "default" as const, label: "Ignoré" },
        };
        const cfg = map[s];
        return (
          <Badge variant={cfg.variant} size="sm" dot>
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "age",
      header: "Détecté",
      cell: ({ row }) => (
        <span className="font-mono text-[11.5px] text-ink-500 tabular-nums">
          {formatRelativeFr(new Date(Date.now() - row.original.age * 60_000))}
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
      {/* Filtres + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={activeFilter} onValueChange={setActiveFilter}>
          <TabsList className="bg-white border border-ink-200 shadow-xs">
            {FILTERS.map((f) => {
              const Icon = f.icon;
              return (
                <TabsTrigger key={f.key} value={f.key} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{f.label}</span>
                  <span className="ml-1 rounded bg-ink-100 px-1.5 py-0 text-[10.5px] font-mono tabular-nums text-ink-600 group-data-[state=active]:bg-brand-50 group-data-[state=active]:text-brand-700">
                    {f.count}
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

      {/* Table */}
      {filtered.length > 0 ? (
        <DataTable
          columns={columns}
          data={filtered}
          pageSize={25}
          onRowClick={(t) => console.log("Open detail", t.id)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Target}
              title="Aucun trigger ne matche ces critères"
              description="Affinez votre filtre ou attendez les prochains signaux. Le moteur scanne en continu."
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
