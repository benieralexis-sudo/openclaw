import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Mail, Quote } from "lucide-react";

export const metadata: Metadata = {
  title: "À propos — La vision iFIND",
  description:
    "Pourquoi iFIND existe. Le pari : une promesse mesurable bat un fichier de 50 000 contacts froids.",
  robots: { index: true, follow: true },
};

export default function AProposPage() {
  return (
    <>
      {/* HERO */}
      <section className="pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            À propos
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight leading-[1.05]">
            Construire le moteur de prospection le plus précis de France.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-600 leading-relaxed">
            iFIND n&apos;est ni une base de données ni un agrégateur. C&apos;est un engagement
            mesurable sur la qualité des leads livrés.
          </p>
        </div>
      </section>

      {/* CHIFFRES CLÉS */}
      <section className="pb-20">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ink-200 rounded-xl overflow-hidden border border-ink-200">
            {KEY_FIGURES.map((f) => (
              <div key={f.label} className="bg-white p-6 text-center">
                <div className="font-display text-3xl md:text-4xl font-semibold tracking-tight tabular-nums bg-gradient-to-br from-ink-900 via-brand-800 to-brand-700 bg-clip-text text-transparent">
                  {f.value}
                </div>
                <p className="mt-2 text-xs font-medium text-ink-700">{f.label}</p>
                <p className="text-[11px] text-ink-500 mt-0.5">{f.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STORY */}
      <section className="pb-20 md:pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="space-y-8 text-[16px] text-ink-700 leading-[1.7]">
            <p>
              En 2026, la prospection B2B en France reste un casse-tête. Les outils
              américains couvrent mal la donnée FR. Les outils français vendent de la
              donnée brute sans intelligence. Et tous demandent au commercial de trier
              500 prospects pour trouver 5 vraies opportunités.
            </p>
            <p className="font-display text-2xl md:text-3xl font-semibold text-ink-900 leading-tight">
              iFIND est né de cette frustration.
            </p>
            <p>
              On a construit le seul moteur français qui fait <strong className="text-ink-900">les trois à la fois</strong> :
              détecter en temps réel sur 11 sources publiques FR, qualifier chaque
              signal avec une IA propriétaire, et garantir contractuellement un
              minimum de 6 Pépites par mois.
            </p>
          </div>

          {/* Citation */}
          <figure className="my-16 relative rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/60 to-white p-8 md:p-10">
            <Quote className="absolute -top-4 left-8 h-8 w-8 text-brand-600 fill-brand-600 bg-white p-1 rounded-full border border-brand-200" />
            <blockquote className="font-display text-xl md:text-2xl font-medium text-ink-900 leading-snug tracking-tight">
              Une promesse mesurable bat un fichier de 50&nbsp;000 contacts froids.
              Plutôt que vendre du volume, on s&apos;engage sur la qualité.
            </blockquote>
            <figcaption className="mt-5 text-sm text-ink-500">— La vision iFIND</figcaption>
          </figure>
        </div>
      </section>

      {/* TIMELINE */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-3">
              Notre parcours
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink-900 tracking-tight">
              De l&apos;idée à la production.
            </h2>
          </div>

          <div className="relative">
            {/* Ligne verticale */}
            <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-brand-300 via-brand-200 to-transparent md:-translate-x-px" />

            <div className="space-y-10">
              {TIMELINE.map((t, i) => (
                <div key={i} className={`relative flex md:gap-8 ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"}`}>
                  {/* Dot */}
                  <div className="absolute left-4 md:left-1/2 -translate-x-1/2 mt-2 w-3 h-3 rounded-full bg-brand-600 border-2 border-white shadow-md z-10" />

                  {/* Content */}
                  <div className="ml-12 md:ml-0 md:w-1/2 md:px-6">
                    <div className={`bg-white rounded-xl border border-ink-200 p-5 ${i % 2 === 0 ? "md:text-right" : "md:text-left"}`}>
                      <p className="text-xs font-mono font-semibold text-brand-700 mb-1.5 tabular-nums">{t.date}</p>
                      <h3 className="font-display font-semibold text-ink-900 mb-1.5">{t.title}</h3>
                      <p className="text-sm text-ink-600 leading-relaxed">{t.description}</p>
                    </div>
                  </div>

                  {/* Spacer pour layout 50/50 */}
                  <div className="hidden md:block md:w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* VISION + ENGAGEMENTS */}
      <section className="py-20 md:py-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="mb-16">
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 mb-4 tracking-tight">
              Notre vision
            </h2>
            <p className="text-[16px] text-ink-700 leading-[1.7]">
              Démocratiser l&apos;accès à la qualification IA pour toutes les PME tech
              françaises. Aujourd&apos;hui, les outils enterprise coûtent plusieurs
              milliers d&apos;euros par an et par utilisateur. Demain, votre PME de
              30 personnes y aura accès à 390&nbsp;€ par mois.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 mb-6 tracking-tight">
              Nos engagements
            </h2>
            <ul className="space-y-3">
              {ENGAGEMENTS.map((e) => (
                <li key={e.title} className="rounded-xl border border-ink-200 bg-white p-5 hover:border-brand-200 hover:shadow-md transition-all">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-md bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center font-display font-semibold text-sm tabular-nums">
                      {e.num}
                    </div>
                    <div>
                      <p className="font-display font-semibold text-ink-900 mb-1">{e.title}</p>
                      <p className="text-sm text-ink-600 leading-relaxed">{e.description}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink-900 tracking-tight">
            Une question, un devis sur mesure&nbsp;?
          </h2>
          <p className="mt-5 text-base md:text-lg text-ink-600 max-w-xl mx-auto leading-relaxed">
            Pour les besoins {">"} 200 leads par mois ou multi-équipes, on construit
            un devis sur mesure.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:contact@ifind.fr"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium px-5 h-11 text-sm shadow-md shadow-brand-500/20"
            >
              <Mail className="h-4 w-4" />
              contact@ifind.fr
            </a>
            <Link
              href="/tarifs"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white hover:bg-ink-50 text-ink-700 hover:text-ink-900 font-medium px-5 h-11 text-sm border border-ink-200"
            >
              Voir les tarifs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

const KEY_FIGURES = [
  { value: "11", label: "Sources FR", sub: "scannées 24/7" },
  { value: "18", label: "Pépites/mois", sub: "en moyenne" },
  { value: "95%", label: "Précision IA", sub: "vs 80% V1" },
  { value: "100%", label: "Made in France", sub: "hébergé en FR" },
];

const TIMELINE = [
  {
    date: "Mi 2024",
    title: "Le constat",
    description: "Frustration partagée avec deux commerciaux : on perd 80 % du temps à filtrer pour trouver 5 vraies opportunités. Aucun outil ne fait à la fois la donnée FR et la qualification IA.",
  },
  {
    date: "Fin 2024",
    title: "Premier prototype",
    description: "Premier moteur de détection sur 3 sources françaises. Les leads sortent — mais sans qualification, on retombe sur le même problème de tri.",
  },
  {
    date: "Q1 2025",
    title: "Le pivot IA",
    description: "Intégration d'une IA propriétaire avec contexte client. Score 0-10 + brief sur-mesure. Précision passe de 60 % à 85 %.",
  },
  {
    date: "Q3 2025",
    title: "Premier client production",
    description: "Lancement avec un partenaire pilote sur l'écosystème tech FR. Premiers résultats mesurés en production.",
  },
  {
    date: "2026",
    title: "Garantie contractuelle",
    description: "Engagement écrit : 6 Pépites minimum par mois ou quota doublé. Personne d'autre ne s'engage contractuellement sur la qualité en France.",
  },
];

const ENGAGEMENTS = [
  {
    num: "01",
    title: "Transparence pricing",
    description: "Un seul prix public, sans rabais douteux ni tacite reconduction. Ce que vous voyez est ce que vous payez.",
  },
  {
    num: "02",
    title: "Garantie qualité contractuelle",
    description: "6 Pépites par mois minimum. Si on ne tient pas, votre quota du mois suivant est doublé. Engagement écrit dans les CGV.",
  },
  {
    num: "03",
    title: "RGPD by design",
    description: "100 % des données scrapées sont publiques et légales. Hébergement EU uniquement, aucun transfert hors UE.",
  },
  {
    num: "04",
    title: "Hébergé en France",
    description: "Développé, hébergé et supporté en France. Infrastructure OVHcloud / Hetzner FR.",
  },
];
