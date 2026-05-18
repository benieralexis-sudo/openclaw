"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Flame, Layers, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * V1 17/05/2026 — Section "Tes 3 piliers" sur le dashboard.
 *
 * Pour chaque pilier actif du client, montre :
 *   - le code + nom français (P1 Recrutement rôle clé)
 *   - le nb de leads 7j et 30j
 *   - le nb de Pépites où ce pilier a participé sur 7j
 *   - un lien direct vers /triggers?signal=Pn
 *
 * Permet au client de voir instantanément quels signaux performent et
 * lesquels sont à pivoter (en complément de la bannière santé qui montre
 * la fraîcheur).
 */

export interface PillarSummaryItem {
  code: string;
  name: string;
  leads7d: number;
  leads30d: number;
  pepites7d: number;
}

export function PillarsOverviewSection({
  pillars,
  isLoading,
}: {
  pillars: PillarSummaryItem[];
  isLoading: boolean;
}) {
  // Pas de bloc si le client n'a pas de piliers actifs (admin sans scope, ou
  // client en cours d'onboarding qui n'a pas validé ses 3 signaux).
  if (!isLoading && pillars.length === 0) return null;

  return (
    <section>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-brand-600" />
              Tes 3 piliers
            </CardTitle>
            <CardDescription>
              Les signaux que tu as choisis dans ton catalogue — chacun te ramène des leads, et leur convergence crée tes Pépites
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {pillars.map((p) => (
                <Link
                  key={p.code}
                  href={`/triggers?signal=${p.code}` as never}
                  className={cn(
                    "group rounded-lg border border-ink-100 bg-white p-4 transition-all",
                    "hover:border-brand-300 hover:shadow-sm",
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-mono font-semibold text-ink-500 tabular-nums">
                        {p.code}
                      </div>
                      <div className="text-sm font-semibold text-ink-900 truncate group-hover:text-brand-700 transition-colors">
                        {p.name}
                      </div>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 text-ink-300 group-hover:text-brand-600 transition-colors shrink-0" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="font-display text-2xl font-semibold tabular-nums text-ink-900">
                      {p.leads7d}
                    </span>
                    <span className="text-[11px] text-ink-500">leads 7j</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-500">
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-ink-400" />
                      {p.leads30d} sur 30j
                    </span>
                    {p.pepites7d > 0 && (
                      <span className="inline-flex items-center gap-1 text-brand-700 font-medium">
                        <Flame className="h-3 w-3" />
                        {p.pepites7d} Pépite{p.pepites7d > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
