import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mentions légales",
  robots: { index: false, follow: true },
};

export default function MentionsLegalesPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-20">
      <h1 className="font-display text-4xl font-bold text-ink-900 mb-10">Mentions légales</h1>
      <div className="prose prose-ink max-w-none space-y-6 text-ink-700">
        <h2 className="font-display text-2xl font-bold text-ink-900">Éditeur du site</h2>
        <p>
          iFIND<br />
          [Raison sociale à compléter]<br />
          [Adresse complète]<br />
          SIRET : [À compléter]<br />
          Email : <a href="mailto:contact@ifind.fr" className="text-brand-600 underline">contact@ifind.fr</a>
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">Directeur de la publication</h2>
        <p>Alexis Bénier</p>

        <h2 className="font-display text-2xl font-bold text-ink-900">Hébergement</h2>
        <p>
          Hébergeur : [OVHcloud / Hetzner — à compléter]<br />
          Adresse : [À compléter]
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">Propriété intellectuelle</h2>
        <p>
          L&apos;ensemble du contenu de ce site (textes, images, logo, code source) est la propriété
          exclusive d&apos;iFIND. Toute reproduction, même partielle, est interdite sans autorisation
          écrite préalable.
        </p>
      </div>
    </div>
  );
}
