import Link from "next/link";
import type { Metadata } from "next";
import { Check, Sparkles, Shield, Zap, RotateCcw, ArrowRight, X, Quote, TrendingUp, Lock, Headphones, Brain, Target } from "lucide-react";
import { TestimonialGrid } from "../_components/testimonial-grid";

export const metadata: Metadata = {
  title: "Tarifs — 390€/mois, 6 Pépites garanties",
  description:
    "Une seule offre claire : 390€/mois en annuel, 60 leads qualifiés inclus, 6 Pépites minimum garanties. Setup gratuit.",
  robots: { index: true, follow: true },
};

export default function TarifsPage() {
  return (
    <div className="bg-white overflow-hidden">
      {/* ════════════════════════════════════════════════════════════
          1 — HERO MASSIVE
          ═══════════════════════════════════════════════════════════ */}
      <section className="relative pt-20 pb-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-amber-50/60 via-white to-white" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-gradient-radial from-amber-300/30 via-transparent to-transparent blur-3xl" />
          <div className="absolute top-32 left-1/4 w-[400px] h-[400px] bg-gradient-radial from-brand-300/20 via-transparent to-transparent blur-3xl" />
          <svg className="absolute inset-0 w-full h-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative max-w-5xl mx-auto px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-amber-200 shadow-sm text-xs font-medium text-amber-800 mb-8">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Une offre. Une promesse. Zéro confusion.</span>
          </div>

          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-ink-900 tracking-tight leading-[1.0]">
            Vous payez la
            <br />
            <span className="relative inline-block mt-2">
              <span className="relative z-10 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 bg-clip-text text-transparent">
                qualité
              </span>
              <span className="absolute -inset-3 bg-amber-200/40 rounded-2xl blur-2xl -z-10" />
            </span>
            <span className="text-ink-700">,</span>
            <br />
            <span className="text-ink-700">pas le volume</span>
          </h1>

          <p className="mt-10 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            Une seule promesse mesurable :{" "}
            <span className="text-ink-900 font-semibold">6 Pépites par mois minimum</span>,
            ou on double votre quota le mois suivant. <span className="text-amber-700 font-semibold">Engagement contractuel.</span>
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          2 — PRICING CARD ULTRA PREMIUM
          ═══════════════════════════════════════════════════════════ */}
      <section className="relative pb-24">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          {/* Multi-layer glow background */}
          <div className="absolute inset-0 -m-16 -z-10">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-gradient-radial from-brand-300/30 via-transparent to-transparent blur-3xl" />
            <div className="absolute top-1/4 left-0 w-[400px] h-[400px] bg-gradient-radial from-amber-200/30 via-transparent to-transparent blur-3xl" />
          </div>

          <div className="relative rounded-3xl bg-gradient-to-br from-white via-white to-brand-50/30 border-2 border-brand-200 shadow-2xl overflow-hidden">
            {/* Animated top ribbon */}
            <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-r from-brand-700 via-brand-600 to-brand-700 flex items-center justify-center gap-2 text-white text-xs font-bold uppercase tracking-[0.15em]">
              <Sparkles className="h-3 w-3 text-amber-300" />
              <span>Offre publique unique · Pas de tier confus</span>
              <Sparkles className="h-3 w-3 text-amber-300" />
            </div>

            <div className="p-10 md:p-16 pt-20 md:pt-24">
              <div className="grid md:grid-cols-12 gap-10 items-start">
                {/* LEFT — Pricing */}
                <div className="md:col-span-5">
                  <p className="font-mono text-xs uppercase tracking-[0.15em] text-brand-700 font-bold mb-2">
                    iFIND Growth
                  </p>
                  <p className="text-sm text-ink-600 mb-8">
                    Conçu pour PME tech FR de 30 à 200 personnes
                  </p>

                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-display text-7xl lg:text-8xl font-bold bg-gradient-to-br from-ink-900 via-brand-800 to-brand-700 bg-clip-text text-transparent leading-none tracking-tight">390€</span>
                    <span className="text-ink-600 text-2xl">/mois</span>
                  </div>
                  <p className="text-sm text-ink-600 mb-1">Engagement annuel</p>
                  <p className="text-xs text-ink-500 mb-8">
                    Soit <span className="font-mono font-semibold text-ink-700">4 680€ HT/an</span> · Setup gratuit · TVA 20% en sus
                  </p>

                  <Link
                    href="/signup"
                    className="group relative block w-full text-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white font-semibold py-4 text-base shadow-2xl shadow-brand-500/30 hover:shadow-brand-500/50 transition-all overflow-hidden"
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                    <span className="relative flex items-center justify-center gap-2">
                      Démarrer maintenant
                      <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Link>
                  <p className="text-[11px] text-ink-500 text-center mt-3">
                    Paiement sécurisé Stripe · Annulation 1-clic à l&apos;échéance
                  </p>

                  {/* Trust badges row */}
                  <div className="mt-8 grid grid-cols-3 gap-2">
                    <Trust icon={<Lock className="h-4 w-4" />} label="RGPD" sub="Compliant" color="emerald" />
                    <Trust icon={<Shield className="h-4 w-4" />} label="Garanti" sub="Contractuel" color="brand" />
                    <Trust icon={<Headphones className="h-4 w-4" />} label="Support" sub="FR inclus" color="amber" />
                  </div>
                </div>

                {/* RIGHT — Features */}
                <div className="md:col-span-7">
                  {/* GUARANTEE BOX - The hero feature */}
                  <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-amber-100/60 to-amber-50 border-2 border-amber-300 p-6 mb-6 relative overflow-hidden shadow-lg shadow-amber-500/10">
                    <div className="absolute -top-8 -right-8 w-32 h-32 bg-amber-300/40 rounded-full blur-3xl" />
                    <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-amber-400/20 rounded-full blur-2xl" />
                    <div className="relative">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="flex-shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-xl shadow-amber-500/40">
                          <Shield className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-200/60 text-amber-800 text-[10px] font-bold uppercase tracking-wider mb-1">
                            <Sparkles className="h-2.5 w-2.5" />
                            Le killer feature
                          </div>
                          <p className="font-display font-bold text-xl text-amber-900">
                            Garantie 6 Pépites/mois
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-amber-900 leading-relaxed mb-3">
                        Si on vous livre <strong>moins de 6 Pépites</strong> (boîtes ULTRA chaudes, score ≥ 8/10) un mois,
                        votre quota est <strong>automatiquement doublé</strong> le mois suivant (120 leads inclus au lieu de 60).
                      </p>
                      <div className="inline-flex items-center gap-1.5 text-xs text-amber-800 font-medium">
                        <Check className="h-3.5 w-3.5" />
                        Engagement contractuel — personne d&apos;autre ne fait ça en France
                      </div>
                    </div>
                  </div>

                  {/* Other features */}
                  <div className="space-y-3">
                    <FeatureRow icon={<Zap className="h-4 w-4 text-brand-600" />} title="60 leads qualifiés inclus / mois" description="Détectés en temps réel sur 11 sources publiques FR" />
                    <FeatureRow icon={<RotateCcw className="h-4 w-4 text-emerald-600" />} title="Rollover crédits jusqu'à 4 mois" description="Mois calme = rien perdu, vos crédits roulent automatiquement" />
                    <FeatureRow icon={<TrendingUp className="h-4 w-4 text-brand-600" />} title="Overage flexible : 8€/lead" description="Mois explosif = topup à la demande, pas de quota imposé" />
                    <FeatureRow icon={<Brain className="h-4 w-4 text-brand-600" />} title="Brief Opus 4.7 sur chaque Pépite" description="Contexte + signal + pitch + objections — prêt à utiliser" />
                    <FeatureRow icon={<Target className="h-4 w-4 text-brand-600" />} title="Setup ICP custom + tuning inclus" description="Notre équipe configure votre profil cible avec vous" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Custom enterprise note */}
          <div className="mt-10 text-center">
            <div className="inline-flex items-center gap-3 px-6 py-3.5 rounded-full bg-white border border-ink-200 shadow-sm text-sm">
              <span className="font-semibold text-ink-900">Besoin sur mesure ?</span>
              <span className="text-ink-500">{">"}200 leads/mois ou multi-équipes</span>
              <Link href="/a-propos" className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-semibold">
                Devis personnalisé
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          3 — TEMOIGNAGES (3 cards)
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-gradient-to-b from-amber-50/30 via-white to-brand-50/30">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Ils ont signé</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Le verdict de nos clients
            </h2>
          </div>
          <TestimonialGrid />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          4 — ROI CALCULATOR (visuel pas interactif pour l'instant)
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-white">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Calcul ROI typique</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              ROI sous <span className="text-emerald-600">2 mois</span>
            </h2>
            <p className="mt-3 text-ink-600 max-w-xl mx-auto">
              Sur la base de 18 Pépites/mois (moyenne réelle DTL) avec un taux conversion 5% RDV→deal.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <RoiCard label="Coût iFIND" value="390€" sub="par mois (annuel)" tone="neutral" />
            <RoiCard label="Pépites livrées" value="18" sub="en moyenne / mois" tone="brand" />
            <RoiCard label="Deal moyen ESN" value="35 000€" sub="ARR par contrat" tone="emerald" />
          </div>
          <div className="mt-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-700 text-white p-8 text-center shadow-2xl shadow-emerald-500/20">
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-100 mb-3">ROI annuel</p>
            <div className="flex items-baseline justify-center gap-3 mb-2">
              <span className="font-display text-5xl md:text-6xl font-bold">×7,5</span>
              <span className="text-xl text-emerald-100">retour sur investissement</span>
            </div>
            <p className="text-sm text-emerald-100 max-w-xl mx-auto">
              1 deal closé par trimestre = 35 000€ ARR vs 4 680€ iFIND/an = ROI ×7,5.
              Avec 2 deals/an, ROI ×15.
            </p>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          5 — COMPARATOR EXPANDED
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-ink-950 text-white relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[300px] bg-gradient-radial from-amber-500/20 via-transparent to-transparent blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-400 font-bold mb-3">Benchmark marché 2026</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
              iFIND vs <span className="text-ink-500">les autres</span>
            </h2>
            <p className="text-ink-400 max-w-2xl mx-auto">
              Aucun outil français ne combine détection temps réel, qualification IA et garantie qualité.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-ink-800 bg-ink-900/40 backdrop-blur-sm shadow-2xl">
            <table className="w-full text-sm">
              <thead className="bg-ink-800/50 border-b border-ink-700">
                <tr>
                  <th className="text-left py-5 px-6 font-semibold text-ink-300"></th>
                  <th className="text-center py-5 px-4 font-display font-bold text-brand-300 bg-gradient-to-b from-brand-600/30 to-transparent">
                    iFIND <span className="text-[10px] font-normal text-brand-400 ml-1">🇫🇷</span>
                  </th>
                  <th className="text-center py-5 px-4 font-semibold text-ink-400">Pharow</th>
                  <th className="text-center py-5 px-4 font-semibold text-ink-400">Cognism</th>
                  <th className="text-center py-5 px-4 font-semibold text-ink-400">Apollo</th>
                  <th className="text-center py-5 px-4 font-semibold text-ink-400">Société.info</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {COMPARISON.map(([feature, ...values], i) => (
                  <tr key={i} className="hover:bg-ink-800/30 transition-colors">
                    <td className="py-3.5 px-6 text-ink-300 font-medium">{feature}</td>
                    {values.map((v, j) => (
                      <CellValue key={j} value={v} highlight={j === 0} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          6 — FAQ
          ═══════════════════════════════════════════════════════════ */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-600 font-bold mb-3">Questions fréquentes</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-ink-900">
              Tout ce qu&apos;il faut savoir
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="group rounded-xl border border-ink-200 bg-white px-6 py-5 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all open:bg-gradient-to-br open:from-brand-50/50 open:to-white open:border-brand-300 open:shadow-lg">
                <summary className="font-semibold text-ink-900 list-none flex items-center justify-between gap-4">
                  <span className="text-base">{f.q}</span>
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-lg group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-4 text-sm text-ink-600 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          7 — FINAL CTA
          ═══════════════════════════════════════════════════════════ */}
      <section className="relative bg-ink-950 text-white overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-radial from-brand-600/30 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-gradient-radial from-amber-500/20 via-transparent to-transparent blur-3xl" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid3" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid3)" />
        </svg>
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 py-20 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-200 text-xs font-medium mb-8 backdrop-blur-sm">
            <Sparkles className="h-3 w-3" />
            48h pour vos premières Pépites
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold mb-6 tracking-tight leading-[1.0]">
            Démarrez en
            <br />
            <span className="text-amber-300 drop-shadow-[0_0_30px_rgba(251,191,36,0.4)]">5 minutes.</span>
          </h2>
          <p className="text-ink-300 text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
            Setup gratuit. Premières Pépites sous 48h.
            Garantie 6 Pépites le premier mois ou quota doublé.
          </p>
          <Link href="/signup" className="group inline-flex items-center gap-2 rounded-xl bg-white text-brand-700 hover:bg-brand-50 font-semibold px-10 py-5 text-lg shadow-2xl shadow-brand-500/30 transition-all">
            Démarrer maintenant
            <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureRow({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3 group">
      <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-white shadow-sm border border-ink-100 flex items-center justify-center group-hover:scale-105 group-hover:border-brand-200 transition-all">{icon}</div>
      <div>
        <p className="font-semibold text-ink-900 text-sm">{title}</p>
        <p className="text-xs text-ink-600 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function Trust({ icon, label, sub, color }: { icon: React.ReactNode; label: string; sub: string; color: "emerald" | "brand" | "amber" }) {
  const colorClass = {
    emerald: "from-emerald-500 to-emerald-700 shadow-emerald-500/20",
    brand: "from-brand-500 to-brand-700 shadow-brand-500/20",
    amber: "from-amber-500 to-amber-700 shadow-amber-500/20",
  }[color];
  return (
    <div className="rounded-xl bg-white border border-ink-100 p-3 text-center shadow-sm hover:shadow-md transition-all">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br ${colorClass} text-white mb-1.5 shadow-md mx-auto`}>
        {icon}
      </div>
      <p className="text-[11px] font-bold text-ink-900">{label}</p>
      <p className="text-[10px] text-ink-500">{sub}</p>
    </div>
  );
}

function CellValue({ value, highlight }: { value: boolean | string; highlight?: boolean }) {
  return (
    <td className={`text-center py-4 px-4 ${highlight ? "bg-brand-600/15 border-x border-brand-500/30" : ""}`}>
      {typeof value === "boolean" ? (
        value ? (
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${highlight ? "bg-emerald-400 text-emerald-950" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"}`}>
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : (
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <X className="h-4 w-4" strokeWidth={3} />
          </span>
        )
      ) : (
        <span className={`inline-block font-mono text-xs px-2.5 py-1 rounded-md ${highlight ? "font-bold text-brand-200 bg-brand-500/20 border border-brand-400/40" : "text-ink-300 bg-ink-800/60"}`}>{value}</span>
      )}
    </td>
  );
}

function RoiCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "neutral" | "brand" | "emerald" }) {
  const toneClass = {
    neutral: "bg-white border-ink-200",
    brand: "bg-gradient-to-br from-brand-50 to-white border-brand-200",
    emerald: "bg-gradient-to-br from-emerald-50 to-white border-emerald-200",
  }[tone];
  const valueClass = {
    neutral: "text-ink-900",
    brand: "text-brand-700",
    emerald: "text-emerald-700",
  }[tone];
  return (
    <div className={`rounded-2xl p-6 border-2 text-center ${toneClass}`}>
      <p className="text-xs uppercase tracking-wider font-bold text-ink-500 mb-2">{label}</p>
      <p className={`font-display text-3xl font-bold ${valueClass}`}>{value}</p>
      <p className="text-xs text-ink-500 mt-1">{sub}</p>
    </div>
  );
}

const COMPARISON: Array<[string, ...(boolean | string)[]]> = [
  ["Données 100% françaises", true, true, false, false, true],
  ["Détection temps réel multi-sources", true, false, false, false, false],
  ["Qualification IA (Opus 4.7)", true, false, false, false, false],
  ["Garantie qualité contractuelle", true, false, false, false, false],
  ["Brief sur-mesure par lead", true, false, false, false, false],
  ["Rollover crédits", true, false, false, false, false],
  ["Setup ICP custom inclus", true, false, false, false, false],
  ["RGPD by design", true, true, true, false, true],
  ["Tarif starter", "390€/mo", "139€/mo", "$1500/an", "$49/user", "50€/mo"],
];

const FAQS = [
  { q: "Pourquoi une seule offre et pas plusieurs tiers ?", a: "Parce qu'on déteste la confusion. Un prix, une promesse, point. Linear, Stripe, Cal.com ont tous démarré avec 1 offre — c'est ce qui marche au stade où on est. Si vous avez besoin de plus de volume (>200 leads/mois) ou de fonctionnalités multi-équipes, contactez-nous pour un devis custom." },
  { q: "C'est quoi exactement une « Pépite » ?", a: "Un lead avec un score Opus ≥ 8/10 — c'est-à-dire une boîte qui matche votre ICP ET qui présente un signal fort (vient de lever des fonds, recrute massivement, sort un nouveau produit, etc.). En moyenne 18-25 Pépites/mois sont détectées sur un client type." },
  { q: "Et si vous ne livrez pas mes 6 Pépites un mois ?", a: "C'est notre engagement contractuel. Si vous recevez moins de 6 Pépites un mois, votre quota du mois suivant est automatiquement doublé (120 leads inclus au lieu de 60). Vous ne payez jamais pour de l'air." },
  { q: "Que se passe-t-il si je n'utilise pas mes 60 leads dans le mois ?", a: "Vos crédits non-consommés roulent automatiquement sur les mois suivants (cumul max 4 mois = 240 crédits de stock). Si vous êtes en vacances ou en mois calme, rien n'est perdu." },
  { q: "Et si j'ai besoin de plus de 60 leads dans un mois explosif ?", a: "Vous pouvez acheter des leads supplémentaires à 8€ pièce, facturés en fin de mois sur la même carte. Vous gardez le contrôle — pas de quota imposé." },
  { q: "Sources : qu'est-ce qui est scrappé exactement ?", a: "11 sources publiques françaises : BODACC, INPI marques, France Travail, presse Tech FR (RSS), JOAFE, LinkedIn jobs, Welcome to the Jungle, Pappers SIRENE, et 2 sources premium (intent data + tech stack discovery). Tout est légal, public, et conforme RGPD." },
  { q: "Combien de temps pour voir les premiers résultats ?", a: "Setup en 5 minutes (questionnaire ICP). Premières détections sous 48h. Vous recevez ensuite des Pépites en continu, avec alertes Telegram/Slack si vous voulez." },
  { q: "Comment je peux annuler ?", a: "Engagement annuel obligatoire (c'est ce qui nous permet d'investir dans votre ICP custom). À l'échéance, vous pouvez annuler en 1 clic depuis votre dashboard sans aucun frais. Pas de tacite reconduction sans préavis." },
];
