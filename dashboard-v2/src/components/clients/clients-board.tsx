"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Building2,
  ChevronRight,
  Mail,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/use-scope";
import { ClientProfile } from "@/components/clients/client-profile";
import { cn, formatNumberFr, formatRelativeFr } from "@/lib/utils";

type Status = "PROSPECT" | "ACTIVE" | "PAUSED" | "CHURNED";
type Plan = "LEADS_DATA" | "FULL_SERVICE" | "CUSTOM";

interface EnrichedClient {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  industry: string | null;
  region: string | null;
  size: string | null;
  status: Status;
  plan: Plan;
  contactEmail: string | null;
  primaryColor: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  triggersLast7d: number;
  openOpportunities: number;
  unreadReplies: number;
  mrrEur: number;
}

const STATUS_META: Record<Status, { label: string; variant: "warning" | "info" | "brand" | "success" | "default" }> = {
  PROSPECT: { label: "Prospect", variant: "warning" },
  ACTIVE: { label: "Actif", variant: "success" },
  PAUSED: { label: "Pause", variant: "info" },
  CHURNED: { label: "Churn", variant: "default" },
};

const PLAN_META: Record<Plan, { label: string; price: number }> = {
  LEADS_DATA: { label: "Leads Data", price: 199 },
  FULL_SERVICE: { label: "Full Service", price: 890 },
  CUSTOM: { label: "Custom", price: 0 },
};

export function ClientsBoard() {
  const { me } = useScope();
  const router = useRouter();

  if (!me) {
    return <BoardSkeleton />;
  }

  const isAdminLike = me.role === "ADMIN" || me.role === "COMMERCIAL";

  // CLIENT/EDITOR/VIEWER : profil direct (pas de table)
  if (!isAdminLike) {
    if (!me.clientId) {
      return (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Building2}
              title="Aucun client associé à votre compte"
              description="Contactez votre administrateur iFIND pour rattacher votre profil à un client."
              className="border-0 rounded-none bg-transparent"
            />
          </CardContent>
        </Card>
      );
    }
    return <ClientProfile clientId={me.clientId} />;
  }

  return <AdminClientsTable onOpen={(id) => router.push(`/clients/${id}` as never)} />;
}

function AdminClientsTable({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: clients = [], isLoading } = useQuery<EnrichedClient[]>({
    queryKey: ["clients-enriched"],
    queryFn: async () => {
      const res = await fetch("/api/clients?enriched=true");
      if (!res.ok) throw new Error("Erreur chargement clients");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  const totals = React.useMemo(() => {
    const active = clients.filter((c) => c.status === "ACTIVE");
    const mrr = active.reduce((sum, c) => sum + c.mrrEur, 0);
    const totalUnread = clients.reduce((sum, c) => sum + c.unreadReplies, 0);
    const totalOpen = clients.reduce((sum, c) => sum + c.openOpportunities, 0);
    return { mrr, count: clients.length, active: active.length, totalUnread, totalOpen };
  }, [clients]);

  const columns: ColumnDef<EnrichedClient>[] = [
    {
      accessorKey: "name",
      header: "Client",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white shadow-sm",
            )}
            style={{
              background: row.original.primaryColor
                ? `linear-gradient(135deg, ${row.original.primaryColor}, ${row.original.primaryColor}cc)`
                : "linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))",
            }}
          >
            {row.original.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-ink-900">{row.original.name}</div>
            <div className="truncate text-[11.5px] text-ink-500">
              {[row.original.industry, row.original.region].filter(Boolean).join(" · ") ||
                row.original.legalName ||
                "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Statut",
      cell: ({ row }) => {
        const m = STATUS_META[row.original.status];
        return (
          <Badge variant={m.variant} size="sm" dot>
            {m.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "plan",
      header: "Plan",
      cell: ({ row }) => {
        const m = PLAN_META[row.original.plan];
        return (
          <div className="flex flex-col">
            <span className="text-[12.5px] font-medium text-ink-800">{m.label}</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-500">
              {m.price > 0 ? `${m.price} €/mois` : "Sur mesure"}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "mrrEur",
      header: "MRR",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] tabular-nums font-semibold text-ink-900">
          {row.original.mrrEur > 0 ? `${formatNumberFr(row.original.mrrEur)} €` : "—"}
        </span>
      ),
    },
    {
      accessorKey: "triggersLast7d",
      header: "Triggers 7j",
      cell: ({ row }) => (
        <Badge variant="info" size="sm" className="font-mono tabular-nums">
          {row.original.triggersLast7d}
        </Badge>
      ),
    },
    {
      accessorKey: "openOpportunities",
      header: "Opps",
      cell: ({ row }) => (
        <Badge variant="brand" size="sm" className="font-mono tabular-nums">
          {row.original.openOpportunities}
        </Badge>
      ),
    },
    {
      accessorKey: "unreadReplies",
      header: "Replies",
      cell: ({ row }) =>
        row.original.unreadReplies > 0 ? (
          <Badge variant="warning" size="sm" className="font-mono tabular-nums" dot>
            {row.original.unreadReplies}
          </Badge>
        ) : (
          <span className="font-mono text-[11px] text-ink-300">—</span>
        ),
    },
    {
      accessorKey: "activatedAt",
      header: "Activé",
      cell: ({ row }) => (
        <span className="font-mono text-[11.5px] text-ink-500 tabular-nums">
          {row.original.activatedAt ? formatRelativeFr(row.original.activatedAt) : "—"}
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
            aria-label="Ouvrir fiche"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row.original.id);
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
      {/* KPIs récap admin */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="MRR consolidé"
          value={`${formatNumberFr(totals.mrr)} €`}
          hint={`${totals.active} clients actifs`}
          accent="brand"
        />
        <KpiCard
          icon={Building2}
          label="Total clients"
          value={String(totals.count)}
          hint="Tous statuts confondus"
          accent="success"
        />
        <KpiCard
          icon={Zap}
          label="Opportunités ouvertes"
          value={String(totals.totalOpen)}
          hint="Tous clients confondus"
          accent="warning"
        />
        <KpiCard
          icon={Mail}
          label="Replies à traiter"
          value={String(totals.totalUnread)}
          hint="Non lus tous clients"
          accent="fire"
        />
      </div>

      {clients.length > 0 || isLoading ? (
        <DataTable
          columns={columns}
          data={clients}
          loading={isLoading}
          pageSize={25}
          onRowClick={(c) => onOpen(c.id)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Users}
              title="Aucun client à afficher"
              description="Aucun compte client n'est rattaché à votre périmètre."
              className="border-0 rounded-none bg-transparent"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  hint: string;
  accent: "brand" | "success" | "warning" | "fire";
}) {
  const accentClass = {
    brand: "from-brand-50 to-brand-100 text-brand-700",
    success: "from-emerald-50 to-emerald-100 text-emerald-700",
    warning: "from-amber-50 to-amber-100 text-amber-700",
    fire: "from-orange-50 to-amber-50 text-orange-700",
  }[accent];

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
            accentClass,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
            {label}
          </div>
          <div className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink-900 tabular-nums">
            {value}
          </div>
          <div className="text-[11.5px] text-ink-500 truncate">{hint}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[78px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );
}
