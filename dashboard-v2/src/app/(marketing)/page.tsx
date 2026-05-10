import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Shield, Zap, Brain } from "lucide-react";
import { DashboardMockup } from "./_components/dashboard-mockup";
import { SourcesMarquee } from "./_components/sources-marquee";
import { BeforeAfter } from "./_components/before-after";
import { FeatureShowcase } from "./_components/feature-showcase";
import { LiveFeed } from "./_components/live-feed";
import { BriefMockup } from "./_components/brief-mockup";
import { SectionHeading } from "./_components/section-heading";
import { AnimatedStat } from "./_components/animated-stat";
import { SignalDetectionIllu, AIQualifyIllu, GuaranteeIllu } from "./_components/signature-illustrations";
import { MagneticLink } from "./_components/magnetic-button";
import { UseCasesGrid } from "./_components/use-cases-grid";
import { IntegrationsGrid } from "./_components/integrations-grid";
import { ResourcesTeaser } from "./_components/resources-teaser";
import { STATS_PRODUIT } from "./_components/_data/mock-companies";

export const metadata: Metadata = {
  title: "iFIND — Détection de signaux d'achat sur les PME françaises",
  description:
    "Le moteur français de détection de signaux d'achat. 11 sources publiques scannées 24/7, qualification IA propriétaire, garantie 6 Pépites par mois.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative pt-20 pb-24 md:pt-28 md:pb-32 overflow-hidden">
        {/* Soft brand glow décoratif sous le mockup — pas de drama, juste un halo subtil */}
        <div className="absolute inset-x-0 top-[60%] -z-0 pointer-events-none">
          <div className="mx-auto h-[400px] max-w-5xl rounded-full bg-brand-200/30 blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
          {/* Badge live — pop subtil */}
          <div className="flex justify-center mb-8">
            <Link
              href="/produit#garantie"
              className="group inline-flex items-center gap-2 pl-2 pr-3 h-7 rounded-full bg-white border border-ink-200 shadow-sm text-xs font-medium text-ink-700 hover:border-brand-200 hover:shadow-md transition-all"
            >
              <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold uppercase tracking-wider border border-emerald-100">
                <span className="relative flex h-1 w-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1 w-1 bg-emerald-500" />
                </span>
                Live
              </span>
              <span>Garantie contractuelle 6 Pépites par mois</span>
              <ArrowRight className="h-3 w-3 text-ink-400 group-hover:text-brand-700 group-hover:translate-x-0.5 transition-all" />
            </Link>
          </div>

          {/* Headline sobre */}
          <h1 className="text-center font-display text-4xl sm:text-5xl md:text-6xl lg:text-[64px] font-semibold text-ink-900 tracking-tight leading-[1.05] max-w-4xl mx-auto">
            Trouvez les boîtes FR{" "}
            <span className="bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent">au moment où elles signent</span>.
          </h1>

          <p className="mt-6 text-center text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            iFIND détecte les signaux d&apos;achat sur les PME françaises en temps réel,
            les qualifie avec une IA propriétaire, et garantit 6 Pépites par mois minimum.
          </p>

          {/* CTA */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <MagneticLink href="/tarifs">
              <span className="group inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium px-5 h-11 text-sm shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/30">
                Voir les tarifs
                <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </MagneticLink>
            <MagneticLink href="/produit" strength={4}>
              <span className="group inline-flex items-center justify-center gap-1.5 rounded-md bg-white hover:bg-ink-50 text-ink-700 hover:text-ink-900 font-medium px-5 h-11 text-sm border border-ink-200 hover:border-ink-300">
                Comment ça marche
                <ArrowRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </span>
            </MagneticLink>
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
            {STATS_PRODUIT.map((s) => (
              <AnimatedStat key={s.label} value={s.value} label={s.label} sublabel={s.sub} />
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── PROBLEM / SOLUTION ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Le problème"
            title={<>80&nbsp;% du temps perdu <span className="text-ink-500">à trier des prospects</span>.</>}
            description="iFIND inverse l'équation : on filtre, vos commerciaux closent. Vous gagnez 12 heures par semaine et par commercial."
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
            title={<>Une IA qui pense comme votre commercial senior.</>}
            description="Chaque signal est analysé avec 12 blocs de contexte (persona, santé entreprise, news, signaux négatifs, votre ICP). Verdict OUI/NON/ENRICH avec score 0-10, raison détaillée, et brief sur-mesure prêt à utiliser."
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

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            <Pillar
              icon={<Brain className="h-5 w-5" />}
              illustration={<AIQualifyIllu />}
              title="Intelligence"
              description="IA propriétaire + 12 blocs de contexte. Chaque lead est analysé comme par un commercial senior, pas par un keyword match."
            />
            <Pillar
              icon={<Shield className="h-5 w-5" />}
              illustration={<GuaranteeIllu />}
              title="Garantie"
              description="6 Pépites minimum par mois. Engagement contractuel — si on ne tient pas, votre quota du mois suivant est doublé."
              highlight
            />
            <Pillar
              icon={<Zap className="h-5 w-5" />}
              illustration={<SignalDetectionIllu />}
              title="Temps réel"
              description="11 sources scannées 24/7. Vous recevez les signaux quand ils sont chauds, pas après le batch nocturne."
            />
          </div>
        </div>
      </section>

      {/* ───────────────────────── MANIFESTO BREAK (full-bleed dark) ───────────────────────── */}
      <section className="relative py-32 md:py-40 bg-brand-950 text-white overflow-hidden">
        {/* Ambient gradients */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1400px] h-[700px] rounded-full bg-brand-700/20 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-[600px] h-[400px] rounded-full bg-brand-600/15 blur-3xl" />
          <div className="absolute top-0 left-1/4 w-[400px] h-[400px] rounded-full bg-brand-500/10 blur-3xl" />
        </div>

        {/* Grid texture subtile */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.04] pointer-events-none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <pattern id="manifesto-grid" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M 56 0 L 0 0 0 56" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#manifesto-grid)" />
        </svg>

        {/* Quote marks géantes en background */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-display text-[400px] md:text-[600px] leading-none text-white/[0.03] select-none -translate-y-12">&ldquo;</span>
        </div>

        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-brand-300 mb-8">
            Le pari iFIND
          </p>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            Une promesse{" "}
            <span className="bg-gradient-to-br from-brand-200 via-brand-300 to-brand-400 bg-clip-text text-transparent">mesurable</span>{" "}
            bat
            <br className="hidden md:inline" />{" "}
            un fichier de 50&nbsp;000 contacts froids.
          </h2>
          <p className="mt-10 text-base md:text-lg text-ink-300 max-w-2xl mx-auto leading-relaxed">
            Plutôt que vendre du volume, on s&apos;engage sur la qualité.
            Si on ne livre pas, on rembourse en quota doublé.
            <br />
            <span className="text-ink-400">C&apos;est écrit dans nos CGV.</span>
          </p>

          {/* Decorative line */}
          <div className="mt-16 mx-auto w-12 h-px bg-gradient-to-r from-transparent via-brand-300 to-transparent" />
        </div>
      </section>

      {/* ───────────────────────── DIFFÉRENCIATEURS ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Différenciateurs"
            title="Comment iFIND est différent."
            description="Les autres outils vendent une base de données ou un fichier de leads. iFIND vend un engagement mesurable sur la qualité."
          />

          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl mx-auto">
            {DIFFERENCIATEURS.map((d) => (
              <div key={d.title} className="rounded-2xl bg-white border border-ink-200 p-7 hover:border-brand-200 hover:shadow-md transition-all">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="font-mono text-xs text-brand-700 font-semibold tabular-nums">{d.num}</span>
                  <h3 className="font-display text-lg font-semibold text-ink-900">{d.title}</h3>
                </div>
                <p className="text-sm text-ink-600 leading-relaxed mb-3">{d.description}</p>
                <p className="text-xs text-ink-500 italic border-l-2 border-brand-200 pl-3">{d.contraste}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── CAS D'USAGE PAR PERSONA ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Cas d'usage"
            title="Vos signaux d'achat, par métier."
            description="iFIND configure votre cerveau IA selon votre ICP et les patterns d'achat propres à votre marché."
          />

          <div className="mt-16 max-w-6xl mx-auto">
            <UseCasesGrid />
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/cas-d-usage"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 link-underline"
            >
              Voir tous les cas d&apos;usage en détail
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────────────── INTÉGRATIONS ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Intégrations"
            title="Branche iFIND à ta stack en 5 minutes."
            description="Webhook + API + alertes natives sur Telegram et Slack. Connecté aussi à votre CRM, agenda et automatisation."
          />

          <div className="mt-16 max-w-6xl mx-auto">
            <IntegrationsGrid />
          </div>

          <p className="mt-10 text-center text-xs text-ink-500">
            13 intégrations natives ou via Zapier/Make · API REST documentée disponible
          </p>
        </div>
      </section>

      {/* ───────────────────────── ACADEMY/TEMPLATES TEASER ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="Ressources"
            title="Maîtrisez la prospection IA française."
            description="Academy, templates de briefs, scripts d'appel, études de cas — réservés aux clients iFIND."
          />

          <div className="mt-16 max-w-5xl mx-auto">
            <ResourcesTeaser />
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/ressources"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 link-underline"
            >
              Voir toutes les ressources
              <ArrowRight className="h-4 w-4" />
            </Link>
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

          <div className="mt-16 max-w-5xl mx-auto relative">
            {/* Connecteur horizontal pointillé desktop */}
            <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px border-t border-dashed border-brand-300/60 -z-0" />

            <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
              {STEPS.map((s, i) => (
                <div key={i} className="bg-white rounded-xl p-7 border border-ink-200 hover:border-brand-200 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white font-display font-semibold text-sm tabular-nums shadow-md">
                      {i + 1}
                    </div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 bg-ink-50 px-2 py-0.5 rounded-md font-mono">{s.time}</span>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-ink-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-ink-600 leading-relaxed">{s.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── CTA FINAL ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl bg-brand-950 text-white px-8 py-14 md:px-14 md:py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Vos premières Pépites sous 48&nbsp;heures.
            </h2>
            <p className="mt-5 text-base md:text-lg text-ink-300 max-w-xl mx-auto leading-relaxed">
              Setup en 5 minutes. 6 Pépites garanties le premier mois — sinon quota doublé.
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

function Pillar({ icon, illustration, title, description, highlight }: { icon: React.ReactNode; illustration?: React.ReactNode; title: string; description: string; highlight?: boolean }) {
  if (highlight) {
    return (
      <div className="relative rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 text-white p-8 shadow-xl shadow-brand-500/20 md:-translate-y-2 overflow-hidden">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-white text-brand-800 text-[10px] font-bold uppercase tracking-wider shadow-sm border border-brand-100 z-10">
          Unique en France
        </div>
        {illustration && (
          <div className="-mx-4 -mt-2 mb-5 opacity-90">
            {illustration}
          </div>
        )}
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-md mb-5 bg-white/15 backdrop-blur-sm border border-white/20 text-white">
          {icon}
        </div>
        <h3 className="font-display text-xl font-semibold mb-2.5">{title}</h3>
        <p className="text-sm text-brand-100 leading-relaxed">{description}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-white border border-ink-200 p-8 hover:border-brand-200 hover:shadow-md transition-all overflow-hidden">
      {illustration && (
        <div className="-mx-4 -mt-2 mb-5">
          {illustration}
        </div>
      )}
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-md mb-5 bg-brand-50 text-brand-700 border border-brand-100">
        {icon}
      </div>
      <h3 className="font-display text-lg font-semibold text-ink-900 mb-2.5">{title}</h3>
      <p className="text-sm text-ink-600 leading-relaxed">{description}</p>
    </div>
  );
}

const DIFFERENCIATEURS = [
  {
    num: "01",
    title: "Détection temps réel, pas batch nocturne",
    description: "Le moteur scanne 11 sources publiques en continu. Vous recevez les signaux quand ils sont chauds — pas 24 h après le crawl quotidien.",
    contraste: "Les bases de données classiques rafraîchissent les données mensuellement, voire trimestriellement.",
  },
  {
    num: "02",
    title: "Qualification IA contextuelle, pas filtres bruts",
    description: "Chaque signal passe par 12 blocs de contexte (persona, santé entreprise, news, signaux négatifs, votre ICP). Verdict OUI/NON/ENRICH avec brief sur-mesure.",
    contraste: "Les outils traditionnels livrent un fichier filtré par taille/industrie — vous re-triez 500 leads pour en sortir 5.",
  },
  {
    num: "03",
    title: "Garantie contractuelle, pas best effort",
    description: "6 Pépites minimum par mois (score IA ≥ 8/10). Si on ne tient pas, votre quota du mois suivant est doublé. C'est écrit dans les CGV.",
    contraste: "Aucun autre outil ne s'engage contractuellement sur la qualité des leads livrés. Vous payez pour de l'accès, pas pour un résultat.",
  },
  {
    num: "04",
    title: "Brief sur-mesure, pas juste des contacts",
    description: "Chaque Pépite arrive avec contexte, signal d'achat détecté, angle d'attaque suggéré, pitch prêt à utiliser, et anticipation des objections.",
    contraste: "Les autres outils livrent un email + un téléphone — vos commerciaux écrivent leur copie depuis zéro.",
  },
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
    description: "Triggers détectés en temps réel, qualifiés par notre IA, enrichis (email, téléphone, LinkedIn vérifiés).",
  },
  {
    title: "Recevez vos Pépites",
    time: "48 heures",
    description: "Dashboard temps réel, alertes Telegram instantanées, briefs IA prêts à utiliser. Vos commerciaux closent.",
  },
];
