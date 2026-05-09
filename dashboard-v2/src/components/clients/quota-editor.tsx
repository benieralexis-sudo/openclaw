"use client";

/**
 * Sprint 7 (10/05/2026) — Editor quotas API par client (Anthropic/Apify/TheirStack).
 *
 * Permet ADMIN/EDITOR de definir budget mensuel + hard cap pour chaque provider.
 * Affiche conso cumulee + barre de progression + alerte 80% / 100%.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, AlertCircle, CheckCircle2, Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { QuotaConfig, Provider } from "@/lib/quota-config";

interface QuotaApiResponse {
  clientId: string;
  plan: string;
  config: QuotaConfig;
  defaults: Partial<Record<Provider, { monthlyBudgetUsd: number; hardCapUsd: number }>>;
}

const PROVIDERS: Array<{ key: Provider; label: string; description: string }> = [
  { key: "anthropic", label: "Anthropic (Claude)", description: "Cerveau IA pour qualifier les leads (V1+V2)" },
  { key: "apify", label: "Apify", description: "Scraping LinkedIn jobs + Welcome to the Jungle" },
  { key: "theirstack", label: "TheirStack", description: "Job offers + buying intent firmographic" },
];

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="w-full h-2 bg-ink-100 rounded overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function QuotaEditor({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<QuotaApiResponse>({
    queryKey: ["client-quota", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/quota`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [draft, setDraft] = useState<QuotaConfig | null>(null);
  useEffect(() => {
    if (data?.config) setDraft(data.config);
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (cfg: QuotaConfig) => {
      const res = await fetch(`/api/clients/${clientId}/quota`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-quota", clientId] }),
  });

  if (isLoading) return <div className="p-6 text-ink-500"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Chargement…</div>;
  if (error) return <div className="p-6 text-red-600"><AlertCircle className="h-4 w-4 inline mr-2" />Erreur : {String(error)}</div>;
  if (!draft || !data) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm flex items-start gap-2">
        <Coins className="h-5 w-5 text-blue-600 mt-0.5" />
        <div>
          <div className="font-semibold text-blue-900">Quotas API par client (plan {data.plan})</div>
          <div className="text-blue-700 mt-1">
            Définit le budget mensuel et le hard cap pour chaque provider. Reset automatique le 1er du mois.
            Alertes Telegram à 80%, blocage à 100%.
          </div>
        </div>
      </div>

      {PROVIDERS.map(({ key, label, description }) => {
        const provider = draft[key];
        const defaults = data.defaults[key];
        const pctUsed = provider.hardCapUsd > 0
          ? Math.round((provider.currentSpendUsd / provider.hardCapUsd) * 100)
          : 0;

        return (
          <section key={key} className="rounded-lg border border-ink-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  <h3 className="font-semibold text-base">{label}</h3>
                </div>
                <p className="text-sm text-ink-600 mt-1">{description}</p>
              </div>
              <Switch
                checked={provider.enabled}
                disabled={!canEdit}
                onCheckedChange={(v) => setDraft({ ...draft, [key]: { ...provider, enabled: v } })}
              />
            </div>

            {provider.hardCapUsd > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-ink-600">Conso cumulée mois</span>
                  <span className="font-mono font-semibold">
                    ${provider.currentSpendUsd.toFixed(2)} / ${provider.hardCapUsd.toFixed(2)} <span className="text-ink-500">({pctUsed}%)</span>
                  </span>
                </div>
                <ProgressBar pct={pctUsed} />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${key}-budget`}>
                  Budget mensuel ($) <span className="text-ink-500">— alerte 80%</span>
                </Label>
                <Input
                  id={`${key}-budget`}
                  type="number"
                  min={0}
                  step={5}
                  value={provider.monthlyBudgetUsd}
                  disabled={!canEdit || !provider.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [key]: { ...provider, monthlyBudgetUsd: parseFloat(e.target.value) || 0 },
                    })
                  }
                  placeholder={defaults?.monthlyBudgetUsd?.toString() ?? "0"}
                />
                {defaults && (
                  <p className="text-xs text-ink-500 mt-1">
                    Défaut plan {data.plan} : ${defaults.monthlyBudgetUsd}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor={`${key}-hard`}>
                  Hard cap ($) <span className="text-red-600">— bloque pollers</span>
                </Label>
                <Input
                  id={`${key}-hard`}
                  type="number"
                  min={0}
                  step={5}
                  value={provider.hardCapUsd}
                  disabled={!canEdit || !provider.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [key]: { ...provider, hardCapUsd: parseFloat(e.target.value) || 0 },
                    })
                  }
                  placeholder={defaults?.hardCapUsd?.toString() ?? "0"}
                />
                {defaults && (
                  <p className="text-xs text-ink-500 mt-1">
                    Défaut plan {data.plan} : ${defaults.hardCapUsd}
                  </p>
                )}
              </div>
            </div>
          </section>
        );
      })}

      {canEdit && (
        <div className="flex items-center justify-between p-4 rounded-lg bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-2 text-sm">
            {mutation.isSuccess && !mutation.isPending && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-green-700">Quotas sauvegardés</span>
              </>
            )}
            {mutation.error && (
              <>
                <AlertCircle className="h-4 w-4 text-red-600" />
                <span className="text-red-700">{String(mutation.error)}</span>
              </>
            )}
          </div>
          <Button onClick={() => mutation.mutate(draft)} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Sauvegarder
          </Button>
        </div>
      )}
    </div>
  );
}
