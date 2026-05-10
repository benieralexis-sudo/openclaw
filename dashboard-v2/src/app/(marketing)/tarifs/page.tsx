import Link from "next/link";
import type { Metadata } from "next";
import { Check, Shield, ArrowRight } from "lucide-react";
import { SectionHeading } from "../_components/section-heading";

export const metadata: Metadata = {
  title: "Tarifs — 390 €/mois, 6 Pépites garanties",
  description:
    "Une seule offre publique : 390 €/mois en annuel, 60 leads qualifiés inclus, 6 Pépites minimum garanties. Setup gratuit. Engagement annuel.",
  robots: { index: true, follow: true },
};

export default function TarifsPage() {
  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            Tarifs
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight leading-[1.05]">
            Une offre. Une promesse{" "}
            <span className="text-brand-700">mesurable</span>.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            390&nbsp;€ par mois. 6 Pépites garanties — ou quota doublé.
            Pas de rabais douteux, pas de tier confus.
          </p>
        </div>
      </section>

      {/* ───────────────────────── PRICING CARD ───────────────────────── */}
      <section className="pb-20 md:pb-24">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl border border-ink-200 bg-white shadow-lg overflow-hidden">
            <div className="grid md:grid-cols-12">
              {/* LEFT — Pricing */}
              <div className="md:col-span-5 p-8 md:p-10 border-b md:border-b-0 md:border-r border-ink-100">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-2">
                  iFIND Growth
                </p>
                <p className="text-sm text-ink-500 mb-8">
                  Pour PME tech FR de 11 à 200 collaborateurs
                </p>

                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className="font-display text-6xl md:text-7xl font-semibold text-ink-900 tracking-tight tabular-nums">
                    390&nbsp;€
                  </span>
                  <span className="text-ink-600 text-xl">/ mois</span>
                </div>
                <p className="text-sm text-ink-500 mb-1">Engagement annuel</p>
                <p className="text-xs text-ink-400 mb-8">
                  Soit 4&nbsp;680&nbsp;€ HT/an · TVA en sus · Setup gratuit
                </p>

                <Link
                  href="/signup"
                  className="block w-full text-center rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium py-3 text-sm"
                >
                  Démarrer maintenant
                  <ArrowRight className="inline-block ml-1.5 h-4 w-4" />
                </Link>
                <p className="text-[11px] text-ink-400 text-center mt-3">
                  Paiement sécurisé Stripe · Annulation 1-clic à l&apos;échéance
                </p>
              </div>

              {/* RIGHT — Features */}
              <div className="md:col-span-7 p-8 md:p-10 bg-ink-50/30">
                {/* Garantie */}
                <div className="rounded-lg bg-white border border-brand-200 p-5 mb-6">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-brand-700 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 mb-1.5">
                        Garantie 6 Pépites par mois
                      </p>
                      <p className="text-sm text-ink-700 leading-relaxed">
                        Si on livre moins de 6 Pépites (score IA ≥ 8/10) un mois,
                        votre quota du mois suivant est <strong className="text-ink-900">automatiquement doublé</strong> — 120 leads inclus au lieu de 60.
                      </p>
                    </div>
                  </div>
                </div>

                <p className="text-xs font-medium uppercase tracking-wider text-ink-500 mb-4">
                  Inclus dans l&apos;offre
                </p>
                <ul className="space-y-3">
                  {INCLUS.map((f) => (
                    <li key={f.title} className="flex items-start gap-3">
                      <Check className="h-4 w-4 text-brand-700 flex-shrink-0 mt-1" strokeWidth={3} />
                      <div>
                        <p className="text-sm font-medium text-ink-900">{f.title}</p>
                        <p className="text-xs text-ink-500 mt-0.5">{f.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Custom enterprise */}
          <div className="mt-8 text-center">
            <p className="text-sm text-ink-500">
              Besoin de plus de 200 leads par mois ou multi-équipes ?{" "}
              <a href="mailto:contact@ifind.fr" className="text-brand-700 hover:text-brand-800 font-medium link-underline">
                Devis personnalisé
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── ROI ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Calcul ROI typique"
            title={<>ROI sous <span className="text-brand-700">2 mois</span>.</>}
            description="Hypothèse réaliste : 18 Pépites par mois (moyenne mesurée DTL), 5 % de conversion RDV→deal, 35 000 € ARR par contrat moyen ESN."
          />

          <div className="mt-12 grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            <RoiCard label="Coût iFIND" value="390 €" sub="par mois (annuel)" />
            <RoiCard label="Pépites mesurées" value="18" sub="par mois en moyenne" />
            <RoiCard label="Deal moyen ESN" value="35 000 €" sub="ARR par contrat" />
          </div>

          <div className="mt-6 max-w-4xl mx-auto rounded-xl bg-brand-950 text-white p-8 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-400 mb-3">
              ROI annuel typique
            </p>
            <div className="font-display text-5xl md:text-6xl font-semibold tracking-tight tabular-nums">
              ×&nbsp;7,5
            </div>
            <p className="mt-4 text-sm text-ink-300 max-w-xl mx-auto leading-relaxed">
              1 deal closé par trimestre = 35 000 € ARR · iFIND coûte 4 680 €/an ·
              ROI ×&nbsp;7,5. Avec 2 deals par an, ROI ×&nbsp;15.
            </p>
          </div>
        </div>
      </section>

      {/* ───────────────────────── FAQ ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Questions fréquentes"
            title="Tout ce qu'il faut savoir."
          />

          <div className="mt-12 space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="group rounded-lg border border-ink-200 bg-white px-5 py-4 cursor-pointer hover:border-ink-300 transition-colors open:border-brand-200 open:bg-brand-50/20">
                <summary className="font-medium text-ink-900 list-none flex items-center justify-between gap-4">
                  <span className="text-[15px]">{f.q}</span>
                  <span className="flex-shrink-0 text-ink-400 text-base group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-3 text-sm text-ink-600 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── CTA FINAL ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl bg-brand-950 text-white px-8 py-14 md:px-14 md:py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Démarrez en 5 minutes.
            </h2>
            <p className="mt-5 text-base md:text-lg text-ink-300 max-w-xl mx-auto leading-relaxed">
              Setup gratuit. Premières Pépites sous 48 heures. Garantie
              6 Pépites le premier mois ou quota doublé.
            </p>
            <Link
              href="/signup"
              className="mt-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-white text-ink-900 hover:bg-ink-100 font-medium px-5 h-11 text-sm"
            >
              Démarrer maintenant
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function RoiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-white border border-ink-200 p-6 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-500 mb-2">{label}</p>
      <p className="font-display text-3xl font-semibold text-ink-900 tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-ink-500 mt-1">{sub}</p>
    </div>
  );
}

const INCLUS = [
  { title: "60 leads qualifiés par mois", description: "Score IA ≥ 6, prêts à approcher." },
  { title: "Rollover crédits jusqu'à 4 mois", description: "Crédits non-consommés roulent automatiquement." },
  { title: "Overage flexible : 8 € par lead", description: "Topup à la demande si vous dépassez votre quota." },
  { title: "Brief IA sur chaque Pépite", description: "Contexte, signal, angle, pitch, objections — prêt à utiliser." },
  { title: "Setup ICP custom + tuning offerts", description: "Notre équipe configure votre profil cible avec vous." },
  { title: "Alertes Telegram et email", description: "Notification instantanée à chaque Pépite détectée." },
];

const FAQS = [
  {
    q: "Pourquoi une seule offre et pas plusieurs tiers ?",
    a: "Parce qu'on déteste la confusion. Un prix, une promesse mesurable. Si vous avez besoin de plus de 200 leads par mois ou de fonctionnalités multi-équipes, contactez-nous pour un devis custom.",
  },
  {
    q: "C'est quoi exactement une Pépite ?",
    a: "Un lead avec un score IA ≥ 8/10 — une boîte qui matche votre ICP ET qui présente un signal d'achat fort (levée de fonds, recrutement urgent, lancement produit, changement dirigeant…). Sur le bot DTL, on en détecte 18 par mois en moyenne.",
  },
  {
    q: "Et si vous ne livrez pas mes 6 Pépites un mois ?",
    a: "Engagement contractuel : si vous recevez moins de 6 Pépites un mois, votre quota du mois suivant est automatiquement doublé (120 leads inclus au lieu de 60). Vous ne payez jamais pour de l'air.",
  },
  {
    q: "Que se passe-t-il si je n'utilise pas mes 60 leads dans le mois ?",
    a: "Vos crédits non-consommés roulent automatiquement sur les mois suivants (cumul max 4 mois = 240 crédits de stock). En cas de mois calme ou de vacances, rien n'est perdu.",
  },
  {
    q: "Et si j'ai besoin de plus de 60 leads dans un mois explosif ?",
    a: "Vous pouvez acheter des leads supplémentaires à 8 € pièce, facturés en fin de mois sur la même carte. Vous gardez le contrôle, sans quota imposé.",
  },
  {
    q: "Quelles sources sont scannées exactement ?",
    a: "11 sources publiques françaises : BODACC, INPI, France Travail, presse Tech FR (RSS), JOAFE, LinkedIn Jobs, Welcome to the Jungle, Pappers SIRENE, et 2 sources premium (intent data + tech stack discovery). Tout est légal, public, et conforme RGPD.",
  },
  {
    q: "Combien de temps pour voir les premiers résultats ?",
    a: "Setup en 5 minutes (questionnaire ICP). Premières détections sous 48 heures. Vous recevez ensuite des Pépites en continu, avec alertes Telegram instantanées si vous le souhaitez.",
  },
  {
    q: "Comment annuler ?",
    a: "Engagement annuel obligatoire — c'est ce qui nous permet d'investir dans votre ICP custom. À l'échéance, vous pouvez annuler en 1 clic depuis votre dashboard, sans frais. Pas de tacite reconduction sans préavis.",
  },
];
