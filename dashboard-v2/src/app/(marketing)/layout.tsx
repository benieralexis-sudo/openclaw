import Link from "next/link";
import { ReactNode } from "react";
import { getSession } from "@/server/session";

// Sprint Saint Graal (10/05/2026) — Layout pages publiques marketing.
// Header transparent + footer pro. Pas d'auth requis.

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const isAuthenticated = !!session;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 border-b border-ink-100">
        <nav className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-xl font-bold text-ink-900">iFIND</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">FR</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-ink-700">
            <Link href="/produit" className="hover:text-brand-700 transition-colors">Produit</Link>
            <Link href="/tarifs" className="hover:text-brand-700 transition-colors">Tarifs</Link>
            <Link href="/a-propos" className="hover:text-brand-700 transition-colors">À propos</Link>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 h-9 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
              >
                Mon dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm font-medium text-ink-700 hover:text-ink-900">
                  Connexion
                </Link>
                <Link
                  href="/tarifs"
                  className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 h-9 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
                >
                  Démarrer
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="bg-ink-900 text-ink-300 mt-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-display text-2xl font-bold text-white">iFIND</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-brand-300 bg-brand-900/50 px-1.5 py-0.5 rounded">FR</span>
            </div>
            <p className="text-sm text-ink-400 max-w-sm">
              Le moteur de détection de signaux d&apos;achat sur les PME françaises.
              Triggers temps réel, qualification IA, garantie qualité.
            </p>
          </div>
          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Produit</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/produit" className="hover:text-white transition-colors">Fonctionnalités</Link></li>
              <li><Link href="/tarifs" className="hover:text-white transition-colors">Tarifs</Link></li>
              <li><Link href="/login" className="hover:text-white transition-colors">Se connecter</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Légal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/cgv" className="hover:text-white transition-colors">CGV</Link></li>
              <li><Link href="/cgu" className="hover:text-white transition-colors">CGU</Link></li>
              <li><Link href="/rgpd" className="hover:text-white transition-colors">RGPD</Link></li>
              <li><Link href="/mentions-legales" className="hover:text-white transition-colors">Mentions légales</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-ink-800">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-ink-500">
            <p>© {new Date().getFullYear()} iFIND. Tous droits réservés.</p>
            <p>Made in France 🇫🇷 — Triggers détectés en temps réel sur sources publiques FR</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
