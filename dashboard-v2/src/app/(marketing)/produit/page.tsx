import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Database, Brain, Shield, BarChart3 } from "lucide-react";

export const metadata: Metadata = {
  title: "Produit — Détection + qualification + garantie",
  description: "Comment iFIND détecte, qualifie et garantit les meilleures Pépites du marché PME français.",
  robots: { index: true, follow: true },
};

export default function ProduitPage() {
  return (
    <div className="bg-white">
      <section className="max-w-5xl mx-auto px-6 lg:px-8 pt-20 pb-16">
        <h1 className="font-display text-5xl md:text-6xl font-bold text-ink-900 tracking-tight">
          Le moteur le plus avancé sur les <span className="text-brand-600">PME françaises</span>
        </h1>
        <p className="mt-6 text-lg text-ink-600 max-w-2xl">
          iFIND combine 9 sources publiques françaises, une qualification IA Opus 4.7,
          et une garantie qualité unique sur le marché.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 lg:px-8 pb-24 space-y-20">
        <Block
          tag="01 — DÉTECTION"
          icon={<Database className="h-6 w-6" />}
          title="9 sources françaises agrégées 24/7"
          description="Le moteur scanne en continu : BODACC (annonces commerciales, levées), INPI (dépôts marques), Pappers (données SIRENE complètes), France Travail (offres tech), Welcome to the Jungle, LinkedIn Jobs, RSS Maddyness/Frenchweb (levées de fonds), JOAFE (associations), TheirStack (intent + tech stack). Chaque trigger est rattaché à un SIRET unique avec attribution Pappers."
          stats={["202 triggers/mois en moyenne par client", "9 sources publiques FR croisées", "0 doublon grâce au SIRET"]}
        />

        <Block
          tag="02 — QUALIFICATION"
          icon={<Brain className="h-6 w-6" />}
          title="Cerveau Judge V2 sur Claude Opus 4.7"
          description="Chaque trigger est évalué par notre cerveau IA propriétaire (12 blocs de contexte : persona, company health, cross-tenant, news, signaux négatifs, ICP enriched...). Verdict OUI/NON/ENRICH avec score 0-10 + raison détaillée + brief sur-mesure prêt à utiliser."
          stats={["~95-97% précision V2 (vs 80% V1)", "Score Opus 0-10 + raison", "Brief on-demand par lead"]}
        />

        <Block
          tag="03 — GARANTIE"
          icon={<Shield className="h-6 w-6" />}
          title="6 Pépites minimum par mois — engagement contractuel"
          description="Une Pépite = score Opus ≥ 8/10 (boîte ULTRA chaude : vient de lever, recrute en urgence, signal d'achat fort). On garantit 6 Pépites/mois minimum. Si on ne tient pas → votre quota du mois suivant est automatiquement doublé. Vous ne payez jamais pour de l'air."
          stats={["6 Pépites/mois garanties", "18-25 Pépites livrées en moyenne", "Quota doublé si garantie ratée"]}
        />

        <Block
          tag="04 — DASHBOARD"
          icon={<BarChart3 className="h-6 w-6" />}
          title="Visibilité totale, en temps réel"
          description="Dashboard premium avec : compteur Pépites du mois vs garantie, solde crédits + historique, alerte Telegram/Slack instantanée sur les Pépites, table avec filtres avancés et briefs Opus. Tout est consultable mobile."
          stats={["Update temps réel", "Alertes Pépites instantanées", "Brief Opus 1-clic"]}
        />
      </section>

      <section className="bg-brand-50 py-20">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="font-display text-4xl font-bold text-ink-900 mb-4">
            Une seule offre. Une seule promesse.
          </h2>
          <p className="text-ink-600 text-lg mb-8">
            390€/mois en annuel, 60 leads + 6 Pépites garanties. Setup gratuit.
          </p>
          <Link href="/tarifs" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold px-8 py-4 shadow-lg transition-all">
            Voir les tarifs
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function Block({ tag, icon, title, description, stats }: { tag: string; icon: React.ReactNode; title: string; description: string; stats: string[] }) {
  return (
    <div className="grid md:grid-cols-3 gap-10 items-start">
      <div>
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-50 text-brand-600 border border-brand-100 mb-3">
          {icon}
        </div>
        <p className="font-mono text-xs font-bold text-brand-600 mb-2">{tag}</p>
      </div>
      <div className="md:col-span-2">
        <h2 className="font-display text-3xl font-bold text-ink-900 mb-4">{title}</h2>
        <p className="text-ink-600 leading-relaxed mb-6">{description}</p>
        <div className="flex flex-wrap gap-2">
          {stats.map((s, i) => (
            <span key={i} className="inline-flex items-center px-3 py-1.5 rounded-full bg-ink-50 border border-ink-100 text-xs font-medium text-ink-700">
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
