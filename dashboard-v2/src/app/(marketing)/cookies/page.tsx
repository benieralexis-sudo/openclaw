import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique cookies",
  robots: { index: false, follow: true },
};

export default function CookiesPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-20">
      <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink-900 mb-2">Politique cookies</h1>
      <p className="text-sm text-ink-500 mb-10">Dernière mise à jour : 10 mai 2026</p>
      <div className="max-w-none space-y-5 text-[15px] text-ink-700 leading-[1.7]">
        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">Cookies utilisés</h2>
        <p>iFIND utilise uniquement des cookies <strong>strictement nécessaires</strong> au fonctionnement de la plateforme :</p>
        <ul>
          <li><strong>Cookie de session</strong> (nom : <code>ifind.session</code>) : maintient votre connexion. Durée : 30 jours. Indispensable.</li>
          <li><strong>Cookie de cache</strong> (nom : <code>ifind.cache</code>) : optimise le chargement du dashboard. Durée : 5 minutes. Indispensable.</li>
        </ul>
        <p>
          Aucun cookie publicitaire, aucun tracking tiers, aucun pixel Facebook/Google/LinkedIn.
          Pas de bandeau cookie nécessaire car cookies strictement nécessaires (article 82 LIL).
        </p>
        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">Analytics</h2>
        <p>Si analytics activés (Plausible.io en option) : analytics privacy-first, sans cookie, sans IP stockée, conforme RGPD sans consentement.</p>
      </div>
    </div>
  );
}
