import Link from "next/link";
import { ReactNode } from "react";
import { Sparkles, Mail, ArrowRight, Shield } from "lucide-react";
import { getSession } from "@/server/session";

// Sprint Saint Graal (10/05/2026) — Layout pages publiques marketing.
// Header glass + footer 4-col premium type Linear/Stripe.

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const isAuthenticated = !!session;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* HEADER glass premium */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/70 border-b border-ink-100/80">
        <nav className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-2.5 transition-opacity hover:opacity-90">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-md shadow-brand-500/30 group-hover:shadow-lg group-hover:shadow-brand-500/40 transition-all">
              <span className="font-display text-base font-bold text-white">i</span>
            </div>
            <span className="font-display text-lg font-bold text-ink-900">iFIND</span>
            <span className="hidden sm:inline-flex text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.5 rounded">FR</span>
          </Link>

          {/* Nav links */}
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
                className="group inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white text-sm font-semibold px-4 h-9 shadow-md shadow-brand-500/30 hover:shadow-lg hover:shadow-brand-500/40 transition-all"
              >
                Mon dashboard
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="hidden sm:inline-flex items-center text-sm font-medium text-ink-700 hover:text-ink-900 px-3 h-9 rounded-lg hover:bg-ink-50 transition-all">
                  Connexion
                </Link>
                <Link
                  href="/tarifs"
                  className="group inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white text-sm font-semibold px-4 h-9 shadow-md shadow-brand-500/30 hover:shadow-lg hover:shadow-brand-500/40 transition-all"
                >
                  Démarrer
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* CONTENT */}
      <main className="flex-1">{children}</main>

      {/* FOOTER premium 4-col */}
      <footer className="relative bg-ink-950 text-ink-300 mt-24 overflow-hidden">
        {/* Glow accent */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/30 to-transparent" />
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[1000px] h-[200px] bg-gradient-radial from-brand-600/15 via-transparent to-transparent blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-12">
          {/* Top : 5 colonnes */}
          <div className="grid grid-cols-2 md:grid-cols-12 gap-8 mb-16">
            {/* Brand + tagline + newsletter */}
            <div className="col-span-2 md:col-span-5">
              <Link href="/" className="inline-flex items-center gap-2.5 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/30">
                  <span className="font-display text-lg font-bold text-white">i</span>
                </div>
                <span className="font-display text-xl font-bold text-white">iFIND</span>
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-300 bg-brand-900/50 border border-brand-800/40 px-1.5 py-0.5 rounded">FR</span>
              </Link>
              <p className="text-sm text-ink-400 max-w-sm leading-relaxed mb-6">
                Le moteur de détection de signaux d&apos;achat sur les PME françaises.
                <br />Triggers temps réel · Qualification IA · Garantie qualité.
              </p>

              {/* Newsletter */}
              <div className="max-w-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-ink-400 mb-3">Pépite hebdo</p>
                <p className="text-xs text-ink-500 mb-3">1 lead chaud FR analysé chaque semaine. Gratuit.</p>
                <form className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-500 pointer-events-none" />
                    <input
                      type="email"
                      placeholder="vous@entreprise.fr"
                      className="w-full pl-9 pr-3 h-9 rounded-md bg-ink-900 border border-ink-800 text-sm text-white placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/50"
                    />
                  </div>
                  <button type="submit" className="inline-flex items-center justify-center px-3 h-9 rounded-md bg-gradient-to-br from-brand-600 to-brand-800 hover:from-brand-700 hover:to-brand-900 text-white text-xs font-semibold shadow-md shadow-brand-500/30 transition-all">
                    S&apos;abonner
                  </button>
                </form>
              </div>
            </div>

            {/* Produit */}
            <div className="md:col-span-2">
              <h4 className="text-white text-xs font-bold uppercase tracking-wider mb-4">Produit</h4>
              <ul className="space-y-2.5">
                <FooterLink href="/produit">Fonctionnalités</FooterLink>
                <FooterLink href="/tarifs">Tarifs</FooterLink>
                <FooterLink href="/produit#detection">Sources FR</FooterLink>
                <FooterLink href="/produit#qualification">Cerveau Opus</FooterLink>
                <FooterLink href="/produit#garantie">Garantie Pépite</FooterLink>
              </ul>
            </div>

            {/* Entreprise */}
            <div className="md:col-span-2">
              <h4 className="text-white text-xs font-bold uppercase tracking-wider mb-4">Entreprise</h4>
              <ul className="space-y-2.5">
                <FooterLink href="/a-propos">À propos</FooterLink>
                <FooterLink href="/login">Connexion</FooterLink>
                <FooterLink href="/signup">Démarrer</FooterLink>
                <li className="flex items-center gap-1.5 text-sm text-ink-400">
                  <Mail className="h-3 w-3" />
                  <a href="mailto:contact@ifind.fr" className="hover:text-white transition-colors">contact@ifind.fr</a>
                </li>
              </ul>
            </div>

            {/* Légal */}
            <div className="md:col-span-3">
              <h4 className="text-white text-xs font-bold uppercase tracking-wider mb-4">Légal & sécurité</h4>
              <ul className="space-y-2.5">
                <FooterLink href="/cgv">Conditions de vente</FooterLink>
                <FooterLink href="/cgu">Conditions d&apos;utilisation</FooterLink>
                <FooterLink href="/rgpd">Politique RGPD</FooterLink>
                <FooterLink href="/cookies">Cookies</FooterLink>
                <FooterLink href="/mentions-legales">Mentions légales</FooterLink>
              </ul>
              <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-900/30 border border-emerald-800/40 text-emerald-300 text-[10px] font-semibold">
                <Shield className="h-3 w-3" />
                RGPD compliant
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="pt-8 border-t border-ink-800/60 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-ink-500">
            <div className="flex items-center gap-2">
              <span>© {new Date().getFullYear()} iFIND.</span>
              <span className="text-ink-700">·</span>
              <span>Tous droits réservés.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-amber-400" />
                <span>Made in France 🇫🇷</span>
              </span>
              <span className="text-ink-700">·</span>
              <span>Triggers temps réel · Sources publiques</span>
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
      className="px-3 py-1.5 rounded-md text-sm font-medium text-ink-700 hover:text-ink-900 hover:bg-ink-50 transition-all"
    >
      {children}
    </Link>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href as never} className="text-sm text-ink-400 hover:text-white transition-colors">
        {children}
      </Link>
    </li>
  );
}
