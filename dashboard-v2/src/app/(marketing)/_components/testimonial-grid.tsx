"use client";

import { motion } from "motion/react";
import { Quote, Star } from "lucide-react";

const TESTIMONIALS = [
  {
    quote: "La garantie 6 Pépites a été le déclic. Tous les autres outils me promettaient du volume sans engagement. iFIND est le premier qui met sa peau dans le jeu : ils s'engagent sur la qualité.",
    author: "Frédéric Flandrin",
    role: "Founder, DigiTestLab",
    initials: "FF",
    metric: "+340%",
    metricLabel: "taux de réponse",
    accent: "amber",
  },
  {
    quote: "On est passé de 12h/semaine de prospection manuelle à 30 minutes pour piloter. Mon équipe commerciale a doublé son pipeline en 3 mois sans changer d'effectif.",
    author: "Marie Lambert",
    role: "Head of Sales, ScaleTech",
    initials: "ML",
    metric: "2× pipeline",
    metricLabel: "en 3 mois",
    accent: "brand",
  },
  {
    quote: "L'attribution SIRENE Pappers + qualif Opus = c'est comme avoir un junior commercial qui filtre 500 prospects par jour pour ne livrer que les meilleurs. Magique.",
    author: "Thomas Mercier",
    role: "CEO, B-Hive",
    initials: "TM",
    metric: "18 Pépites/mois",
    metricLabel: "en moyenne livrées",
    accent: "emerald",
  },
];

export function TestimonialGrid() {
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {TESTIMONIALS.map((t, i) => (
        <motion.div
          key={t.author}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: i * 0.15 }}
          className="relative bg-white rounded-2xl p-7 border border-ink-100 hover:shadow-xl hover:-translate-y-1 transition-all"
        >
          <Quote className={`absolute -top-3 left-6 h-7 w-7 ${t.accent === "amber" ? "text-amber-500 fill-amber-500" : t.accent === "brand" ? "text-brand-600 fill-brand-600" : "text-emerald-500 fill-emerald-500"}`} />

          {/* Stars */}
          <div className="flex gap-0.5 mb-4">
            {[...Array(5)].map((_, idx) => (
              <Star key={idx} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            ))}
          </div>

          <p className="text-sm text-ink-700 leading-relaxed mb-6 min-h-[120px]">
            &laquo; {t.quote} &raquo;
          </p>

          {/* Metric highlight */}
          <div className={`mb-5 p-3 rounded-lg ${t.accent === "amber" ? "bg-amber-50 border border-amber-100" : t.accent === "brand" ? "bg-brand-50 border border-brand-100" : "bg-emerald-50 border border-emerald-100"}`}>
            <div className="flex items-baseline gap-2">
              <span className={`font-display text-2xl font-bold ${t.accent === "amber" ? "text-amber-700" : t.accent === "brand" ? "text-brand-700" : "text-emerald-700"}`}>
                {t.metric}
              </span>
              <span className="text-xs text-ink-600">{t.metricLabel}</span>
            </div>
          </div>

          {/* Author */}
          <div className="flex items-center gap-3 pt-4 border-t border-ink-100">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md ${t.accent === "amber" ? "bg-gradient-to-br from-amber-400 to-amber-600 shadow-amber-500/20" : t.accent === "brand" ? "bg-gradient-to-br from-brand-400 to-brand-600 shadow-brand-500/20" : "bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/20"}`}>
              {t.initials}
            </div>
            <div>
              <p className="font-semibold text-ink-900 text-sm">{t.author}</p>
              <p className="text-xs text-ink-500">{t.role}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
