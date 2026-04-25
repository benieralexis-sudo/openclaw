"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ShieldCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = (await signIn.email({ email, password, callbackURL: callbackUrl })) as
        | { data?: unknown; error?: { message?: string; code?: string; status?: number } }
        | null;
      console.log("[ifind v2] signIn response:", res);
      if (res?.error) {
        const msg = res.error.message ?? `[v2] Erreur ${res.error.status ?? "?"} ${res.error.code ?? ""}`;
        setError(`[v2 Better Auth] ${msg}`);
      } else {
        router.push(callbackUrl as never);
        router.refresh();
      }
    } catch (err) {
      console.error("[ifind v2] login fail:", err);
      setError(`[v2] Connexion impossible : ${err instanceof Error ? err.message : "erreur inconnue"}`);
    } finally {
      setPending(false);
    }
  }

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
          <span className="font-display text-[22px] font-semibold tracking-tight text-ink-900">iFIND</span>
        </div>

        <Card className="shadow-lg">
          <CardContent className="px-9 py-8">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-mono font-semibold text-emerald-700 uppercase tracking-wider">
              ✓ Dashboard v2 · Better Auth
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Bonjour 👋</h1>
            <p className="mt-1 text-sm text-ink-600">
              Accédez à votre tableau de bord pour suivre vos triggers et vos RDV en temps réel.
            </p>
            <p className="mt-2 text-xs text-ink-500 font-mono">URL: ifind.fr/preview-v2/login</p>

            {error && (
              <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">
                <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="vous@entreprise.fr"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    aria-label={showPw ? "Cacher le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={pending || !email || !password}>
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connexion…
                  </>
                ) : (
                  <>
                    Se connecter
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {/* Bouton de pré-remplissage 1-clic pour debug */}
            <button
              type="button"
              onClick={() => {
                setEmail("benieralexis@gmail.com");
                setPassword("ifind2026");
                setError(null);
              }}
              className="mt-3 w-full rounded-md border border-dashed border-ink-300 bg-ink-50 px-3 py-2 text-[12px] text-ink-600 hover:bg-ink-100 transition-colors"
            >
              Pré-remplir : benieralexis@gmail.com / ifind2026
            </button>

            <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-ink-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Connexion sécurisée · Hébergement France · RGPD
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 text-center text-[13px] text-ink-500">
          <Link href="https://ifind.fr" className="font-medium text-brand-600 hover:text-brand-700">
            ← Retour au site
          </Link>
        </div>
      </div>
    </main>
  );
}
