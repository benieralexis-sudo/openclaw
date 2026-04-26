"use client";

import * as React from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  Flame,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useScope } from "@/hooks/use-scope";
import { cn, formatNumberFr, formatRelativeFr } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types & constantes
// ──────────────────────────────────────────────────────────────────────

type Stage =
  | "IDENTIFIED"
  | "CONTACTED"
  | "ENGAGED"
  | "MEETING_SET"
  | "PROPOSAL"
  | "WON"
  | "LOST";

interface OpportunityLead {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  email: string | null;
  companyName: string;
}

interface OpportunityTrigger {
  id: string;
  title: string;
  score: number;
  isHot: boolean;
  isCombo: boolean;
  industry: string | null;
  region: string | null;
}

interface Opportunity {
  id: string;
  clientId: string;
  stage: Stage;
  meetingDate: string | null;
  meetingNotes: string | null;
  dealValueEur: number | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  lead: OpportunityLead | null;
  trigger: OpportunityTrigger | null;
}

interface StageMeta {
  label: string;
  hint: string;
  // Probabilité utilisée pour pondérer le pipeline ouvert
  probability: number;
  accent: string; // tw class for column header bar
  badgeVariant: "default" | "info" | "brand" | "warning" | "success" | "danger" | "fire";
}

const STAGE_ORDER: Stage[] = [
  "IDENTIFIED",
  "CONTACTED",
  "ENGAGED",
  "MEETING_SET",
  "PROPOSAL",
  "WON",
  "LOST",
];

const STAGE_META: Record<Stage, StageMeta> = {
  IDENTIFIED: {
    label: "Identifié",
    hint: "Trigger reçu",
    probability: 0.05,
    accent: "bg-ink-300",
    badgeVariant: "default",
  },
  CONTACTED: {
    label: "Contacté",
    hint: "Email envoyé",
    probability: 0.15,
    accent: "bg-cyan-400",
    badgeVariant: "info",
  },
  ENGAGED: {
    label: "Engagé",
    hint: "Réponse reçue",
    probability: 0.35,
    accent: "bg-brand-400",
    badgeVariant: "brand",
  },
  MEETING_SET: {
    label: "RDV booké",
    hint: "Calendrier",
    probability: 0.55,
    accent: "bg-amber-400",
    badgeVariant: "warning",
  },
  PROPOSAL: {
    label: "Proposition",
    hint: "Devis envoyé",
    probability: 0.75,
    accent: "bg-orange-400",
    badgeVariant: "fire",
  },
  WON: {
    label: "Gagné",
    hint: "Deal signé",
    probability: 1,
    accent: "bg-emerald-500",
    badgeVariant: "success",
  },
  LOST: {
    label: "Perdu",
    hint: "Pas concluant",
    probability: 0,
    accent: "bg-red-400",
    badgeVariant: "danger",
  },
};

// ──────────────────────────────────────────────────────────────────────
// Board principal
// ──────────────────────────────────────────────────────────────────────

export function PipelineBoard() {
  const { activeClientId } = useScope();
  const queryClient = useQueryClient();
  const [draggedId, setDraggedId] = React.useState<string | null>(null);

  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ["opportunities", activeClientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set("clientId", activeClientId);
      const res = await fetch(`/api/opportunities?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur chargement opportunités");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  const updateStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error("Erreur mise à jour");
      return res.json();
    },
    // Optimistic update — pas de flicker
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: ["opportunities", activeClientId] });
      const previous = queryClient.getQueryData<Opportunity[]>([
        "opportunities",
        activeClientId,
      ]);
      queryClient.setQueryData<Opportunity[]>(
        ["opportunities", activeClientId],
        (prev) => (prev ?? []).map((o) => (o.id === id ? { ...o, stage } : o)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["opportunities", activeClientId], ctx.previous);
      }
      toast.error("Échec du déplacement", { description: "Réessayez dans un instant." });
    },
    onSuccess: (_data, vars) => {
      const meta = STAGE_META[vars.stage];
      toast.success(`Déplacé vers ${meta.label}`, {
        description:
          vars.stage === "WON"
            ? "Bravo — deal marqué gagné."
            : vars.stage === "LOST"
              ? "Marqué comme perdu."
              : meta.hint,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities", activeClientId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Grouping
  const byStage = React.useMemo(() => {
    const map: Record<Stage, Opportunity[]> = {
      IDENTIFIED: [],
      CONTACTED: [],
      ENGAGED: [],
      MEETING_SET: [],
      PROPOSAL: [],
      WON: [],
      LOST: [],
    };
    for (const o of opportunities) map[o.stage].push(o);
    return map;
  }, [opportunities]);

  // KPIs
  const kpis = React.useMemo(() => {
    const open = opportunities.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
    const weightedPipeline = open.reduce(
      (sum, o) => sum + (o.dealValueEur ?? 0) * STAGE_META[o.stage].probability,
      0,
    );
    const won = byStage.WON;
    const closed = won.length + byStage.LOST.length;
    const conversion = closed > 0 ? (won.length / closed) * 100 : 0;
    const wonValue = won.reduce((sum, o) => sum + (o.dealValueEur ?? 0), 0);
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + 7);
    const meetingsThisWeek = byStage.MEETING_SET.filter((o) => {
      if (!o.meetingDate) return false;
      const d = new Date(o.meetingDate);
      return d >= now && d <= endOfWeek;
    }).length;
    return { weightedPipeline, conversion, wonValue, meetingsThisWeek, openCount: open.length };
  }, [opportunities, byStage]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const draggedOpp = React.useMemo(
    () => opportunities.find((o) => o.id === draggedId) ?? null,
    [draggedId, opportunities],
  );

  function handleDragStart(e: DragStartEvent) {
    setDraggedId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setDraggedId(null);
    if (!e.over) return;
    const id = String(e.active.id);
    const targetStage = e.over.id as Stage;
    const opp = opportunities.find((o) => o.id === id);
    if (!opp || opp.stage === targetStage) return;
    updateStage.mutate({ id, stage: targetStage });
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="Pipeline pondéré"
          value={`${formatNumberFr(Math.round(kpis.weightedPipeline))} €`}
          hint={`${kpis.openCount} deals ouverts`}
          accent="brand"
        />
        <KpiCard
          icon={Sparkles}
          label="Conversion close"
          value={`${kpis.conversion.toFixed(0)} %`}
          hint={`${byStage.WON.length} gagnés / ${byStage.LOST.length} perdus`}
          accent="success"
        />
        <KpiCard
          icon={CalendarClock}
          label="RDV cette semaine"
          value={String(kpis.meetingsThisWeek)}
          hint="MEETING_SET ≤ 7 jours"
          accent="warning"
        />
        <KpiCard
          icon={Flame}
          label="CA gagné cumul"
          value={`${formatNumberFr(Math.round(kpis.wonValue))} €`}
          hint={`${byStage.WON.length} contrats signés`}
          accent="fire"
        />
      </div>

      {isLoading && opportunities.length === 0 ? (
        <BoardSkeleton />
      ) : opportunities.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Users}
              title="Aucune opportunité dans ce périmètre"
              description={
                activeClientId
                  ? "Les triggers les mieux scorés se transforment en opportunités. Relancez le moteur ou abaissez le seuil."
                  : "Sélectionnez un client dans la barre du haut pour voir son pipeline."
              }
              className="border-0 rounded-none bg-transparent"
            />
          </CardContent>
        </Card>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {STAGE_ORDER.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                items={byStage[stage]}
                draggedId={draggedId}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {draggedOpp ? <OpportunityCardView opp={draggedOpp} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KPI Card
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

// ──────────────────────────────────────────────────────────────────────
// Stage Column (droppable)
// ──────────────────────────────────────────────────────────────────────

function StageColumn({
  stage,
  items,
  draggedId,
}: {
  stage: Stage;
  items: Opportunity[];
  draggedId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = STAGE_META[stage];
  const totalValue = items.reduce((sum, o) => sum + (o.dealValueEur ?? 0), 0);

  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      {/* Header */}
      <div className="mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", meta.accent)} aria-hidden />
          <span className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-700">
            {meta.label}
          </span>
          <Badge variant={meta.badgeVariant} size="sm" className="font-mono tabular-nums">
            {items.length}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 pl-4 text-[11px] tabular-nums text-ink-500">
          <span>{formatNumberFr(Math.round(totalValue))} €</span>
          <span className="text-ink-300">•</span>
          <span>{meta.hint}</span>
        </div>
      </div>

      {/* Drop area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[200px] flex-1 flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors",
          isOver
            ? "border-brand-400 bg-brand-50/50"
            : "border-ink-200 bg-ink-50/50",
        )}
      >
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-2 py-6 text-center text-[11.5px] text-ink-400">
            Aucune opportunité ici
          </div>
        ) : (
          items.map((opp) => (
            <DraggableCard key={opp.id} opp={opp} hidden={draggedId === opp.id} />
          ))
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Card (draggable wrapper + visual)
// ──────────────────────────────────────────────────────────────────────

function DraggableCard({ opp, hidden }: { opp: Opportunity; hidden?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: opp.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("touch-none", (isDragging || hidden) && "opacity-30")}
    >
      <OpportunityCardView opp={opp} />
    </div>
  );
}

function OpportunityCardView({ opp, dragging }: { opp: Opportunity; dragging?: boolean }) {
  const score = opp.trigger?.score;
  const isHot = opp.trigger?.isHot ?? false;
  const isCombo = opp.trigger?.isCombo ?? false;

  return (
    <div
      className={cn(
        "group cursor-grab rounded-lg border border-ink-200 bg-white p-3 shadow-xs transition-all hover:border-brand-300 hover:shadow-sm active:cursor-grabbing",
        dragging && "rotate-1 shadow-lg ring-2 ring-brand-300",
      )}
    >
      {/* Header : entreprise + score */}
      <div className="mb-1.5 flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600">
          <Building2 className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink-900">
            {opp.lead?.companyName ?? "—"}
          </div>
          <div className="truncate text-[11px] text-ink-500">
            {opp.lead?.fullName ?? "Contact à identifier"}
            {opp.lead?.jobTitle ? ` · ${opp.lead.jobTitle}` : ""}
          </div>
        </div>
        {score !== undefined && (
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant={isHot ? "fire" : score >= 7 ? "score" : "info"}
              size="sm"
              className="font-mono tabular-nums shrink-0"
            >
              {score}/10
            </Badge>
            {isCombo && (
              <Badge variant="brand" size="sm" className="shrink-0 gap-0.5">
                <Sparkles className="h-2.5 w-2.5" />
                Combo
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Trigger title */}
      {opp.trigger?.title && (
        <div className="mb-2 line-clamp-2 text-[11.5px] leading-snug text-ink-600">
          {opp.trigger.title}
        </div>
      )}

      {/* Footer : deal value + RDV */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-500">
        <span className="font-mono tabular-nums">
          {opp.dealValueEur ? `${formatNumberFr(opp.dealValueEur)} €` : "—"}
        </span>
        {opp.meetingDate ? (
          <span className="flex items-center gap-1 text-amber-600">
            <CalendarClock className="h-3 w-3" />
            {formatRelativeFr(opp.meetingDate)}
          </span>
        ) : (
          <span className="text-ink-400">{formatRelativeFr(opp.updatedAt)}</span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {STAGE_ORDER.map((stage) => (
        <div key={stage} className="flex w-[280px] shrink-0 flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
