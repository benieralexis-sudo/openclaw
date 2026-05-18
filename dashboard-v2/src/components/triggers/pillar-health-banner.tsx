"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, AlertCircle, Clock, Settings } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * V1 17/05/2026 — Bannière "Santé de tes 3 piliers" en haut du dashboard.
 *
 * Affiche pour chaque pilier actif du client :
 *   - 🟢 OK : dernier lead < 3j
 *   - 🟡 Tiède : 3-6j sans lead (warning)
 *   - 🔴 Froid : 7j+ sans lead (alerte rouge)
 *
 * Pas de notification externe. Tout est visible directement ici.
 * Si un pilier est tiède ou froid, lien direct vers la page de configuration.
 */

interface PillarHealth {
  code: string;
  name: string;
  status: "ok" | "tepid" | "cold" | "warming-up";
  daysSinceLastTrigger: number | null;
  leadCountWindow: number;
  warmingUpReason?: string;
}

interface PillarHealthReport {
  clientId: string;
  pillars: PillarHealth[];
  hasIssue: boolean;
}

const STATUS_STYLE: Record<PillarHealth["status"], { bg: string; border: string; text: string; icon: typeof CheckCircle2; label: string }> = {
  ok: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    icon: CheckCircle2,
    label: "OK",
  },
  tepid: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    icon: AlertTriangle,
    label: "Tiède",
  },
  cold: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    icon: AlertCircle,
    label: "Froid",
  },
  // V1 18/05 — Statut neutre pour signaux naturellement lents (ex P5)
  // pendant leur fenêtre d'apprentissage. Ne déclenche pas d'alerte.
  "warming-up": {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    icon: Clock,
    label: "En apprentissage",
  },
};

export function PillarHealthBanner({ clientId }: { clientId: string | null }) {
  const { data } = useQuery<PillarHealthReport>({
    queryKey: ["pillar-health", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/pillar-health`);
      if (!res.ok) throw new Error("Erreur santé piliers");
      return res.json();
    },
    enabled: !!clientId,
    staleTime: 60_000, // 1 min cache
  });

  if (!data || data.pillars.length === 0) return null;

  return (
    <Card className="border-ink-200 shadow-xs">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink-800">
            Santé de tes signaux
            {data.hasIssue && (
              <span className="ml-2 text-xs font-normal text-amber-600">
                — un pilier nécessite votre attention
              </span>
            )}
          </h3>
          <Link
            href={`/clients/${clientId}`}
            className="text-xs text-ink-500 hover:text-ink-700 inline-flex items-center gap-1"
          >
            <Settings className="h-3 w-3" />
            Modifier mes signaux
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {data.pillars.map((p) => {
            const style = STATUS_STYLE[p.status];
            const Icon = style.icon;
            // V1 18/05 — Pour les signaux en apprentissage, on affiche l'explication
            // plutôt qu'un "dernier lead" alarmant ("Aucun lead à ce jour").
            const daysText =
              p.status === "warming-up"
                ? (p.warmingUpReason ?? "Signal lent — premiers leads sous quelques semaines")
                : p.daysSinceLastTrigger === null
                ? "Aucun lead à ce jour"
                : p.daysSinceLastTrigger === 0
                ? "Lead aujourd'hui"
                : p.daysSinceLastTrigger === 1
                ? "Lead il y a 1 jour"
                : `Dernier lead il y a ${p.daysSinceLastTrigger} jours`;

            return (
              <div
                key={p.code}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  style.bg,
                  style.border,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-ink-600">{p.code}</div>
                    <div className="text-sm font-semibold text-ink-900 truncate">{p.name}</div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium shrink-0",
                      style.bg,
                      style.border,
                      style.text,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {style.label}
                  </span>
                </div>
                <div className={cn("text-[11px] mt-1", style.text)}>{daysText}</div>
                <div className="text-[10.5px] text-ink-500 mt-0.5">
                  {p.leadCountWindow} lead{p.leadCountWindow > 1 ? "s" : ""} sur 30j
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
