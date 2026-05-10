import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CGU — Conditions Générales d'Utilisation",
  robots: { index: false, follow: true },
};

export default function CguPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-20">
      <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink-900 mb-2">Conditions Générales d&apos;Utilisation</h1>
      <p className="text-sm text-ink-500 mb-10">Dernière mise à jour : 10 mai 2026</p>
      <div className="max-w-none space-y-5 text-[15px] text-ink-700 leading-[1.7]">
        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">1. Acceptation</h2>
        <p>L&apos;utilisation de la plateforme iFIND implique l&apos;acceptation pleine et entière des présentes CGU.</p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">2. Accès et compte utilisateur</h2>
        <p>
          L&apos;accès à iFIND nécessite la création d&apos;un compte. L&apos;utilisateur est responsable de la
          confidentialité de ses identifiants. Toute action effectuée depuis son compte est
          réputée effectuée par lui.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">3. Utilisation conforme</h2>
        <p>
          L&apos;utilisateur s&apos;engage à utiliser iFIND conformément aux lois en vigueur, notamment :
          ne pas utiliser les données fournies pour du démarchage non sollicité illicite, respecter
          le RGPD dans son outreach, ne pas tenter de scraper, copier ou redistribuer les données
          fournies par iFIND.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">4. Propriété intellectuelle</h2>
        <p>
          La plateforme iFIND, son code, son design, ses algorithmes IA et sa marque sont la
          propriété exclusive d&apos;iFIND. Toute reproduction est interdite sans autorisation écrite.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">5. Disponibilité du service</h2>
        <p>
          iFIND s&apos;engage à un objectif de disponibilité de 99% sur l&apos;année. Des interruptions
          peuvent survenir pour maintenance ou incident technique sans engager la responsabilité
          d&apos;iFIND au-delà du remboursement prorata des jours d&apos;indisponibilité.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">6. Suspension / Résiliation</h2>
        <p>
          iFIND se réserve le droit de suspendre tout compte en cas d&apos;utilisation abusive ou
          contraire aux présentes CGU, sans préavis et sans remboursement.
        </p>
      </div>
    </div>
  );
}
