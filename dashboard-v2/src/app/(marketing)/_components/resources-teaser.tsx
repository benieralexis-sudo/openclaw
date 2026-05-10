import Link from "next/link";
import { ArrowRight, BookOpen, FileText, Rss, Lock } from "lucide-react";

const TEASER = [
  {
    id: "academy-icp",
    icon: <BookOpen className="h-3.5 w-3.5" />,
    label: "Academy",
    badge: "5 min",
    title: "Construire son ICP en B2B FR",
    description: "Méthode pour identifier et formaliser votre profil cible idéal sur le marché français.",
    href: "/ressources#academy",
  },
  {
    id: "template-cold",
    icon: <FileText className="h-3.5 w-3.5" />,
    label: "Template",
    badge: "Email × 5",
    title: "Séquence cold email — Levée de fonds",
    description: "5 emails d'ouverture éprouvés pour contacter une boîte qui vient de lever.",
    href: "/ressources#templates",
  },
  {
    id: "blog-benchmark",
    icon: <Rss className="h-3.5 w-3.5" />,
    label: "Blog",
    badge: "Avr. 2026",
    title: "Étude de cas : ESN tech, 18 Pépites en 30 jours",
    description: "Comment notre client pilote a transformé sa prospection avec iFIND.",
    href: "/ressources#blog",
  },
];

export function ResourcesTeaser() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {TEASER.map((t) => (
        <Link
          key={t.id}
          href={t.href as never}
          className="group rounded-xl border border-ink-200 bg-white p-6 hover:border-brand-200 hover:shadow-md transition-all flex flex-col"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-500">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-brand-50 text-brand-700">
                {t.icon}
              </span>
              {t.label}
            </span>
            <span className="text-[10px] font-mono font-semibold text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.5 rounded">
              {t.badge}
            </span>
          </div>
          <h3 className="font-display text-base font-semibold text-ink-900 mb-2 leading-tight">{t.title}</h3>
          <p className="text-xs text-ink-600 leading-relaxed mb-4 flex-1">{t.description}</p>

          <div className="flex items-center justify-between text-[11px] text-ink-500 pt-3 border-t border-ink-100">
            <span className="inline-flex items-center gap-1">
              <Lock className="h-2.5 w-2.5" />
              Réservé clients
            </span>
            <span className="inline-flex items-center gap-1 text-brand-700 font-medium group-hover:translate-x-0.5 transition-transform">
              Voir
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
