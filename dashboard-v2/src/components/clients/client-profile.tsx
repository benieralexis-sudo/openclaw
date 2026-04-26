"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  Check,
  Flame,
  Mail,
  Phone,
  Save,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { useScope } from "@/hooks/use-scope";
import { cn, formatNumberFr, formatRelativeFr } from "@/lib/utils";

type Status = "PROSPECT" | "ACTIVE" | "PAUSED" | "CHURNED";
type Plan = "LEADS_DATA" | "FULL_SERVICE" | "CUSTOM";

interface Icp {
  industries?: string[];
  sizes?: string[];
  regions?: string[];
  minScore?: number;
  preferredSignals?: string[];
  antiPersonas?: string[];
  notes?: string;
}

interface ClientDetail {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  industry: string | null;
  region: string | null;
  size: string | null;
  status: Status;
  plan: Plan;
  contactEmail: string | null;
  contactPhone: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  icp: Icp | null;
  activatedAt: string | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metrics: {
    triggersLast7d: number;
    openOpportunities: number;
    unreadReplies: number;
    conversionClosePct: number;
    wonValueEur: number;
    meetingsThisWeek: number;
    mrrEur: number;
  };
  recentTriggers: Array<{
    id: string;
    companyName: string;
    title: string;
    score: number;
    capturedAt: string;
    isHot: boolean;
    isCombo: boolean;
  }>;
}

const STATUS_META: Record<Status, { label: string; variant: "warning" | "info" | "brand" | "success" | "default" }> = {
  PROSPECT: { label: "Prospect", variant: "warning" },
  ACTIVE: { label: "Actif", variant: "success" },
  PAUSED: { label: "Pause", variant: "info" },
  CHURNED: { label: "Churn", variant: "default" },
};

const PLAN_META: Record<Plan, { label: string; price: number }> = {
  LEADS_DATA: { label: "Leads Data", price: 199 },
  FULL_SERVICE: { label: "Full Service", price: 890 },
  CUSTOM: { label: "Custom", price: 0 },
};

const SIGNAL_LABELS: Record<string, string> = {
  FUNDRAISING: "Levée de fonds",
  HIRING_KEY: "Recrutement clé",
  LEADERSHIP_CHANGE: "Changement dirigeant",
  TRADEMARK: "Dépôt INPI",
  PATENT: "Brevet",
  AD_CAMPAIGN: "Campagne pub",
  EXPANSION: "Expansion / ouverture",
  REGULATORY: "Réglementaire",
  RFP: "RFP / appel d'offres",
  DECLARATIVE_PAIN: "Pain déclaré",
  OTHER: "Autre",
};

export function ClientProfile({ clientId }: { clientId: string }) {
  const { me } = useScope();
  const queryClient = useQueryClient();

  const { data: client, isLoading } = useQuery<ClientDetail>({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}`);
      if (!res.ok) throw new Error("Erreur chargement client");
      return res.json();
    },
  });

  const canEdit = me?.role === "ADMIN" || me?.role === "EDITOR" || me?.role === "CLIENT";

  const updateClient = useMutation({
    mutationFn: async (data: Partial<ClientDetail>) => {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Erreur mise à jour");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Profil enregistré");
      queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      queryClient.invalidateQueries({ queryKey: ["clients-enriched"] });
    },
    onError: (err: Error) => {
      toast.error("Échec de l'enregistrement", { description: err.message });
    },
  });

  if (isLoading || !client) {
    return <ProfileSkeleton />;
  }

  return (
    <div className="space-y-5">
      <ClientHeader client={client} />
      <KpiRow metrics={client.metrics} />
      <Tabs defaultValue="icp" className="space-y-4">
        <TabsList className="bg-white border border-ink-200 shadow-xs">
          <TabsTrigger value="icp" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Profil ICP
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Activité récente
          </TabsTrigger>
          <TabsTrigger value="contact" className="gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            Contact
          </TabsTrigger>
        </TabsList>

        <TabsContent value="icp">
          <IcpEditor
            client={client}
            canEdit={canEdit}
            onSave={(icp) => updateClient.mutate({ icp } as Partial<ClientDetail>)}
            saving={updateClient.isPending}
          />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityPanel client={client} />
        </TabsContent>

        <TabsContent value="contact">
          <ContactEditor
            client={client}
            canEdit={canEdit}
            onSave={(d) => updateClient.mutate(d as Partial<ClientDetail>)}
            saving={updateClient.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Header avec avatar + meta
// ──────────────────────────────────────────────────────────────────────

function ClientHeader({ client }: { client: ClientDetail }) {
  const statusMeta = STATUS_META[client.status];
  const planMeta = PLAN_META[client.plan];

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-xl font-semibold text-white shadow-sm"
          style={{
            background: client.primaryColor
              ? `linear-gradient(135deg, ${client.primaryColor}, ${client.primaryColor}cc)`
              : "linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700))",
          }}
        >
          {client.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
              {client.name}
            </h2>
            <Badge variant={statusMeta.variant} size="sm" dot>
              {statusMeta.label}
            </Badge>
            <Badge variant="outline" size="sm">
              {planMeta.label}
              {planMeta.price > 0 && ` · ${planMeta.price} €/mois`}
            </Badge>
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-500">
            {[client.legalName, client.industry, client.region].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        {client.activatedAt && (
          <div className="text-right">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-400">Activé</div>
            <div className="font-mono text-[12.5px] tabular-nums text-ink-700">
              {formatRelativeFr(client.activatedAt)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KPI row (4 cards)
// ──────────────────────────────────────────────────────────────────────

function KpiRow({ metrics }: { metrics: ClientDetail["metrics"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        icon={Zap}
        label="Triggers 7j"
        value={String(metrics.triggersLast7d)}
        hint="Détectés sur la semaine"
        accent="brand"
      />
      <KpiCard
        icon={TrendingUp}
        label="Opps ouvertes"
        value={String(metrics.openOpportunities)}
        hint="Hors WON/LOST"
        accent="warning"
      />
      <KpiCard
        icon={CalendarClock}
        label="RDV semaine"
        value={String(metrics.meetingsThisWeek)}
        hint="MEETING_SET ≤ 7 jours"
        accent="success"
      />
      <KpiCard
        icon={Flame}
        label="CA gagné cumul"
        value={`${formatNumberFr(metrics.wonValueEur)} €`}
        hint={`Conversion close ${metrics.conversionClosePct}%`}
        accent="fire"
      />
    </div>
  );
}

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
// ICP Editor (chips + slider + textarea)
// ──────────────────────────────────────────────────────────────────────

function IcpEditor({
  client,
  canEdit,
  onSave,
  saving,
}: {
  client: ClientDetail;
  canEdit: boolean;
  onSave: (icp: Icp) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = React.useState<Icp>(client.icp ?? {});

  React.useEffect(() => {
    setDraft(client.icp ?? {});
  }, [client.icp]);

  const isDirty = React.useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(client.icp ?? {}),
    [draft, client.icp],
  );

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <ChipListField
          label="Industries cibles"
          hint="Secteurs d'activité que vous priorisez"
          values={draft.industries ?? []}
          onChange={(industries) => setDraft({ ...draft, industries })}
          disabled={!canEdit}
          placeholder="ex. SaaS B2B"
        />
        <ChipListField
          label="Tailles"
          hint="TPE / PME / ETI / GE"
          values={draft.sizes ?? []}
          onChange={(sizes) => setDraft({ ...draft, sizes })}
          disabled={!canEdit}
          placeholder="ex. PME"
        />
        <ChipListField
          label="Régions"
          hint="Régions FR ou pays"
          values={draft.regions ?? []}
          onChange={(regions) => setDraft({ ...draft, regions })}
          disabled={!canEdit}
          placeholder="ex. Île-de-France"
        />
        <ChipListField
          label="Signaux préférés"
          hint="Types de triggers à prioriser"
          values={draft.preferredSignals ?? []}
          onChange={(preferredSignals) => setDraft({ ...draft, preferredSignals })}
          disabled={!canEdit}
          placeholder="ex. FUNDRAISING"
          options={Object.keys(SIGNAL_LABELS)}
          renderLabel={(v) => SIGNAL_LABELS[v] ?? v}
        />
        <ChipListField
          label="Anti-personas"
          hint="Profils à exclure"
          values={draft.antiPersonas ?? []}
          onChange={(antiPersonas) => setDraft({ ...draft, antiPersonas })}
          disabled={!canEdit}
          placeholder="ex. Auto-entrepreneurs"
        />

        <div>
          <Label htmlFor="minScore">
            Score minimum
            <span className="ml-2 text-[11px] font-normal text-ink-500">
              (de 1 à 10 — 7 est le seuil MVP)
            </span>
          </Label>
          <div className="mt-1.5 flex items-center gap-3">
            <input
              id="minScore"
              type="range"
              min={1}
              max={10}
              step={1}
              disabled={!canEdit}
              value={draft.minScore ?? 7}
              onChange={(e) => setDraft({ ...draft, minScore: Number(e.target.value) })}
              className="flex-1 accent-brand-500"
            />
            <Badge variant="score" size="md" className="font-mono tabular-nums">
              {draft.minScore ?? 7}/10
            </Badge>
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Notes ICP</Label>
          <textarea
            id="notes"
            disabled={!canEdit}
            rows={4}
            value={draft.notes ?? ""}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Précisions sur vos cibles, exclusions, contexte du marché…"
            className="mt-1.5 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-800 shadow-xs transition-colors placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500"
          />
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(client.icp ?? {})}
              disabled={!isDirty || saving}
            >
              Annuler
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => onSave(draft)}
              disabled={!isDirty || saving}
              className="gap-1.5"
            >
              {saving ? (
                "Enregistrement…"
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Enregistrer ICP
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChipListField({
  label,
  hint,
  values,
  onChange,
  disabled,
  placeholder,
  options,
  renderLabel,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  options?: string[];
  renderLabel?: (v: string) => string;
}) {
  const [input, setInput] = React.useState("");

  function add(value: string) {
    const v = value.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setInput("");
  }
  function remove(v: string) {
    onChange(values.filter((x) => x !== v));
  }

  return (
    <div>
      <Label>
        {label}
        {hint && <span className="ml-2 text-[11px] font-normal text-ink-500">{hint}</span>}
      </Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-white p-2 shadow-xs">
        {values.length === 0 && (
          <span className="text-[11.5px] italic text-ink-400">Aucune entrée</span>
        )}
        {values.map((v) => (
          <Badge key={v} variant="brand" size="sm" className="gap-1">
            {renderLabel ? renderLabel(v) : v}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(v)}
                className="ml-0.5 -mr-0.5 rounded-full text-brand-700 hover:text-brand-900"
                aria-label={`Retirer ${v}`}
              >
                ×
              </button>
            )}
          </Badge>
        ))}
        {!disabled && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(input);
              } else if (e.key === "Backspace" && !input && values.length > 0) {
                onChange(values.slice(0, -1));
              }
            }}
            placeholder={placeholder ?? "Ajouter…"}
            list={options ? `${label}-opts` : undefined}
            className="min-w-[120px] flex-1 border-0 bg-transparent text-[12.5px] text-ink-800 outline-none placeholder:text-ink-400"
          />
        )}
        {options && (
          <datalist id={`${label}-opts`}>
            {options.map((o) => (
              <option key={o} value={o}>
                {renderLabel ? renderLabel(o) : o}
              </option>
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Activity panel (mini timeline)
// ──────────────────────────────────────────────────────────────────────

function ActivityPanel({ client }: { client: ClientDetail }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 text-[12.5px] font-medium uppercase tracking-wider text-ink-500">
          5 derniers triggers détectés
        </div>
        {client.recentTriggers.length === 0 ? (
          <div className="text-[13px] text-ink-400">Aucun trigger récent.</div>
        ) : (
          <ul className="space-y-2">
            {client.recentTriggers.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-md border border-ink-100 bg-white p-3 shadow-xs"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600">
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-ink-900">
                      {t.companyName}
                    </span>
                    <Badge
                      variant={t.isHot ? "fire" : t.score >= 7 ? "score" : "info"}
                      size="sm"
                      className="font-mono tabular-nums shrink-0"
                    >
                      {t.score}/10
                    </Badge>
                    {t.isCombo && (
                      <Badge variant="brand" size="sm" className="gap-0.5 shrink-0">
                        <Sparkles className="h-2.5 w-2.5" />
                        Combo
                      </Badge>
                    )}
                  </div>
                  <div className="line-clamp-1 text-[11.5px] text-ink-600">{t.title}</div>
                </div>
                <span className="font-mono text-[10.5px] tabular-nums text-ink-400">
                  {formatRelativeFr(t.capturedAt)}
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
// Contact editor
// ──────────────────────────────────────────────────────────────────────

function ContactEditor({
  client,
  canEdit,
  onSave,
  saving,
}: {
  client: ClientDetail;
  canEdit: boolean;
  onSave: (data: { contactEmail?: string | null; contactPhone?: string | null }) => void;
  saving: boolean;
}) {
  const [email, setEmail] = React.useState(client.contactEmail ?? "");
  const [phone, setPhone] = React.useState(client.contactPhone ?? "");

  React.useEffect(() => {
    setEmail(client.contactEmail ?? "");
    setPhone(client.contactPhone ?? "");
  }, [client.contactEmail, client.contactPhone]);

  const isDirty =
    email !== (client.contactEmail ?? "") || phone !== (client.contactPhone ?? "");

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <Label htmlFor="contactEmail" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            Email principal
          </Label>
          <Input
            id="contactEmail"
            type="email"
            value={email}
            disabled={!canEdit}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@entreprise.fr"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="contactPhone" className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" />
            Téléphone
          </Label>
          <Input
            id="contactPhone"
            type="tel"
            value={phone}
            disabled={!canEdit}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+33 6 12 34 56 78"
            className="mt-1.5"
          />
        </div>
        {canEdit && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEmail(client.contactEmail ?? "");
                setPhone(client.contactPhone ?? "");
              }}
              disabled={!isDirty || saving}
            >
              Annuler
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!isDirty || saving}
              onClick={() =>
                onSave({
                  contactEmail: email.trim() || null,
                  contactPhone: phone.trim() || null,
                })
              }
              className="gap-1.5"
            >
              {saving ? (
                "Enregistrement…"
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Enregistrer
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[88px] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[78px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-1/2 rounded-md" />
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );
}
