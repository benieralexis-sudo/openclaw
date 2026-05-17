"use client";

/**
 * Sprint catalogue P3.3 (17/05/2026) — Éditeur signaux du catalogue universel.
 *
 * Permet à un client (ou ADMIN) d'activer/désactiver chaque signal du catalogue
 * et de configurer ses paramètres custom (keywords, regions, etc.).
 *
 * Contraintes UX :
 *   - 3 piliers MAX actifs
 *   - Seuls les signaux PILLAR peuvent être marqués comme pilier
 *   - VIEWER en lecture seule
 *
 * Pattern aligné sur quota-editor.tsx et delivery-editor.tsx.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  Star,
  Target,
  Zap,
  Eye,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface SignalState {
  enabled: boolean;
  isPillar: boolean;
  parameters: Record<string, unknown>;
  isDefault: boolean;
}

interface SignalEntry {
  code: string;
  name: string;
  description: string;
  category: "PILLAR" | "BOOSTER" | "CONTEXTUAL";
  predictivityPct: number | null;
  implemented: boolean;
  sourceCodes: string[];
  paramsTemplate: Record<string, unknown>;
  state: SignalState;
}

interface SignalsApiResponse {
  clientId: string;
  signals: SignalEntry[];
  pillarCount: number;
  maxPillars: number;
}

const CATEGORY_META: Record<
  SignalEntry["category"],
  { label: string; description: string; Icon: typeof Target; tone: string }
> = {
  PILLAR: {
    label: "Piliers",
    description: "3 signaux d'achat principaux (max 3 actifs)",
    Icon: Target,
    tone: "text-orange-600",
  },
  BOOSTER: {
    label: "Boosters",
    description: "Signaux secondaires qui renforcent la conviction",
    Icon: Zap,
    tone: "text-blue-600",
  },
  CONTEXTUAL: {
    label: "Contextuels",
    description: "Données d'enrichissement (toujours actives)",
    Icon: Sparkles,
    tone: "text-emerald-600",
  },
};

export function SignalsEditor({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<SignalsApiResponse>({
    queryKey: ["client-signals", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/signals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({
      code,
      patch,
    }: {
      code: string;
      patch: Partial<{ enabled: boolean; isPillar: boolean; parameters: Record<string, unknown> }>;
    }) => {
      const res = await fetch(`/api/clients/${clientId}/signals/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ["client-signals", clientId] });
    },
    onError: (e: Error) => setMutationError(e.message),
  });

  if (isLoading)
    return (
      <div className="p-6 text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        Chargement…
      </div>
    );
  if (error)
    return (
      <div className="p-6 text-red-600">
        <AlertCircle className="h-4 w-4 inline mr-2" />
        Erreur : {String(error)}
      </div>
    );
  if (!data) return null;

  const grouped: Record<SignalEntry["category"], SignalEntry[]> = {
    PILLAR: [],
    BOOSTER: [],
    CONTEXTUAL: [],
  };
  for (const sig of data.signals) grouped[sig.category].push(sig);

  function toggleExpanded(code: string) {
    const next = new Set(expanded);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setExpanded(next);
  }

  function handleParamSubmit(code: string) {
    const raw = paramDrafts[code];
    if (raw === undefined) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        setMutationError(`Parameters de ${code}: doit être un objet JSON`);
        return;
      }
    } catch (e) {
      setMutationError(`Parameters de ${code} JSON invalide: ${e instanceof Error ? e.message : "?"}`);
      return;
    }
    mutation.mutate({ code, patch: { parameters: parsed } });
  }

  return (
    <div className="space-y-6">
      {/* Header / contexte */}
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm flex items-start gap-2">
        <Target className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold text-orange-900">
            Catalogue universel — {data.signals.length} signaux ({data.pillarCount}/{data.maxPillars} piliers
            actifs)
          </div>
          <div className="text-orange-700 mt-1">
            Chaque signal détecte un événement d'achat. Les <strong>3 piliers</strong> que vous choisissez
            définissent votre cible principale. Les <strong>boosters</strong> tournent en arrière-plan pour
            renforcer la conviction. Les <strong>contextuels</strong> enrichissent automatiquement.
          </div>
        </div>
      </div>

      {/* Erreur mutation */}
      {mutationError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm flex items-start gap-2">
          <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-red-700">{mutationError}</div>
        </div>
      )}

      {(["PILLAR", "BOOSTER", "CONTEXTUAL"] as const).map((cat) => {
        const meta = CATEGORY_META[cat];
        const sigs = grouped[cat];
        return (
          <section key={cat} className="space-y-3">
            <div className="flex items-center gap-2">
              <meta.Icon className={`h-5 w-5 ${meta.tone}`} />
              <h3 className="text-lg font-semibold text-ink-900">{meta.label}</h3>
              <span className="text-sm text-ink-500">— {meta.description}</span>
            </div>

            <div className="space-y-2">
              {sigs.map((sig) => {
                const isOpen = expanded.has(sig.code);
                const isToggling = mutation.isPending && mutation.variables?.code === sig.code;
                const draft = paramDrafts[sig.code] ?? JSON.stringify(sig.state.parameters, null, 2);

                return (
                  <div
                    key={sig.code}
                    className={`rounded-lg border bg-white transition-all ${
                      sig.state.enabled && sig.state.isPillar
                        ? "border-orange-300 ring-2 ring-orange-100"
                        : sig.state.enabled
                        ? "border-ink-200"
                        : "border-ink-200 bg-ink-50 opacity-75"
                    }`}
                  >
                    {/* Ligne header */}
                    <div className="flex items-center gap-3 p-4">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(sig.code)}
                        className="text-ink-400 hover:text-ink-700 transition"
                        aria-label="Toggle details"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-ink-100 text-ink-700">
                            {sig.code}
                          </span>
                          <span className="font-medium text-ink-900">{sig.name}</span>
                          {sig.predictivityPct !== null && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                sig.predictivityPct >= 40
                                  ? "border-emerald-300 text-emerald-700"
                                  : sig.predictivityPct >= 25
                                  ? "border-blue-300 text-blue-700"
                                  : "border-ink-300 text-ink-600"
                              }`}
                            >
                              +{sig.predictivityPct}% conversion
                            </Badge>
                          )}
                          {!sig.implemented && (
                            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                              À implémenter
                            </Badge>
                          )}
                          {sig.state.isDefault && sig.state.enabled && (
                            <Badge variant="outline" className="text-xs border-ink-200 text-ink-500">
                              défaut
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-ink-600 mt-0.5 truncate">{sig.description}</div>
                      </div>

                      {/* V1 17/05 — Pillar toggle pour tous les signaux ACTIVE (P1-P5 + B1-B7).
                          Les CONTEXTUAL (C1-C4 DEPRECATED) sont des enrichissements, pas des piliers. */}
                      {sig.category !== "CONTEXTUAL" && sig.state.enabled && (
                        <button
                          type="button"
                          onClick={() =>
                            mutation.mutate({
                              code: sig.code,
                              patch: { isPillar: !sig.state.isPillar },
                            })
                          }
                          disabled={!canEdit || isToggling}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition ${
                            sig.state.isPillar
                              ? "bg-orange-100 text-orange-700 border border-orange-300"
                              : "bg-ink-50 text-ink-500 border border-ink-200 hover:bg-ink-100"
                          }`}
                          title={sig.state.isPillar ? "Retirer du top 3" : "Marquer comme pilier (max 3)"}
                        >
                          <Star className={`h-3.5 w-3.5 ${sig.state.isPillar ? "fill-orange-500" : ""}`} />
                          Pilier
                        </button>
                      )}

                      {/* Switch on/off */}
                      <Switch
                        checked={sig.state.enabled}
                        onCheckedChange={(v) => mutation.mutate({ code: sig.code, patch: { enabled: v } })}
                        disabled={!canEdit || isToggling}
                      />
                    </div>

                    {/* Détails expansibles */}
                    {isOpen && (
                      <div className="border-t border-ink-100 p-4 bg-ink-50/40 space-y-3">
                        {sig.sourceCodes.length > 0 && (
                          <div className="text-xs">
                            <span className="text-ink-500">Sources techniques :</span>{" "}
                            <span className="font-mono text-ink-700">{sig.sourceCodes.join(", ")}</span>
                          </div>
                        )}

                        <div>
                          <Label htmlFor={`params-${sig.code}`} className="text-xs text-ink-600">
                            Paramètres (JSON)
                          </Label>
                          <textarea
                            id={`params-${sig.code}`}
                            value={draft}
                            onChange={(e) => setParamDrafts((p) => ({ ...p, [sig.code]: e.target.value }))}
                            disabled={!canEdit}
                            className="w-full mt-1 font-mono text-xs p-2 border border-ink-300 rounded bg-white"
                            rows={Math.max(3, draft.split("\n").length)}
                          />
                          {sig.paramsTemplate && Object.keys(sig.paramsTemplate as object).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-ink-500 cursor-pointer hover:text-ink-700">
                                Template paramètres disponibles
                              </summary>
                              <pre className="mt-1 text-xs font-mono p-2 bg-white border border-ink-200 rounded overflow-auto">
                                {JSON.stringify(sig.paramsTemplate, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        {canEdit && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleParamSubmit(sig.code)}
                              disabled={isToggling || paramDrafts[sig.code] === undefined}
                            >
                              {isToggling ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              )}
                              Sauvegarder paramètres
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setParamDrafts((p) => {
                                  const next = { ...p };
                                  delete next[sig.code];
                                  return next;
                                })
                              }
                              disabled={paramDrafts[sig.code] === undefined}
                            >
                              Annuler
                            </Button>
                          </div>
                        )}

                        {!canEdit && (
                          <div className="text-xs text-ink-500 italic flex items-center gap-1">
                            <Eye className="h-3 w-3" /> Lecture seule
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
