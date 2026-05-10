import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, Shield, Zap, Brain } from "lucide-react";
import { DashboardMockup } from "./_components/dashboard-mockup";
import { SourcesMarquee } from "./_components/sources-marquee";
import { BeforeAfter } from "./_components/before-after";
import { FeatureShowcase } from "./_components/feature-showcase";
import { LiveFeed } from "./_components/live-feed";
import { BriefMockup } from "./_components/brief-mockup";
import { SectionHeading } from "./_components/section-heading";
import { Reveal } from "./_components/reveal";
import { STATS_PRODUIT } from "./_components/_data/mock-companies";

export const metadata: Metadata = {
  title: "iFIND — Détection de signaux d'achat sur les PME françaises",
  description:
    "Le moteur français de détection de signaux d'achat. 11 sources publiques scannées 24/7, qualification IA Claude Opus 4.7, garantie 6 Pépites par mois.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="pt-20 pb-24 md:pt-28 md:pb-32">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          {/* Badge live discret */}
          <div className="flex justify-center mb-8">
            <Link
              href="/produit#garantie"
              className="group inline-flex items-center gap-2 px-3 h-7 rounded-full bg-brand-50 border border-brand-100 text-xs font-medium text-brand-800 hover:bg-brand-100 transition-colors"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-600" />
              </span>
              Garantie contractuelle 6 Pépites par mois
              <ArrowRight className="h-3 w-3 opacity-60 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          {/* Headline sobre */}
          <h1 className="text-center font-display text-4xl sm:text-5xl md:text-6xl lg:text-[64px] font-semibold text-ink-900 tracking-tight leading-[1.05] max-w-4xl mx-auto">
            Détectez les PME françaises{" "}
            <span className="text-brand-700">qui sont prêtes à acheter</span>.
          </h1>

          <p className="mt-6 text-center text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            iFIND scanne 11 sources publiques françaises en continu, qualifie chaque
            signal avec Claude&nbsp;Opus&nbsp;4.7, et vous garantit 6 Pépites par mois minimum.
          </p>

          {/* CTA */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/tarifs"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium px-5 h-11 text-sm shadow-sm"
            >
              Voir les tarifs
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/produit"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white hover:bg-ink-50 text-ink-700 hover:text-ink-900 font-medium px-5 h-11 text-sm border border-ink-200"
            >
              Comment ça marche
            </Link>
          </div>

          {/* Trust micro-line */}
          <p className="mt-6 text-center text-xs text-ink-500">
            390 €/mois · Engagement annuel · Setup gratuit · RGPD
          </p>

          {/* Mockup hero */}
          <div className="mt-16 lg:mt-20">
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ───────────────────────── SOURCES ───────────────────────── */}
      <SourcesMarquee />

      {/* ───────────────────────── STATS PRODUIT ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Mesuré en production"
            title="Des chiffres, pas des promesses."
            description="Données réelles du moteur iFIND mesurées sur les 30 derniers jours en production."
          />

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-8 max-w-5xl mx-auto">
            {STATS_PRODUIT.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.08}>
                <div className="text-center">
                  <div className="font-display text-4xl md:text-5xl font-semibold text-ink-900 tracking-tight tabular-nums">
                    {s.value}
                  </div>
                  <p className="mt-3 text-sm font-medium text-ink-700">{s.label}</p>
                  <p className="text-xs text-ink-500 mt-0.5">{s.sub}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── PROBLEM / SOLUTION ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Le problème"
            title={<>Vos commerciaux passent <span className="text-ink-500">12 h par semaine</span> à filtrer.</>}
            description="80 % du temps en B2B est consacré à trier des prospects. iFIND inverse l'équation : on filtre, vos commerciaux closent."
          />

          <div className="mt-16 max-w-5xl mx-auto">
            <BeforeAfter />
          </div>
        </div>
      </section>

      {/* ───────────────────────── FEATURE 1 — DÉTECTION ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            eyebrow="01 · Détection"
            title={<>11 sources publiques françaises, scannées 24/7.</>}
            description="Le moteur agrège en continu les données publiques les plus riches sur le marché français : annonces commerciales BODACC, dépôts INPI, financiers Pappers, offres tech France Travail, levées de fonds, jobs LinkedIn, et plus encore."
            bullets={[
              "9 sources actives + 2 sources premium (intent data + tech stack)",
              "Attribution SIRENE Pappers automatique sur chaque signal",
              "Déduplication cross-source par SIRET unique",
              "Latence détection → dashboard inférieure à 5 minutes",
            ]}
            visual={<LiveFeed />}
          />
        </div>
      </section>

      {/* ───────────────────────── FEATURE 2 — QUALIFICATION ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            eyebrow="02 · Qualification IA"
            title={<>Cerveau Claude Opus 4.7 avec votre ICP en contexte.</>}
            description="Chaque signal est analysé avec 12 blocs de contexte (persona, santé entreprise, news, signaux négatifs, ICP enrichi). Verdict OUI/NON/ENRICH avec score 0-10, raison détaillée, et brief sur-mesure prêt à utiliser."
            bullets={[
              "Score 0-10 avec raison explicite — jamais de boîte noire",
              "Brief en 5 sections : contexte, signal, angle, pitch, objections",
              "Précision 95 % en V2 (vs 80 % avec un scoring classique)",
              "Anti-hallucination : tous les faits sont vérifiés contre la source",
            ]}
            visual={<BriefMockup />}
            reverse
          />
        </div>
      </section>

      {/* ───────────────────────── 3 PILIERS ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Pourquoi iFIND"
            title="Pas une base de données. Un engagement."
            description="iFIND est le seul moteur français qui combine détection temps réel, qualification IA, et garantie qualité contractuelle."
          />

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-px bg-ink-200 rounded-xl overflow-hidden border border-ink-200 max-w-5xl mx-auto">
            <Pillar
              icon={<Brain className="h-5 w-5" />}
              title="Intelligence"
              description="Claude Opus 4.7 + 12 blocs de contexte. Chaque lead est analysé comme par un commercial senior, pas par un keyword match."
            />
            <Pillar
              icon={<Shield className="h-5 w-5" />}
              title="Garantie"
              description="6 Pépites minimum par mois. Engagement contractuel — si on ne tient pas, votre quota du mois suivant est doublé."
              highlight
            />
            <Pillar
              icon={<Zap className="h-5 w-5" />}
              title="Temps réel"
              description="11 sources scannées 24/7. Vous recevez les signaux quand ils sont chauds, pas après le batch nocturne."
            />
          </div>
        </div>
      </section>

      {/* ───────────────────────── COMPARATOR ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Comparaison marché"
            title={<>iFIND vs <span className="text-ink-400">les autres</span>.</>}
            description="Les outils de prospection FR vendent de la donnée brute. Les outils US n'ont pas la couverture FR. iFIND est le seul à combiner les trois piliers."
          />

          <div className="mt-12 max-w-5xl mx-auto">
            <div className="rounded-xl border border-ink-200 overflow-hidden bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-ink-50 border-b border-ink-200">
                    <tr>
                      <th className="text-left py-4 px-5 font-medium text-ink-600 text-xs uppercase tracking-wider"></th>
                      <th className="text-center py-4 px-4 font-display font-semibold text-brand-700 bg-brand-50/40">iFIND</th>
                      <th className="text-center py-4 px-4 font-medium text-ink-600">Pharow</th>
                      <th className="text-center py-4 px-4 font-medium text-ink-600">Cognism</th>
                      <th className="text-center py-4 px-4 font-medium text-ink-600">Apollo</th>
                      <th className="text-center py-4 px-4 font-medium text-ink-600">Société.info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {COMPARISON.map(([feature, ...values], i) => (
                      <tr key={i}>
                        <td className="py-3.5 px-5 text-ink-700 text-[14px]">{feature}</td>
                        {values.map((v, j) => (
                          <Cell key={j} value={v} highlight={j === 0} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── COMMENT ÇA MARCHE ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Démarrage"
            title="Vos premières Pépites en 48 heures."
            description="Setup en 5 minutes, première détection sous 48 heures, Pépites livrées en continu."
          />

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {STEPS.map((s, i) => (
              <div key={i} className="bg-white rounded-xl p-7 border border-ink-200">
                <div className="flex items-center gap-2 mb-5">
                  <span className="font-display text-xs font-semibold text-brand-700 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{s.time}</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-ink-900 mb-2">{s.title}</h3>
                <p className="text-sm text-ink-600 leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── CTA FINAL ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl bg-brand-950 text-white px-8 py-14 md:px-14 md:py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Prêt à recevoir vos premières Pépites&nbsp;?
            </h2>
            <p className="mt-5 text-base md:text-lg text-ink-300 max-w-xl mx-auto leading-relaxed">
              Setup en 5 minutes. Premières détections sous 48 heures. Garantie
              6 Pépites le premier mois ou quota doublé.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/tarifs"
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white text-ink-900 hover:bg-ink-100 font-medium px-5 h-11 text-sm"
              >
                Voir les tarifs · 390 €/mois
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/produit"
                className="inline-flex items-center justify-center gap-1.5 rounded-md text-ink-300 hover:text-white font-medium px-5 h-11 text-sm"
              >
                Comment ça marche
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Pillar({ icon, title, description, highlight }: { icon: React.ReactNode; title: string; description: string; highlight?: boolean }) {
  return (
    <div className={`p-8 ${highlight ? "bg-brand-50/40" : "bg-white"}`}>
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-md mb-5 ${highlight ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700"}`}>
        {icon}
      </div>
      <h3 className="font-display text-lg font-semibold text-ink-900 mb-2.5">{title}</h3>
      <p className="text-sm text-ink-600 leading-relaxed">{description}</p>
    </div>
  );
}

function Cell({ value, highlight }: { value: boolean | string; highlight?: boolean }) {
  return (
    <td className={`text-center py-3.5 px-4 ${highlight ? "bg-brand-50/40" : ""}`}>
      {typeof value === "boolean" ? (
        value ? (
          <Check className={`h-4 w-4 mx-auto ${highlight ? "text-brand-700" : "text-emerald-600"}`} strokeWidth={3} />
        ) : (
          <span className="text-ink-300 text-sm">—</span>
        )
      ) : (
        <span className={`inline-block font-mono text-xs ${highlight ? "font-semibold text-brand-800" : "text-ink-600"}`}>{value}</span>
      )}
    </td>
  );
}

const COMPARISON: Array<[string, ...(boolean | string)[]]> = [
  ["Données 100 % françaises", true, true, false, false, true],
  ["Détection temps réel multi-sources", true, false, false, false, false],
  ["Qualification IA Claude Opus 4.7", true, false, false, false, false],
  ["Garantie qualité contractuelle", true, false, false, false, false],
  ["Brief sur-mesure par lead", true, false, false, false, false],
  ["Rollover crédits inutilisés", true, false, false, false, false],
  ["Setup ICP custom inclus", true, false, false, false, false],
  ["Conforme RGPD by design", true, true, true, false, true],
  ["Tarif starter", "390 €/mo", "139 €/mo", "$1500/an", "$49/user", "50 €/mo"],
];

const STEPS = [
  {
    title: "Configurez votre ICP",
    time: "5 minutes",
    description: "Wizard guidé : industrie, taille, signaux préférés, anti-personas. Setup et tuning offerts par notre équipe.",
  },
  {
    title: "Le moteur scanne 24/7",
    time: "Automatique",
    description: "Triggers détectés en temps réel, qualifiés par Opus 4.7, enrichis (email, téléphone, LinkedIn vérifiés).",
  },
  {
    title: "Recevez vos Pépites",
    time: "48 heures",
    description: "Dashboard temps réel, alertes Telegram instantanées, briefs Opus prêts à utiliser. Vos commerciaux closent.",
  },
];
