"use client";

/**
 * Sprint 3 (10/05/2026) — Editor configuration delivery par client.
 *
 * Permet a un user EDITOR/CLIENT/ADMIN de configurer :
 *   - Weekly digest email (destinataire + minScore + maxLeads + jour/heure)
 *   - Realtime alerts (email + Telegram chatId + minScore + cap quotidien)
 *   - Branding email (sender name + email + couleur)
 *
 * Backend : GET/PATCH /api/clients/[id]/delivery
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Bell, Palette, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { DeliveryConfig } from "@/lib/delivery-config";

interface DeliveryApiResponse {
  clientId: string;
  config: DeliveryConfig;
}

export function DeliveryEditor({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<DeliveryApiResponse>({
    queryKey: ["client-delivery", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/delivery`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [draft, setDraft] = useState<DeliveryConfig | null>(null);
  useEffect(() => {
    if (data?.config) setDraft(data.config);
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (cfg: DeliveryConfig) => {
      const res = await fetch(`/api/clients/${clientId}/delivery`, {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-delivery", clientId] });
    },
  });

  if (isLoading) return <div className="p-6 text-ink-500"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Chargement…</div>;
  if (error) return <div className="p-6 text-red-600"><AlertCircle className="h-4 w-4 inline mr-2" />Erreur : {String(error)}</div>;
  if (!draft) return null;

  return (
    <div className="space-y-6">
      {/* Weekly Digest */}
      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold text-base">Digest hebdomadaire</h3>
          </div>
          <Switch
            checked={draft.weeklyDigest.enabled}
            disabled={!canEdit}
            onCheckedChange={(v) =>
              setDraft({ ...draft, weeklyDigest: { ...draft.weeklyDigest, enabled: v } })
            }
          />
        </div>
        <p className="text-sm text-ink-600 mb-4">
          Email automatique chaque lundi à 7h Paris avec les leads chauds (score ≥ seuil) captés sur les 7 derniers jours.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="wd-email">Email destinataire</Label>
            <Input
              id="wd-email"
              type="email"
              value={draft.weeklyDigest.email ?? ""}
              disabled={!canEdit || !draft.weeklyDigest.enabled}
              onChange={(e) =>
                setDraft({ ...draft, weeklyDigest: { ...draft.weeklyDigest, email: e.target.value || null } })
              }
              placeholder="ex: frederic@digitestlab.fr"
            />
          </div>
          <div>
            <Label htmlFor="wd-minscore">Score minimum</Label>
            <Input
              id="wd-minscore"
              type="number"
              min={1}
              max={10}
              value={draft.weeklyDigest.minScore}
              disabled={!canEdit || !draft.weeklyDigest.enabled}
              onChange={(e) =>
                setDraft({ ...draft, weeklyDigest: { ...draft.weeklyDigest, minScore: parseInt(e.target.value) || 7 } })
              }
            />
            <p className="text-xs text-ink-500 mt-1">7 = Brûlants + Très chauds, 8 = Pépites + Brûlants, 9 = Pépites uniquement</p>
          </div>
          <div>
            <Label htmlFor="wd-maxleads">Nombre max de leads</Label>
            <Input
              id="wd-maxleads"
              type="number"
              min={1}
              max={50}
              value={draft.weeklyDigest.maxLeads}
              disabled={!canEdit || !draft.weeklyDigest.enabled}
              onChange={(e) =>
                setDraft({ ...draft, weeklyDigest: { ...draft.weeklyDigest, maxLeads: parseInt(e.target.value) || 15 } })
              }
            />
          </div>
        </div>
      </section>

      {/* Realtime Alerts */}
      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-orange-600" />
            <h3 className="font-semibold text-base">Alertes Pépites en temps réel</h3>
          </div>
          <Switch
            checked={draft.realtimeAlert.enabled}
            disabled={!canEdit}
            onCheckedChange={(v) =>
              setDraft({ ...draft, realtimeAlert: { ...draft.realtimeAlert, enabled: v } })
            }
          />
        </div>
        <p className="text-sm text-ink-600 mb-4">
          Alerte instantanée (email + Telegram optionnel) dès qu'un lead atteint le seuil "Pépite".
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="rt-email">Email destinataire</Label>
            <Input
              id="rt-email"
              type="email"
              value={draft.realtimeAlert.email ?? ""}
              disabled={!canEdit || !draft.realtimeAlert.enabled}
              onChange={(e) =>
                setDraft({ ...draft, realtimeAlert: { ...draft.realtimeAlert, email: e.target.value || null } })
              }
              placeholder="ex: frederic@digitestlab.fr"
            />
          </div>
          <div>
            <Label htmlFor="rt-tg">Telegram chat ID (optionnel)</Label>
            <Input
              id="rt-tg"
              type="text"
              value={draft.realtimeAlert.telegramChatId ?? ""}
              disabled={!canEdit || !draft.realtimeAlert.enabled}
              onChange={(e) =>
                setDraft({ ...draft, realtimeAlert: { ...draft.realtimeAlert, telegramChatId: e.target.value || null } })
              }
              placeholder="ex: 123456789"
            />
          </div>
          <div>
            <Label htmlFor="rt-minscore">Score Pépite</Label>
            <Input
              id="rt-minscore"
              type="number"
              min={1}
              max={10}
              value={draft.realtimeAlert.minScore}
              disabled={!canEdit || !draft.realtimeAlert.enabled}
              onChange={(e) =>
                setDraft({ ...draft, realtimeAlert: { ...draft.realtimeAlert, minScore: parseInt(e.target.value) || 9 } })
              }
            />
          </div>
          <div>
            <Label htmlFor="rt-maxday">Cap alertes / jour</Label>
            <Input
              id="rt-maxday"
              type="number"
              min={1}
              max={100}
              value={draft.realtimeAlert.maxPerDay}
              disabled={!canEdit || !draft.realtimeAlert.enabled}
              onChange={(e) =>
                setDraft({ ...draft, realtimeAlert: { ...draft.realtimeAlert, maxPerDay: parseInt(e.target.value) || 10 } })
              }
            />
          </div>
        </div>
      </section>

      {/* Branding */}
      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold text-base">Branding email</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="brand-name">Nom expéditeur</Label>
            <Input
              id="brand-name"
              type="text"
              value={draft.brand.senderName}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, brand: { ...draft.brand, senderName: e.target.value } })
              }
              placeholder="iFIND"
            />
          </div>
          <div>
            <Label htmlFor="brand-email">Email expéditeur (custom)</Label>
            <Input
              id="brand-email"
              type="email"
              value={draft.brand.senderEmail ?? ""}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, brand: { ...draft.brand, senderEmail: e.target.value || null } })
              }
              placeholder="leads@ifind.fr (optionnel)"
            />
          </div>
          <div>
            <Label htmlFor="brand-color">Couleur primaire (hex)</Label>
            <Input
              id="brand-color"
              type="text"
              value={draft.brand.primaryColor}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft({ ...draft, brand: { ...draft.brand, primaryColor: e.target.value } })
              }
              placeholder="#5B7CFA"
            />
          </div>
        </div>
      </section>

      {/* Save button */}
      {canEdit && (
        <div className="flex items-center justify-between p-4 rounded-lg bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-2 text-sm">
            {mutation.isSuccess && !mutation.isPending && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-green-700">Configuration sauvegardée</span>
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
