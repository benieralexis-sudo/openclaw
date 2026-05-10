import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpen, FileText, Lightbulb, Rss, Mail, Lock } from "lucide-react";
import { SectionHeading } from "../_components/section-heading";

export const metadata: Metadata = {
  title: "Ressources — iFIND Academy, templates, blog",
  description: "Tout pour maîtriser la prospection IA française : guides, templates de briefs, scripts d'appel, articles et études de cas.",
  robots: { index: true, follow: true },
};

export default function RessourcesPage() {
  return (
    <>
      {/* HERO */}
      <section className="pt-20 pb-12 md:pt-28 md:pb-16">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-700 mb-5">
            Ressources
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-ink-900 tracking-tight leading-[1.05]">
            Maîtrisez la{" "}
            <span className="bg-gradient-to-br from-brand-600 to-brand-800 bg-clip-text text-transparent">prospection IA française</span>.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto leading-relaxed">
            Guides, templates de briefs, scripts d&apos;appel, études de cas.
            Réservés aux clients iFIND et inscrits à la newsletter.
          </p>
        </div>
      </section>

      {/* ACADEMY */}
      <section id="academy" className="pb-20 md:pb-24 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-brand-50 text-brand-700 border border-brand-100">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-900">Academy</h2>
              <p className="text-sm text-ink-500">Guides courts et concrets pour mieux prospecter en B2B FR.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ACADEMY.map((a) => (
              <ResourceCard
                key={a.title}
                badge={a.duree}
                title={a.title}
                description={a.description}
                href="#"
                locked
              />
            ))}
          </div>
        </div>
      </section>

      {/* TEMPLATES */}
      <section id="templates" className="py-20 md:py-24 bg-ink-50/40 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-brand-50 text-brand-700 border border-brand-100">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-900">Templates</h2>
              <p className="text-sm text-ink-500">Briefs, scripts d&apos;appel, séquences email — prêts à utiliser.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEMPLATES.map((t) => (
              <ResourceCard
                key={t.title}
                badge={t.format}
                title={t.title}
                description={t.description}
                href="#"
                locked
              />
            ))}
          </div>
        </div>
      </section>

      {/* BLOG */}
      <section id="blog" className="py-20 md:py-24 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-brand-50 text-brand-700 border border-brand-100">
              <Rss className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-900">Blog</h2>
              <p className="text-sm text-ink-500">Études de cas, benchmarks marché, retours d&apos;expérience.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {BLOG.map((b) => (
              <ResourceCard
                key={b.title}
                badge={b.date}
                title={b.title}
                description={b.description}
                href="#"
                locked
              />
            ))}
          </div>
        </div>
      </section>

      {/* NEWSLETTER */}
      <section className="py-20 md:py-24 bg-ink-50/40">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <SectionHeading
            eyebrow="Pépite hebdo"
            title="1 lead chaud FR analysé chaque semaine."
            description="Inscrivez-vous pour recevoir 1 cas concret par semaine, anonymisé : signal détecté, brief Opus, angle d'attaque. Gratuit."
          />
          <div className="mt-10 max-w-md mx-auto flex gap-2">
            <input
              type="email"
              placeholder="vous@entreprise.fr"
              className="flex-1 h-11 px-4 rounded-md border border-ink-200 bg-white text-sm placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
            />
            <button className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 h-11 text-sm shadow-sm">
              <Mail className="h-4 w-4" />
              S&apos;abonner
            </button>
          </div>
          <p className="mt-4 text-xs text-ink-500">
            Pas de spam. Désinscription en 1 clic.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-24">
        <div className="max-w-4xl mx-auto px-6 lg:px-8">
          <div className="rounded-2xl bg-brand-950 text-white px-8 py-14 md:px-14 md:py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              Tout devient public<br className="hidden md:block" /> dès que vous êtes client.
            </h2>
            <p className="mt-5 text-base md:text-lg text-ink-300 max-w-xl mx-auto leading-relaxed">
              Academy + Templates + Blog complets — inclus dans iFIND Growth.
            </p>
            <Link
              href="/signup"
              className="mt-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-white text-ink-900 hover:bg-ink-100 font-medium px-5 h-11 text-sm"
            >
              Réserver ma place
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function ResourceCard({ badge, title, description, locked }: {
  badge: string;
  title: string;
  description: string;
  href: string;
  locked?: boolean;
}) {
  return (
    <div className="group rounded-xl border border-ink-200 bg-white p-5 hover:border-brand-200 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono font-semibold text-brand-700 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded">
          {badge}
        </span>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink-500">
            <Lock className="h-2.5 w-2.5" />
            Réservé clients
          </span>
        )}
      </div>
      <h3 className="font-display text-base font-semibold text-ink-900 mb-2 leading-tight">{title}</h3>
      <p className="text-xs text-ink-600 leading-relaxed">{description}</p>
    </div>
  );
}

const ACADEMY = [
  {
    duree: "5 min",
    title: "Construire son ICP en B2B FR",
    description: "Méthode pour identifier et formaliser votre profil cible idéal sur le marché français.",
  },
  {
    duree: "8 min",
    title: "Lire un brief IA en 30 secondes",
    description: "Comment extraire l'angle d'attaque d'un brief Opus pour ne pas perdre de temps en cold call.",
  },
  {
    duree: "12 min",
    title: "Anatomie d'une Pépite",
    description: "Décomposition d'un signal d'achat : taxonomie complète des triggers qui marchent en FR.",
  },
  {
    duree: "6 min",
    title: "BODACC, INPI, Pappers : que disent vraiment ces sources ?",
    description: "Guide pratique des 3 sources publiques FR les plus puissantes pour la prospection.",
  },
  {
    duree: "10 min",
    title: "Cold call après détection IA : pitch en 3 phrases",
    description: "Framework pour ouvrir un appel en référençant le signal détecté sans paraître stalker.",
  },
  {
    duree: "7 min",
    title: "Mesurer le ROI de la prospection IA",
    description: "Métriques à suivre : conversion Pépite → RDV → deal, cycle de vente, attribution.",
  },
];

const TEMPLATES = [
  {
    format: "Email × 5",
    title: "Séquence cold email — Levée de fonds",
    description: "5 emails d'ouverture éprouvés pour contacter une boîte qui vient de lever (Série A à C).",
  },
  {
    format: "Script",
    title: "Script d'appel — Recrutement tech massif",
    description: "Script de 2 minutes pour ouvrir un échange après détection d'un pic de recrutement tech.",
  },
  {
    format: "Doc",
    title: "Brief Opus → Pitch — Conversion",
    description: "Comment transformer un brief IA structuré en pitch oral fluide en moins de 10 minutes.",
  },
  {
    format: "Email × 3",
    title: "Séquence post-démo — Closing",
    description: "3 emails post-démo qui ramènent le prospect en cycle de décision sous 7 jours.",
  },
  {
    format: "Script",
    title: "Script LinkedIn DM — Changement dirigeant",
    description: "Approche LinkedIn pour reach un nouveau C-level sans paraître opportuniste.",
  },
  {
    format: "Excel",
    title: "Tracker conversion Pépite → Deal",
    description: "Tableur prêt à utiliser pour suivre la conversion sur 12 mois et calculer le ROI.",
  },
];

const BLOG = [
  {
    date: "Mai 2026",
    title: "Pourquoi 80% des outils prospection FR échouent",
    description: "Étude marché 2026 : ce qui distingue les outils qui marchent de ceux qui livrent du volume sans qualité.",
  },
  {
    date: "Avril 2026",
    title: "Étude de cas : ESN tech, 18 Pépites en 30 jours",
    description: "Comment notre client pilote a transformé sa prospection avec iFIND — chiffres et méthodologie.",
  },
  {
    date: "Avril 2026",
    title: "Benchmark : iFIND vs outils traditionnels",
    description: "Test comparatif sur 100 leads : précision IA, temps de qualification, taux de conversion RDV.",
  },
  {
    date: "Mars 2026",
    title: "RGPD : ce qui est légal en prospection BtoB FR",
    description: "Guide juridique complet : article 6.1.f, recommandations CNIL, durée de conservation.",
  },
  {
    date: "Mars 2026",
    title: "Comment construire un cerveau IA pour la qualification",
    description: "Architecture technique : 12 blocs de contexte, anti-hallucination, cache prompt à 97% hit.",
  },
  {
    date: "Février 2026",
    title: "Le futur de la prospection est en France",
    description: "Pourquoi le marché PME FR mérite ses propres outils, pas un wrapper d'Apollo.",
  },
];
