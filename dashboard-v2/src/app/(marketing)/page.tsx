import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, X, Zap, Brain, Shield, Target, Database, Sparkles, TrendingUp, Quote } from "lucide-react";
import { DashboardMockup } from "./_components/dashboard-mockup";
import { AnimatedStat } from "./_components/animated-stat";
import { SourcesMarquee } from "./_components/sources-marquee";

export const metadata: Metadata = {
  title: "iFIND — Détectez les boîtes FR qui ont besoin de vous",
  description:
    "Le moteur de détection de signaux d'achat sur les PME françaises. 11 sources publiques, qualification IA Opus 4.7, garantie 6 Pépites/mois.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <div className="bg-white overflow-hidden">
      {/* ════════════ HERO ════════════ */}
      <section className="relative pt-20 pb-32">
        {/* Background mesh gradient */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/40 via-white to-white" />
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-gradient-radial from-brand-300/30 via-transparent to-transparent blur-3xl" />
          <div className="absolute top-20 right-1/4 w-[600px] h-[600px] bg-gradient-radial from-amber-200/25 via-transparent to-transparent blur-3xl" />
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            {/* Left : copy */}
            <div className="lg:col-span-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/80 border border-amber-200 text-amber-800 text-xs font-medium mb-6 backdrop-blur-sm">
                <Sparkles className="h-3 w-3" />
                Nouveau · Garantie 6 Pépites/mois
              </div>
              <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold text-ink-900 tracking-tight leading-[1.0]">
                Les boîtes FR qui ont
                <br />
                <span className="relative inline-block">
                  <span className="relative bg-gradient-to-r from-brand-600 via-brand-700 to-brand-900 bg-clip-text text-transparent">
                    besoin de vous
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" height="12" viewBox="0 0 200 12" fill="none">
                    <path d="M2 9 Q 50 3, 100 7 T 198 5" stroke="url(#underline)" strokeWidth="3" strokeLinecap="round" fill="none" />
                    <defs>
                      <linearGradient id="underline" x1="0" x2="200" y1="0" y2="0">
                        <stop offset="0" stopColor="#2563eb" />
                        <stop offset="1" stopColor="#1e40af" />
                      </linearGradient>
                    </defs>
                  </svg>
                </span>
                <br />
                <span className="text-ink-700">livrées chaque mois.</span>
              </h1>

              <p className="mt-8 text-lg md:text-xl text-ink-600 max-w-xl lg:mx-0 mx-auto leading-relaxed">
                Le seul moteur français qui combine{" "}
                <span className="text-ink-900 font-semibold">détection temps réel sur 11 sources publiques</span>,
                qualification IA Opus 4.7, et garantie contractuelle de 6 boîtes ULTRA chaudes par mois.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-3">
                <Link
                  href="/tarifs"
                  className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white font-semibold px-7 py-4 text-base shadow-lg hover:shadow-2xl shadow-brand-500/30 transition-all"
                >
                  <span className="absolute inset-0 rounded-xl bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  Voir les tarifs
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <Link
                  href="/produit"
                  className="inline-flex items-center gap-2 rounded-xl text-ink-700 hover:text-ink-900 font-semibold px-5 py-4 text-base transition-all"
                >
                  Comment ça marche
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap items-center lg:justify-start justify-center gap-x-6 gap-y-3 text-xs text-ink-500">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Setup gratuit
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  6 Pépites garanties / mois
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  RGPD compliant
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Made in France 🇫🇷
                </div>
              </div>
            </div>

            {/* Right : dashboard mockup */}
            <div className="lg:col-span-6 lg:pl-8">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ SOURCES MARQUEE ════════════ */}
      <SourcesMarquee />

      {/* ════════════ STATS MASSIVES ════════════ */}
      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Des chiffres qui parlent
            </h2>
            <p className="mt-3 text-ink-600">Mesurés en production sur le bot iFIND DTL.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
            <AnimatedStat value={11} label="Sources françaises" sublabel="croisées 24/7" />
            <AnimatedStat value={18} label="Pépites/mois" sublabel="en moyenne par client" />
            <AnimatedStat value={95} suffix="%" label="Précision Cerveau V2" sublabel="vs 80% V1" />
            <AnimatedStat value={48} suffix="h" label="Premières Pépites" sublabel="après onboarding" />
          </div>
        </div>
      </section>

      {/* ════════════ WHY iFIND DIFFÉRENT ════════════ */}
      <section className="py-24 bg-gradient-to-b from-white via-brand-50/30 to-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-4">
              Pourquoi iFIND
            </p>
            <h2 className="font-display text-4xl md:text-6xl font-bold text-ink-900 leading-[1.1]">
              Pas un fichier de leads.
              <br />
              <span className="text-brand-600">Une assurance qualité.</span>
            </h2>
            <p className="mt-6 text-lg text-ink-600">
              Le seul outil français qui ne vous vend pas du volume,
              mais une garantie contractuelle de signaux ultra-chauds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="11 sources FR temps réel"
              description="BODACC, INPI, Pappers, France Travail, RSS, LinkedIn jobs, WTTJ, JOAFE, Maddyness, Frenchweb, TheirStack. Toutes croisées par SIRET."
              accent="brand"
            />
            <FeatureCard
              icon={<Brain className="h-6 w-6" />}
              title="Cerveau Opus 4.7"
              description="Chaque signal analysé par Claude Opus avec votre ICP. Verdict OUI/NON/ENRICH + score 0-10 + brief sur-mesure prêt à utiliser."
              accent="brand"
            />
            <FeatureCard
              icon={<Shield className="h-6 w-6" />}
              title="6 Pépites garanties/mois"
              description="Engagement contractuel : si on livre moins de 6 boîtes ULTRA chaudes, votre quota est doublé le mois suivant. Personne ne fait ça."
              accent="amber"
              highlight
            />
            <FeatureCard
              icon={<Target className="h-6 w-6" />}
              title="ICP custom inclus"
              description="Configuration de votre profil cible : industrie, taille, signaux préférés, anti-personas. Setup et tuning offerts."
              accent="brand"
            />
            <FeatureCard
              icon={<Database className="h-6 w-6" />}
              title="Attribution SIRENE"
              description="Chaque trigger rattaché à un SIRET avec dirigeants Pappers, financials, effectifs. Zéro doublon, zéro fake."
              accent="brand"
            />
            <FeatureCard
              icon={<TrendingUp className="h-6 w-6" />}
              title="Brief Opus on-demand"
              description="Sur chaque Pépite : un brief de 5 paragraphes — contexte, angle d'attaque, objections probables. Vos commerciaux closent vite."
              accent="brand"
            />
          </div>
        </div>
      </section>

      {/* ════════════ COMPARATOR DRAMATIQUE ════════════ */}
      <section className="py-24 bg-ink-900 text-white relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-radial from-brand-600/20 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
              Comparé aux alternatives
            </h2>
            <p className="text-ink-400">
              Ce qui rend iFIND <span className="text-white font-semibold">vraiment unique</span> sur le marché FR.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {COMPARISONS.map((c) => (
              <ComparisonCard key={c.name} {...c} />
            ))}
          </div>
        </div>
      </section>

      {/* ════════════ TÉMOIGNAGE ════════════ */}
      <section className="py-24 bg-gradient-to-br from-amber-50 via-white to-brand-50">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="relative bg-white rounded-3xl p-10 md:p-16 shadow-xl border border-ink-100">
            <Quote className="absolute -top-6 left-10 h-12 w-12 text-brand-600 fill-brand-600" />
            <p className="font-display text-2xl md:text-3xl text-ink-800 leading-relaxed font-medium">
              &laquo; Avant iFIND, mes commerciaux passaient 70% de leur temps à chercher
              les bonnes boîtes. Maintenant ils passent 100% à les contacter. Et les
              taux de réponse ont triplé parce que les leads sont vraiment chauds. &raquo;
            </p>
            <div className="mt-8 flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-200 to-brand-400 flex items-center justify-center text-white font-bold text-lg">
                FF
              </div>
              <div>
                <p className="font-semibold text-ink-900">Frédéric Flandrin</p>
                <p className="text-sm text-ink-500">Founder, DigiTestLab — client iFIND depuis avril 2026</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ COMMENT CA MARCHE ════════════ */}
      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-4">Démarrage</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              3 étapes. 5 minutes.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-12 left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-brand-200 via-brand-400 to-brand-200" />
            {STEPS.map((s, i) => (
              <div key={i} className="relative">
                <div className="bg-white rounded-2xl p-8 border border-ink-100 hover:border-brand-200 hover:shadow-xl transition-all relative z-10">
                  <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-display font-bold text-xl mx-auto mb-5 shadow-lg shadow-brand-500/30">
                    0{i + 1}
                  </div>
                  <h3 className="font-display text-xl font-bold text-ink-900 text-center mb-3">{s.t}</h3>
                  <p className="text-sm text-ink-600 text-center leading-relaxed">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════ PRICING TEASER ════════════ */}
      <section className="py-24 bg-ink-50">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="relative bg-white rounded-3xl border-2 border-brand-200 shadow-2xl overflow-hidden">
            <div className="absolute top-0 right-0 bg-gradient-to-bl from-brand-600 to-brand-800 text-white text-xs font-bold uppercase tracking-wider px-6 py-2 rounded-bl-2xl">
              Une seule offre
            </div>
            <div className="p-10 md:p-12 text-center">
              <h2 className="font-display text-3xl font-bold text-ink-900 mb-2">iFIND Growth</h2>
              <p className="text-sm text-ink-500 mb-6">Conçu pour PME tech FR 30-200 personnes</p>
              <div className="flex items-baseline justify-center gap-2 mb-2">
                <span className="font-display text-7xl font-bold bg-gradient-to-br from-ink-900 to-brand-800 bg-clip-text text-transparent">390€</span>
                <span className="text-ink-600">/mois</span>
              </div>
              <p className="text-sm text-ink-500 mb-8">Engagement annuel · 4 680€ HT/an · Setup gratuit</p>
              <div className="flex items-center justify-center gap-6 text-sm font-medium text-ink-700 mb-10 flex-wrap">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" />60 leads/mois</span>
                <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-amber-600" />6 Pépites garanties</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" />Rollover 4 mois</span>
              </div>
              <Link href="/tarifs" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white font-semibold px-8 py-4 shadow-lg shadow-brand-500/30 hover:shadow-xl transition-all">
                Voir le détail des tarifs
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ CTA FINAL ════════════ */}
      <section className="relative bg-ink-900 text-white overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-gradient-radial from-amber-500/20 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-24 text-center">
          <h2 className="font-display text-5xl md:text-6xl font-bold mb-6 tracking-tight">
            Prêt à recevoir vos
            <br />
            <span className="bg-gradient-to-r from-amber-300 via-amber-200 to-white bg-clip-text text-transparent">
              premières Pépites ?
            </span>
          </h2>
          <p className="text-ink-300 text-lg mb-10 max-w-2xl mx-auto">
            Setup en 5 minutes. Premières détections sous 48h.
            Garantie 6 Pépites le premier mois ou quota doublé.
          </p>
          <Link href="/tarifs" className="inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-10 py-5 text-lg shadow-2xl shadow-brand-500/30 transition-all">
            Démarrer maintenant
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, description, accent, highlight }: { icon: React.ReactNode; title: string; description: string; accent: "brand" | "amber"; highlight?: boolean }) {
  const accentClass = accent === "amber"
    ? "bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700 border-amber-200"
    : "bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 border-brand-200";
  const cardClass = highlight
    ? "bg-gradient-to-br from-amber-50 to-white border-2 border-amber-300 shadow-lg shadow-amber-500/10"
    : "bg-white border border-ink-100 hover:border-brand-200 hover:shadow-xl hover:-translate-y-0.5";
  return (
    <div className={`rounded-2xl p-8 transition-all ${cardClass}`}>
      <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl border ${accentClass} mb-5 shadow-sm`}>
        {icon}
      </div>
      <h3 className="font-display text-xl font-bold text-ink-900 mb-3">{title}</h3>
      <p className="text-ink-600 leading-relaxed text-sm">{description}</p>
    </div>
  );
}

interface ComparisonItem {
  name: string;
  tagline: string;
  price: string;
  pros: string[];
  cons: string[];
  highlight?: boolean;
}

function ComparisonCard({ name, tagline, price, pros, cons, highlight }: ComparisonItem) {
  return (
    <div className={`rounded-2xl p-6 transition-all ${highlight ? "bg-gradient-to-br from-brand-600 to-brand-800 border-2 border-brand-400 shadow-2xl shadow-brand-500/30 -translate-y-2" : "bg-ink-800/50 border border-ink-700 backdrop-blur-sm"}`}>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className={`font-display text-xl font-bold ${highlight ? "text-white" : "text-ink-200"}`}>{name}</h3>
        <span className={`text-xs font-mono ${highlight ? "text-brand-200" : "text-ink-500"}`}>{price}</span>
      </div>
      <p className={`text-xs mb-5 ${highlight ? "text-brand-100" : "text-ink-500"}`}>{tagline}</p>
      <ul className="space-y-2 text-sm">
        {pros.map((p, i) => (
          <li key={`p${i}`} className={`flex items-start gap-2 ${highlight ? "text-white" : "text-ink-300"}`}>
            <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${highlight ? "text-emerald-300" : "text-emerald-500"}`} />
            <span>{p}</span>
          </li>
        ))}
        {cons.map((c, i) => (
          <li key={`c${i}`} className="flex items-start gap-2 text-ink-500">
            <X className="h-4 w-4 flex-shrink-0 mt-0.5 text-ink-600" />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const COMPARISONS: ComparisonItem[] = [
  {
    name: "Société.info / Manageo",
    tagline: "Données SIRENE brutes",
    price: "50-300€/mo",
    pros: ["Données françaises"],
    cons: ["Aucune IA", "Aucun temps réel", "Vous triez 500 prospects"],
  },
  {
    name: "Pharow",
    tagline: "Données + enrichissement",
    price: "139-500€/mo",
    pros: ["Données FR", "Email enrichi"],
    cons: ["Aucune IA de qualif", "Aucune garantie", "Aucun brief"],
  },
  {
    name: "iFIND",
    tagline: "Détection + IA + Garantie",
    price: "390€/mo annuel",
    pros: ["11 sources temps réel", "Cerveau Opus 4.7", "6 Pépites garanties", "Brief sur-mesure", "Setup ICP inclus"],
    cons: [],
    highlight: true,
  },
];

const STEPS = [
  { t: "Vous configurez votre ICP", d: "Industrie, taille, signaux préférés, anti-personas. Wizard guidé en 5 minutes, setup et tuning offerts." },
  { t: "On scanne 11 sources FR 24/7", d: "Triggers détectés en temps réel + qualifiés par Opus 4.7 + enrichis (email, phone, LinkedIn)." },
  { t: "Vous recevez vos Pépites", d: "Dashboard temps réel + alertes Telegram instantanées + briefs Opus prêts. Vos commerciaux closent." },
];
