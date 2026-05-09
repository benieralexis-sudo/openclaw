import Link from "next/link";
import type { Metadata } from "next";
import { Check, Sparkles, Shield, Zap, RotateCcw, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Tarifs — 390€/mois, 6 Pépites garanties",
  description:
    "Une seule offre claire : 390€/mois en annuel, 60 leads qualifiés inclus, 6 Pépites minimum garanties. Setup gratuit.",
  robots: { index: true, follow: true },
};

export default function TarifsPage() {
  return (
    <div className="bg-gradient-to-b from-brand-50/50 to-white">
      <section className="max-w-4xl mx-auto px-6 lg:px-8 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-medium mb-6">
          <Sparkles className="h-3 w-3" />
          Tarif unique transparent
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-bold text-ink-900 tracking-tight">
          Vous payez la <span className="text-brand-600">qualité</span>,
          <br />
          pas le volume
        </h1>
        <p className="mt-6 text-lg text-ink-600 max-w-2xl mx-auto">
          Une seule offre. Une seule promesse :{" "}
          <span className="text-ink-900 font-semibold">6 Pépites par mois minimum</span>,
          ou on double votre quota le mois suivant.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-6 lg:px-8 pb-20">
        <div className="relative rounded-3xl bg-white border-2 border-brand-200 shadow-xl overflow-hidden">
          <div className="absolute top-0 right-0 bg-gradient-to-bl from-brand-600 to-brand-700 text-white text-xs font-bold uppercase tracking-wider px-6 py-2 rounded-bl-2xl">
            Offre publique
          </div>
          <div className="p-10 md:p-12">
            <div className="mb-2">
              <span className="font-display text-2xl font-bold text-ink-900">iFIND Growth</span>
            </div>
            <p className="text-sm text-ink-600 mb-8">
              L&apos;offre conçue pour les PME tech françaises de 30 à 200 personnes.
            </p>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="font-display text-6xl font-bold text-ink-900">390€</span>
              <span className="text-ink-600 text-lg">/mois</span>
            </div>
            <p className="text-sm text-ink-500">
              Engagement annuel • Soit <span className="font-semibold text-ink-700">4 680€ HT/an</span> • Setup gratuit
            </p>
            <div className="my-10 space-y-4">
              <FeatureRow icon={<Zap className="h-5 w-5 text-brand-600" />} title="60 leads qualifiés inclus chaque mois" description="Détectés en temps réel sur 9 sources françaises (BODACC, INPI, France Travail, LinkedIn jobs…)" />
              <FeatureRow icon={<Shield className="h-5 w-5 text-amber-600" />} title="6 Pépites minimum garanties / mois" description="Boîtes ULTRA chaudes (vient de lever, recrute en urgence, signal d'achat fort). Si on tient pas → quota doublé le mois suivant." highlight />
              <FeatureRow icon={<RotateCcw className="h-5 w-5 text-emerald-600" />} title="Crédits non-utilisés roulent jusqu'à 4 mois" description="Mois calme ? Vos crédits ne sont pas perdus. Cumul max 4 mois de stock." />
              <FeatureRow icon={<ArrowRight className="h-5 w-5 text-ink-600" />} title="Overage flexible : 8€ par lead supplémentaire" description="Mois explosif ? Vous décidez d'aller au-delà de votre quota. Facturé à la consommation." />
              <FeatureRow icon={<Check className="h-5 w-5 text-brand-600" />} title="Setup, ICP custom & support inclus" description="On configure votre profil cible avec vous. Aucun frais caché." />
            </div>
            <Link href="/signup" className="block w-full text-center rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold py-4 text-base shadow-lg hover:shadow-xl transition-all">
              Démarrer maintenant
            </Link>
            <p className="text-xs text-ink-500 text-center mt-4">
              Engagement 12 mois • Paiement annuel sécurisé Stripe • TVA 20% en sus
            </p>
          </div>
        </div>
        <div className="mt-8 text-center">
          <p className="text-sm text-ink-600">
            Plus de 200 leads/mois ou besoin multi-équipes ?{" "}
            <Link href="/a-propos" className="text-brand-600 hover:text-brand-700 font-medium underline">
              Contactez-nous pour un devis sur mesure
            </Link>
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 lg:px-8 pb-20">
        <h2 className="font-display text-3xl font-bold text-ink-900 text-center mb-3">
          Comparé aux alternatives
        </h2>
        <p className="text-center text-ink-600 mb-10">
          Pourquoi iFIND est différent des outils de prospection classiques.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-ink-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 border-b border-ink-200">
              <tr>
                <th className="text-left py-4 px-6 font-semibold text-ink-700"></th>
                <th className="text-center py-4 px-6 font-semibold text-brand-700 bg-brand-50/50">iFIND</th>
                <th className="text-center py-4 px-6 font-semibold text-ink-600">Pharow</th>
                <th className="text-center py-4 px-6 font-semibold text-ink-600">Société.info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {COMPARISON.map(([feature, ifind, pharow, societe], i) => (
                <tr key={i}>
                  <td className="py-3 px-6 text-ink-800">{feature}</td>
                  <td className="text-center py-3 px-6 bg-brand-50/30">
                    {typeof ifind === "boolean" ? (ifind ? <Check className="h-5 w-5 text-brand-600 inline" /> : <span className="text-ink-300">—</span>) : <span className="font-semibold text-brand-700">{ifind}</span>}
                  </td>
                  <td className="text-center py-3 px-6">
                    {typeof pharow === "boolean" ? (pharow ? <Check className="h-5 w-5 text-emerald-500 inline" /> : <span className="text-ink-300">—</span>) : <span className="text-ink-700">{pharow}</span>}
                  </td>
                  <td className="text-center py-3 px-6">
                    {typeof societe === "boolean" ? (societe ? <Check className="h-5 w-5 text-emerald-500 inline" /> : <span className="text-ink-300">—</span>) : <span className="text-ink-700">{societe}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 lg:px-8 pb-24">
        <h2 className="font-display text-3xl font-bold text-ink-900 text-center mb-12">
          Questions fréquentes
        </h2>
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <details key={i} className="group rounded-xl border border-ink-200 bg-white px-6 py-4 cursor-pointer hover:border-brand-300 transition-colors">
              <summary className="font-semibold text-ink-900 list-none flex items-center justify-between">
                {f.q}
                <span className="text-brand-600 ml-4 text-xl group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="mt-3 text-sm text-ink-600 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="bg-gradient-to-br from-brand-600 to-brand-800 text-white">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 py-20 text-center">
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
            Prêt à recevoir vos premières Pépites ?
          </h2>
          <p className="text-brand-100 text-lg mb-8 max-w-2xl mx-auto">
            Setup en 5 minutes. Premières détections sous 24-48h. Garantie 6 Pépites le premier mois.
          </p>
          <Link href="/signup" className="inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-8 py-4 text-base shadow-xl transition-all">
            Démarrer maintenant
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureRow({ icon, title, description, highlight }: { icon: React.ReactNode; title: string; description: string; highlight?: boolean }) {
  return (
    <div className={`flex gap-4 ${highlight ? "p-4 -mx-4 rounded-xl bg-amber-50 border border-amber-200" : ""}`}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div>
        <p className="font-semibold text-ink-900">{title}</p>
        <p className="text-sm text-ink-600 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

const COMPARISON: Array<[string, boolean | string, boolean | string, boolean | string]> = [
  ["Données 100% françaises", true, true, true],
  ["Qualification IA (Opus 4.7)", true, false, false],
  ["Détection temps réel multi-sources", true, false, false],
  ["Garantie qualité (Pépites)", true, false, false],
  ["Brief sur-mesure par lead", true, false, false],
  ["Rollover crédits", true, false, false],
  ["Setup ICP custom inclus", true, false, false],
  ["Tarif", "390€/mois", "139-500€/mois", "50-300€/mois"],
];

const FAQS = [
  { q: "Pourquoi une seule offre et pas plusieurs tiers ?", a: "Parce qu'on déteste la confusion. Un prix, une promesse, point. Si vous avez besoin de plus de volume (>200 leads/mois) ou de fonctionnalités multi-équipes, contactez-nous pour un devis custom." },
  { q: "C'est quoi exactement une « Pépite » ?", a: "Un lead avec un score Opus ≥ 8/10 — c'est-à-dire une boîte qui matche votre ICP ET qui présente un signal fort (vient de lever des fonds, recrute massivement, sort un nouveau produit, etc.). En moyenne 18-25 Pépites/mois sont détectées sur un client type." },
  { q: "Et si vous ne livrez pas mes 6 Pépites un mois ?", a: "C'est notre engagement contractuel. Si vous recevez moins de 6 Pépites un mois, votre quota du mois suivant est automatiquement doublé (120 leads inclus au lieu de 60). Vous ne payez jamais pour de l'air." },
  { q: "Que se passe-t-il si je n'utilise pas mes 60 leads dans le mois ?", a: "Vos crédits non-consommés roulent automatiquement sur les mois suivants (cumul max 4 mois = 240 crédits de stock). Si vous êtes en vacances ou en mois calme, rien n'est perdu." },
  { q: "Et si j'ai besoin de plus de 60 leads dans un mois explosif ?", a: "Vous pouvez acheter des leads supplémentaires à 8€ pièce, facturés en fin de mois sur la même carte. Vous gardez le contrôle — pas de quota imposé." },
  { q: "Sources : qu'est-ce qui est scrappé exactement ?", a: "9 sources publiques françaises : BODACC, INPI marques, France Travail, RSS Maddyness/Frenchweb, JOAFE, LinkedIn jobs, Welcome to the Jungle, Pappers SIRENE, et triggers spécialisés (Rodz, TheirStack). Tout est légal, public, et conforme RGPD." },
  { q: "Combien de temps pour voir les premiers résultats ?", a: "Setup en 5 minutes (questionnaire ICP). Premières détections sous 24-48h. Vous recevez ensuite des Pépites en continu, avec alertes Telegram/Slack si vous voulez." },
  { q: "Comment je peux annuler ?", a: "Engagement annuel obligatoire (c'est ce qui nous permet d'investir dans votre ICP custom). À l'échéance, vous pouvez annuler en 1 clic depuis votre dashboard sans aucun frais. Pas de tacite reconduction sans préavis." },
];
