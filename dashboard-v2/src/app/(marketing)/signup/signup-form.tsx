"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Status = "idle" | "submitting" | "success" | "error";

export function SignupForm() {
  const [status, setStatus] = React.useState<Status>("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [errorField, setErrorField] = React.useState<string | null>(null);

  // Form state
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [volumeEstimate, setVolumeEstimate] = React.useState("60-120");
  const [industry, setIndustry] = React.useState("SaaS");
  const [message, setMessage] = React.useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);
    setErrorField(null);

    try {
      const res = await fetch("/api/public/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          company,
          phone: phone || undefined,
          volumeEstimate,
          industry,
          message: message || undefined,
          source: "/signup",
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        field?: string;
      };

      if (!res.ok) {
        setErrorMsg(data.error ?? "Une erreur est survenue. Réessayez.");
        setErrorField(data.field ?? null);
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMsg("Connexion impossible. Vérifiez votre réseau.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mb-5">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h2 className="font-display text-2xl font-semibold text-ink-900 mb-3">
          Inscription enregistrée.
        </h2>
        <p className="text-base text-ink-600 leading-relaxed max-w-md mx-auto">
          On vous contacte sous <strong className="text-ink-900">24 heures</strong> pour
          configurer votre ICP. Vos premières Pépites arriveront sous 48 heures
          après onboarding.
        </p>
        <div className="mt-8 pt-8 border-t border-emerald-100">
          <p className="text-sm text-ink-500">En attendant, vous pouvez :</p>
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/produit"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 link-underline"
            >
              Découvrir le produit
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <span className="hidden sm:inline text-ink-300">·</span>
            <Link
              href="/cas-d-usage"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 link-underline"
            >
              Voir les cas d&apos;usage
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-ink-200 bg-white p-8 md:p-10 space-y-5 shadow-lg">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-2">
          iFIND Growth · 390 €/mois
        </p>
        <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 tracking-tight mb-3">
          Réservez votre accès.
        </h2>
        <p className="text-sm text-ink-600 leading-relaxed">
          Le paiement automatique en ligne arrive sous peu. En attendant,
          on vous contacte sous 24 heures pour démarrer. Premières Pépites sous 48 heures.
        </p>
      </div>

      {errorMsg && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Identité */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Prénom" required={false}>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jean"
            autoComplete="given-name"
            className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
          />
        </Field>
        <Field label="Nom" required={false}>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Dupont"
            autoComplete="family-name"
            className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
          />
        </Field>
      </div>

      <Field label="Email professionnel" required error={errorField === "email" ? (errorMsg ?? undefined) : undefined}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="vous@entreprise.fr"
          autoComplete="email"
          className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
        />
      </Field>

      <Field label="Société" required error={errorField === "company" ? (errorMsg ?? undefined) : undefined}>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          required
          placeholder="Acme SAS"
          autoComplete="organization"
          className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
        />
      </Field>

      <Field label="Téléphone" required={false}>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+33 6 00 00 00 00"
          autoComplete="tel"
          className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Secteur">
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm text-ink-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
          >
            <option value="SaaS">SaaS B2B</option>
            <option value="ESN">ESN tech</option>
            <option value="Conseil">Conseil tech</option>
            <option value="Industrie">Industrie</option>
            <option value="Autre">Autre</option>
          </select>
        </Field>
        <Field label="Volume estimé">
          <select
            value={volumeEstimate}
            onChange={(e) => setVolumeEstimate(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm text-ink-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
          >
            <option value="30-60">30-60 leads / mois</option>
            <option value="60-120">60-120 leads / mois</option>
            <option value="120-200">120-200 leads / mois</option>
            <option value="200+">+ de 200 leads / mois</option>
          </select>
        </Field>
      </div>

      <Field label="Message (optionnel)">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Décrivez brièvement votre cible commerciale ou vos objectifs."
          className="w-full px-3 py-2 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all resize-none"
        />
      </Field>

      <button
        type="submit"
        disabled={status === "submitting" || !email || !company}
        className="w-full h-11 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium text-sm shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
      >
        {status === "submitting" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Envoi en cours…
          </>
        ) : (
          <>
            Réserver ma place
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <p className="text-[11px] text-ink-500 text-center leading-relaxed">
        En soumettant ce formulaire, vous acceptez nos{" "}
        <Link href="/cgv" className="text-brand-700 hover:text-brand-800 underline-offset-2 hover:underline">CGV</Link>
        {" "}et notre{" "}
        <Link href="/rgpd" className="text-brand-700 hover:text-brand-800 underline-offset-2 hover:underline">politique RGPD</Link>.
        Nous ne partageons jamais vos données.
      </p>
    </form>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-ink-900">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
