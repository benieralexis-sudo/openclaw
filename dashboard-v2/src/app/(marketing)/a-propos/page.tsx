import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "À propos — La vision iFIND",
  description:
    "Pourquoi iFIND existe. Le pari : la qualité IA bat le volume sur le marché B2B FR.",
  robots: { index: true, follow: true },
};

export default function AProposPage() {
  return (
    <>
      <section className="pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            À propos
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight leading-[1.05]">
            Construire le moteur de prospection le plus précis de France.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-600 leading-relaxed">
            iFIND n&apos;est ni une base de données ni un agrégateur. C&apos;est un engagement
            mesurable sur la qualité des leads livrés.
          </p>
        </div>
      </section>

      <section className="pb-20 md:pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <div className="space-y-8 text-[16px] text-ink-700 leading-[1.7]">
            <p>
              En 2026, la prospection B2B en France reste un casse-tête. Les outils américains
              (Apollo, ZoomInfo, Cognism) couvrent mal la donnée FR. Les outils français
              (Pharow, Société.info) vendent de la donnée brute sans intelligence. Et tous
              demandent au commercial de trier 500 prospects pour trouver 5 vraies opportunités.
            </p>
            <p className="font-display text-2xl md:text-3xl font-semibold text-ink-900 leading-tight">
              iFIND est né de cette frustration.
            </p>
            <p>
              On a construit le seul moteur français qui fait <strong className="text-ink-900">les trois à la fois</strong> :
              détecter en temps réel sur 11 sources publiques FR, qualifier chaque signal
              avec Claude Opus 4.7, et garantir contractuellement un minimum de 6 Pépites par mois.
            </p>
            <p>
              Le pari : une promesse mesurable bat un fichier de 50 000 contacts froids.
              Plutôt que vendre du volume, on s&apos;engage sur la qualité.
            </p>
          </div>

          <hr className="my-16 border-ink-100" />

          <div className="space-y-12">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 mb-4 tracking-tight">
                Notre vision
              </h2>
              <p className="text-[16px] text-ink-700 leading-[1.7]">
                Démocratiser l&apos;accès à la qualification IA pour toutes les PME tech françaises.
                Aujourd&apos;hui, seules les ETI peuvent se permettre Cognism à 5 000 € par an et par utilisateur.
                Demain, votre PME de 30 personnes le pourra aussi à 390 € par mois.
              </p>
            </div>

            <div>
              <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 mb-6 tracking-tight">
                Nos engagements
              </h2>
              <ul className="space-y-4">
                {ENGAGEMENTS.map((e) => (
                  <li key={e.title} className="rounded-lg border border-ink-200 bg-white p-5">
                    <p className="font-display font-semibold text-ink-900 mb-1.5">{e.title}</p>
                    <p className="text-sm text-ink-600 leading-relaxed">{e.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink-900 tracking-tight">
            Une question, un devis custom&nbsp;?
          </h2>
          <p className="mt-5 text-base md:text-lg text-ink-600 max-w-xl mx-auto leading-relaxed">
            Pour les besoins {">"} 200 leads par mois ou multi-équipes, on construit un devis sur mesure.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:contact@ifind.fr"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink-900 hover:bg-ink-800 text-white font-medium px-5 h-11 text-sm"
            >
              <Mail className="h-4 w-4" />
              contact@ifind.fr
            </a>
            <Link
              href="/tarifs"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white hover:bg-ink-50 text-ink-700 hover:text-ink-900 font-medium px-5 h-11 text-sm border border-ink-200"
            >
              Voir les tarifs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

const ENGAGEMENTS = [
  {
    title: "Transparence pricing",
    description: "Un seul prix public, sans rabais douteux ni tacite reconduction. Ce que vous voyez est ce que vous payez.",
  },
  {
    title: "Garantie qualité contractuelle",
    description: "6 Pépites par mois minimum. Si on ne tient pas, votre quota du mois suivant est doublé. Engagement écrit.",
  },
  {
    title: "RGPD by design",
    description: "100 % des données scrapées sont publiques et légales (BODACC, INPI, etc.). Hébergement EU uniquement.",
  },
  {
    title: "Hébergé en France",
    description: "Développé, hébergé et supporté en France. Aucun transfert hors UE.",
  },
];
