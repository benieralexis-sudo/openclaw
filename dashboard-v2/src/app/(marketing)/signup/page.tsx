import Link from "next/link";
import type { Metadata } from "next";
import { Mail, ArrowRight, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Démarrer — Souscrire à iFIND Growth",
  description: "Démarrez avec iFIND. Setup en 5 minutes. Premières détections sous 48h.",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-gradient-to-br from-brand-50 to-white px-6 py-20">
      <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-ink-100 p-10 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium mb-6">
          <Clock className="h-3 w-3" />
          Paiement en ligne bientôt disponible
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-bold text-ink-900 mb-4">
          Réservez votre accès iFIND Growth
        </h1>
        <p className="text-ink-600 mb-8">
          Le paiement automatique en ligne arrive dans quelques jours. En attendant,
          contactez-nous directement pour démarrer — onboarding sous 24h, premières
          Pépites sous 48h.
        </p>
        <a
          href="mailto:contact@ifind.fr?subject=Souscription%20iFIND%20Growth%20-%20390€/mois"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold px-8 py-4 shadow-lg transition-all"
        >
          <Mail className="h-5 w-5" />
          Me faire contacter
        </a>
        <div className="mt-8 pt-8 border-t border-ink-100">
          <p className="text-sm text-ink-600 mb-3">Ou si vous avez déjà un compte :</p>
          <Link href="/login" className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium">
            Se connecter
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
