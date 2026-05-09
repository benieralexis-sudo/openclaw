"use client";

import { motion } from "motion/react";
import { X, Check, Clock, Search, Frown, Smile } from "lucide-react";

export function BeforeAfter() {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* AVANT */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative rounded-2xl bg-gradient-to-br from-rose-50 to-white border border-rose-100 p-8"
      >
        <div className="absolute top-0 right-0 px-4 py-1.5 bg-rose-100 text-rose-700 text-xs font-bold uppercase tracking-wider rounded-bl-2xl rounded-tr-2xl">
          Avant iFIND
        </div>
        <Frown className="h-8 w-8 text-rose-400 mb-4" />
        <h3 className="font-display text-2xl font-bold text-ink-900 mb-3">
          70% du temps perdu à chercher
        </h3>
        <p className="text-ink-600 text-sm leading-relaxed mb-6">
          Vos commerciaux passent leur journée sur Sales Nav, Pharow,
          Société.info — à filtrer 500 prospects pour trouver 5 vraies opportunités.
        </p>
        <ul className="space-y-2.5">
          {[
            "Achat de fichiers froids à 2 000€",
            "Cold emailing en masse à 0,5% de réponse",
            "Aucun signal d'achat — vous tirez à l'aveugle",
            "Briefs persona faits à la main, parfois bidons",
            "Des heures de qualification manuelle",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-ink-700">
              <X className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-6 pt-6 border-t border-rose-100 flex items-center gap-3">
          <Clock className="h-5 w-5 text-rose-500" />
          <span className="text-sm text-ink-700">
            <span className="font-bold text-rose-600">12h/semaine</span> perdues par commercial
          </span>
        </div>
      </motion.div>

      {/* APRÈS */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="relative rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white p-8 shadow-2xl shadow-brand-500/20"
      >
        <div className="absolute top-0 right-0 px-4 py-1.5 bg-amber-400 text-amber-900 text-xs font-bold uppercase tracking-wider rounded-bl-2xl rounded-tr-2xl">
          Avec iFIND
        </div>
        <Smile className="h-8 w-8 text-amber-300 mb-4" />
        <h3 className="font-display text-2xl font-bold mb-3">
          100% du temps à closer
        </h3>
        <p className="text-brand-100 text-sm leading-relaxed mb-6">
          On vous livre 6 Pépites garanties par mois — boîtes ULTRA chaudes,
          briefs Opus prêts. Vos commerciaux contactent direct, ils convertissent.
        </p>
        <ul className="space-y-2.5">
          {[
            "Détection temps réel sur 11 sources FR publiques",
            "Qualification IA Opus 4.7 sur chaque signal",
            "Brief sur-mesure prêt à utiliser pour chaque Pépite",
            "Email + phone + LinkedIn vérifiés inclus",
            "Garantie contractuelle 6 Pépites/mois minimum",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <Check className="h-4 w-4 text-amber-300 flex-shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-6 pt-6 border-t border-brand-500/30 flex items-center gap-3">
          <Search className="h-5 w-5 text-amber-300" />
          <span className="text-sm">
            <span className="font-bold text-amber-200">5 minutes/jour</span> pour piloter
          </span>
        </div>
      </motion.div>
    </div>
  );
}
