import { Check, X } from "lucide-react";

const AVANT = [
  "Achat de fichiers froids à 2 000 €",
  "Cold emailing à 0,5 % de réponse",
  "Aucun signal d'achat — tir à l'aveugle",
  "Heures de qualification manuelle",
];

const APRES = [
  "Détection sur 11 sources publiques FR",
  "Qualification IA propriétaire sur chaque signal",
  "Brief contextuel prêt à utiliser",
  "Email + téléphone + LinkedIn vérifiés",
];

export function BeforeAfter() {
  return (
    <div className="grid md:grid-cols-2 gap-px bg-ink-200 rounded-xl overflow-hidden border border-ink-200">
      <div className="bg-white p-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-500 mb-4">Avant</p>
        <h3 className="font-display text-xl font-semibold text-ink-900 mb-5 leading-tight">
          70 % du temps perdu à chercher.
        </h3>
        <ul className="space-y-3">
          {AVANT.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-[15px] text-ink-600">
              <X className="h-4 w-4 text-ink-400 flex-shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-brand-950 text-white p-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-300 mb-4">Avec iFIND</p>
        <h3 className="font-display text-xl font-semibold mb-5 leading-tight">
          100 % du temps à closer.
        </h3>
        <ul className="space-y-3">
          {APRES.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-[15px] text-ink-200">
              <Check className="h-4 w-4 text-brand-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
