import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "À propos — La vision iFIND",
  description: "Pourquoi iFIND existe. Le pari : la qualité IA bat le volume sur le marché B2B FR.",
  robots: { index: true, follow: true },
};

export default function AProposPage() {
  return (
    <div className="bg-white">
      <section className="max-w-3xl mx-auto px-6 lg:px-8 pt-20 pb-16">
        <h1 className="font-display text-5xl md:text-6xl font-bold text-ink-900 tracking-tight mb-8">
          Construire le meilleur outil de prospection FR.
        </h1>
        <div className="prose prose-lg prose-ink max-w-none text-ink-700 space-y-6">
          <p>
            En France, en 2026, vendre en B2B reste un casse-tête : les outils américains
            (Apollo, ZoomInfo) n&apos;ont pas la donnée FR. Les outils français (Pharow,
            Société.info) vendent de la donnée brute sans intelligence. Et tous vous demandent
            de trier 500 prospects pour trouver 5 vraies pépites.
          </p>
          <p className="text-2xl font-display font-bold text-ink-900">
            iFIND est né de cette frustration.
          </p>
          <p>
            On a construit le seul moteur français qui fait <strong>les 3 à la fois</strong> :
            détecter en temps réel sur 9 sources publiques FR, qualifier chaque signal avec
            Claude Opus 4.7, et garantir contractuellement un minimum de Pépites par mois.
          </p>
          <p>
            On vend une <strong>promesse mesurable</strong>, pas une base de données. On
            préfère livrer 6 vraies opportunités chaudes par mois que 600 contacts froids.
          </p>
          <h2 className="font-display text-3xl font-bold text-ink-900 mt-12 mb-4">
            Notre vision
          </h2>
          <p>
            Démocratiser l&apos;accès à la qualification IA pour toutes les PME tech françaises.
            Aujourd&apos;hui, seules les ETI peuvent se permettre Cognism à 5000€/an/user.
            Demain, votre PME de 30 personnes le pourra aussi à 390€/mois.
          </p>
          <h2 className="font-display text-3xl font-bold text-ink-900 mt-12 mb-4">
            Nos engagements
          </h2>
          <ul className="space-y-3">
            <li><strong>Transparence pricing</strong> : un seul prix, public, sans rabais douteux. Ce que vous voyez est ce que vous payez.</li>
            <li><strong>Garantie qualité contractuelle</strong> : 6 Pépites/mois minimum, sinon quota doublé.</li>
            <li><strong>RGPD by design</strong> : 100% des données scrapées sont publiques et légales (BODACC, INPI, etc.).</li>
            <li><strong>Made in France</strong> : développé, hébergé, supporté en France 🇫🇷.</li>
          </ul>
        </div>
      </section>

      <section className="bg-ink-50 py-20">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="font-display text-3xl font-bold text-ink-900 mb-4">
            Une question ? Un devis custom ?
          </h2>
          <p className="text-ink-600 mb-8">
            Pour les besoins {">"}200 leads/mois ou multi-équipes, on construit un devis sur mesure.
          </p>
          <a href="mailto:contact@ifind.fr" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold px-8 py-4 shadow-lg transition-all">
            <Mail className="h-5 w-5" />
            contact@ifind.fr
          </a>
          <div className="mt-12">
            <Link href="/tarifs" className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium">
              Voir les tarifs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
