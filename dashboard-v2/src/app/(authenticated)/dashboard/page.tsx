import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowUpRight,
  Calendar,
  Flame,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const kpis = [
  {
    label: "Signaux 24h",
    value: "47",
    delta: "+12",
    deltaPct: "+34%",
    direction: "up" as const,
    icon: Zap,
    accent: "brand" as const,
  },
  {
    label: "Pépites ≥ 9/10",
    value: "5",
    delta: "+3",
    deltaPct: "nouvelles",
    direction: "up" as const,
    icon: Flame,
    accent: "fire" as const,
  },
  {
    label: "RDV bookés cette semaine",
    value: "8",
    delta: "+2",
    deltaPct: "vs sem -1",
    direction: "up" as const,
    icon: Calendar,
    accent: "success" as const,
  },
  {
    label: "Délai signal → vous",
    value: "28",
    suffix: "min",
    delta: "-4 min",
    deltaPct: "vs hier",
    direction: "up" as const,
    icon: Activity,
    accent: "info" as const,
  },
];

const recentTriggers = [
  {
    company: "Industrie aéronautique · Île-de-France",
    type: "Levée de fonds Série A",
    detail: "4,5 M€ — annonce officielle",
    score: 10,
    badge: "Combo 🔥",
    accent: "fire" as const,
    age: "il y a 2 min",
  },
  {
    company: "SaaS B2B · Lyon",
    type: "Recrutement Head of Sales",
    detail: "1er commercial — runway 18 mois",
    score: 9,
    badge: "Hot",
    accent: "warning" as const,
    age: "il y a 8 min",
  },
  {
    company: "ETI agro · Pays de la Loire",
    type: "Dépôt INPI nouvelle marque",
    detail: "Lancement gamme produit Q3",
    score: 8,
    badge: "Qualifié",
    accent: "brand" as const,
    age: "il y a 17 min",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            const accentBg = {
              brand: "bg-brand-50 text-brand-600",
              fire: "bg-orange-50 text-orange-600",
              success: "bg-emerald-50 text-emerald-600",
              info: "bg-cyan-50 text-cyan-600",
            }[kpi.accent];
            return (
              <Card key={kpi.label} className="overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className="px-5 pt-5">
                  <div className="flex items-start justify-between">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentBg}`}>
                      <Icon className="h-4 w-4" strokeWidth={2} />
                    </div>
                    <Badge variant={kpi.direction === "up" ? "success" : "danger"} size="sm">
                      <TrendingUp className="h-3 w-3" />
                      {kpi.delta}
                    </Badge>
                  </div>
                  <p className="mt-4 text-[12px] font-medium uppercase tracking-wider text-ink-500">
                    {kpi.label}
                  </p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-display text-3xl font-bold tracking-tight text-ink-900">
                      {kpi.value}
                    </span>
                    {kpi.suffix && <span className="text-sm text-ink-500">{kpi.suffix}</span>}
                  </div>
                  <p className="mt-1 mb-5 text-xs text-ink-500">{kpi.deltaPct}</p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Pépites du jour + Pipeline summary */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Pépites */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500" />
                Pépites du jour
              </CardTitle>
              <CardDescription>Les signaux les plus chauds détectés sur les dernières 24h</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 text-brand-600">
              Voir tout
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-ink-100">
              {recentTriggers.map((t, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 group cursor-pointer"
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    t.accent === "fire" ? "bg-orange-50 text-orange-600" :
                    t.accent === "warning" ? "bg-amber-50 text-amber-600" :
                    "bg-brand-50 text-brand-600"
                  }`}>
                    <Zap className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[13.5px] font-medium text-ink-900 truncate">{t.type}</p>
                      <span className="font-mono text-[11px] text-ink-400">{t.age}</span>
                    </div>
                    <p className="text-xs text-ink-500 truncate">{t.company} · {t.detail}</p>
                  </div>
                  <Badge variant="score" size="md" className="shrink-0">
                    {t.score}/10
                  </Badge>
                  <Badge variant={t.accent} size="sm" className="hidden md:inline-flex">{t.badge}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Pipeline résumé */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4 text-brand-600" />
              Pipeline RDV
            </CardTitle>
            <CardDescription>État de la conversion cette semaine</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Signaux qualifiés", value: 47, color: "bg-brand-500", pct: 100 },
              { label: "Contactés", value: 32, color: "bg-cyan-500", pct: 68 },
              { label: "Réponses positives", value: 12, color: "bg-amber-500", pct: 26 },
              { label: "RDV bookés", value: 8, color: "bg-emerald-500", pct: 17 },
            ].map((step) => (
              <div key={step.label}>
                <div className="mb-1 flex items-baseline justify-between text-[13px]">
                  <span className="text-ink-700">{step.label}</span>
                  <span className="font-mono font-semibold tabular-nums text-ink-900">{step.value}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={`h-full rounded-full ${step.color} transition-all`}
                    style={{ width: `${step.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Note Phase 1 */}
      <Card className="border-dashed bg-brand-50/50 border-brand-200">
        <CardContent className="flex items-start gap-4 py-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-base font-semibold text-ink-900">
              Dashboard v2 — Phase 1 en cours
            </h3>
            <p className="mt-1 text-sm text-ink-600">
              Cette page utilise des données mock le temps que la migration vers Postgres + Better Auth
              soit terminée (Phase 1.3 et 1.4). Les vraies données arriveront connectées dès Phase 1.6.
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="success" dot>Light-mode brand</Badge>
              <Badge variant="brand" dot>Multi-tenant scope</Badge>
              <Badge variant="info" dot>⌘K command palette</Badge>
              <Badge variant="warning" dot>Live indicator</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
