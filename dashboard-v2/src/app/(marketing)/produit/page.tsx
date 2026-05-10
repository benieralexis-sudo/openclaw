import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Brain, Shield, Zap, BarChart3, Bell, Database, Target, Lock, Server, FileCheck, RefreshCw } from "lucide-react";
import { FeatureShowcase } from "../_components/feature-showcase";
import { LiveFeed } from "../_components/live-feed";
import { BriefMockup } from "../_components/brief-mockup";
import { DashboardMockup } from "../_components/dashboard-mockup";
import { SectionHeading } from "../_components/section-heading";

export const metadata: Metadata = {
  title: "Produit — Détection, qualification, garantie",
  description:
    "Comment iFIND détecte, qualifie et garantit les meilleures Pépites du marché PME français. 11 sources publiques, Claude Opus 4.7, garantie contractuelle.",
  robots: { index: true, follow: true },
};

export default function ProduitPage() {
  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            Produit
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight leading-[1.05]">
            Le moteur de prospection le{" "}
            <span className="text-brand-700">plus précis</span> sur le marché PME français.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            iFIND combine 11 sources publiques françaises, qualification IA Claude Opus 4.7,
            et garantie qualité contractuelle. Voici comment, en détail.
          </p>
        </div>
      </section>

      {/* ───────────────────────── FEATURE 1 — DÉTECTION ───────────────────────── */}
      <section id="sources" className="py-20 md:py-24 bg-ink-50/40 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            eyebrow="01 · Détection"
            title="11 sources publiques françaises, scannées 24/7."
            description="Le moteur agrège en continu les sources publiques FR les plus riches. Chaque trigger est rattaché à un SIRET unique avec attribution Pappers automatique. Aucun doublon, aucune fausse donnée."
            bullets={[
              "BODACC — Annonces commerciales (levées, fusions, créations)",
              "INPI — Dépôts de marques (signal pré-launch produit)",
              "Pappers — Données SIRENE complètes (dirigeants, financiers)",
              "France Travail — Offres tech (5 000 req/jour gratuit)",
              "Presse Tech FR — Levées de fonds en temps réel",
              "LinkedIn Jobs + Welcome to the Jungle — Recrutement",
              "JOAFE — Associations & fondations",
              "Sources premium — intent data B2B + tech stack discovery",
            ]}
            visual={<LiveFeed />}
          />
        </div>
      </section>

      {/* ───────────────────────── FEATURE 2 — QUALIFICATION ───────────────────────── */}
      <section id="qualification" className="py-20 md:py-24 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <FeatureShowcase
            eyebrow="02 · Qualification IA"
            title="Cerveau Claude Opus 4.7 — précision 95 %."
            description="Chaque trigger est analysé avec 12 blocs de contexte (persona, santé entreprise, news, signaux négatifs, ICP enrichi). Verdict OUI/NON/ENRICH avec score 0-10, raison détaillée, et brief sur-mesure prêt à utiliser."
            bullets={[
              "12 blocs de contexte injectés à Claude Opus pour chaque trigger",
              "Verdict explicite OUI/NON/ENRICH — jamais de boîte noire",
              "Score 0-10 avec raison détaillée",
              "Brief en 5 sections : contexte, signal, angle, pitch, objections",
              "Anti-hallucination : tous les faits vérifiés contre la source",
              "Cache prompt à 97 % de hit rate — économie 10× sur les coûts API",
            ]}
            visual={<BriefMockup />}
            reverse
          />
        </div>
      </section>

      {/* ───────────────────────── FEATURE 3 — GARANTIE ───────────────────────── */}
      <section id="garantie" className="py-20 md:py-24 bg-ink-50/40 scroll-mt-20">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="03 · Garantie"
            title={<>6 Pépites garanties par mois <span className="text-ink-400">— ou quota doublé</span>.</>}
            description={
              <>
                Engagement contractuel. Une <strong>Pépite</strong> = lead avec score Opus ≥ 8/10
                (boîte qui matche votre ICP <em>et</em> présente un signal d&apos;achat fort).
                Si on en livre moins de 6 un mois, votre quota du mois suivant est automatiquement doublé.
              </>
            }
          />

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-px bg-ink-200 rounded-xl overflow-hidden border border-ink-200">
            <GuaranteeCard
              title="Mois normal"
              value="18-25"
              sub="Pépites livrées"
              detail="Garantie respectée, quota standard 60 leads."
            />
            <GuaranteeCard
              title="Mois calme"
              value="< 6"
              sub="Pépites — garantie ratée"
              detail="Quota du mois suivant automatiquement doublé : 120 leads inclus."
              highlight
            />
            <GuaranteeCard
              title="Mois explosif"
              value="30+"
              sub="Pépites — overage flexible"
              detail="Topup à 8 € par lead supplémentaire si vous voulez plus."
            />
          </div>
        </div>
      </section>

      {/* ───────────────────────── FEATURE 4 — DASHBOARD ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="04 · Dashboard"
            title="Visibilité totale, en temps réel."
            description="Tous vos KPI en un seul écran : Pépites livrées, garantie en cours, crédits consommés, activité récente, alertes."
          />

          <div className="mt-12">
            <DashboardMockup />
          </div>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
            <DashFeature icon={<BarChart3 className="h-4 w-4" />} title="Compteur garantie live" desc="Suivez en continu vos Pépites livrées vs les 6 garanties contractuelles." />
            <DashFeature icon={<Bell className="h-4 w-4" />} title="Alertes Telegram" desc="Ping instantané dès qu'une Pépite est détectée et qualifiée." />
            <DashFeature icon={<Database className="h-4 w-4" />} title="Brief Opus 1-clic" desc="Ouvrez le brief de chaque lead sans changer de page." />
            <DashFeature icon={<Target className="h-4 w-4" />} title="Actions bulk" desc="Marquer contactés, archiver, exporter en CSV — par lots." />
          </div>
        </div>
      </section>

      {/* ───────────────────────── SÉCURITÉ ───────────────────────── */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <SectionHeading
            eyebrow="05 · Sécurité & RGPD"
            title="Conforme par construction."
            description="Tout est public, légal, hébergé en France. Sans compromis."
          />

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SecCard icon={<FileCheck className="h-4 w-4" />} title="Sources publiques uniquement" desc="BODACC, INPI, Pappers, France Travail — tout est légal et public." />
            <SecCard icon={<Shield className="h-4 w-4" />} title="RGPD by design" desc="Article 6.1.f intérêt légitime + recommandations CNIL prospection BtoB." />
            <SecCard icon={<Server className="h-4 w-4" />} title="Données EU uniquement" desc="Hébergement OVHcloud / Hetzner FR. Aucun transfert hors UE." />
            <SecCard icon={<Lock className="h-4 w-4" />} title="Chiffrement bout-en-bout" desc="HTTPS/TLS en transit, PostgreSQL chiffré au repos." />
            <SecCard icon={<Brain className="h-4 w-4" />} title="Audit log complet" desc="Toutes les actions critiques tracées (auth, edit ICP, delivery)." />
            <SecCard icon={<RefreshCw className="h-4 w-4" />} title="Backups GPG offsite" desc="Sauvegardes quotidiennes chiffrées sur Backblaze B2." />
          </div>
        </div>
      </section>

      {/* ───────────────────────── CTA ───────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl border border-ink-200 bg-ink-950 text-white px-8 py-14 md:px-14 md:py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Une offre. Une promesse.
            </h2>
            <p className="mt-5 text-base md:text-lg text-ink-300 max-w-xl mx-auto leading-relaxed">
              390 €/mois en annuel. 60 leads inclus, 6 Pépites garanties. Setup gratuit.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/tarifs"
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white text-ink-900 hover:bg-ink-100 font-medium px-5 h-11 text-sm"
              >
                Voir les tarifs
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-1.5 rounded-md text-ink-300 hover:text-white font-medium px-5 h-11 text-sm"
              >
                Démarrer maintenant
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function GuaranteeCard({ title, value, sub, detail, highlight }: { title: string; value: string; sub: string; detail: string; highlight?: boolean }) {
  return (
    <div className={`p-7 ${highlight ? "bg-brand-50/40" : "bg-white"}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-ink-500 mb-3">{title}</p>
      <p className="font-display text-3xl md:text-4xl font-semibold text-ink-900 tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-ink-500 mb-3">{sub}</p>
      <p className="text-sm text-ink-700 leading-relaxed">{detail}</p>
    </div>
  );
}

function DashFeature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-white border border-ink-200 p-5">
      <div className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-brand-50 text-brand-700 mb-3">
        {icon}
      </div>
      <p className="font-medium text-ink-900 text-sm mb-1">{title}</p>
      <p className="text-xs text-ink-600 leading-relaxed">{desc}</p>
    </div>
  );
}

function SecCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-white border border-ink-200 p-5">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="font-medium text-ink-900 text-sm mb-0.5">{title}</p>
          <p className="text-xs text-ink-600 leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  );
}

void Zap;
