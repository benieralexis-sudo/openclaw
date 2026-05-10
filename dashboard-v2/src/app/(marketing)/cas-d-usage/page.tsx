import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Briefcase, Code, Lightbulb, Factory, Check } from "lucide-react";
import { SectionHeading } from "../_components/section-heading";

export const metadata: Metadata = {
  title: "Cas d'usage — iFIND par secteur",
  description: "Comment iFIND s'adapte à votre métier : ESN tech, SaaS B2B, Conseil tech, Industrie. Les signaux qui comptent vraiment pour vous.",
  robots: { index: true, follow: true },
};

export default function CasDUsagePage() {
  return (
    <>
      {/* HERO */}
      <section className="pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            Cas d&apos;usage
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight leading-[1.05]">
            Vos signaux d&apos;achat,{" "}
            <span className="bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent">par métier</span>.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            Chaque secteur a ses signaux. iFIND configure votre cerveau IA selon
            votre ICP et les patterns d&apos;achat propres à votre marché.
          </p>
        </div>
      </section>

      {/* USE CASES */}
      <section className="pb-20 md:pb-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {USE_CASES.map((u) => (
              <UseCase key={u.id} {...u} />
            ))}
          </div>
        </div>
      </section>

      {/* CUSTOM SECTION */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <SectionHeading
            eyebrow="Votre métier n'est pas listé ?"
            title="On configure votre ICP avec vous."
            description="iFIND s'adapte à n'importe quel ICP B2B sur le marché PME français. Notre équipe construit votre profil cible custom pendant le setup, sans frais supplémentaire."
          />
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium px-5 h-11 text-sm shadow-md shadow-brand-500/20"
            >
              S&apos;inscrire
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/produit"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white hover:bg-ink-50 text-ink-700 hover:text-ink-900 font-medium px-5 h-11 text-sm border border-ink-200"
            >
              Voir le produit
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl bg-brand-950 text-white px-8 py-14 md:px-14 md:py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Prêt à voir vos premières Pépites&nbsp;?
            </h2>
            <p className="mt-5 text-base md:text-lg text-ink-300 max-w-xl mx-auto leading-relaxed">
              Setup gratuit. Onboarding sous 24 heures. Premières détections sous 48 heures.
            </p>
            <Link
              href="/signup"
              className="mt-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-white text-ink-900 hover:bg-ink-100 font-medium px-5 h-11 text-sm"
            >
              S&apos;inscrire maintenant
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function UseCase({ id, icon, title, audience, signaux, exemple, conversion }: {
  id: string;
  icon: React.ReactNode;
  title: string;
  audience: string;
  signaux: string[];
  exemple: string;
  conversion: string;
}) {
  return (
    <div id={id} className="rounded-2xl border border-ink-200 bg-white p-7 hover:border-brand-200 hover:shadow-md transition-all scroll-mt-20">
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-brand-50 text-brand-700 border border-brand-100">
          {icon}
        </div>
        <div>
          <h3 className="font-display text-xl font-semibold text-ink-900">{title}</h3>
          <p className="text-xs text-ink-500">{audience}</p>
        </div>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500 mb-3 mt-6">
        Signaux qui comptent pour vous
      </p>
      <ul className="space-y-2 mb-6">
        {signaux.map((s) => (
          <li key={s} className="flex items-start gap-2 text-sm text-ink-700">
            <Check className="h-3.5 w-3.5 text-brand-700 flex-shrink-0 mt-1" strokeWidth={3} />
            <span>{s}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-lg bg-ink-50 border border-ink-100 p-4 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-1.5">Exemple Pépite</p>
        <p className="text-sm text-ink-700 leading-relaxed">{exemple}</p>
      </div>

      <p className="text-xs text-brand-700 font-medium">{conversion}</p>
    </div>
  );
}

const USE_CASES = [
  {
    id: "saas",
    icon: <Code className="h-5 w-5" />,
    title: "SaaS B2B",
    audience: "Éditeurs SaaS qui vendent à des PME tech",
    signaux: [
      "Levée de fonds (Pré-seed à Série C)",
      "Recrutements tech massifs (CTO, Lead Dev, QA)",
      "Lancement nouveau produit ou pivot",
      "Croissance effectif (>20% en 6 mois)",
    ],
    exemple: "Société FR plateforme RH vient de lever 12 M€ Série B et publie 3 offres QA Engineer en 7 jours. Le CTO publie personnellement le job « Test Automation Lead ». Score IA 9/10.",
    conversion: "Conversion typique : 18-25 Pépites/mois · ROI sous 2 mois sur deal moyen 35 k€ ARR",
  },
  {
    id: "esn",
    icon: <Briefcase className="h-5 w-5" />,
    title: "ESN tech",
    audience: "Cabinets de conseil et ESN spécialisés tech",
    signaux: [
      "Recrutements profils rares (Cloud Architect, DevOps Senior)",
      "Migration cloud annoncée (AWS, GCP, Azure)",
      "Refonte SI ou modernisation legacy",
      "Audit IT externe en cours",
    ],
    exemple: "PME industrielle 250 personnes annonce migration cloud AWS et publie 4 offres DevOps en 14 jours. DSI sortant remplacé. Score IA 8/10.",
    conversion: "Conversion typique : 15-22 Pépites/mois · Mission moyenne 80 k€ HT",
  },
  {
    id: "conseil",
    icon: <Lightbulb className="h-5 w-5" />,
    title: "Conseil tech / stratégie",
    audience: "Conseil produit, IA, transformation digitale",
    signaux: [
      "Changement dirigeant C-level (CEO, CTO, CDO)",
      "Acquisition ou cession récente",
      "Plan d'investissement 3-5 ans annoncé",
      "Restructuration ou plan social",
    ],
    exemple: "ETI services 800 personnes annonce nouveau CDO + budget transformation IA 5 M€. Communiqué presse + recrutement Head of AI Lab. Score IA 9/10.",
    conversion: "Conversion typique : 12-18 Pépites/mois · Honoraires moyens 60 k€ par mission",
  },
  {
    id: "industrie",
    icon: <Factory className="h-5 w-5" />,
    title: "Industrie",
    audience: "Solutions tech pour industrie 4.0 / manufacturing",
    signaux: [
      "Investissement industriel BPI / France 2030",
      "Recrutement CIO industriel ou Lead Data",
      "Annonce digitalisation ou Industrie 4.0",
      "Acquisition ligne de production",
    ],
    exemple: "PMI 350 personnes obtient 3 M€ subvention BPI plan France 2030 sur digitalisation et recrute Chef de projet IoT. Score IA 8/10.",
    conversion: "Conversion typique : 10-15 Pépites/mois · Cycle plus long mais panier 100 k€+",
  },
];
