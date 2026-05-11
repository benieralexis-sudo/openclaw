"use client";

/**
 * Sprint 4 (10/05/2026) — Wizard création client (3 étapes).
 *
 * Étape 1 : Info entreprise + plan + contact
 * Étape 2 : ICP de base (industries, sizes, naf_codes, antiPersonas)
 * Étape 3 : Review + Create
 *
 * Apres creation, redirect vers /clients/[id] pour configurer ICP avance + delivery.
 *
 * Auth : ADMIN seulement (route POST /api/clients verifie).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, X, Check, Loader2, AlertCircle, Building2, Sparkles, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = 1 | 2 | 3;

interface WizardData {
  // Step 1
  name: string;
  slug: string;
  legalName: string;
  industry: string;
  region: string;
  size: string;
  contactEmail: string;
  contactPhone: string;
  plan: "GROWTH" | "LEADS_DATA" | "CUSTOM";
  status: "PROSPECT" | "ACTIVE" | "PAUSED";
  // Step 2 (ICP de base)
  icpIndustries: string[];
  icpSizes: string[];
  icpRegions: string[];
  icpNafCodes: string[];
  icpAntiPersonas: string[];
  icpMinScore: number;
}

const SIZES_AVAILABLE = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];
const REGIONS_AVAILABLE = [
  "Île-de-France",
  "Auvergne-Rhône-Alpes",
  "Nouvelle-Aquitaine",
  "Hauts-de-France",
  "Occitanie",
  "Provence-Alpes-Côte d'Azur",
  "Bretagne",
  "Pays de la Loire",
  "Grand Est",
  "Bourgogne-Franche-Comté",
  "Centre-Val de Loire",
  "Normandie",
  "Corse",
];

const DEFAULT_DATA: WizardData = {
  name: "",
  slug: "",
  legalName: "",
  industry: "",
  region: "",
  size: "",
  contactEmail: "",
  contactPhone: "",
  plan: "LEADS_DATA",
  status: "PROSPECT",
  icpIndustries: [],
  icpSizes: [],
  icpRegions: [],
  icpNafCodes: [],
  icpAntiPersonas: [],
  icpMinScore: 7,
};

function ChipsInput({
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [input, setInput] = useState("");
  function add(v: string) {
    const trimmed = v.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput("");
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs">
            {v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(input);
            }
          }}
          placeholder={placeholder ?? "Tape + Entrée"}
        />
        <Button type="button" size="sm" onClick={() => add(input)} disabled={!input.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {suggestions
            .filter((s) => !value.includes(s))
            .slice(0, 12)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="px-2 py-0.5 rounded text-xs bg-ink-100 text-ink-600 hover:bg-blue-100 hover:text-blue-700"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function CreateClientWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [data, setData] = useState<WizardData>(DEFAULT_DATA);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: data.name,
        slug: data.slug || undefined,
        legalName: data.legalName || null,
        industry: data.industry || null,
        region: data.region || null,
        size: data.size || null,
        plan: data.plan,
        status: data.status,
        contactEmail: data.contactEmail || null,
        contactPhone: data.contactPhone || null,
        icp: {
          industries: data.icpIndustries.length ? data.icpIndustries : undefined,
          sizes: data.icpSizes.length ? data.icpSizes : undefined,
          regions: data.icpRegions.length ? data.icpRegions : undefined,
          naf_codes: data.icpNafCodes.length ? data.icpNafCodes : undefined,
          antiPersonas: data.icpAntiPersonas.length ? data.icpAntiPersonas : undefined,
          minScore: data.icpMinScore,
          country_codes: ["FR"],
        },
      };
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}` + (err.issues ? ": " + JSON.stringify(err.issues) : ""));
      }
      return res.json();
    },
    onSuccess: (created: { id: string; slug: string; name: string }) => {
      router.push(`/clients/${created.id}?welcome=1`);
    },
  });

  const canStep1 = data.name.length >= 2;
  const canStep2 = true; // ICP optional
  const canCreate = canStep1 && canStep2;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/clients")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Retour
        </Button>
      </div>

      <div className="rounded-lg border border-ink-200 bg-white p-6">
        <h1 className="text-2xl font-bold mb-1">Nouveau client</h1>
        <p className="text-ink-600 text-sm mb-6">Onboarding en 3 étapes — ~2 minutes.</p>

        {/* Stepper */}
        <div className="flex items-center justify-between mb-8">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center flex-1">
              <div
                className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step === n ? "bg-blue-600 text-white" : step > n ? "bg-green-100 text-green-700" : "bg-ink-100 text-ink-400"
                }`}
              >
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 3 && <div className={`flex-1 h-0.5 mx-2 ${step > n ? "bg-green-300" : "bg-ink-200"}`} />}
            </div>
          ))}
        </div>

        {/* Step 1 — Info */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-3 text-blue-600">
              <Building2 className="h-5 w-5" />
              <h2 className="font-semibold text-lg">Informations entreprise</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Nom * <span className="text-red-500">obligatoire</span></Label>
                <Input
                  id="name"
                  value={data.name}
                  onChange={(e) => setData({ ...data, name: e.target.value })}
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug (auto si vide)</Label>
                <Input
                  id="slug"
                  value={data.slug}
                  onChange={(e) => setData({ ...data, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  placeholder="acme-corp"
                />
              </div>
              <div>
                <Label htmlFor="legalName">Raison sociale</Label>
                <Input id="legalName" value={data.legalName} onChange={(e) => setData({ ...data, legalName: e.target.value })} placeholder="ACME SAS" />
              </div>
              <div>
                <Label htmlFor="industry">Industrie</Label>
                <Input id="industry" value={data.industry} onChange={(e) => setData({ ...data, industry: e.target.value })} placeholder="SaaS B2B" />
              </div>
              <div>
                <Label htmlFor="region">Région</Label>
                <Input id="region" value={data.region} onChange={(e) => setData({ ...data, region: e.target.value })} placeholder="Île-de-France" />
              </div>
              <div>
                <Label htmlFor="size">Taille (PME, ETI, GE)</Label>
                <Input id="size" value={data.size} onChange={(e) => setData({ ...data, size: e.target.value })} placeholder="PME" />
              </div>
              <div>
                <Label htmlFor="contactEmail">Email contact</Label>
                <Input id="contactEmail" type="email" value={data.contactEmail} onChange={(e) => setData({ ...data, contactEmail: e.target.value })} placeholder="contact@acme.fr" />
              </div>
              <div>
                <Label htmlFor="contactPhone">Téléphone</Label>
                <Input id="contactPhone" value={data.contactPhone} onChange={(e) => setData({ ...data, contactPhone: e.target.value })} placeholder="+33 1 23 45 67 89" />
              </div>
              <div>
                <Label htmlFor="plan">Plan</Label>
                <select
                  id="plan"
                  value={data.plan}
                  onChange={(e) => setData({ ...data, plan: e.target.value as WizardData["plan"] })}
                  className="w-full h-9 px-3 rounded-md border border-ink-200 bg-white text-sm"
                >
                  <option value="GROWTH">Growth — 390€/mois (offre publique)</option>
                  <option value="LEADS_DATA">Leads Data — 199€/mois (legacy)</option>
                  <option value="CUSTOM">Custom (deal négocié)</option>
                </select>
              </div>
              <div>
                <Label htmlFor="status">Statut initial</Label>
                <select
                  id="status"
                  value={data.status}
                  onChange={(e) => setData({ ...data, status: e.target.value as WizardData["status"] })}
                  className="w-full h-9 px-3 rounded-md border border-ink-200 bg-white text-sm"
                >
                  <option value="PROSPECT">Prospect (test)</option>
                  <option value="ACTIVE">Actif (en production)</option>
                  <option value="PAUSED">En pause</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — ICP */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 mb-3 text-blue-600">
              <Sparkles className="h-5 w-5" />
              <h2 className="font-semibold text-lg">ICP de base</h2>
            </div>
            <p className="text-sm text-ink-600">Critères de ciblage. Tu pourras les enrichir après création (page Profil ICP).</p>

            <div>
              <Label>Industries cibles</Label>
              <ChipsInput value={data.icpIndustries} onChange={(v) => setData({ ...data, icpIndustries: v })} placeholder="ex: SaaS B2B, ESN, FinTech" />
            </div>
            <div>
              <Label>Tailles cibles</Label>
              <ChipsInput value={data.icpSizes} onChange={(v) => setData({ ...data, icpSizes: v })} suggestions={SIZES_AVAILABLE} />
            </div>
            <div>
              <Label>Régions cibles</Label>
              <ChipsInput value={data.icpRegions} onChange={(v) => setData({ ...data, icpRegions: v })} suggestions={REGIONS_AVAILABLE} />
            </div>
            <div>
              <Label>Codes NAF (whitelist)</Label>
              <ChipsInput value={data.icpNafCodes} onChange={(v) => setData({ ...data, icpNafCodes: v })} placeholder="ex: 5829A, 6201Z" />
              <p className="text-xs text-ink-500 mt-1">Format INSEE sans point. Préfixe accepté (5829 matche 5829A/B/C).</p>
            </div>
            <div>
              <Label>Anti-personas (entreprises à exclure)</Label>
              <ChipsInput value={data.icpAntiPersonas} onChange={(v) => setData({ ...data, icpAntiPersonas: v })} placeholder="ex: Capgemini, Sopra" />
              <p className="text-xs text-ink-500 mt-1">Match partiel sur nom (ex: "Capgemini" exclut "Capgemini Engineering").</p>
            </div>
            <div>
              <Label htmlFor="minScore">Score minimum (1-10)</Label>
              <Input
                id="minScore"
                type="number"
                min={1}
                max={10}
                value={data.icpMinScore}
                onChange={(e) => setData({ ...data, icpMinScore: parseInt(e.target.value) || 7 })}
              />
              <p className="text-xs text-ink-500 mt-1">Seuil pour qualifier un trigger en NEW. Défaut 7 (Brûlants + Très chauds).</p>
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 mb-3 text-blue-600">
              <ListChecks className="h-5 w-5" />
              <h2 className="font-semibold text-lg">Vérification</h2>
            </div>
            <div className="rounded-md border border-ink-200 bg-ink-50 p-4 space-y-3 text-sm">
              <div><span className="text-ink-500">Nom :</span> <strong>{data.name}</strong></div>
              <div><span className="text-ink-500">Slug :</span> <code className="text-xs bg-white px-1.5 py-0.5 rounded border">{data.slug || "(auto)"}</code></div>
              {data.legalName && <div><span className="text-ink-500">Raison sociale :</span> {data.legalName}</div>}
              <div><span className="text-ink-500">Plan :</span> {data.plan} • <span className="text-ink-500">Statut :</span> <strong className={data.status === "ACTIVE" ? "text-green-600" : "text-ink-600"}>{data.status}</strong></div>
              {data.contactEmail && <div><span className="text-ink-500">Contact :</span> {data.contactEmail}</div>}
              {data.icpIndustries.length > 0 && <div><span className="text-ink-500">ICP industries :</span> {data.icpIndustries.join(", ")}</div>}
              {data.icpSizes.length > 0 && <div><span className="text-ink-500">ICP tailles :</span> {data.icpSizes.join(", ")}</div>}
              {data.icpNafCodes.length > 0 && <div><span className="text-ink-500">ICP NAF :</span> {data.icpNafCodes.join(", ")}</div>}
              {data.icpAntiPersonas.length > 0 && <div><span className="text-ink-500">Anti-personas :</span> {data.icpAntiPersonas.join(", ")}</div>}
              <div><span className="text-ink-500">Score min :</span> {data.icpMinScore}/10</div>
            </div>

            {mutation.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>{String(mutation.error)}</div>
              </div>
            )}

            <p className="text-xs text-ink-500">
              Après création, tu seras redirigé vers la fiche client pour enrichir l'ICP, configurer le delivery et inviter des utilisateurs.
            </p>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-ink-200">
          <Button
            variant="ghost"
            disabled={step === 1 || mutation.isPending}
            onClick={() => setStep((step - 1) as Step)}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Précédent
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((step + 1) as Step)}
              disabled={(step === 1 && !canStep1) || (step === 2 && !canStep2)}
            >
              Suivant <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={() => mutation.mutate()} disabled={!canCreate || mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Créer le client
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
