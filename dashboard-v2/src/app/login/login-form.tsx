"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ShieldCheck, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { signIn } from "@/lib/auth-client";

const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function LoginForm() {
  const params = useSearchParams();
  const rawCallback = params.get("callbackUrl");
  const callbackUrl = rawCallback
    ? rawCallback.startsWith(APP_BASE_PATH) ? rawCallback : `${APP_BASE_PATH}${rawCallback}`
    : `${APP_BASE_PATH}/dashboard`;

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
      const res = (await signIn.email({ email, password })) as
        | { data?: unknown; error?: { message?: string; code?: string; status?: number } }
        | null;
      if (res?.error) {
        setError(res.error.message ?? "Identifiants incorrects.");
      } else {
        window.location.href = callbackUrl;
      }
    } catch (err) {
      setError(`Connexion impossible : ${err instanceof Error ? err.message : "erreur inconnue"}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 py-12 bg-white">
      {/* Glow brand subtil */}
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-brand-200/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[420px]">
        {/* Logo */}
        <Link href="/" className="mb-10 flex items-center justify-center gap-2 transition-opacity hover:opacity-80">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-md">
            <span className="font-display text-lg font-bold leading-none text-white">i</span>
          </div>
          <span className="font-display text-xl font-semibold tracking-tight text-ink-900">iFIND</span>
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-ink-200 bg-white shadow-lg p-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Connexion à votre dashboard
          </h1>
          <p className="mt-2 text-sm text-ink-600 leading-relaxed">
            Suivez vos signaux, vos Pépites et votre garantie en temps réel.
          </p>

          {error && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-ink-900">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="vous@entreprise.fr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                className="w-full h-10 px-3 rounded-md border border-ink-200 bg-white text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-ink-900">Mot de passe</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 pl-3 pr-10 rounded-md border border-ink-200 bg-white text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900 transition-colors"
                  aria-label={showPw ? "Cacher le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={pending || !email || !password}
              className="w-full h-11 rounded-md bg-brand-700 hover:bg-brand-800 text-white font-medium text-sm shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
            >
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
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Connexion sécurisée · Hébergement France · RGPD
          </div>
        </div>

        <div className="mt-6 text-center text-[13px] text-ink-500">
          <Link href="/" className="font-medium text-brand-700 hover:text-brand-800 link-underline">
            ← Retour au site
          </Link>
        </div>
      </div>
    </main>
  );
}
