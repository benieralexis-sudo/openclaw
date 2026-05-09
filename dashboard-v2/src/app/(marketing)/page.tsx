import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Zap, Shield, Brain, Target, Database, Sparkles, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "iFIND — Détectez les boîtes FR qui ont besoin de vous",
  description:
    "Le moteur de détection de signaux d'achat sur les PME françaises. 9 sources publiques, qualification IA Opus 4.7, garantie 6 Pépites/mois.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-white" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial from-brand-200/30 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-6 lg:px-8 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-medium mb-8">
            <Sparkles className="h-3 w-3" />
            Trigger Engine FR — Made in France 🇫🇷
          </div>
          <h1 className="font-display text-5xl md:text-7xl font-bold text-ink-900 tracking-tight max-w-5xl mx-auto leading-[1.05]">
            Détectez les boîtes FR
            <br />
            <span className="bg-gradient-to-r from-brand-600 to-brand-800 bg-clip-text text-transparent">
              qui ont besoin de vous
            </span>
            <br />
            avant vos concurrents
          </h1>
          <p className="mt-8 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            Le moteur de détection de signaux d&apos;achat temps réel sur les PME françaises.{" "}
            <span className="text-ink-900 font-semibold">9 sources publiques, qualifiées par IA</span>,
            avec garantie 6 Pépites par mois minimum.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/tarifs"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold px-8 py-4 text-base shadow-lg hover:shadow-xl transition-all"
            >
              Démarrer maintenant
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/produit"
              className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-ink-50 text-ink-700 font-semibold px-8 py-4 text-base border border-ink-200 transition-all"
            >
              Voir comment ça marche
            </Link>
          </div>
          <div className="mt-12 flex items-center justify-center gap-8 text-xs text-ink-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Setup gratuit
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Garantie 6 Pépites/mois
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              RGPD compliant
            </div>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-y border-ink-100 bg-ink-50/50 py-8">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold mb-4">
            Détecte les triggers depuis ces sources françaises
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm font-medium text-ink-600">
            <span>BODACC</span>
            <span className="text-ink-300">•</span>
            <span>INPI</span>
            <span className="text-ink-300">•</span>
            <span>Pappers</span>
            <span className="text-ink-300">•</span>
            <span>France Travail</span>
            <span className="text-ink-300">•</span>
            <span>LinkedIn</span>
            <span className="text-ink-300">•</span>
            <span>Welcome to the Jungle</span>
            <span className="text-ink-300">•</span>
            <span>JOAFE</span>
            <span className="text-ink-300">•</span>
            <span>Maddyness</span>
            <span className="text-ink-300">•</span>
            <span>Frenchweb</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Pas un fichier de leads.
              <br />
              <span className="text-brand-600">Une assurance qualité.</span>
            </h2>
            <p className="mt-4 text-ink-600 max-w-2xl mx-auto">
              Le seul outil français qui ne vous vend pas du volume, mais une garantie de signaux chauds.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="9 sources FR temps réel"
              description="BODACC, INPI, Pappers, France Travail, RSS levées, LinkedIn jobs… Toutes les données publiques françaises agrégées et croisées."
              accent="brand"
            />
            <FeatureCard
              icon={<Brain className="h-6 w-6" />}
              title="Qualification IA Opus 4.7"
              description="Chaque signal est analysé par Claude Opus avec votre ICP en contexte. Score 0-10 + raison + brief sur-mesure."
              accent="brand"
            />
            <FeatureCard
              icon={<Shield className="h-6 w-6" />}
              title="Garantie 6 Pépites par mois"
              description="On vous garantit minimum 6 boîtes ULTRA chaudes (score ≥ 8) chaque mois. Sinon votre quota est doublé. Engagement contractuel."
              accent="amber"
            />
            <FeatureCard
              icon={<Target className="h-6 w-6" />}
              title="ICP custom par client"
              description="On configure votre profil cible avec vous : industrie, taille, signaux d'achat préférés, anti-personas. Setup gratuit."
              accent="brand"
            />
            <FeatureCard
              icon={<Database className="h-6 w-6" />}
              title="Attribution SIRENE Pappers"
              description="Chaque trigger est rattaché à un SIRET avec dirigeants, financials, effectifs. Pas de fakes, pas de doublons."
              accent="brand"
            />
            <FeatureCard
              icon={<Sparkles className="h-6 w-6" />}
              title="Brief Opus on-demand"
              description="Sur chaque Pépite : un brief de 5 paragraphes prêt à utiliser pour votre commercial — contexte, angle d'attaque, objections probables."
              accent="brand"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-ink-50 py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Comment ça marche
            </h2>
            <p className="mt-4 text-ink-600">3 étapes, 5 minutes pour démarrer.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { n: "01", t: "Vous configurez votre ICP", d: "Industrie, taille, signaux préférés, anti-personas. Wizard de 5 minutes guidé." },
              { n: "02", t: "On scanne 9 sources FR 24/7", d: "Triggers détectés en temps réel + qualifiés par Opus + enrichis (email, phone, LinkedIn)." },
              { n: "03", t: "Vous recevez vos Pépites", d: "Dashboard en temps réel + alertes Telegram/Slack + briefs prêts à utiliser. Vos commerciaux closent." },
            ].map((step) => (
              <div key={step.n} className="bg-white rounded-2xl p-8 shadow-sm border border-ink-100">
                <div className="font-mono text-xs text-brand-600 font-bold mb-3">{step.n}</div>
                <h3 className="font-display text-xl font-bold text-ink-900 mb-3">{step.t}</h3>
                <p className="text-sm text-ink-600 leading-relaxed">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              iFIND vs les autres
            </h2>
            <p className="mt-4 text-ink-600">
              Personne d&apos;autre ne fait <span className="font-semibold text-ink-900">détection temps réel + qualification IA + garantie qualité</span> sur le marché FR.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ComparisonCard name="Société.info / Manageo" tagline="Données brutes" pros={["Données SIRENE/INPI"]} cons={["Aucune qualification", "Aucun signal temps réel", "Vous triez tout vous-même"]} />
            <ComparisonCard name="Pharow" tagline="Données + enrichissement" pros={["Données françaises", "Enrichissement email"]} cons={["Aucune IA de qualification", "Aucune garantie", "Vous décidez quoi prioriser"]} />
            <ComparisonCard name="iFIND" tagline="Pépites garanties" pros={["Détection temps réel multi-sources", "Qualification IA Opus 4.7", "6 Pépites/mois garanties", "Brief sur-mesure"]} cons={[]} highlight />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-brand-600 to-brand-800 text-white">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 py-24 text-center">
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
            Prêt à recevoir vos premières Pépites ?
          </h2>
          <p className="text-brand-100 text-lg mb-8 max-w-2xl mx-auto">
            390€/mois en annuel. 60 leads + 6 Pépites garanties. Setup gratuit. Premières détections sous 24-48h.
          </p>
          <Link href="/tarifs" className="inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-8 py-4 text-base shadow-xl transition-all">
            Voir les tarifs
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, description, accent }: { icon: React.ReactNode; title: string; description: string; accent: "brand" | "amber" }) {
  const accentClass = accent === "amber"
    ? "bg-amber-50 text-amber-600 border-amber-200"
    : "bg-brand-50 text-brand-600 border-brand-100";
  return (
    <div className="rounded-2xl p-8 bg-white border border-ink-100 hover:border-brand-200 hover:shadow-lg transition-all">
      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl border ${accentClass} mb-5`}>
        {icon}
      </div>
      <h3 className="font-display text-xl font-bold text-ink-900 mb-2">{title}</h3>
      <p className="text-ink-600 leading-relaxed">{description}</p>
    </div>
  );
}

function ComparisonCard({ name, tagline, pros, cons, highlight }: { name: string; tagline: string; pros: string[]; cons: string[]; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-6 border-2 ${highlight ? "border-brand-500 bg-gradient-to-br from-brand-50 to-white shadow-xl" : "border-ink-200 bg-white"}`}>
      <h3 className={`font-display text-lg font-bold ${highlight ? "text-brand-700" : "text-ink-900"}`}>{name}</h3>
      <p className="text-xs text-ink-500 mb-4">{tagline}</p>
      <ul className="space-y-2 text-sm">
        {pros.map((p, i) => (
          <li key={`p${i}`} className="flex items-start gap-2 text-ink-700">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>{p}</span>
          </li>
        ))}
        {cons.map((c, i) => (
          <li key={`c${i}`} className="flex items-start gap-2 text-ink-500">
            <span className="text-ink-300 flex-shrink-0 mt-0.5">×</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
