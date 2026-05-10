import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CGV — Conditions Générales de Vente",
  robots: { index: false, follow: true },
};

export default function CgvPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-20">
      <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink-900 mb-2">Conditions Générales de Vente</h1>
      <p className="text-sm text-ink-500 mb-10">Dernière mise à jour : 10 mai 2026</p>
      <div className="max-w-none space-y-5 text-[15px] text-ink-700 leading-[1.7]">
        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">1. Objet</h2>
        <p>
          Les présentes Conditions Générales de Vente (CGV) régissent les relations contractuelles
          entre iFIND, exploité par [Raison sociale à compléter], et tout client professionnel
          souscrivant à l&apos;offre Growth.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">2. Description de l&apos;offre</h2>
        <p>
          L&apos;offre Growth comprend : 60 leads qualifiés inclus par mois, 6 Pépites minimum
          garanties par mois, rollover des crédits non-utilisés sur 4 mois maximum, overage
          flexible à 8€ HT par lead supplémentaire, support et configuration ICP inclus.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">3. Tarifs et facturation</h2>
        <p>
          Le prix de l&apos;offre Growth est de 390€ HT par mois, soit 4 680€ HT par an, payable
          en une seule fois à la souscription. La TVA française au taux légal en vigueur (20%
          au 10/05/2026) s&apos;ajoute. Les prix peuvent être révisés à l&apos;échéance annuelle.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">4. Garantie Pépite</h2>
        <p>
          iFIND s&apos;engage à livrer un minimum de 6 Pépites (leads avec score Opus ≥ 8/10) par
          mois. Si ce minimum n&apos;est pas atteint, le quota mensuel du mois suivant est
          automatiquement doublé (120 leads inclus au lieu de 60). Cet engagement constitue la
          seule garantie contractuelle quant au volume livré.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">5. Engagement et résiliation</h2>
        <p>
          La souscription est annuelle ferme. Le client peut résilier à tout moment via son
          dashboard, la résiliation prend effet à l&apos;échéance annuelle. Aucun remboursement
          n&apos;est prévu en cas de résiliation anticipée. Pas de tacite reconduction sans
          notification préalable du client 30 jours avant l&apos;échéance.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">6. Données et RGPD</h2>
        <p>
          Toutes les données fournies via iFIND sont issues de sources publiques françaises (BODACC,
          INPI, Pappers, France Travail, etc.) conformément au RGPD. Voir la <a href="/rgpd" className="text-brand-600 underline">Politique RGPD</a> pour les détails.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">7. Responsabilité</h2>
        <p>
          iFIND s&apos;engage à fournir un service avec les meilleurs standards techniques mais ne
          peut garantir un taux de conversion ou de retour sur investissement spécifique. La
          responsabilité d&apos;iFIND est limitée au montant payé par le client sur les 12 derniers mois.
        </p>

        <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mt-10 text-ink-900">8. Loi applicable et juridiction</h2>
        <p>
          Les présentes CGV sont régies par le droit français. Tout litige relatif à l&apos;exécution
          ou l&apos;interprétation des présentes sera soumis à la compétence exclusive des tribunaux
          de Paris.
        </p>
      </div>
    </div>
  );
}
