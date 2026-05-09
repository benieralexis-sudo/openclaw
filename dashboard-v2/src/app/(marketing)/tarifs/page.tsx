import Link from "next/link";
import type { Metadata } from "next";
import { Check, Sparkles, Shield, Zap, RotateCcw, ArrowRight, X, Quote, TrendingUp, Lock, HeadphonesIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Tarifs — 390€/mois, 6 Pépites garanties",
  description:
    "Une seule offre claire : 390€/mois en annuel, 60 leads qualifiés inclus, 6 Pépites minimum garanties. Setup gratuit.",
  robots: { index: true, follow: true },
};

export default function TarifsPage() {
  return (
    <div className="bg-white overflow-hidden">
      {/* ════════════ HERO ════════════ */}
      <section className="relative pt-20 pb-16 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-amber-50/50 via-white to-white" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-gradient-radial from-amber-300/20 via-transparent to-transparent blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100/80 border border-amber-200 text-amber-800 text-xs font-medium mb-8 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Une offre. Une promesse. Zéro confusion.
          </div>
          <h1 className="font-display text-5xl md:text-7xl font-bold text-ink-900 tracking-tight leading-[1.05]">
            Vous payez la
            <br />
            <span className="relative inline-block">
              <span className="relative z-10 bg-gradient-to-r from-brand-600 via-brand-700 to-brand-900 bg-clip-text text-transparent">
                qualité
              </span>
              <span className="absolute -inset-2 bg-amber-200/40 rounded-2xl blur-2xl -z-10" />
            </span>
            ,
            <br />
            <span className="text-ink-700">pas le volume</span>
          </h1>
          <p className="mt-8 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            Une seule promesse mesurable :{" "}
            <span className="text-ink-900 font-semibold">6 Pépites par mois minimum</span>,
            ou on double votre quota le mois suivant. C&apos;est notre engagement contractuel.
          </p>
        </div>
      </section>

      {/* ════════════ PRICING CARD ════════════ */}
      <section className="relative pb-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          {/* Glow background */}
          <div className="absolute inset-0 -m-12 -z-10">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-radial from-brand-200/40 via-transparent to-transparent blur-3xl" />
          </div>

          <div className="relative rounded-3xl bg-gradient-to-b from-white to-brand-50/30 border-2 border-brand-200 shadow-2xl overflow-hidden">
            {/* Top ribbon */}
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-brand-600 via-brand-700 to-brand-800 text-white text-xs font-bold uppercase tracking-wider px-6 py-2.5 flex items-center justify-center gap-2">
              <Sparkles className="h-3 w-3" />
              Offre publique unique
              <Sparkles className="h-3 w-3" />
            </div>

            <div className="p-10 md:p-14 pt-16 md:pt-20">
              <div className="grid md:grid-cols-12 gap-10 items-start">
                {/* Left : pricing + CTA */}
                <div className="md:col-span-5">
                  <p className="text-xs uppercase tracking-wider text-brand-700 font-bold mb-2">
                    iFIND Growth
                  </p>
                  <p className="text-sm text-ink-600 mb-8">
                    Pour PME tech FR de 30 à 200 personnes
                  </p>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-display text-7xl font-bold bg-gradient-to-br from-ink-900 via-brand-800 to-brand-700 bg-clip-text text-transparent leading-none">390€</span>
                    <span className="text-ink-600 text-xl">/mois</span>
                  </div>
                  <p className="text-sm text-ink-500 mb-2">Engagement annuel</p>
                  <p className="text-xs text-ink-400 mb-8">Soit <span className="font-mono font-semibold text-ink-700">4 680€ HT/an</span> · Setup gratuit</p>

                  <Link
                    href="/signup"
                    className="group block w-full text-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white font-semibold py-4 text-base shadow-xl shadow-brand-500/30 hover:shadow-2xl transition-all"
                  >
                    Démarrer maintenant
                    <ArrowRight className="h-5 w-5 inline ml-2 group-hover:translate-x-1 transition-transform" />
                  </Link>
                  <p className="text-xs text-ink-500 text-center mt-4">
                    Paiement sécurisé Stripe · TVA 20% en sus
                  </p>

                  {/* Trust badges */}
                  <div className="mt-8 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-white/60 backdrop-blur-sm border border-ink-100 px-3 py-3">
                      <Lock className="h-4 w-4 text-emerald-600 mx-auto mb-1" />
                      <p className="text-[10px] font-medium text-ink-700">RGPD</p>
                    </div>
                    <div className="rounded-lg bg-white/60 backdrop-blur-sm border border-ink-100 px-3 py-3">
                      <Shield className="h-4 w-4 text-brand-600 mx-auto mb-1" />
                      <p className="text-[10px] font-medium text-ink-700">Garanti</p>
                    </div>
                    <div className="rounded-lg bg-white/60 backdrop-blur-sm border border-ink-100 px-3 py-3">
                      <HeadphonesIcon className="h-4 w-4 text-amber-600 mx-auto mb-1" />
                      <p className="text-[10px] font-medium text-ink-700">Support FR</p>
                    </div>
                  </div>
                </div>

                {/* Right : features */}
                <div className="md:col-span-7">
                  {/* GUARANTEE BOX HIGHLIGHT */}
                  <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100/50 border-2 border-amber-300 p-6 mb-6 relative overflow-hidden">
                    <div className="absolute -top-4 -right-4 w-24 h-24 bg-amber-300/30 rounded-full blur-2xl" />
                    <div className="relative">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/30">
                          <Shield className="h-5 w-5 text-white" />
                        </div>
                        <span className="font-display font-bold text-lg text-amber-900">
                          Garantie 6 Pépites/mois
                        </span>
                      </div>
                      <p className="text-sm text-amber-900 leading-relaxed">
                        Si on vous livre <span className="font-bold">moins de 6 Pépites</span> (boîtes ULTRA chaudes, score ≥ 8/10) un mois,
                        votre quota est <span className="font-bold">automatiquement doublé</span> le mois suivant.
                        <br />
                        <span className="text-xs text-amber-800 mt-1 inline-block">→ Engagement contractuel. Personne d&apos;autre ne fait ça en France.</span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <FeatureRow icon={<Zap className="h-5 w-5 text-brand-600" />} title="60 leads qualifiés inclus / mois" description="Détectés en temps réel sur 11 sources publiques FR (BODACC, INPI, France Travail, LinkedIn jobs…)" />
                    <FeatureRow icon={<RotateCcw className="h-5 w-5 text-emerald-600" />} title="Rollover jusqu&apos;à 4 mois" description="Crédits non-utilisés roulent automatiquement. Mois calme = rien perdu." />
                    <FeatureRow icon={<TrendingUp className="h-5 w-5 text-brand-600" />} title="Overage flexible : 8€/lead" description="Mois explosif ? Achetez des leads supplémentaires à la demande." />
                    <FeatureRow icon={<Check className="h-5 w-5 text-brand-600" />} title="Setup, ICP custom & support inclus" description="On configure votre profil cible avec vous. Aucun frais caché." />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Custom enterprise note */}
          <div className="mt-10 text-center">
            <div className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-ink-50 border border-ink-200 text-sm text-ink-700">
              <span className="font-semibold">Besoin sur mesure ?</span>
              <span className="text-ink-500">Plus de 200 leads/mois ou multi-équipes</span>
              <Link href="/a-propos" className="text-brand-600 hover:text-brand-700 font-medium underline">
                Devis personnalisé →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ TÉMOIGNAGE ════════════ */}
      <section className="py-20 bg-gradient-to-br from-amber-50/50 via-white to-brand-50/50">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="relative bg-white rounded-3xl p-10 md:p-14 shadow-xl border border-ink-100">
            <Quote className="absolute -top-6 left-10 h-12 w-12 text-brand-600 fill-brand-600" />
            <p className="font-display text-2xl md:text-3xl text-ink-800 leading-relaxed font-medium">
              &laquo; La garantie 6 Pépites a été le déclic. Tous les autres outils me promettaient
              du volume sans engagement. iFIND est le premier qui met sa peau dans le jeu :
              ils s&apos;engagent sur la qualité, pas sur les chiffres bidons. &raquo;
            </p>
            <div className="mt-8 flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-200 to-brand-400 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-brand-500/20">
                FF
              </div>
              <div>
                <p className="font-semibold text-ink-900">Frédéric Flandrin</p>
                <p className="text-sm text-ink-500">Founder, DigiTestLab</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ COMPARATOR DRAMATIQUE ════════════ */}
      <section className="py-24 bg-ink-900 text-white relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-radial from-brand-600/20 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-400 font-bold mb-4">Comparaison marché</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
              iFIND vs Pharow vs Cognism vs Apollo
            </h2>
            <p className="text-ink-400 max-w-2xl mx-auto">
              Le seul outil français qui combine détection temps réel, qualification IA et garantie qualité.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-ink-800 bg-ink-800/30 backdrop-blur-sm shadow-2xl">
            <table className="w-full text-sm">
              <thead className="bg-ink-800/50 border-b border-ink-700">
                <tr>
                  <th className="text-left py-5 px-6 font-semibold text-ink-300"></th>
                  <th className="text-center py-5 px-6 font-display font-bold text-brand-300 bg-gradient-to-b from-brand-600/20 to-transparent">
                    iFIND <span className="text-[10px] font-normal text-brand-400 ml-1">🇫🇷</span>
                  </th>
                  <th className="text-center py-5 px-6 font-semibold text-ink-400">Pharow</th>
                  <th className="text-center py-5 px-6 font-semibold text-ink-400">Cognism</th>
                  <th className="text-center py-5 px-6 font-semibold text-ink-400">Apollo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {COMPARISON.map(([feature, ifind, pharow, cognism, apollo], i) => (
                  <tr key={i} className="hover:bg-ink-800/30 transition-colors">
                    <td className="py-3 px-6 text-ink-300 font-medium">{feature}</td>
                    <CellValue value={ifind} highlight />
                    <CellValue value={pharow} />
                    <CellValue value={cognism} />
                    <CellValue value={apollo} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ════════════ FAQ ════════════ */}
      <section className="py-24 bg-white">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-4">Questions fréquentes</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Tout ce qu&apos;il faut savoir
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="group rounded-xl border border-ink-200 bg-white px-6 py-5 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all open:bg-brand-50/30 open:border-brand-300">
                <summary className="font-semibold text-ink-900 list-none flex items-center justify-between gap-4">
                  {f.q}
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-lg group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-4 text-sm text-ink-600 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════ FINAL CTA ════════════ */}
      <section className="relative bg-ink-900 text-white overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-gradient-radial from-amber-500/20 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-24 text-center">
          <h2 className="font-display text-5xl md:text-6xl font-bold mb-6 tracking-tight">
            Démarrez en
            <br />
            <span className="bg-gradient-to-r from-amber-300 via-amber-200 to-white bg-clip-text text-transparent">
              5 minutes.
            </span>
          </h2>
          <p className="text-ink-300 text-lg mb-10 max-w-2xl mx-auto">
            Premières Pépites sous 48h. Garantie 6 Pépites le premier mois ou quota doublé.
            Engagement annuel, support FR inclus.
          </p>
          <Link href="/signup" className="inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-10 py-5 text-lg shadow-2xl shadow-brand-500/30 transition-all">
            Démarrer maintenant
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureRow({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3.5 group">
      <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-white shadow-sm border border-ink-100 flex items-center justify-center group-hover:scale-105 transition-transform">{icon}</div>
      <div>
        <p className="font-semibold text-ink-900 text-sm">{title}</p>
        <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function CellValue({ value, highlight }: { value: boolean | string; highlight?: boolean }) {
  return (
    <td className={`text-center py-3 px-6 ${highlight ? "bg-brand-600/5" : ""}`}>
      {typeof value === "boolean" ? (
        value ? (
          <Check className={`h-5 w-5 inline ${highlight ? "text-brand-300" : "text-emerald-400"}`} />
        ) : (
          <X className="h-5 w-5 inline text-ink-600" />
        )
      ) : (
        <span className={`font-mono text-xs ${highlight ? "font-bold text-brand-300" : "text-ink-300"}`}>{value}</span>
      )}
    </td>
  );
}

const COMPARISON: Array<[string, boolean | string, boolean | string, boolean | string, boolean | string]> = [
  ["Données 100% françaises", true, true, false, false],
  ["Détection temps réel multi-sources", true, false, false, false],
  ["Qualification IA (Opus 4.7)", true, false, false, false],
  ["Garantie qualité Pépites", true, false, false, false],
  ["Brief sur-mesure par lead", true, false, false, false],
  ["Rollover crédits", true, false, false, false],
  ["Setup ICP custom inclus", true, false, false, false],
  ["RGPD by design", true, true, true, false],
  ["Multi-tenant scope", true, false, true, true],
  ["Tarif starter", "390€/mo", "139€/mo", "$1500/an", "$49/user/mo"],
];

const FAQS = [
  { q: "Pourquoi une seule offre et pas plusieurs tiers ?", a: "Parce qu'on déteste la confusion. Un prix, une promesse, point. Linear, Stripe, Cal.com ont tous démarré avec 1 offre — c'est ce qui marche au stade où on est. Si vous avez besoin de plus de volume (>200 leads/mois) ou de fonctionnalités multi-équipes, contactez-nous pour un devis custom." },
  { q: "C'est quoi exactement une « Pépite » ?", a: "Un lead avec un score Opus ≥ 8/10 — c'est-à-dire une boîte qui matche votre ICP ET qui présente un signal fort (vient de lever des fonds, recrute massivement, sort un nouveau produit, etc.). En moyenne 18-25 Pépites/mois sont détectées sur un client type." },
  { q: "Et si vous ne livrez pas mes 6 Pépites un mois ?", a: "C'est notre engagement contractuel. Si vous recevez moins de 6 Pépites un mois, votre quota du mois suivant est automatiquement doublé (120 leads inclus au lieu de 60). Vous ne payez jamais pour de l'air." },
  { q: "Que se passe-t-il si je n'utilise pas mes 60 leads dans le mois ?", a: "Vos crédits non-consommés roulent automatiquement sur les mois suivants (cumul max 4 mois = 240 crédits de stock). Si vous êtes en vacances ou en mois calme, rien n'est perdu." },
  { q: "Et si j'ai besoin de plus de 60 leads dans un mois explosif ?", a: "Vous pouvez acheter des leads supplémentaires à 8€ pièce, facturés en fin de mois sur la même carte. Vous gardez le contrôle — pas de quota imposé." },
  { q: "Sources : qu'est-ce qui est scrappé exactement ?", a: "11 sources publiques françaises : BODACC, INPI marques, France Travail, RSS Maddyness/Frenchweb, JOAFE, LinkedIn jobs, Welcome to the Jungle, Pappers SIRENE, Rodz et TheirStack. Tout est légal, public, et conforme RGPD." },
  { q: "Combien de temps pour voir les premiers résultats ?", a: "Setup en 5 minutes (questionnaire ICP). Premières détections sous 48h. Vous recevez ensuite des Pépites en continu, avec alertes Telegram/Slack si vous voulez." },
  { q: "Comment je peux annuler ?", a: "Engagement annuel obligatoire (c'est ce qui nous permet d'investir dans votre ICP custom). À l'échéance, vous pouvez annuler en 1 clic depuis votre dashboard sans aucun frais. Pas de tacite reconduction sans préavis." },
];
