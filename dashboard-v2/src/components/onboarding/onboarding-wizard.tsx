"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  PartyPopper,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useScope } from "@/hooks/use-scope";
import { cn, formatNumberFr } from "@/lib/utils";

type Plan = "LEADS_DATA" | "FULL_SERVICE" | "CUSTOM";

interface ClientDetail {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  industry: string | null;
  region: string | null;
  size: string | null;
  status: "PROSPECT" | "ACTIVE" | "PAUSED" | "CHURNED";
  plan: Plan;
  contactEmail: string | null;
  contactPhone: string | null;
  icp: {
    industries?: string[];
    sizes?: string[];
    regions?: string[];
    minScore?: number;
    preferredSignals?: string[];
    antiPersonas?: string[];
    notes?: string;
  } | null;
}

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

const SIZE_OPTIONS = ["TPE", "PME", "ETI", "GE"];

const REGION_PRESETS = [
  "Île-de-France",
  "Auvergne-Rhône-Alpes",
  "Hauts-de-France",
  "Pays de la Loire",
  "Nouvelle-Aquitaine",
  "Occitanie",
  "PACA",
  "Bretagne",
  "Grand Est",
  "Normandie",
  "Bourgogne-Franche-Comté",
  "Centre-Val de Loire",
  "Corse",
  "France entière",
];

const STEPS = [
  { id: 1, title: "Société", icon: Building2, hint: "Identité de votre entreprise" },
  { id: 2, title: "Cible (ICP)", icon: Target, hint: "Qui voulez-vous toucher ?" },
  { id: 3, title: "Plan", icon: Wallet, hint: "Choix de l'offre" },
  { id: 4, title: "Activation", icon: PartyPopper, hint: "Lancement du moteur" },
] as const;

interface FormState {
  name: string;
  legalName: string;
  industry: string;
  region: string;
  size: string;
  industries: string[];
  sizes: string[];
  regions: string[];
  minScore: number;
  preferredSignals: string[];
  antiPersonas: string[];
  notes: string;
  plan: Plan;
}

export function OnboardingWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me } = useScope();

  const { data: client, isLoading: clientLoading } = useQuery<ClientDetail>({
    queryKey: ["onboarding-client", me?.clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${me!.clientId}`);
      if (!res.ok) throw new Error("Erreur chargement client");
      return res.json();
    },
    enabled: !!me?.clientId,
  });

  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState<FormState | null>(null);

  // Hydratation depuis le client (pré-remplissage)
  React.useEffect(() => {
    if (!client || form) return;
    setForm({
      name: client.name ?? "",
      legalName: client.legalName ?? "",
      industry: client.industry ?? "",
      region: client.region ?? "",
      size: client.size ?? "",
      industries: client.icp?.industries ?? [],
      sizes: client.icp?.sizes ?? [],
      regions: client.icp?.regions ?? [],
      minScore: client.icp?.minScore ?? 7,
      preferredSignals: client.icp?.preferredSignals ?? ["FUNDRAISING", "HIRING_KEY"],
      antiPersonas: client.icp?.antiPersonas ?? [],
      notes: client.icp?.notes ?? "",
      plan: client.plan ?? "LEADS_DATA",
    });
  }, [client, form]);

  const submit = useMutation({
    mutationFn: async (f: FormState) => {
      const res = await fetch(`/api/clients/${me!.clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name,
          legalName: f.legalName || null,
          industry: f.industry || null,
          region: f.region || null,
          size: f.size || null,
          plan: f.plan,
          status: "ACTIVE",
          icp: {
            industries: f.industries,
            sizes: f.sizes,
            regions: f.regions,
            minScore: f.minScore,
            preferredSignals: f.preferredSignals,
            antiPersonas: f.antiPersonas,
            notes: f.notes,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Erreur lors de l'activation");
      }
      const onboardRes = await fetch(`/api/me/onboarding-done`, { method: "POST" });
      if (!onboardRes.ok) throw new Error("Erreur fin d'onboarding");
      return res.json();
    },
    onSuccess: async () => {
      toast.success("Bienvenue dans iFIND 🚀", {
        description: "Le moteur scanne déjà les premiers signaux.",
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.refetchQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["clients-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["client", me?.clientId] });
      router.replace("/dashboard");
    },
    onError: (err: Error) => {
      toast.error("Activation impossible", { description: err.message });
    },
  });

  if (clientLoading || !form) {
    return <WizardSkeleton />;
  }

  const canNext = (() => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return form.industries.length > 0 && form.regions.length > 0;
    if (step === 3) return ["LEADS_DATA", "FULL_SERVICE", "CUSTOM"].includes(form.plan);
    return true;
  })();

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      {/* Header brand */}
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm shadow-brand-500/30">
            <span className="font-sans text-[18px] font-semibold leading-none text-white">i</span>
          </div>
          <div>
            <div className="font-display text-[15px] font-semibold tracking-tight text-ink-900">
              iFIND
            </div>
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
              Trigger Engine
            </div>
          </div>
        </div>
        {me?.role === "ADMIN" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const res = await fetch("/api/me/onboarding-done", { method: "POST" });
              if (!res.ok) {
                toast.error("Skip impossible");
                return;
              }
              await queryClient.invalidateQueries({ queryKey: ["me"] });
              await queryClient.refetchQueries({ queryKey: ["me"] });
              router.replace("/dashboard");
            }}
          >
            Skip wizard (admin)
          </Button>
        )}
      </header>

      {/* Stepper */}
      <Stepper currentStep={step} />

      {/* Content */}
      <div className="mt-8 flex-1">
        {step === 1 && <StepIdentity form={form} setForm={setForm} />}
        {step === 2 && <StepIcp form={form} setForm={setForm} />}
        {step === 3 && <StepPlan form={form} setForm={setForm} />}
        {step === 4 && <StepReview form={form} />}
      </div>

      {/* Nav */}
      <footer className="mt-8 flex items-center justify-between gap-3 border-t border-ink-200 pt-5">
        <Button
          variant="ghost"
          size="md"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || submit.isPending}
          className="gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour
        </Button>

        <div className="text-[12px] tabular-nums text-ink-500">
          Étape {step} / {STEPS.length}
        </div>

        {step < STEPS.length ? (
          <Button
            variant="primary"
            size="md"
            onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
            disabled={!canNext}
            className="gap-1.5"
          >
            Continuer
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => submit.mutate(form)}
            disabled={submit.isPending}
            className="gap-1.5"
          >
            {submit.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Activation…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Activer mon compte
              </>
            )}
          </Button>
        )}
      </footer>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stepper
// ──────────────────────────────────────────────────────────────────────

function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, idx) => {
        const Icon = s.icon;
        const done = currentStep > s.id;
        const active = currentStep === s.id;
        return (
          <React.Fragment key={s.id}>
            <li className="flex flex-1 items-center gap-2.5">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[12px] font-semibold transition-all",
                  done && "border-brand-500 bg-brand-500 text-white",
                  active && "border-brand-500 bg-brand-50 text-brand-700 shadow-sm shadow-brand-500/20",
                  !done && !active && "border-ink-200 bg-white text-ink-400",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <div className="hidden min-w-0 sm:block">
                <div
                  className={cn(
                    "text-[12.5px] font-semibold leading-tight",
                    active ? "text-ink-900" : "text-ink-500",
                  )}
                >
                  {s.title}
                </div>
                <div className="truncate text-[10.5px] text-ink-400">{s.hint}</div>
              </div>
            </li>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-[2px] flex-1 rounded-full",
                  done ? "bg-brand-500" : "bg-ink-200",
                )}
                aria-hidden
              />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 1 — Identité
// ──────────────────────────────────────────────────────────────────────

function StepIdentity({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
}) {
  const update = (patch: Partial<FormState>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
            Présentez-nous votre société
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Ces infos nous servent à attribuer correctement vos triggers et à éviter les
            faux positifs.
          </p>
        </div>

        <div>
          <Label htmlFor="name">Nom commercial *</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="ex. Digidemat"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="legalName">Raison sociale</Label>
          <Input
            id="legalName"
            value={form.legalName}
            onChange={(e) => update({ legalName: e.target.value })}
            placeholder="ex. Digidemat SAS"
            className="mt-1.5"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="industry">Secteur</Label>
            <Input
              id="industry"
              value={form.industry}
              onChange={(e) => update({ industry: e.target.value })}
              placeholder="ex. SaaS B2B"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="region">Région</Label>
            <Input
              id="region"
              value={form.region}
              list="region-presets"
              onChange={(e) => update({ region: e.target.value })}
              placeholder="ex. Île-de-France"
              className="mt-1.5"
            />
            <datalist id="region-presets">
              {REGION_PRESETS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="size">Taille</Label>
            <select
              id="size"
              value={form.size}
              onChange={(e) => update({ size: e.target.value })}
              className="mt-1.5 h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-[13px] text-ink-800 shadow-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              <option value="">—</option>
              {SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — ICP
// ──────────────────────────────────────────────────────────────────────

function StepIcp({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
}) {
  const update = (patch: Partial<FormState>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
            Décrivez vos cibles idéales
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            On combine ces critères avec les triggers détectés pour ne vous remonter que
            les pépites pertinentes.
          </p>
        </div>

        <ChipField
          label="Industries cibles *"
          hint="Ajouter à la volée — Entrée pour valider"
          values={form.industries}
          onChange={(industries) => update({ industries })}
          placeholder="ex. SaaS B2B"
        />

        <ChipField
          label="Tailles cibles"
          hint="TPE / PME / ETI / GE"
          values={form.sizes}
          onChange={(sizes) => update({ sizes })}
          options={SIZE_OPTIONS}
          placeholder="ex. PME"
        />

        <ChipField
          label="Régions *"
          hint="Régions FR ou pays"
          values={form.regions}
          onChange={(regions) => update({ regions })}
          options={REGION_PRESETS}
          placeholder="ex. Île-de-France"
        />

        <ChipField
          label="Signaux préférés"
          hint="Types de triggers que vous priorisez"
          values={form.preferredSignals}
          onChange={(preferredSignals) => update({ preferredSignals })}
          options={Object.keys(SIGNAL_LABELS)}
          renderLabel={(v) => SIGNAL_LABELS[v] ?? v}
          placeholder="ex. FUNDRAISING"
        />

        <ChipField
          label="Anti-personas"
          hint="Profils à exclure"
          values={form.antiPersonas}
          onChange={(antiPersonas) => update({ antiPersonas })}
          placeholder="ex. Auto-entrepreneurs"
        />

        <div>
          <Label htmlFor="minScore">
            Score minimum
            <span className="ml-2 text-[11px] font-normal text-ink-500">
              (1 à 10 — 7 est le seuil recommandé)
            </span>
          </Label>
          <div className="mt-1.5 flex items-center gap-3">
            <input
              id="minScore"
              type="range"
              min={1}
              max={10}
              step={1}
              value={form.minScore}
              onChange={(e) => update({ minScore: Number(e.target.value) })}
              className="flex-1 accent-brand-500"
            />
            <Badge variant="score" size="md" className="font-mono tabular-nums">
              {form.minScore}/10
            </Badge>
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Précisions (optionnel)</Label>
          <textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="Particularités de votre marché, contexte, exclusions…"
            className="mt-1.5 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-800 shadow-xs placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 3 — Plan
// ──────────────────────────────────────────────────────────────────────

const PLANS: Array<{
  id: Plan;
  name: string;
  price: number;
  tagline: string;
  features: string[];
  highlight?: boolean;
}> = [
  {
    id: "LEADS_DATA",
    name: "Leads Data",
    price: 199,
    tagline: "Vous prospectez vous-même avec nos signaux",
    features: [
      "Triggers temps réel scorés ≥ 7",
      "Attribution SIRENE Pappers + email finder",
      "Digest hebdo + alertes pépites",
      "Dashboard complet",
    ],
  },
  {
    id: "FULL_SERVICE",
    name: "Full Service",
    price: 890,
    tagline: "On envoie + on book vos RDV à votre place",
    features: [
      "Tout du Leads Data",
      "Cold email automatisé (Smartlead) 5 mailboxes",
      "Mailbox warmup 4-8 semaines",
      "Booking de RDV par notre commercial",
      "Reporting mensuel commenté",
    ],
    highlight: true,
  },
];

function StepPlan({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
}) {
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
            Choisissez votre offre
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Tarifs early-stage. Vous pouvez basculer entre les deux à tout moment.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {PLANS.map((p) => {
            const selected = form.plan === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  setForm((f) => (f ? { ...f, plan: p.id } : f))
                }
                className={cn(
                  "relative flex flex-col gap-3 rounded-xl border p-5 text-left transition-all hover:shadow-md",
                  selected
                    ? "border-brand-500 bg-brand-50/40 shadow-sm ring-2 ring-brand-200"
                    : "border-ink-200 bg-white",
                )}
              >
                {p.highlight && !selected && (
                  <span className="absolute -top-2 left-5 rounded-full bg-orange-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-orange-700">
                    Recommandé
                  </span>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-[16px] font-semibold tracking-tight text-ink-900">
                      {p.name}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-600">{p.tagline}</div>
                  </div>
                  <div
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      selected ? "border-brand-500 bg-brand-500" : "border-ink-300 bg-white",
                    )}
                  >
                    {selected && <Check className="h-3 w-3 text-white" />}
                  </div>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-[28px] font-semibold tabular-nums text-ink-900">
                    {p.price} €
                  </span>
                  <span className="text-[12px] text-ink-500">/ mois HT</span>
                </div>
                <ul className="space-y-1.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12.5px] text-ink-700">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-brand-600" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2 rounded-md border border-ink-200 bg-ink-50/60 p-3 text-[11.5px] text-ink-600">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span>
            Aucune CB demandée à cette étape — on facture après votre premier RDV booké.
            Engagement mensuel sans durée minimale.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 4 — Review
// ──────────────────────────────────────────────────────────────────────

function StepReview({ form }: { form: FormState }) {
  const plan = PLANS.find((p) => p.id === form.plan);
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
            Récap avant activation
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Vérifiez puis lancez le moteur. Vous pourrez ajuster à tout moment depuis
            <span className="mx-1 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px]">
              Clients → Profil
            </span>
            .
          </p>
        </div>

        <ReviewBlock title="Société">
          <ReviewLine label="Nom" value={form.name || "—"} />
          {form.legalName && <ReviewLine label="Raison sociale" value={form.legalName} />}
          <ReviewLine
            label="Secteur · Région · Taille"
            value={
              [form.industry, form.region, form.size].filter(Boolean).join(" · ") || "—"
            }
          />
        </ReviewBlock>

        <ReviewBlock title="Cibles ICP">
          <ReviewChips label="Industries" values={form.industries} />
          <ReviewChips label="Tailles" values={form.sizes} />
          <ReviewChips label="Régions" values={form.regions} />
          <ReviewChips
            label="Signaux préférés"
            values={form.preferredSignals.map((s) => SIGNAL_LABELS[s] ?? s)}
          />
          <ReviewChips label="Anti-personas" values={form.antiPersonas} />
          <ReviewLine label="Score minimum" value={`${form.minScore}/10`} />
          {form.notes && <ReviewLine label="Notes" value={form.notes} />}
        </ReviewBlock>

        <ReviewBlock title="Plan choisi">
          <div className="flex items-center justify-between gap-3 rounded-md border border-brand-200 bg-brand-50/50 p-3">
            <div>
              <div className="font-display text-[14px] font-semibold tracking-tight text-ink-900">
                {plan?.name}
              </div>
              <div className="text-[11.5px] text-ink-600">{plan?.tagline}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[18px] font-semibold tabular-nums text-ink-900">
                {formatNumberFr(plan?.price ?? 0)} €
              </div>
              <div className="text-[10.5px] text-ink-500">/ mois HT</div>
            </div>
          </div>
        </ReviewBlock>
      </CardContent>
    </Card>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </div>
      <div className="space-y-1.5 rounded-md border border-ink-100 bg-white p-3">{children}</div>
    </div>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 text-[12.5px]">
      <span className="w-44 shrink-0 text-ink-500">{label}</span>
      <span className="text-ink-800">{value}</span>
    </div>
  );
}

function ReviewChips({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
      <span className="w-44 shrink-0 text-ink-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <Badge key={v} variant="brand" size="sm">
            {v}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ChipField (réutilisé du client-profile, version compacte)
// ──────────────────────────────────────────────────────────────────────

function ChipField({
  label,
  hint,
  values,
  onChange,
  placeholder,
  options,
  renderLabel,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
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

  const dlId = `dl-${label.replace(/\s+/g, "-")}`;

  return (
    <div>
      <Label>
        {label}
        {hint && <span className="ml-2 text-[11px] font-normal text-ink-500">{hint}</span>}
      </Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-white p-2 shadow-xs focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        {values.length === 0 && (
          <span className="text-[11.5px] italic text-ink-400">Aucune entrée</span>
        )}
        {values.map((v) => (
          <Badge key={v} variant="brand" size="sm" className="gap-1">
            {renderLabel ? renderLabel(v) : v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="ml-0.5 -mr-0.5 rounded-full text-brand-700 hover:text-brand-900"
              aria-label={`Retirer ${v}`}
            >
              ×
            </button>
          </Badge>
        ))}
        <input
          type="text"
          value={input}
          list={options ? dlId : undefined}
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
          className="min-w-[140px] flex-1 border-0 bg-transparent text-[12.5px] text-ink-800 outline-none placeholder:text-ink-400"
        />
        {options && (
          <datalist id={dlId}>
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
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function WizardSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Skeleton className="mb-6 h-10 w-1/3" />
      <Skeleton className="mb-8 h-8 w-full" />
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );
}
