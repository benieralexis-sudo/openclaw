import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, Sparkles, Zap, Brain, Shield, Database, TrendingUp } from "lucide-react";
import { DashboardMockup } from "./_components/dashboard-mockup";
import { AnimatedStat } from "./_components/animated-stat";
import { SourcesMarquee } from "./_components/sources-marquee";
import { BeforeAfter } from "./_components/before-after";
import { TestimonialGrid } from "./_components/testimonial-grid";
import { FeatureShowcase } from "./_components/feature-showcase";
import { BriefMockup } from "./_components/brief-mockup";
import { LiveFeed } from "./_components/live-feed";
import { IntelligenceIllustration, GarantieIllustration, TempsReelIllustration } from "./_components/pillar-illustrations";

export const metadata: Metadata = {
  title: "iFIND — Détectez les boîtes FR qui ont besoin de vous",
  description:
    "Le moteur de détection de signaux d'achat sur les PME françaises. 11 sources publiques, qualification IA Opus 4.7, garantie 6 Pépites/mois.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <div className="bg-white overflow-hidden">
      {/* ════════════════════════════════════════════════════════════
          1 — HERO ULTRA dramatique (style Linear/Vercel)
          ═══════════════════════════════════════════════════════════ */}
      <section className="relative pt-12 pb-20 overflow-hidden">
        {/* Ambient background : mesh + grid + glows multi-layer */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/40 via-white to-white" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1600px] h-[800px] bg-gradient-radial from-brand-300/40 via-transparent to-transparent blur-3xl" />
          <div className="absolute top-40 right-[10%] w-[600px] h-[600px] bg-gradient-radial from-amber-200/40 via-transparent to-transparent blur-3xl" />
          <div className="absolute top-80 left-[5%] w-[500px] h-[500px] bg-gradient-radial from-brand-200/35 via-transparent to-transparent blur-3xl" />
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="hero-grid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
          {/* Live badge animated */}
          <div className="flex justify-center mb-8">
            <div className="group inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-amber-200 shadow-sm text-xs font-medium text-amber-800 hover:shadow-md hover:scale-105 transition-all cursor-default">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
              </span>
              <Sparkles className="h-3.5 w-3.5" />
              <span>Nouveau · Garantie contractuelle 6 Pépites/mois</span>
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* Headline gigantesque centré */}
          <h1 className="text-center font-display text-[2.75rem] sm:text-6xl md:text-7xl lg:text-[6rem] xl:text-[7rem] font-bold text-ink-900 tracking-[-0.03em] leading-[0.95] max-w-6xl mx-auto">
            Les boîtes françaises qui
            <br />
            <span className="relative inline-block mt-3">
              <span className="relative bg-gradient-to-r from-brand-600 via-brand-700 to-brand-900 bg-clip-text text-transparent">
                ont besoin de vous
              </span>
              <svg className="absolute -bottom-3 left-0 w-full" height="16" viewBox="0 0 200 14" fill="none" preserveAspectRatio="none">
                <path d="M2 11 Q 50 4, 100 8 T 198 6" stroke="url(#u1)" strokeWidth="4" strokeLinecap="round" fill="none" />
                <defs>
                  <linearGradient id="u1" x1="0" x2="200" y1="0" y2="0">
                    <stop offset="0" stopColor="#f59e0b" />
                    <stop offset="1" stopColor="#2563eb" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <br />
            <span className="text-ink-700 font-medium">livrées chaque mois.</span>
          </h1>

          <p className="mt-10 text-center text-lg md:text-xl text-ink-600 max-w-3xl mx-auto leading-relaxed">
            Le seul moteur français qui combine{" "}
            <span className="text-ink-900 font-semibold">détection temps réel</span>,{" "}
            <span className="text-ink-900 font-semibold">qualification IA Claude Opus 4.7</span>,
            et <span className="text-amber-700 font-bold">garantie contractuelle de 6 boîtes ULTRA chaudes</span> par mois.
          </p>

          {/* CTA buttons */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/tarifs" className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white font-semibold px-8 py-4 text-base shadow-xl shadow-brand-500/30 hover:shadow-2xl hover:shadow-brand-500/50 hover:-translate-y-0.5 transition-all overflow-hidden">
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <span className="relative">Voir les tarifs · 390€/mois</span>
              <ArrowRight className="relative h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/produit" className="group inline-flex items-center gap-2 rounded-xl bg-white text-ink-700 hover:text-ink-900 hover:bg-ink-50 font-semibold px-7 py-4 text-base border border-ink-200 hover:border-ink-300 transition-all">
              Voir le produit
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          {/* Trust badges */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs text-ink-500">
            {[
              "Setup 100% gratuit",
              "6 Pépites/mois garanties",
              "Engagement annuel",
              "RGPD compliant",
              "Made in France 🇫🇷",
            ].map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                {t}
              </div>
            ))}
          </div>

          {/* Hero mockup avec vrai relief */}
          <div className="mt-20 relative">
            {/* Glow derrière le mockup */}
            <div className="absolute -inset-x-20 -inset-y-10 -z-10">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-radial from-brand-400/30 via-transparent to-transparent blur-3xl" />
            </div>
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          2 — SOURCES MARQUEE
          ═══════════════════════════════════════════════════════════ */}
      <SourcesMarquee />

      {/* ════════════════════════════════════════════════════════════
          3 — STATS MASSIVES animées
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Mesuré en production</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Des chiffres qui parlent
            </h2>
            <p className="mt-3 text-ink-600 max-w-xl mx-auto">
              Données réelles du bot iFIND DTL sur les 30 derniers jours.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
            <AnimatedStat value={11} label="Sources françaises" sublabel="croisées 24/7" />
            <AnimatedStat value={18} label="Pépites/mois" sublabel="livrées en moyenne" />
            <AnimatedStat value={95} suffix="%" label="Précision Cerveau V2" sublabel="vs 80% V1" />
            <AnimatedStat value={48} suffix="h" label="Premières Pépites" sublabel="après onboarding" />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          4 — PROBLÈME / SOLUTION (Before/After)
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-gradient-to-b from-white via-rose-50/20 to-brand-50/30">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10 max-w-3xl mx-auto">
            <p className="text-xs uppercase tracking-[0.2em] text-rose-600 font-bold mb-3">Le problème</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900 leading-[1.1]">
              Vos commerciaux perdent
              <br />
              <span className="text-rose-600">12h par semaine</span> à chercher
            </h2>
            <p className="mt-4 text-ink-600 text-lg">
              Vous le savez : la prospection B2B en France, c&apos;est 80% de tri et 20% de vente.
              On a inversé la formule.
            </p>
          </div>
          <BeforeAfter />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          5 — FEATURE SHOWCASE 1 : Détection temps réel
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            badge="01 — Détection"
            title={<>11 sources françaises <span className="text-brand-600">en temps réel</span></>}
            description="Le moteur scanne 24/7 les sources publiques françaises les plus riches : annonces commerciales BODACC, dépôts INPI, financiers Pappers, offres tech France Travail, levées de fonds RSS, jobs LinkedIn et bien plus. Croisé par SIRET, dédupliqué automatiquement."
            bullets={[
              "9 sources actives (BODACC, INPI, Pappers, France Travail, LinkedIn jobs, WTTJ, JOAFE, RSS Tech FR)",
              "Bonus : 2 sources premium (intent data B2B + tech stack discovery)",
              "Attribution SIRENE Pappers automatique sur chaque trigger",
              "Dédup intelligente cross-source (zéro doublon)",
            ]}
            visual={<LiveFeed />}
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          6 — FEATURE SHOWCASE 2 : Brief Opus
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-gradient-to-b from-white to-brand-50/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            badge="02 — Qualification IA"
            title={<>Cerveau Opus 4.7 <span className="text-brand-600">avec votre ICP en contexte</span></>}
            description="Chaque trigger est analysé par notre cerveau IA propriétaire (12 blocs de contexte : persona, company health, cross-tenant, news, signaux négatifs…). Verdict OUI/NON/ENRICH avec score 0-10, raison détaillée, et brief sur-mesure prêt à utiliser par votre commercial."
            bullets={[
              "Score Opus 0-10 avec raison explicite (jamais une boîte noire)",
              "Brief en 5 paragraphes : contexte, signal, angle, pitch, objections",
              "Précision 95-97% en V2 (vs 80% en scoring classique)",
              "Anti-hallucination : 12 blocs de contexte vérifiés avant verdict",
            ]}
            visual={<BriefMockup />}
            reverse
            accent="brand"
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          7 — POURQUOI iFIND DIFFÉRENT (3 piliers)
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10 max-w-3xl mx-auto">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Pourquoi iFIND</p>
            <h2 className="font-display text-4xl md:text-6xl font-bold text-ink-900 leading-[1.1]">
              Pas un fichier de leads.
              <br />
              <span className="bg-gradient-to-r from-amber-500 to-amber-700 bg-clip-text text-transparent">Une assurance qualité.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <PillarCard
              icon={<Brain className="h-6 w-6" />}
              illustration={<IntelligenceIllustration />}
              title="Intelligence"
              description="Cerveau Opus 4.7 + 12 blocs de contexte. Chaque lead est analysé comme par un commercial senior, pas par un keyword match."
              accent="brand"
            />
            <PillarCard
              icon={<Shield className="h-6 w-6" />}
              illustration={<GarantieIllustration />}
              title="Garantie"
              description="6 Pépites minimum/mois — engagement contractuel. Si on tient pas, votre quota est doublé. Personne d'autre ne fait ça."
              accent="amber"
              highlight
            />
            <PillarCard
              icon={<Zap className="h-6 w-6" />}
              illustration={<TempsReelIllustration />}
              title="Temps réel"
              description="11 sources scannées 24/7. Vous recevez les Pépites quand elles sont chaudes — pas quand elles sont passées au scoring batch."
              accent="brand"
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          8 — COMPARATOR DRAMATIQUE
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-ink-950 text-white relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] bg-gradient-radial from-amber-500/20 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-400 font-bold mb-3">Comparaison marché</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
              Comparé à <span className="text-ink-500 line-through">vos outils actuels</span>
            </h2>
            <p className="text-ink-400 max-w-xl mx-auto">
              Le seul outil français qui combine détection, qualification IA et garantie qualité.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <CompCard name="Société.info / Manageo" tagline="Données SIRENE brutes" price="50-300€/mo" pros={["Données françaises"]} cons={["Aucune IA", "Aucun signal temps réel", "Vous triez 500 prospects"]} />
            <CompCard name="Pharow" tagline="Données + enrichissement" price="139-500€/mo" pros={["Données FR", "Email enrichi"]} cons={["Aucune IA de qualif", "Aucune garantie", "Aucun brief"]} />
            <CompCard name="iFIND" tagline="Détection + IA + Garantie" price="390€/mo annuel" pros={["11 sources temps réel", "Cerveau Opus 4.7", "6 Pépites garanties", "Brief sur-mesure inclus", "Setup ICP gratuit"]} cons={[]} highlight />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          9 — TÉMOIGNAGES (3 cards)
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-gradient-to-b from-white to-amber-50/30">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10 max-w-3xl mx-auto">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Ils utilisent iFIND</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Le verdict de nos clients
            </h2>
          </div>
          <TestimonialGrid />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          10 — COMMENT CA MARCHE (3 steps)
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Démarrage</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Vos premières Pépites en <span className="text-brand-600">48h chrono</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-12 left-[18%] right-[18%] h-0.5 bg-gradient-to-r from-brand-300 via-brand-500 to-amber-400" />
            {[
              { t: "Configurez votre ICP", d: "Wizard guidé en 5 minutes : industrie, taille, signaux préférés, anti-personas. Setup et tuning offerts par notre équipe.", time: "5 min" },
              { t: "On scanne 11 sources FR 24/7", d: "Triggers détectés en temps réel + qualifiés par Opus 4.7 + enrichis (email, phone, LinkedIn vérifiés).", time: "Auto" },
              { t: "Recevez vos Pépites", d: "Dashboard temps réel + alertes Telegram instantanées + briefs Opus prêts à utiliser. Vos commerciaux closent.", time: "48h" },
            ].map((s, i) => (
              <div key={i} className="relative bg-white rounded-2xl p-7 border border-ink-100 hover:border-brand-200 hover:shadow-xl transition-all z-10">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-display font-bold text-lg shadow-lg shadow-brand-500/30">
                    0{i + 1}
                  </div>
                  <span className="text-xs font-mono text-ink-400 bg-ink-50 px-2 py-1 rounded">{s.time}</span>
                </div>
                <h3 className="font-display text-xl font-bold text-ink-900 mb-2">{s.t}</h3>
                <p className="text-sm text-ink-600 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          11 — PRICING TEASER
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-ink-50/50">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="relative bg-gradient-to-b from-white to-brand-50/20 rounded-3xl border-2 border-brand-200 shadow-2xl overflow-hidden">
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-brand-600 via-brand-700 to-brand-800 text-white text-xs font-bold uppercase tracking-wider px-6 py-2.5 flex items-center justify-center gap-2">
              <Sparkles className="h-3 w-3" />
              Une seule offre · Pas de tier confus
              <Sparkles className="h-3 w-3" />
            </div>
            <div className="p-12 pt-16 text-center">
              <h2 className="font-display text-3xl font-bold text-ink-900 mb-2">iFIND Growth</h2>
              <p className="text-sm text-ink-500 mb-6">Conçu pour PME tech FR 30-200 personnes</p>
              <div className="flex items-baseline justify-center gap-2 mb-2">
                <span className="font-display text-7xl font-bold bg-gradient-to-br from-ink-900 via-brand-800 to-brand-700 bg-clip-text text-transparent">390€</span>
                <span className="text-ink-600 text-xl">/mois</span>
              </div>
              <p className="text-sm text-ink-500 mb-10">Engagement annuel · 4 680€ HT/an · Setup gratuit</p>
              <div className="flex items-center justify-center gap-5 text-sm font-medium text-ink-700 mb-10 flex-wrap">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" />60 leads/mois</span>
                <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" />6 Pépites garanties</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" />Rollover 4 mois</span>
              </div>
              <Link href="/tarifs" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white font-semibold px-8 py-4 shadow-xl shadow-brand-500/30 hover:shadow-2xl transition-all">
                Voir le détail des tarifs
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          12 — CTA FINAL
          ═══════════════════════════════════════════════════════════ */}
      <section className="relative bg-ink-950 text-white overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-gradient-radial from-amber-500/20 via-transparent to-transparent blur-3xl" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid2" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid2)" />
        </svg>
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-20 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-200 text-xs font-medium mb-8 backdrop-blur-sm">
            <Sparkles className="h-3 w-3" />
            48h pour vos premières Pépites
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold mb-6 tracking-tight leading-[1.0]">
            Prêt à recevoir vos
            <br />
            <span className="text-amber-300 drop-shadow-[0_0_30px_rgba(251,191,36,0.4)]">
              premières Pépites&nbsp;?
            </span>
          </h2>
          <p className="text-ink-300 text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
            Setup en 5 minutes. Premières détections sous 48h.
            Garantie 6 Pépites le premier mois ou quota doublé.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/tarifs" className="group inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-10 py-5 text-lg shadow-2xl shadow-brand-500/30 transition-all">
              Démarrer maintenant
              <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/produit" className="inline-flex items-center gap-2 text-ink-300 hover:text-white font-semibold px-6 py-5 transition-all">
              Voir le produit en détail
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function PillarCard({ icon, illustration, title, description, accent, highlight }: { icon: React.ReactNode; illustration?: React.ReactNode; title: string; description: string; accent: "brand" | "amber"; highlight?: boolean }) {
  return (
    <div className={`relative rounded-2xl p-8 transition-all overflow-hidden ${highlight ? "bg-gradient-to-br from-amber-50 via-white to-amber-50 border-2 border-amber-300 shadow-2xl shadow-amber-500/10 md:-translate-y-2" : "bg-white border border-ink-100 hover:border-brand-200 hover:shadow-xl hover:-translate-y-1"}`}>
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-amber-500/30">
          Unique en France
        </div>
      )}
      {/* Illustration custom SVG en haut */}
      {illustration && (
        <div className="mb-5 -mx-3 h-32 flex items-center justify-center">
          {illustration}
        </div>
      )}
      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4 ${accent === "amber" ? "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/30" : "bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-500/30"}`}>
        {icon}
      </div>
      <h3 className="font-display text-2xl font-bold text-ink-900 mb-3">{title}</h3>
      <p className="text-ink-600 leading-relaxed">{description}</p>
    </div>
  );
}

interface CompProps {
  name: string;
  tagline: string;
  price: string;
  pros: string[];
  cons: string[];
  highlight?: boolean;
}

function CompCard({ name, tagline, price, pros, cons, highlight }: CompProps) {
  return (
    <div className={`relative rounded-2xl p-6 transition-all ${highlight ? "bg-gradient-to-br from-brand-600 to-brand-800 border-2 border-brand-400 shadow-2xl shadow-brand-500/30 -translate-y-2" : "bg-ink-900/50 border border-ink-800 backdrop-blur-sm hover:border-ink-700"}`}>
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg">
          Notre offre
        </div>
      )}
      <div className="flex items-baseline justify-between mb-2">
        <h3 className={`font-display text-xl font-bold ${highlight ? "text-white" : "text-ink-200"}`}>{name}</h3>
      </div>
      <p className={`text-xs mb-1 ${highlight ? "text-brand-100" : "text-ink-500"}`}>{tagline}</p>
      <p className={`text-xs font-mono mb-5 ${highlight ? "text-brand-200" : "text-ink-500"}`}>{price}</p>
      <ul className="space-y-2 text-sm">
        {pros.map((p, i) => (
          <li key={`p${i}`} className={`flex items-start gap-2 ${highlight ? "text-white" : "text-ink-300"}`}>
            <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${highlight ? "text-emerald-300" : "text-emerald-500"}`} />
            <span>{p}</span>
          </li>
        ))}
        {cons.map((c, i) => (
          <li key={`c${i}`} className="flex items-start gap-2 text-ink-500">
            <span className="flex-shrink-0 mt-0.5 text-ink-600">×</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Suppress unused warnings
void Database;
void TrendingUp;
