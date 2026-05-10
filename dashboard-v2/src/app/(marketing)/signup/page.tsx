import Link from "next/link";
import type { Metadata } from "next";
import { Mail, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Démarrer — Souscrire à iFIND Growth",
  description: "Démarrez avec iFIND. Setup en 5 minutes. Premières détections sous 48 heures.",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <section className="min-h-[80vh] flex items-center justify-center px-6 py-20">
      <div className="max-w-md w-full">
        <div className="rounded-2xl border border-ink-200 bg-white p-10 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-4">
            iFIND Growth · 390 €/mois
          </p>
          <h1 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 tracking-tight mb-4">
            Réservez votre accès.
          </h1>
          <p className="text-sm text-ink-600 mb-8 leading-relaxed">
            Le paiement automatique en ligne arrive sous quelques jours.
            En attendant, on vous contacte sous 24 heures pour démarrer.
            Premières Pépites sous 48 heures.
          </p>
          <a
            href="mailto:contact@ifind.fr?subject=Souscription%20iFIND%20Growth%20-%20390%E2%82%AC%2Fmois&body=Bonjour%2C%20je%20souhaite%20d%C3%A9marrer%20avec%20iFIND%20Growth."
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink-900 hover:bg-ink-800 text-white font-medium px-5 h-11 text-sm w-full"
          >
            <Mail className="h-4 w-4" />
            Me faire contacter
          </a>

          <hr className="my-8 border-ink-100" />

          <p className="text-xs text-ink-500 mb-3">Vous avez déjà un compte&nbsp;?</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-sm text-brand-700 hover:text-brand-800 font-medium link-underline"
          >
            Se connecter
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          Setup gratuit · Engagement annuel · Annulation à l&apos;échéance
        </p>
      </div>
    </section>
  );
}
