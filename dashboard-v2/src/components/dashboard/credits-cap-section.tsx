"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Gauge, Sparkles, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

/**
 * V1 18/05/2026 — Section "Compteur leads + cap" sur le dashboard.
 *
 * Affiche pour un client GROWTH avec quota fini :
 *   - Jauge "X / 50 leads ce mois"
 *   - Compteur Pépites livrées / garanties
 *   - Bannière rouge quand cap atteint + bouton overage simulé (8€/lead)
 *
 * Caché pour les clients sans cap applicable (DTL grandfathered, iFIND
 * dogfood à balance illimitée, plan CUSTOM enterprise).
 */

export interface CreditsState {
  balance: number;
  monthlyQuota: number;
  used: number;
  pctUsed: number;
  pepitesThisMonth: number;
  pepitesGuaranteed: number;
  capReached: boolean;
  daysSinceReset: number | null;
  daysUntilReset: number | null;
}

export function CreditsCapSection({
  credits,
  clientId,
  isLoading,
}: {
  credits: CreditsState | null;
  clientId: string | null;
  isLoading?: boolean;
}) {
  const queryClient = useQueryClient();

  const purchaseOverage = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch("/api/internal/dev-purchase-overage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, amount }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data: { newBalance: number; amount: number }) => {
      toast.success(`+${data.amount} leads crédités`, {
        description: `Nouveau solde : ${data.newBalance} leads. Le système reprend.`,
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => {
      toast.error("Achat échoué", { description: e.message });
    },
  });

  // V1 18/05 — Skeleton pendant le 1er chargement (évite le flash visual).
  if (isLoading && clientId) {
    return (
      <section>
        <Card className="border-ink-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </CardContent>
        </Card>
      </section>
    );
  }
  if (!credits) return null;

  const pct = Math.min(100, credits.pctUsed);
  const isWarning = pct >= 80 && !credits.capReached;
  const isCapReached = credits.capReached;

  return (
    <section>
      <Card
        className={cn(
          "border",
          isCapReached
            ? "border-red-300 bg-gradient-to-br from-red-50/60 to-white"
            : isWarning
            ? "border-amber-300 bg-gradient-to-br from-amber-50/40 to-white"
            : "border-ink-200 bg-white",
        )}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md",
                  isCapReached
                    ? "bg-red-100 text-red-700"
                    : isWarning
                    ? "bg-amber-100 text-amber-700"
                    : "bg-brand-50 text-brand-700",
                )}
              >
                <Gauge className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
                  Leads ce cycle
                </div>
                <div className="font-display text-lg font-semibold tabular-nums text-ink-900">
                  {credits.used} <span className="text-ink-400 text-sm">/ {credits.monthlyQuota}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11.5px] text-ink-600">
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-brand-600" />
                <span className="tabular-nums font-medium text-ink-900">
                  {credits.pepitesThisMonth}
                </span>
                <span className="text-ink-500">/ {credits.pepitesGuaranteed} Pépites garanties</span>
              </div>
              {credits.daysUntilReset !== null && (
                <div className="text-ink-500 tabular-nums">
                  Reset dans {credits.daysUntilReset}j
                </div>
              )}
            </div>
          </div>

          {/* Jauge de progression */}
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isCapReached
                  ? "bg-red-500"
                  : isWarning
                  ? "bg-amber-500"
                  : "bg-gradient-to-r from-brand-500 to-brand-600",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Banner cap atteint */}
          {isCapReached && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-red-800">
                  Quota mensuel atteint — système en pause
                </div>
                <div className="mt-0.5 text-[11.5px] text-red-700">
                  Tu as reçu tes {credits.monthlyQuota} leads ce cycle. Plus d'appel
                  API ne se fait sur ton compte. Achète des leads supplémentaires
                  pour redémarrer immédiatement, ou attends le reset
                  {credits.daysUntilReset !== null && ` dans ${credits.daysUntilReset} jour${credits.daysUntilReset > 1 ? "s" : ""}`}.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => purchaseOverage.mutate(1)}
                    disabled={purchaseOverage.isPending}
                  >
                    <Wallet className="h-3 w-3" />
                    +1 lead · 8€ (simulé)
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => purchaseOverage.mutate(10)}
                    disabled={purchaseOverage.isPending}
                  >
                    +10 leads · 80€ (simulé)
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Banner warning à 80% */}
          {isWarning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] text-amber-800">
              ⚠️ Plus que <strong>{credits.balance} leads</strong> avant le cap.
              Si tu en consommes plus de {credits.balance} sur les prochains jours, le système se met en pause jusqu'au reset.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
