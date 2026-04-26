"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Building2,
  CheckCircle2,
  Container,
  Database,
  ExternalLink,
  Inbox,
  Server,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatNumberFr, formatRelativeFr } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface HealthData {
  dockerAvailable: boolean;
  containers: Array<{
    name: string;
    role: string;
    critical: boolean;
    running: boolean;
    status: string;
    image?: string | null;
  }>;
  nextServer: {
    running: boolean;
    pid: number;
    uptime: number;
    nodeVersion?: string;
  };
}

interface SourceData {
  code: string;
  label: string;
  category: string;
  paid: boolean;
  totalTriggers: number;
  last24hTriggers: number;
  last7dTriggers: number;
  lastCaptureAt: string | null;
  ageHours: number | null;
  status: "live" | "stale" | "idle";
}

interface StatsData {
  triggers: { total: number; last24h: number; last7d: number };
  leads: { total: number };
  opportunities: { total: number; open: number; won: number };
  replies: { total: number; unread: number };
  users: { total: number };
  clients: { active: number; prospect: number };
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string | null; role: string } | null;
  client: { id: string; slug: string; name: string } | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  distinctActions: string[];
}

// ──────────────────────────────────────────────────────────────────────
// Board principal
// ──────────────────────────────────────────────────────────────────────

export function SystemBoard() {
  return (
    <Tabs defaultValue="health" className="space-y-4">
      <TabsList className="bg-white border border-ink-200 shadow-xs">
        <TabsTrigger value="health" className="gap-1.5">
          <Server className="h-3.5 w-3.5" />
          Santé moteur
        </TabsTrigger>
        <TabsTrigger value="sources" className="gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Sources
        </TabsTrigger>
        <TabsTrigger value="audit" className="gap-1.5">
          <ExternalLink className="h-3.5 w-3.5" />
          Audit log
        </TabsTrigger>
        <TabsTrigger value="stats" className="gap-1.5">
          <Database className="h-3.5 w-3.5" />
          Stats DB
        </TabsTrigger>
      </TabsList>

      <TabsContent value="health"><HealthPanel /></TabsContent>
      <TabsContent value="sources"><SourcesPanel /></TabsContent>
      <TabsContent value="audit"><AuditLogPanel /></TabsContent>
      <TabsContent value="stats"><StatsPanel /></TabsContent>
    </Tabs>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Santé moteur
// ──────────────────────────────────────────────────────────────────────

function HealthPanel() {
  const { data, isLoading } = useQuery<HealthData>({
    queryKey: ["system-health"],
    queryFn: async () => {
      const res = await fetch("/api/system/health");
      if (!res.ok) throw new Error("Erreur health");
      return res.json();
    },
    refetchInterval: 15 * 1000,
  });

  if (isLoading || !data) return <Skeleton className="h-[300px] w-full rounded-xl" />;

  const allCritical = data.containers
    .filter((c) => c.critical)
    .every((c) => c.running);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                allCritical ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
              )}
            >
              {allCritical ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
                {allCritical ? "Tous les services critiques tournent" : "Incident en cours"}
              </div>
              <div className="text-[12px] text-ink-500">
                Next.js v{data.nextServer.nodeVersion ?? "?"} · uptime{" "}
                {formatUptime(data.nextServer.uptime)} · PID {data.nextServer.pid}
              </div>
            </div>
          </div>
          {!data.dockerAvailable && (
            <Badge variant="warning" size="md">
              Docker indisponible
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {data.containers.map((c) => (
          <Card key={c.name}>
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  c.running
                    ? "bg-emerald-50 text-emerald-700"
                    : c.critical
                      ? "bg-red-50 text-red-700"
                      : "bg-ink-100 text-ink-500",
                )}
              >
                <Container className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12.5px] font-semibold text-ink-900">
                    {c.name}
                  </span>
                  {c.critical && (
                    <Badge variant="brand" size="sm">
                      critique
                    </Badge>
                  )}
                </div>
                <div className="text-[11.5px] text-ink-500">{c.role}</div>
                <div className="mt-0.5 text-[11px] text-ink-600">{c.status}</div>
              </div>
              <Badge
                variant={c.running ? "success" : c.critical ? "danger" : "default"}
                size="sm"
                dot
              >
                {c.running ? "Up" : "Down"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ──────────────────────────────────────────────────────────────────────
// Sources actives (9)
// ──────────────────────────────────────────────────────────────────────

function SourcesPanel() {
  const { data: sources = [], isLoading } = useQuery<SourceData[]>({
    queryKey: ["system-sources"],
    queryFn: async () => {
      const res = await fetch("/api/system/sources");
      if (!res.ok) throw new Error("Erreur sources");
      return res.json();
    },
    refetchInterval: 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-[300px] w-full rounded-xl" />;

  const live = sources.filter((s) => s.status === "live").length;
  const total = sources.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Sources de données ({live}/{total} actives)
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Statut : <span className="text-emerald-700">live</span> ≤ 24h ·{" "}
              <span className="text-amber-700">stale</span> ≤ 7j ·{" "}
              <span className="text-ink-500">idle</span> au-delà.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-ink-100">
            {sources.map((s) => {
              const variant =
                s.status === "live"
                  ? "success"
                  : s.status === "stale"
                    ? "warning"
                    : "default";
              return (
                <li key={s.code} className="flex items-center gap-3 p-3">
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                      s.paid
                        ? "bg-gradient-to-br from-orange-50 to-amber-50 text-orange-700"
                        : "bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700",
                    )}
                  >
                    <Activity className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-ink-900">
                        {s.label}
                      </span>
                      <Badge variant="outline" size="sm">
                        {s.category}
                      </Badge>
                      {s.paid && (
                        <Badge variant="fire" size="sm">
                          Premium
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-ink-500">{s.code}</div>
                  </div>
                  <div className="hidden sm:block text-right">
                    <div className="font-mono text-[12.5px] tabular-nums text-ink-900">
                      {s.last24hTriggers} <span className="text-ink-400">/ 24h</span>
                    </div>
                    <div className="font-mono text-[10.5px] tabular-nums text-ink-500">
                      {s.last7dTriggers} sur 7j · {formatNumberFr(s.totalTriggers)} total
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={variant} size="sm" dot>
                      {s.status}
                    </Badge>
                    <div className="mt-1 font-mono text-[10.5px] tabular-nums text-ink-500">
                      {s.lastCaptureAt ? formatRelativeFr(s.lastCaptureAt) : "—"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Audit log
// ──────────────────────────────────────────────────────────────────────

function AuditLogPanel() {
  const [filter, setFilter] = React.useState<string>("all");

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["system-audit", filter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("action", filter);
      const res = await fetch(`/api/system/audit-log?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur audit");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  if (isLoading || !data) return <Skeleton className="h-[400px] w-full rounded-xl" />;

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              Audit log
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {data.entries.length} dernières actions
            </p>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 rounded-md border border-ink-200 bg-white px-3 text-[12.5px] text-ink-800 shadow-xs"
          >
            <option value="all">Toutes les actions</option>
            {data.distinctActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {data.entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-ink-50/40 p-8 text-center text-[12.5px] text-ink-500">
            Aucune entrée pour ce filtre
          </div>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-100 bg-white">
            {data.entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 p-3">
                <Badge variant="outline" size="sm" className="shrink-0 font-mono">
                  {e.action}
                </Badge>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 text-[12px] text-ink-700">
                    {e.user && (
                      <span className="font-medium">
                        {e.user.name ?? e.user.email}
                      </span>
                    )}
                    {e.client && (
                      <>
                        <span className="text-ink-300">·</span>
                        <span className="text-ink-600">{e.client.name}</span>
                      </>
                    )}
                    {e.entityType && (
                      <>
                        <span className="text-ink-300">·</span>
                        <span className="font-mono text-ink-500">
                          {e.entityType}#{e.entityId?.slice(-6) ?? "?"}
                        </span>
                      </>
                    )}
                  </div>
                  {e.metadata !== null &&
                    typeof e.metadata === "object" &&
                    Object.keys(e.metadata).length > 0 ? (
                      <div className="font-mono text-[10.5px] text-ink-500 truncate">
                        {JSON.stringify(e.metadata)}
                      </div>
                    ) : null}
                  {e.ipAddress && (
                    <div className="font-mono text-[10.5px] text-ink-400">
                      {e.ipAddress}
                    </div>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-400">
                  {formatRelativeFr(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stats DB
// ──────────────────────────────────────────────────────────────────────

function StatsPanel() {
  const { data, isLoading } = useQuery<StatsData>({
    queryKey: ["system-stats"],
    queryFn: async () => {
      const res = await fetch("/api/system/stats");
      if (!res.ok) throw new Error("Erreur stats");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  if (isLoading || !data) return <Skeleton className="h-[300px] w-full rounded-xl" />;

  const cards = [
    {
      label: "Triggers",
      icon: Target,
      accent: "brand" as const,
      main: formatNumberFr(data.triggers.total),
      hint: `${data.triggers.last24h} sur 24h · ${data.triggers.last7d} sur 7j`,
    },
    {
      label: "Leads identifiés",
      icon: Users,
      accent: "success" as const,
      main: formatNumberFr(data.leads.total),
      hint: "Contacts avec attribution Pappers",
    },
    {
      label: "Opportunités",
      icon: Zap,
      accent: "warning" as const,
      main: formatNumberFr(data.opportunities.total),
      hint: `${data.opportunities.open} ouvertes · ${data.opportunities.won} gagnées`,
    },
    {
      label: "Replies",
      icon: Inbox,
      accent: "fire" as const,
      main: formatNumberFr(data.replies.total),
      hint: `${data.replies.unread} non lus`,
    },
    {
      label: "Utilisateurs",
      icon: Users,
      accent: "brand" as const,
      main: String(data.users.total),
      hint: "Tous rôles confondus",
    },
    {
      label: "Clients",
      icon: Building2,
      accent: "success" as const,
      main: String(data.clients.active),
      hint: `${data.clients.active} actifs · ${data.clients.prospect} prospects`,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                {
                  brand: "from-brand-50 to-brand-100 text-brand-700",
                  success: "from-emerald-50 to-emerald-100 text-emerald-700",
                  warning: "from-amber-50 to-amber-100 text-amber-700",
                  fire: "from-orange-50 to-amber-50 text-orange-700",
                }[c.accent],
              )}
            >
              <c.icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
                {c.label}
              </div>
              <div className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink-900 tabular-nums">
                {c.main}
              </div>
              <div className="text-[11.5px] text-ink-500 truncate">{c.hint}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

