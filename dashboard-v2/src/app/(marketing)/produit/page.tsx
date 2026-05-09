import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Database, Brain, Shield, BarChart3, Zap, Bell } from "lucide-react";
import { FeatureShowcase } from "../_components/feature-showcase";
import { LiveFeed } from "../_components/live-feed";
import { BriefMockup } from "../_components/brief-mockup";
import { DashboardMockup } from "../_components/dashboard-mockup";

export const metadata: Metadata = {
  title: "Produit — Détection + qualification + garantie",
  description: "Comment iFIND détecte, qualifie et garantit les meilleures Pépites du marché PME français.",
  robots: { index: true, follow: true },
};

export default function ProduitPage() {
  return (
    <div className="bg-white overflow-hidden">
      {/* HERO */}
      <section className="relative pt-20 pb-16 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/40 via-white to-white" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-gradient-radial from-brand-300/30 via-transparent to-transparent blur-3xl" />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-5">Produit</p>
          <h1 className="font-display text-5xl md:text-7xl font-bold text-ink-900 tracking-tight leading-[1.05]">
            Le moteur le plus avancé sur les
            <br />
            <span className="bg-gradient-to-r from-brand-600 via-brand-700 to-brand-900 bg-clip-text text-transparent">
              PME françaises
            </span>
          </h1>
          <p className="mt-8 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            iFIND combine 11 sources publiques françaises, qualification IA Opus 4.7,
            et garantie qualité unique sur le marché. Voici comment, en détail.
          </p>
        </div>
      </section>

      {/* FEATURE 1 — Détection */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            badge="01 — DÉTECTION"
            title={<>11 sources françaises <span className="text-brand-600">scannées 24/7</span></>}
            description="Notre moteur agrège en continu les sources publiques FR les plus riches. Chaque trigger est rattaché à un SIRET unique avec attribution Pappers automatique. Aucun doublon, aucune fake."
            bullets={[
              "BODACC — Annonces commerciales (levées, fusions, créations)",
              "INPI — Dépôts de marques (signal pré-launch produit)",
              "Pappers — Données SIRENE complètes (dirigeants, financials)",
              "France Travail — Offres tech (5000 req/jour gratuit)",
              "RSS Maddyness/Frenchweb — Levées de fonds en temps réel",
              "LinkedIn jobs + Welcome to the Jungle — Recrutement",
              "JOAFE — Associations & fondations",
              "Rodz + TheirStack — Triggers premium (intent + tech stack)",
            ]}
            visual={<LiveFeed />}
          />
        </div>
      </section>

      {/* FEATURE 2 — Qualification IA */}
      <section className="py-24 bg-gradient-to-b from-white to-brand-50/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            badge="02 — QUALIFICATION IA"
            title={<>Cerveau Opus 4.7 — <span className="text-brand-600">95% précision</span></>}
            description="Chaque trigger est analysé par notre cerveau IA propriétaire avec 12 blocs de contexte (persona, company health, cross-tenant, news, signaux négatifs, ICP enriched). Verdict OUI/NON/ENRICH avec score 0-10 et brief sur-mesure prêt à utiliser."
            bullets={[
              "12 blocs de contexte injectés à Claude Opus pour chaque trigger",
              "Verdict explicite OUI/NON/ENRICH (pas de boîte noire)",
              "Score 0-10 avec raison détaillée",
              "Brief 5 paragraphes : contexte, signal, angle, pitch, objections",
              "Anti-hallucination : tous les faits sont vérifiés contre les sources",
              "Cache prompt 97% hit rate (économie 10× sur les coûts API)",
            ]}
            visual={<BriefMockup />}
            reverse
          />
        </div>
      </section>

      {/* FEATURE 3 — Garantie */}
      <section className="py-24 bg-gradient-to-br from-amber-50/50 via-white to-amber-50/30">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold mb-6">
            03 — GARANTIE PÉPITE
          </div>
          <h2 className="font-display text-4xl md:text-6xl font-bold text-ink-900 mb-6 leading-[1.1]">
            6 Pépites garanties par mois
            <br />
            <span className="bg-gradient-to-r from-amber-500 to-amber-700 bg-clip-text text-transparent">— ou quota doublé.</span>
          </h2>
          <p className="text-lg text-ink-600 max-w-2xl mx-auto leading-relaxed mb-12">
            C&apos;est notre engagement contractuel. Une Pépite = score Opus ≥ 8/10
            (boîte ULTRA chaude : vient de lever, recrute en urgence, signal d&apos;achat fort).
            <br />Si on livre moins de 6 → votre quota du mois suivant est automatiquement doublé.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            <GuaranteeCard
              title="Mois normal"
              value="18-25"
              sub="Pépites livrées en moyenne"
              status="ok"
              detail="Garantie respectée — quota standard 60 leads"
            />
            <GuaranteeCard
              title="Mois calme"
              value="< 6"
              sub="Pépites — garantie ratée"
              status="alert"
              detail="Quota mois suivant automatiquement doublé : 120 leads"
            />
            <GuaranteeCard
              title="Mois explosif"
              value="30+"
              sub="Pépites — overage flexible"
              status="hot"
              detail="Topup à 8€/lead supplémentaire si vous voulez plus"
            />
          </div>
        </div>
      </section>

      {/* FEATURE 4 — Dashboard */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">04 — DASHBOARD</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900 leading-[1.1]">
              Visibilité totale, en <span className="text-brand-600">temps réel</span>
            </h2>
            <p className="mt-4 text-ink-600 max-w-2xl mx-auto">
              Dashboard premium avec tous vos KPI en un seul écran : Pépites, garantie,
              crédits, activité récente, alertes.
            </p>
          </div>
          <DashboardMockup />
          <div className="mt-12 grid mdisques-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            <DashFeature icon={<BarChart3 className="h-5 w-5" />} title="Compteur garantie live" desc="Voir à tout moment combien de Pépites livrées vs 6 garanties" />
            <DashFeature icon={<Bell className="h-5 w-5" />} title="Alertes Telegram/Slack" desc="Ping instantané dès qu'une Pépite est détectée" />
            <DashFeature icon={<Database className="h-5 w-5" />} title="Brief Opus 1-clic" desc="Ouvrez le brief de chaque lead sans changer de page" />
            <DashFeature icon={<Zap className="h-5 w-5" />} title="Actions bulk" desc="Marquer contactés, archiver, exporter — en lot" />
          </div>
        </div>
      </section>

      {/* FEATURE 5 — Sécurité */}
      <section className="py-24 bg-gradient-to-b from-white to-ink-50/50">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">05 — SÉCURITÉ & RGPD</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Conforme par construction
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SecurityCard title="Sources publiques uniquement" desc="BODACC, INPI, Pappers, France Travail — tout est légal et public" />
            <SecurityCard title="GDPR by design" desc="Article 6.1.f intérêt légitime + recommandations CNIL prospection BtoB" />
            <SecurityCard title="Data EU uniquement" desc="Hébergement OVHcloud / Hetzner FR. Aucun transfert hors UE" />
            <SecurityCard title="Chiffrement bout-en-bout" desc="HTTPS/TLS en transit, PostgreSQL chiffré au repos" />
            <SecurityCard title="Audit log complet" desc="Toutes les actions critiques tracées (auth, edit ICP, delivery)" />
            <SecurityCard title="Backups GPG offsite" desc="Sauvegardes quotidiennes chiffrées sur Backblaze B2" />
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="relative bg-ink-950 text-white overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-24 text-center">
          <h2 className="font-display text-4xl md:text-6xl font-bold mb-6 tracking-tight leading-[1.0]">
            Une seule offre.
            <br />
            <span className="bg-gradient-to-r from-amber-300 via-amber-200 to-white bg-clip-text text-transparent">
              Une seule promesse.
            </span>
          </h2>
          <p className="text-ink-300 text-lg mb-10 max-w-xl mx-auto">
            390€/mois en annuel. 60 leads + 6 Pépites garanties. Setup gratuit.
          </p>
          <Link href="/tarifs" className="inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-10 py-5 text-lg shadow-2xl shadow-brand-500/30 transition-all">
            Voir les tarifs
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function GuaranteeCard({ title, value, sub, status, detail }: { title: string; value: string; sub: string; status: "ok" | "alert" | "hot"; detail: string }) {
  const colorClass = {
    ok: "bg-gradient-to-br from-emerald-50 to-white border-emerald-200",
    alert: "bg-gradient-to-br from-amber-50 to-white border-amber-300 shadow-lg shadow-amber-500/10",
    hot: "bg-gradient-to-br from-brand-50 to-white border-brand-200",
  }[status];
  const valueColor = {
    ok: "text-emerald-700",
    alert: "text-amber-700",
    hot: "text-brand-700",
  }[status];
  return (
    <div className={`rounded-2xl p-6 border-2 text-left ${colorClass}`}>
      <p className="text-xs uppercase tracking-wider font-bold text-ink-500 mb-2">{title}</p>
      <p className={`font-display text-4xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-ink-600 mb-3">{sub}</p>
      <p className="text-xs text-ink-700 leading-relaxed">{detail}</p>
    </div>
  );
}

function DashFeature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-white border border-ink-100 p-5 hover:border-brand-200 hover:shadow-md transition-all">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-brand-50 text-brand-600 border border-brand-100 mb-3">
        {icon}
      </div>
      <p className="font-semibold text-ink-900 text-sm mb-1">{title}</p>
      <p className="text-xs text-ink-600 leading-relaxed">{desc}</p>
    </div>
  );
}

function SecurityCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-white border border-ink-100 p-5 hover:border-brand-200 hover:shadow-md transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
          <Shield className="h-4 w-4" />
        </div>
        <div>
          <p className="font-semibold text-ink-900 text-sm mb-0.5">{title}</p>
          <p className="text-xs text-ink-600 leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  );
}

void Brain;
