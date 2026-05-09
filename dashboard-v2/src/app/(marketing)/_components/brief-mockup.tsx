"use client";

import { motion } from "motion/react";
import { Brain, Sparkles, MessageSquare, Target, TrendingUp } from "lucide-react";

export function BriefMockup() {
  return (
    <motion.div className="relative">
      {/* Glow */}
      <div className="absolute inset-0 -m-8 bg-gradient-radial from-brand-400/20 via-transparent to-transparent blur-3xl" />

      <div className="relative rounded-2xl bg-gradient-to-br from-white to-brand-50/30 border border-brand-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-brand-600 to-brand-800 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-brand-200">Brief Opus 4.7</p>
              <p className="text-sm font-semibold">Asys — Levée Série B 12M€</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-400/20 border border-amber-300/40 text-amber-100 text-[10px] font-bold backdrop-blur-sm">
            <Sparkles className="h-2.5 w-2.5" />
            Pépite
          </span>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Section 1 : Contexte */}
          <Section icon={<Target className="h-4 w-4" />} title="Contexte" color="emerald">
            <p>Asys (414 850 257) — ESN spécialisée test/QA, 180 collaborateurs, Paris 92.</p>
            <p className="mt-1.5">
              <strong className="text-ink-900">Vient de boucler 12M€ Série B</strong> (BPI Investissement, Sera Capital). Annoncé sur Maddyness le 8 mai. Plan d&apos;hyper-croissance : doublement effectif d&apos;ici fin 2026.
            </p>
          </Section>

          {/* Section 2 : Signal d'achat */}
          <Section icon={<TrendingUp className="h-4 w-4" />} title="Signal d'achat" color="amber">
            <p>3 offres QA Engineer postées en 7 jours sur LinkedIn + WTTJ. Le CTO Vanacker (5 ans LinkedIn, profil tech actif) a publié personnellement le job &laquo; Test Automation Lead &raquo; le 12/05.</p>
            <p className="mt-1.5"><strong className="text-amber-700">→ Frustration recrutement QA confirmée.</strong></p>
          </Section>

          {/* Section 3 : Pitch suggéré */}
          <Section icon={<MessageSquare className="h-4 w-4" />} title="Pitch suggéré" color="brand">
            <div className="bg-white rounded-lg p-3.5 border border-brand-100 italic text-ink-700">
              &laquo; Bonjour Vanacker, j&apos;ai vu que vous recrutez 3 QA Engineers chez Asys.
              On externalise l&apos;infra test pour des PME tech qui scalent vite — le ROI moyen
              est de 6 mois avec une équipe externe dédiée. 15 minutes cette semaine pour
              voir si ça matche votre roadmap post-Série B ? &raquo;
            </div>
          </Section>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-ink-100">
            <Stat value="92%" label="Match ICP" />
            <Stat value="9/10" label="Score Opus" highlight />
            <Stat value="2h" label="Détecté" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Section({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: "emerald" | "amber" | "brand"; children: React.ReactNode }) {
  const colorClass = {
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    brand: "bg-brand-100 text-brand-700",
  }[color];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colorClass}`}>
          {icon}
        </div>
        <p className="text-xs font-bold text-ink-700 uppercase tracking-wider">{title}</p>
      </div>
      <div className="text-sm text-ink-600 leading-relaxed pl-8">
        {children}
      </div>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={`font-display text-xl font-bold ${highlight ? "text-amber-600" : "text-ink-900"}`}>{value}</div>
      <div className="text-[10px] text-ink-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
