import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RGPD — Politique de protection des données",
  robots: { index: false, follow: true },
};

export default function RgpdPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-20">
      <h1 className="font-display text-4xl font-bold text-ink-900 mb-2">Politique RGPD</h1>
      <p className="text-sm text-ink-500 mb-10">Dernière mise à jour : 10 mai 2026</p>
      <div className="prose prose-ink max-w-none space-y-6 text-ink-700">
        <h2 className="font-display text-2xl font-bold text-ink-900">1. Responsable de traitement</h2>
        <p>iFIND, [Raison sociale à compléter], dont le siège social est situé à [Adresse à compléter].</p>

        <h2 className="font-display text-2xl font-bold text-ink-900">2. Données collectées</h2>
        <p>
          <strong>Sur les utilisateurs (clients iFIND)</strong> : email, nom, identifiants de
          connexion, données de facturation (Stripe), données de session (logs, IP).
        </p>
        <p>
          <strong>Sur les leads détectés</strong> : données publiques issues de BODACC, INPI,
          Pappers, France Travail, JOAFE, RSS Maddyness/Frenchweb, Welcome to the Jungle, LinkedIn
          (informations publiques uniquement). Aucune donnée privée n&apos;est collectée.
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">3. Base légale</h2>
        <p>
          <strong>Pour les utilisateurs</strong> : exécution du contrat (CGV).<br />
          <strong>Pour les leads</strong> : intérêt légitime (prospection B2B sur données publiques),
          conformément à l&apos;article 6.1.f du RGPD et aux recommandations CNIL pour la prospection BtoB.
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">4. Durée de conservation</h2>
        <p>
          <strong>Données utilisateurs</strong> : durée du contrat + 3 ans (obligation comptable).<br />
          <strong>Données leads</strong> : 3 ans à compter de la dernière mise à jour, puis suppression
          automatique.
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">5. Vos droits</h2>
        <p>Vous disposez des droits suivants : accès, rectification, effacement, portabilité, opposition, limitation. Pour exercer ces droits, contactez <a href="mailto:rgpd@ifind.fr" className="text-brand-600 underline">rgpd@ifind.fr</a>.</p>

        <h2 className="font-display text-2xl font-bold text-ink-900">6. Sous-traitants</h2>
        <p>
          iFIND utilise les sous-traitants suivants, tous conformes RGPD :
          Stripe (paiements), Resend (emails transactionnels), Anthropic (qualification IA via API),
          Pappers / Apify / TheirStack / Rodz / Kaspr (enrichissement données publiques),
          OVHcloud / Hetzner (hébergement UE).
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">7. Sécurité</h2>
        <p>
          Données chiffrées en transit (HTTPS/TLS) et au repos (PostgreSQL chiffré). Backup quotidien
          chiffré GPG offsite. Authentification par magic-link sans mot de passe. Logs d&apos;audit
          de toutes les actions critiques.
        </p>

        <h2 className="font-display text-2xl font-bold text-ink-900">8. Réclamation CNIL</h2>
        <p>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une
          réclamation auprès de la CNIL : <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">www.cnil.fr</a>.
        </p>
      </div>
    </div>
  );
}
