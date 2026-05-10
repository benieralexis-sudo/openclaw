import Link from "next/link";
import { Code, Briefcase, Lightbulb, Factory, ArrowRight } from "lucide-react";

const PERSONAS = [
  {
    id: "saas",
    icon: <Code className="h-4 w-4" />,
    title: "SaaS B2B",
    audience: "Éditeurs SaaS qui vendent à des PME tech",
    metric: "18-25",
    metricLabel: "Pépites/mois typiques",
    primarySignal: "Levée de fonds + recrutement tech",
  },
  {
    id: "esn",
    icon: <Briefcase className="h-4 w-4" />,
    title: "ESN tech",
    audience: "Cabinets de conseil tech",
    metric: "15-22",
    metricLabel: "Pépites/mois typiques",
    primarySignal: "Migration cloud + DevOps senior",
  },
  {
    id: "conseil",
    icon: <Lightbulb className="h-4 w-4" />,
    title: "Conseil tech",
    audience: "Conseil produit, IA, transformation",
    metric: "12-18",
    metricLabel: "Pépites/mois typiques",
    primarySignal: "Changement C-level + plan invest.",
  },
  {
    id: "industrie",
    icon: <Factory className="h-4 w-4" />,
    title: "Industrie 4.0",
    audience: "Solutions tech pour l'industrie",
    metric: "10-15",
    metricLabel: "Pépites/mois typiques",
    primarySignal: "Subvention BPI + IoT/digitalisation",
  },
];

export function UseCasesGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {PERSONAS.map((p) => (
        <Link
          key={p.id}
          href={`/cas-d-usage#${p.id}` as never}
          className="group relative rounded-xl bg-white border border-ink-200 p-6 hover:border-brand-300 hover:shadow-lg transition-all"
        >
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-brand-50 text-brand-700 border border-brand-100 mb-4">
            {p.icon}
          </div>
          <h3 className="font-display text-lg font-semibold text-ink-900 mb-1">{p.title}</h3>
          <p className="text-xs text-ink-500 leading-relaxed mb-5">{p.audience}</p>

          <div className="pt-4 border-t border-ink-100">
            <div className="flex items-baseline gap-1 mb-1">
              <span className="font-display text-2xl font-semibold tabular-nums text-ink-900">{p.metric}</span>
              <span className="text-[11px] text-ink-500">{p.metricLabel}</span>
            </div>
            <p className="text-[11px] text-brand-700 font-medium mt-2">
              {p.primarySignal}
            </p>
          </div>

          <span className="absolute top-5 right-5 text-ink-300 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-all">
            <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      ))}
    </div>
  );
}
