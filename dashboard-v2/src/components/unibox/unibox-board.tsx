"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Building2,
  Check,
  Clock,
  ExternalLink,
  Filter,
  Inbox,
  Mail,
  MailOpen,
  MessageSquareWarning,
  Reply as ReplyIcon,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  UserX,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useScope } from "@/hooks/use-scope";
import { cn, formatRelativeFr, initials } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types & constantes
// ──────────────────────────────────────────────────────────────────────

type Intent =
  | "POSITIVE_INTEREST"
  | "REQUEST_INFO"
  | "ASK_TIMING"
  | "OBJECTION"
  | "REFUSED"
  | "OUT_OF_OFFICE"
  | "UNSUBSCRIBE"
  | "WRONG_PERSON"
  | "UNCLASSIFIED";

type Status = "UNREAD" | "READ" | "RESPONDING" | "ANSWERED" | "ARCHIVED";

interface ReplyLead {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  companyName: string;
  email: string | null;
  triggerId: string | null;
}

interface Reply {
  id: string;
  clientId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  body: string;
  receivedAt: string;
  intent: Intent;
  intentConfidence: number | null;
  status: Status;
  respondedAt: string | null;
  createdAt: string;
  lead: ReplyLead | null;
}

interface IntentMeta {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  variant: "success" | "brand" | "warning" | "danger" | "info" | "default" | "fire";
  hint: string;
}

const INTENT_META: Record<Intent, IntentMeta> = {
  POSITIVE_INTEREST: {
    label: "Positif",
    icon: Sparkles,
    variant: "success",
    hint: "À traiter en priorité — RDV potentiel",
  },
  REQUEST_INFO: {
    label: "Demande info",
    icon: MessageSquareWarning,
    variant: "info",
    hint: "Veut plus de détails / cas client",
  },
  ASK_TIMING: {
    label: "Timing",
    icon: Clock,
    variant: "warning",
    hint: "Pas maintenant — relance différée",
  },
  OBJECTION: {
    label: "Objection",
    icon: ShieldAlert,
    variant: "fire",
    hint: "Question difficile — à argumenter",
  },
  REFUSED: {
    label: "Refus",
    icon: ThumbsDown,
    variant: "danger",
    hint: "Pas intéressé — archiver",
  },
  OUT_OF_OFFICE: {
    label: "OOO",
    icon: Clock,
    variant: "default",
    hint: "Auto-réponse — reprogrammer",
  },
  UNSUBSCRIBE: {
    label: "Unsubscribe",
    icon: ThumbsDown,
    variant: "danger",
    hint: "Demande retrait liste — désabonner",
  },
  WRONG_PERSON: {
    label: "Wrong person",
    icon: UserX,
    variant: "default",
    hint: "Mauvais interlocuteur — re-router",
  },
  UNCLASSIFIED: {
    label: "À classifier",
    icon: Zap,
    variant: "brand",
    hint: "IA pas certaine — review manuel",
  },
};

const STATUS_META: Record<Status, { label: string; variant: "warning" | "info" | "brand" | "success" | "default" }> = {
  UNREAD: { label: "Non lu", variant: "warning" },
  READ: { label: "Lu", variant: "info" },
  RESPONDING: { label: "En cours", variant: "brand" },
  ANSWERED: { label: "Répondu", variant: "success" },
  ARCHIVED: { label: "Archivé", variant: "default" },
};

interface FilterDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  match: (r: Reply) => boolean;
}

const FILTERS: FilterDef[] = [
  { key: "all", label: "Tous", icon: Inbox, match: () => true },
  { key: "unread", label: "Non lus", icon: Mail, match: (r) => r.status === "UNREAD" },
  {
    key: "positive",
    label: "Positifs",
    icon: Sparkles,
    match: (r) => r.intent === "POSITIVE_INTEREST" || r.intent === "REQUEST_INFO",
  },
  {
    key: "objections",
    label: "Objections",
    icon: ShieldAlert,
    match: (r) => r.intent === "OBJECTION" || r.intent === "ASK_TIMING",
  },
  {
    key: "noise",
    label: "Bruit",
    icon: ThumbsDown,
    match: (r) =>
      r.intent === "REFUSED" ||
      r.intent === "OUT_OF_OFFICE" ||
      r.intent === "UNSUBSCRIBE" ||
      r.intent === "WRONG_PERSON",
  },
  { key: "todo", label: "À classifier", icon: Zap, match: (r) => r.intent === "UNCLASSIFIED" },
];

// ──────────────────────────────────────────────────────────────────────
// Board principal
// ──────────────────────────────────────────────────────────────────────

export function UniboxBoard() {
  const { activeClientId } = useScope();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data: replies = [], isLoading } = useQuery<Reply[]>({
    queryKey: ["replies", activeClientId, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set("clientId", activeClientId);
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/replies?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur chargement replies");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  const filtered = React.useMemo(() => {
    const f = FILTERS.find((x) => x.key === activeFilter);
    if (!f) return replies;
    return replies.filter(f.match);
  }, [replies, activeFilter]);

  const counts = React.useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.key, replies.filter(f.match).length]),
      ) as Record<string, number>,
    [replies],
  );

  const kpis = React.useMemo(() => {
    const unread = replies.filter((r) => r.status === "UNREAD").length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const positiveToday = replies.filter(
      (r) =>
        new Date(r.receivedAt) >= today &&
        (r.intent === "POSITIVE_INTEREST" || r.intent === "REQUEST_INFO"),
    ).length;
    const meetingReady = replies.filter(
      (r) =>
        r.intent === "POSITIVE_INTEREST" &&
        (r.status === "UNREAD" || r.status === "READ"),
    ).length;
    return { unread, positiveToday, meetingReady };
  }, [replies]);

  // Sélection auto du premier item au chargement / au changement de filtre
  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.find((r) => r.id === selectedId)) {
      setSelectedId(filtered[0]!.id);
    }
  }, [filtered, selectedId]);

  const selected = React.useMemo(
    () => filtered.find((r) => r.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const res = await fetch(`/api/replies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Erreur mise à jour");
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["replies", activeClientId] });
      const previous = queryClient.getQueryData<Reply[]>([
        "replies",
        activeClientId,
        debouncedSearch,
      ]);
      queryClient.setQueryData<Reply[]>(
        ["replies", activeClientId, debouncedSearch],
        (prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["replies", activeClientId, debouncedSearch], ctx.previous);
      }
      toast.error("Échec de la mise à jour");
    },
    onSuccess: (_data, vars) => {
      const labels: Record<Status, string> = {
        UNREAD: "Marqué non lu",
        READ: "",  // silencieux — auto-mark au clic
        RESPONDING: "Marqué en cours",
        ANSWERED: "Marqué répondu",
        ARCHIVED: "Archivé",
      };
      if (labels[vars.status]) toast.success(labels[vars.status]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["replies", activeClientId] });
      queryClient.invalidateQueries({ queryKey: ["replies-unread-count"] });
    },
  });

  // Auto-mark READ quand on sélectionne un UNREAD
  React.useEffect(() => {
    if (selected && selected.status === "UNREAD") {
      updateStatus.mutate({ id: selected.id, status: "READ" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          icon={Mail}
          label="Non lus"
          value={String(kpis.unread)}
          hint="À traiter en priorité"
          accent="warning"
        />
        <KpiCard
          icon={Sparkles}
          label="Positifs aujourd'hui"
          value={String(kpis.positiveToday)}
          hint="Reçus depuis 00h"
          accent="success"
        />
        <KpiCard
          icon={ReplyIcon}
          label="RDV bookables"
          value={String(kpis.meetingReady)}
          hint="POSITIVE_INTEREST en attente"
          accent="brand"
        />
      </div>

      {/* Filtres + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={activeFilter} onValueChange={setActiveFilter}>
          <TabsList className="bg-white border border-ink-200 shadow-xs">
            {FILTERS.map((f) => {
              const Icon = f.icon;
              return (
                <TabsTrigger key={f.key} value={f.key} className="gap-1.5 group">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{f.label}</span>
                  <span className="ml-1 rounded bg-ink-100 px-1.5 py-0 text-[10.5px] font-mono tabular-nums text-ink-600 group-data-[state=active]:bg-brand-50 group-data-[state=active]:text-brand-700">
                    {counts[f.key] ?? 0}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Rechercher contact, sujet, contenu…"
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

      {/* Layout split */}
      {isLoading && replies.length === 0 ? (
        <SplitSkeleton />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Inbox}
              title="Aucune réponse dans ce filtre"
              description={
                activeClientId
                  ? "Ajustez le filtre ou la recherche. Les nouvelles réponses arrivent en temps réel."
                  : "Sélectionnez un client dans la barre du haut pour voir ses replies."
              }
              action={
                activeFilter !== "all" ? (
                  <Button variant="secondary" onClick={() => setActiveFilter("all")}>
                    Voir toutes les réponses
                  </Button>
                ) : undefined
              }
              className="border-0 rounded-none bg-transparent"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex h-[calc(100vh-340px)] min-h-[480px] gap-3 rounded-xl border border-ink-200 bg-white shadow-xs overflow-hidden">
          {/* Liste */}
          <ul className="w-[360px] shrink-0 overflow-y-auto border-r border-ink-200">
            {filtered.map((r) => (
              <ReplyListItem
                key={r.id}
                reply={r}
                active={r.id === selectedId}
                onClick={() => setSelectedId(r.id)}
              />
            ))}
          </ul>

          {/* Reading pane */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <ReplyDetail
                reply={selected}
                onMutate={(status) => updateStatus.mutate({ id: selected.id, status })}
                onOpenBrief={
                  selected.lead?.triggerId
                    ? () => router.push(`/triggers/${selected.lead!.triggerId}` as never)
                    : undefined
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-ink-400">
                Sélectionnez une réponse pour la consulter
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KPI card (simple)
// ──────────────────────────────────────────────────────────────────────

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
  accent: "brand" | "success" | "warning";
}) {
  const accentClass = {
    brand: "from-brand-50 to-brand-100 text-brand-700",
    success: "from-emerald-50 to-emerald-100 text-emerald-700",
    warning: "from-amber-50 to-amber-100 text-amber-700",
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

// ──────────────────────────────────────────────────────────────────────
// List item
// ──────────────────────────────────────────────────────────────────────

function ReplyListItem({
  reply,
  active,
  onClick,
}: {
  reply: Reply;
  active: boolean;
  onClick: () => void;
}) {
  const meta = INTENT_META[reply.intent];
  const Icon = meta.icon;
  const unread = reply.status === "UNREAD";

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex w-full flex-col gap-1.5 border-b border-ink-100 px-4 py-3 text-left transition-colors hover:bg-ink-50/70",
          active && "bg-brand-50/70 hover:bg-brand-50/90",
          unread && !active && "bg-white",
        )}
      >
        {active && (
          <span
            className="absolute left-0 top-0 h-full w-[3px] bg-brand-500"
            aria-hidden
          />
        )}
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-semibold uppercase",
              unread ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-600",
            )}
          >
            {initials(reply.fromName ?? reply.fromEmail)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "truncate text-[13px]",
                  unread ? "font-semibold text-ink-900" : "font-medium text-ink-700",
                )}
              >
                {reply.fromName ?? reply.fromEmail}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-400">
                {formatRelativeFr(reply.receivedAt)}
              </span>
            </div>
            <div className="truncate text-[12px] text-ink-600">
              {reply.subject ?? "(sans sujet)"}
            </div>
            <div className="line-clamp-1 text-[11.5px] text-ink-500">
              {reply.body.slice(0, 120)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 pl-[42px]">
          <Badge variant={meta.variant} size="sm" className="gap-1">
            <Icon className="h-2.5 w-2.5" />
            {meta.label}
          </Badge>
          {reply.lead?.companyName && (
            <Badge variant="outline" size="sm" className="gap-1 text-ink-600">
              <Building2 className="h-2.5 w-2.5" />
              <span className="truncate max-w-[110px]">{reply.lead.companyName}</span>
            </Badge>
          )}
          {unread && (
            <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
          )}
        </div>
      </button>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Reading pane
// ──────────────────────────────────────────────────────────────────────

function ReplyDetail({
  reply,
  onMutate,
  onOpenBrief,
}: {
  reply: Reply;
  onMutate: (status: Status) => void;
  onOpenBrief?: () => void;
}) {
  const intentMeta = INTENT_META[reply.intent];
  const IntentIcon = intentMeta.icon;
  const statusMeta = STATUS_META[reply.status];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-ink-200 px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-semibold leading-snug tracking-tight text-ink-900">
            {reply.subject ?? "(sans sujet)"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-600">
            <span className="font-medium text-ink-800">
              {reply.fromName ?? reply.fromEmail}
            </span>
            <span className="text-ink-300">·</span>
            <span className="font-mono text-[11.5px] text-ink-500">{reply.fromEmail}</span>
            {reply.lead?.companyName && (
              <>
                <span className="text-ink-300">·</span>
                <span className="flex items-center gap-1 text-ink-600">
                  <Building2 className="h-3 w-3" />
                  {reply.lead.companyName}
                </span>
              </>
            )}
            {reply.lead?.jobTitle && (
              <>
                <span className="text-ink-300">·</span>
                <span className="text-ink-500">{reply.lead.jobTitle}</span>
              </>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={intentMeta.variant} size="md" className="gap-1.5">
              <IntentIcon className="h-3 w-3" />
              {intentMeta.label}
              {reply.intentConfidence !== null && (
                <span className="font-mono opacity-70">
                  {Math.round(reply.intentConfidence * 100)}%
                </span>
              )}
            </Badge>
            <Badge variant={statusMeta.variant} size="sm" dot>
              {statusMeta.label}
            </Badge>
            <span className="font-mono text-[11px] tabular-nums text-ink-400">
              {formatRelativeFr(reply.receivedAt)}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-ink-500">{intentMeta.hint}</div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenBrief && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenBrief}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Brief</span>
            </Button>
          )}
          {reply.status !== "UNREAD" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMutate("UNREAD")}
              aria-label="Marquer non lu"
              className="gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Non lu</span>
            </Button>
          )}
          {reply.status !== "RESPONDING" && reply.status !== "ANSWERED" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMutate("RESPONDING")}
              className="gap-1.5"
            >
              <ReplyIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">En cours</span>
            </Button>
          )}
          {reply.status !== "ANSWERED" && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onMutate("ANSWERED")}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Répondu
            </Button>
          )}
          {reply.status !== "ARCHIVED" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMutate("ARCHIVED")}
              aria-label="Archiver"
              className="gap-1.5"
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Archiver</span>
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-700">
          {reply.body}
        </div>

        {reply.respondedAt && (
          <div className="mt-6 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            <MailOpen className="h-3.5 w-3.5" />
            Réponse envoyée {formatRelativeFr(reply.respondedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function SplitSkeleton() {
  return (
    <div className="flex h-[calc(100vh-340px)] min-h-[480px] gap-3 rounded-xl border border-ink-200 bg-white shadow-xs overflow-hidden">
      <div className="w-[360px] shrink-0 space-y-2 border-r border-ink-200 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
        ))}
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="mb-3 h-6 w-2/3" />
        <Skeleton className="mb-4 h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
