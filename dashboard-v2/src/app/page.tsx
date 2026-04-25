import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Target, TrendingUp, Zap } from "lucide-react";

export default function HomePage() {
  return (
    <main className="relative min-h-screen mesh-soft">
      <div className="container-app pt-16 pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="brand" dot className="mb-6">
            Dashboard v2 — En développement
          </Badge>

          <h1 className="font-display text-5xl font-bold tracking-tight text-ink-900 md:text-6xl">
            iFIND Dashboard
            <span className="block text-brand-600">v2</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-600">
            Refonte complète propulsée par Next.js 15, Shadcn UI et Tailwind v4.
            Multi-tenant strict, données fraîches en temps réel, design system brand-cohérent
            avec ifind.fr.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="xl" asChild>
              <Link href="/login">
                Accéder au dashboard
                <span aria-hidden>→</span>
              </Link>
            </Button>
            <Button size="xl" variant="ghost" asChild>
              <Link href="https://ifind.fr">Retour au site</Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<Target className="h-5 w-5" />}
            title="Multi-tenant strict"
            description="Chaque client voit ses propres données. Isolation au niveau API + DB."
          />
          <FeatureCard
            icon={<Zap className="h-5 w-5" />}
            title="Données live"
            description="WebSocket + cache 1s + invalidation event-based. Pas de stale data."
          />
          <FeatureCard
            icon={<TrendingUp className="h-5 w-5" />}
            title="Pipeline visuel"
            description="Kanban drag&drop, KPIs animés, charts interactifs en temps réel."
          />
          <FeatureCard
            icon={<Sparkles className="h-5 w-5" />}
            title="UX premium"
            description="⌘K command palette, raccourcis, mobile-native, animations Motion."
          />
        </div>
      </div>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-brand-gradient transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700">
          {icon}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  );
}
