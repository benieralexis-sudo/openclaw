import Link from "next/link";
import type { Metadata } from "next";
import { Shield, Zap, Mail } from "lucide-react";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Inscription — iFIND Growth · 390 €/mois",
  description: "Inscrivez-vous à iFIND Growth. Setup en 5 minutes. Premières détections sous 48 heures. Garantie 6 Pépites/mois.",
  robots: { index: true, follow: true },
};

export default function SignupPage() {
  return (
    <section className="py-20 md:py-28 px-6 lg:px-8">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-5 gap-12 lg:gap-16 items-start">
        {/* Left — Pitch + bénéfices */}
        <div className="lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            Inscription
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink-900 tracking-tight leading-[1.05] mb-6">
            Vos premières{" "}
            <span className="bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent">Pépites sous 48 h</span>.
          </h1>
          <p className="text-lg text-ink-600 leading-relaxed mb-10">
            Remplissez ce formulaire — on vous contacte sous 24 heures pour
            configurer votre ICP et lancer le moteur.
          </p>

          <ul className="space-y-4">
            <BenefitRow icon={<Zap className="h-4 w-4" />} title="Setup en 5 minutes" desc="Wizard ICP guidé : industrie, taille, signaux, anti-personas." />
            <BenefitRow icon={<Shield className="h-4 w-4" />} title="Garantie 6 Pépites/mois" desc="Si on ne tient pas, votre quota du mois suivant est doublé." />
            <BenefitRow icon={<Mail className="h-4 w-4" />} title="Aucun spam" desc="On vous contacte une fois pour onboarding, c'est tout." />
          </ul>

          <div className="mt-12 pt-8 border-t border-ink-100">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500 mb-3">
              Vous avez déjà un compte ?
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 link-underline"
            >
              Se connecter
            </Link>
          </div>
        </div>

        {/* Right — Form */}
        <div className="lg:col-span-3">
          <SignupForm />
        </div>
      </div>
    </section>
  );
}

function BenefitRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-md bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="font-display font-semibold text-ink-900 text-sm mb-0.5">{title}</p>
        <p className="text-xs text-ink-600 leading-relaxed">{desc}</p>
      </div>
    </li>
  );
}
