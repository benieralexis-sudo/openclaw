import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Connexion",
};

export default function LoginPage() {
  return (
    <main className="relative min-h-screen mesh-soft flex items-center justify-center px-6 py-12">
      <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden>
        <div
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(15 23 42 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(15 23 42 / 0.04) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 30%, black 0%, transparent 100%)",
          }}
          className="absolute inset-0"
        />
      </div>

      <div className="relative w-full max-w-[440px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-md shadow-brand-500/30">
            <span className="font-sans text-2xl font-semibold leading-none text-white">i</span>
          </div>
          <span className="font-display text-[22px] font-semibold tracking-tight text-ink-900">
            iFIND
          </span>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <Badge variant="brand" dot className="mb-1 self-start">
              Trigger Engine
            </Badge>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
              Bonjour 👋
            </h1>
            <p className="text-sm text-ink-600">
              Page login en cours de migration vers Better Auth.
              <br />
              <Link href="https://app.ifind.fr" className="font-medium text-brand-600 hover:text-brand-700">
                Utilisez l'ancien dashboard pour le moment →
              </Link>
            </p>
          </CardHeader>
          <CardContent>
            <Button size="lg" variant="secondary" className="w-full" asChild>
              <Link href={"/" as never}>
                Retour
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-ink-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Connexion sécurisée · Hébergement France · RGPD
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
