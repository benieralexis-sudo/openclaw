"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Diamond, Flame, Mail, Phone as PhoneIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeFr } from "@/lib/utils";

/**
 * V1 17/05/2026 — Section "Combos du jour" sur le dashboard.
 *
 * Affiche uniquement les leads issus de convergence cross-pillar :
 *   - Pépite 🔥 : 2 piliers du client ont trouvé la même boîte sur 7j
 *   - Diamant 💎 : 3 piliers ont convergé (priorité absolue)
 *
 * Différent du "isHot" classique (qui peut être 1 seul signal très fort).
 * Ici c'est l'argument commercial : "qualifiée sous plusieurs angles".
 */

export interface ComboItem {
  id: string;
  companyName: string;
  industry: string | null;
  region: string | null;
  title: string;
  signalCode: string | null;
  score: number;
  capturedAt: string;
  pillarsConverged: string[];
  pillarNames: string[];
  tier: "pepite" | "diamant";
  hasContact: boolean;
  leadId: string | null;
}

export function CombosSection({
  combos,
  isLoading,
}: {
  combos: ComboItem[];
  isLoading: boolean;
}) {
  if (!isLoading && combos.length === 0) return null;

  return (
    <section>
      <Card className="border-brand-200 bg-gradient-to-br from-brand-50/30 to-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Diamond className="h-4 w-4 text-brand-700" />
              Combos du jour
            </CardTitle>
            <CardDescription>
              Boîtes qualifiées par 2+ de tes signaux sur 7 jours — argument commercial fort
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 text-brand-600" asChild>
            <a href="/triggers?filter=combo">
              Voir tout
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ul className="space-y-2">
              {[1, 2, 3].map((i) => (
                <li key={i}>
                  <Skeleton className="h-16 rounded-lg" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {combos.map((c) => {
                const isDiamant = c.tier === "diamant";
                return (
                  <li key={c.id}>
                    <Link
                      href={`/triggers/${c.id}` as never}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg border bg-white p-3 transition-all",
                        isDiamant
                          ? "border-brand-300 hover:border-brand-500"
                          : "border-ink-100 hover:border-brand-300",
                        "hover:shadow-sm",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          isDiamant
                            ? "bg-gradient-to-br from-brand-200 to-brand-300 text-brand-800"
                            : "bg-brand-100 text-brand-700 border border-brand-200",
                        )}
                      >
                        {isDiamant ? (
                          <Diamond className="h-4 w-4" />
                        ) : (
                          <Flame className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="text-[13.5px] font-semibold text-ink-900 truncate">
                            {c.companyName}
                          </p>
                          <span className="font-mono text-[11px] text-ink-400 shrink-0">
                            {formatRelativeFr(c.capturedAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-500">
                          {c.industry && <span className="truncate">{c.industry}</span>}
                          {c.industry && c.region && <span className="text-ink-300">·</span>}
                          {c.region && <span>{c.region}</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {c.pillarsConverged.map((code, idx) => (
                            <React.Fragment key={code}>
                              <span
                                className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-medium text-brand-700"
                                title={c.pillarNames[idx]}
                              >
                                {code} · {c.pillarNames[idx]}
                              </span>
                              {idx < c.pillarsConverged.length - 1 && (
                                <span className="text-[10.5px] text-ink-400">+</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.hasContact && (
                          <div className="flex items-center gap-1 text-ink-400">
                            <Mail className="h-3 w-3 text-emerald-600" />
                            <PhoneIcon className="h-3 w-3 text-brand-600" />
                          </div>
                        )}
                        <Badge
                          variant={isDiamant ? "brand" : "score"}
                          size="md"
                          className="font-mono tabular-nums shrink-0"
                          title={isDiamant ? "Diamant — 3 piliers convergents" : "Pépite — 2 piliers convergents"}
                        >
                          {isDiamant ? "Diamant" : "Pépite"}
                        </Badge>
                        <ArrowUpRight className="h-3.5 w-3.5 text-ink-400 group-hover:text-brand-600 transition-colors" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
