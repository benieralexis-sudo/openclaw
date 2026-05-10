import Link from "next/link";
import { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { getSession } from "@/server/session";

// Refonte v5 (10/05/2026) — Layout marketing public.
// Direction : Stripe minimal premium / blanc pur / 1 accent bleu.
// Header neutre, footer aéré 3 colonnes, zéro drama visuel.

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const isAuthenticated = !!session;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* HEADER — sticky, blanc avec bordure subtile */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-ink-100">
        <nav className="max-w-6xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-90">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
              <span className="font-display text-sm font-bold text-white leading-none">i</span>
            </div>
            <span className="font-display text-base font-semibold text-ink-900 tracking-tight">iFIND</span>
            <span className="hidden sm:inline-flex items-center text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.5 rounded">
              FR
            </span>
          </Link>

          {/* Nav */}
          <div className="hidden md:flex items-center gap-1">
            <NavLink href="/produit">Produit</NavLink>
            <NavLink href="/tarifs">Tarifs</NavLink>
            <NavLink href="/a-propos">À propos</NavLink>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 h-9"
              >
                Mon dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden sm:inline-flex items-center text-sm font-medium text-ink-700 hover:text-ink-900 px-3 h-9 rounded-md hover:bg-ink-50">
                  Connexion
                </Link>
                <Link
                  href="/tarifs"
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 h-9"
                >
                  Démarrer
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* CONTENT */}
      <main className="flex-1">{children}</main>

      {/* FOOTER — manifesto + 4 colonnes + signature */}
      <footer className="bg-white border-t border-ink-100 mt-24">
        {/* Manifesto signature — phrase qui plante le drapeau */}
        <div className="max-w-6xl mx-auto px-6 lg:px-8 pt-20 pb-16 border-b border-ink-100">
          <p className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1] max-w-4xl">
            <span className="text-ink-300">Pas un fichier de leads.</span>{" "}
            <span className="bg-gradient-to-br from-brand-700 to-brand-900 bg-clip-text text-transparent">Une promesse mesurable.</span>
          </p>
        </div>

        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-14">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-10">
            {/* Brand */}
            <div className="col-span-2 md:col-span-5">
              <Link href="/" className="inline-flex items-center gap-2 mb-4">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm">
                  <span className="font-display text-sm font-bold text-white leading-none">i</span>
                </div>
                <span className="font-display text-base font-semibold text-ink-900 tracking-tight">iFIND</span>
                <span className="inline-flex items-center text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.5 rounded">
                  FR
                </span>
              </Link>
              <p className="text-sm text-ink-600 max-w-xs leading-relaxed">
                Le moteur de détection de signaux d&apos;achat sur les PME françaises.
              </p>
              <p className="mt-6 text-xs text-ink-400">
                <a href="mailto:contact@ifind.fr" className="hover:text-ink-700 transition-colors link-underline">contact@ifind.fr</a>
              </p>
            </div>

            <div className="md:col-span-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-900 mb-4">Produit</h4>
              <ul className="space-y-3">
                <FooterLink href="/produit">Fonctionnalités</FooterLink>
                <FooterLink href="/tarifs">Tarifs</FooterLink>
                <FooterLink href="/produit#sources">Sources</FooterLink>
                <FooterLink href="/produit#garantie">Garantie</FooterLink>
              </ul>
            </div>

            <div className="md:col-span-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-900 mb-4">Société</h4>
              <ul className="space-y-3">
                <FooterLink href="/a-propos">À propos</FooterLink>
                <FooterLink href="/login">Connexion</FooterLink>
                <FooterLink href="/signup">Démarrer</FooterLink>
              </ul>
            </div>

            <div className="md:col-span-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-900 mb-4">Légal</h4>
              <ul className="space-y-3">
                <FooterLink href="/cgv">CGV</FooterLink>
                <FooterLink href="/cgu">CGU</FooterLink>
                <FooterLink href="/rgpd">RGPD</FooterLink>
                <FooterLink href="/mentions-legales">Mentions légales</FooterLink>
                <FooterLink href="/cookies">Cookies</FooterLink>
              </ul>
            </div>
          </div>

          <div className="mt-14 pt-8 border-t border-ink-100 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-ink-500">
            <p>© {new Date().getFullYear()} iFIND · Tous droits réservés.</p>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                Tous systèmes opérationnels
              </span>
              <span className="text-ink-300">·</span>
              <span>Hébergé en France</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href as never}
      className="px-3 py-1.5 rounded-md text-sm font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-50 transition-colors"
    >
      {children}
    </Link>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href as never} className="text-sm text-ink-600 hover:text-ink-900 transition-colors">
        {children}
      </Link>
    </li>
  );
}
