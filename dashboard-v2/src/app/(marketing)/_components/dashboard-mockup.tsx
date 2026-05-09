"use client";

import { Sparkles, TrendingUp, Building2, Briefcase, ChevronRight, Zap } from "lucide-react";
import { motion } from "motion/react";

// Sprint Saint Graal (10/05/2026) — Mockup dashboard pour homepage hero.
// Reproduit le visuel du dashboard client iFIND avec donnees fake mais credibles.

const PEPITES = [
  { company: "Asys", score: 9, signal: "Recrute 3 QA Engineers (last 7d)", funding: "Levee 12M€ Series B", time: "il y a 2h" },
  { company: "B-Hive", score: 10, signal: "Co-founder cherche QA Lead", funding: "Pre-seed 800k€ frais", time: "il y a 5h" },
  { company: "Lacour Solutec", score: 8, signal: "DSI publie offre Test Automation", funding: "ETI 80M€ CA", time: "hier" },
];

export function DashboardMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.4 }}
      className="relative"
    >
      {/* Glow ambient */}
      <div className="absolute inset-0 -m-8 bg-gradient-radial from-brand-400/30 via-brand-300/10 to-transparent blur-3xl" />

      {/* Browser chrome */}
      <div className="relative rounded-2xl bg-white border border-ink-200 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-100 bg-ink-50">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-rose-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-white border border-ink-200 text-xs text-ink-600">
              <span className="text-emerald-500">●</span>
              app.ifind.fr/dashboard
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="grid grid-cols-12 min-h-[420px]">
          {/* Sidebar */}
          <aside className="col-span-2 bg-ink-900 text-ink-300 p-4 space-y-1">
            <div className="flex items-center gap-2 px-2 mb-4">
              <span className="font-display text-sm font-bold text-white">iFIND</span>
            </div>
            <NavItem active>Dashboard</NavItem>
            <NavItem>Leads</NavItem>
            <NavItem>Pépites</NavItem>
            <NavItem>Crédits</NavItem>
            <NavItem>Réglages</NavItem>
          </aside>

          {/* Main */}
          <main className="col-span-10 p-6 bg-white">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-ink-900">Vos Pépites du mois</h2>
                <p className="text-xs text-ink-500">Mis à jour il y a 2 minutes</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  Live
                </span>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="Pépites" value="14" sub="/ 6 garanties" trend="up" highlight />
              <StatCard label="Leads qualifiés" value="47" sub="/ 60 inclus" />
              <StatCard label="Crédits restants" value="13" sub="rollovera 4 mois" />
            </div>

            {/* Pepites list */}
            <div className="space-y-2">
              {PEPITES.map((p, i) => (
                <motion.div
                  key={p.company}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.6 + i * 0.15 }}
                  className="flex items-center gap-3 p-3 rounded-lg border border-ink-100 hover:border-brand-200 hover:bg-brand-50/30 transition-all cursor-pointer"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-brand-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-ink-900">{p.company}</span>
                      <ScoreBadge score={p.score} />
                    </div>
                    <p className="text-xs text-ink-600 truncate">
                      <Briefcase className="h-3 w-3 inline mr-1 text-ink-400" />
                      {p.signal} · <span className="text-emerald-600 font-medium">{p.funding}</span>
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[11px] text-ink-500">{p.time}</p>
                    <ChevronRight className="h-4 w-4 text-ink-400 inline mt-1" />
                  </div>
                </motion.div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </motion.div>
  );
}

function NavItem({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div className={`px-2 py-1.5 rounded text-xs font-medium ${active ? "bg-brand-600/20 text-white" : "hover:bg-ink-800"}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, highlight, trend }: { label: string; value: string; sub: string; highlight?: boolean; trend?: "up" | "down" }) {
  return (
    <div className={`rounded-lg p-3 border ${highlight ? "bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200" : "bg-ink-50 border-ink-100"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-500">{label}</span>
        {trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
        {highlight && <Sparkles className="h-3 w-3 text-amber-500" />}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-2xl font-bold ${highlight ? "text-amber-700" : "text-ink-900"}`}>{value}</span>
        <span className="text-[10px] text-ink-500">{sub}</span>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 9 ? "bg-amber-100 text-amber-700 border-amber-300" : score >= 8 ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-ink-100 text-ink-700 border-ink-200";
  const icon = score >= 9 ? <Zap className="h-2.5 w-2.5" /> : null;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold ${color}`}>
      {icon}
      {score}/10
    </span>
  );
}
