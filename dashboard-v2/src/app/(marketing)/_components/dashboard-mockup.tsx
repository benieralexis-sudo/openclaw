"use client";

import { motion } from "motion/react";
import { Sparkles, Building2, Briefcase, Zap, TrendingUp, Search, Settings, Home, Users, CreditCard, Filter, ArrowUpRight, MapPin, Mail, Phone, Linkedin, Brain, Target } from "lucide-react";
import { MOCK_PEPITES, MOCK_BRIEF } from "./_data/mock-companies";

const PEPITES = MOCK_PEPITES;
const BRIEF = MOCK_BRIEF;

export function DashboardMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2 }}
      className="relative"
    >
      {/* Multi-layer glow */}
      <div className="absolute inset-0 -m-12">
        <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-gradient-radial from-brand-400/40 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-gradient-radial from-amber-400/30 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Browser frame */}
      <div className="relative rounded-2xl bg-ink-900 border border-ink-800 shadow-2xl overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-3 px-4 py-3 bg-ink-900 border-b border-ink-800">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex-1 max-w-md mx-auto">
            <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-ink-800 border border-ink-700 text-[11px] text-ink-400">
              <Lock />
              <span>app.ifind.fr/dashboard</span>
            </div>
          </div>
          <div className="w-12" />
        </div>

        {/* Dashboard content */}
        <div className="grid grid-cols-12 min-h-[540px] bg-white">
          {/* Sidebar */}
          <aside className="col-span-2 bg-ink-950 text-ink-300 p-3 flex flex-col">
            <div className="flex items-center gap-2 px-2 mb-6 pt-1">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/30">
                <span className="text-white font-display font-bold text-sm">i</span>
              </div>
              <span className="font-display text-sm font-bold text-white">iFIND</span>
            </div>
            <div className="space-y-0.5">
              <NavItem icon={<Home className="h-3.5 w-3.5" />} active>Dashboard</NavItem>
              <NavItem icon={<Sparkles className="h-3.5 w-3.5" />} badge="14">Pépites</NavItem>
              <NavItem icon={<Users className="h-3.5 w-3.5" />}>Leads</NavItem>
              <NavItem icon={<CreditCard className="h-3.5 w-3.5" />}>Crédits</NavItem>
              <NavItem icon={<Settings className="h-3.5 w-3.5" />}>Réglages</NavItem>
            </div>
            <div className="mt-auto p-3 rounded-lg bg-gradient-to-br from-brand-600/20 to-brand-800/20 border border-brand-700/30">
              <p className="text-[10px] text-brand-300 font-semibold uppercase tracking-wider mb-1">Garantie</p>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-xl font-bold text-white">14</span>
                <span className="text-[10px] text-ink-400">/ 6 min</span>
              </div>
              <div className="mt-2 h-1 bg-ink-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: "100%" }} />
              </div>
            </div>
          </aside>

          {/* Main mockup zone */}
          <div className="col-span-7 bg-ink-50/30 p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-display font-bold text-ink-900">Vos Pépites du mois</h2>
                <p className="text-[11px] text-ink-500">Mis à jour il y a 2 minutes · 14 nouvelles cette semaine</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 h-7 inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white text-[11px] text-ink-700 hover:bg-ink-50">
                  <Filter className="h-3 w-3" />
                  Filtrer
                </button>
                <button className="px-2 h-7 inline-flex items-center gap-1 rounded-md bg-ink-900 text-white text-[11px] hover:bg-ink-800">
                  <Search className="h-3 w-3" />
                  Rechercher
                </button>
                <span className="inline-flex items-center gap-1 px-2 h-7 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  LIVE
                </span>
              </div>
            </div>

            {/* Stats with sparklines */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <StatCard label="Pépites mois" value="14" target="/6 garantie" trend="+27%" highlight sparkline={[2, 3, 2, 4, 3, 5, 6, 7, 8, 10, 12, 14]} />
              <StatCard label="Leads qualif" value="47" target="/60 quota" trend="+12%" sparkline={[10, 15, 18, 22, 25, 30, 33, 36, 40, 43, 45, 47]} />
              <StatCard label="Crédits" value="13" target="rollover 4 mois" sparkline={[60, 55, 48, 42, 36, 32, 28, 24, 20, 17, 15, 13]} inverse />
            </div>

            {/* Pepites list */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-wider font-bold text-ink-500">Toutes les Pépites</p>
                <p className="text-[11px] text-brand-600 font-medium hover:underline cursor-pointer">Tout voir →</p>
              </div>
              {PEPITES.map((p, i) => (
                <motion.div
                  key={p.company}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.6 + i * 0.12 }}
                  className={`group flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${i === 0 ? "border-amber-300 bg-gradient-to-r from-amber-50 to-white shadow-md shadow-amber-500/10" : "border-ink-200 bg-white hover:border-brand-300 hover:shadow-md"}`}
                >
                  <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${i === 0 ? "bg-gradient-to-br from-amber-400 to-amber-600 shadow-md shadow-amber-500/30" : "bg-gradient-to-br from-brand-100 to-brand-200"}`}>
                    {i === 0 ? <Zap className="h-4 w-4 text-white" /> : <Building2 className="h-4 w-4 text-brand-700" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-ink-900">{p.company}</span>
                      <ScoreBadge score={p.score} hot={p.isHot} />
                      <span className="text-[10px] text-ink-400 font-mono">{p.siret}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-ink-600">
                      <span className="flex items-center gap-1"><Briefcase className="h-2.5 w-2.5" />{p.signal}</span>
                      <span className="text-emerald-600 font-medium">{p.funding}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-ink-400">
                      <span className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{p.location}</span>
                      <span>·</span>
                      <span>{p.size}</span>
                      <span>·</span>
                      <span>{p.industry}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-ink-500">{p.time}</p>
                    <ArrowUpRight className={`h-3.5 w-3.5 inline mt-1 ${i === 0 ? "text-amber-600" : "text-ink-400 group-hover:text-brand-600"}`} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Side panel — Pépite détail */}
          <aside className="col-span-3 bg-white border-l border-ink-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-wider">
                <Zap className="h-2.5 w-2.5" />
                Pépite ULTRA
              </span>
              <ScoreBadge score={9} hot large />
            </div>
            <h3 className="font-display text-base font-bold text-ink-900 mb-1">{BRIEF.company}</h3>
            <p className="text-[11px] text-ink-500 mb-3">SIRET {BRIEF.siret} · {BRIEF.location}</p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1 mb-4">
              <Tag color="emerald">Série B 12M€</Tag>
              <Tag color="blue">QA × 3</Tag>
              <Tag color="amber">CTO actif</Tag>
            </div>

            {/* Brief Opus */}
            <div className="rounded-lg bg-gradient-to-br from-brand-50 to-white border border-brand-100 p-3 mb-3">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                  <Brain className="h-2.5 w-2.5 text-white" />
                </div>
                <span className="text-[10px] font-bold text-brand-700 uppercase tracking-wider">Brief Opus</span>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-700">
                <span className="font-semibold">Angle d&apos;attaque :</span> {BRIEF.company} vient de boucler 12M€ Série B et publie 3 offres QA en 7 jours. Le CTO a posté un job &laquo; Test Automation Lead &raquo; le 12/05.
              </p>
              <p className="text-[11px] leading-relaxed text-ink-700 mt-2">
                <span className="font-semibold">Pitch :</span> &laquo; Bonjour, j&apos;ai vu que vous recrutiez 3 profils QA. On externalise votre infra test pour des PME tech qui scalent vite (≤ 6 mois ROI). 15min cette semaine ? &raquo;
              </p>
            </div>

            {/* Contacts */}
            <div className="space-y-1.5">
              <ContactRow icon={<Mail className="h-3 w-3" />} value={BRIEF.contactEmail} verified />
              <ContactRow icon={<Phone className="h-3 w-3" />} value={BRIEF.contactPhone} verified />
              <ContactRow icon={<Linkedin className="h-3 w-3" />} value={BRIEF.contactLinkedin} />
            </div>

            <button className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 text-white text-[11px] font-semibold shadow-md shadow-brand-500/30 hover:shadow-lg transition-all">
              <Target className="h-3 w-3" />
              Marquer comme contacté
            </button>
          </aside>
        </div>
      </div>
    </motion.div>
  );
}

function NavItem({ icon, children, active, badge }: { icon: React.ReactNode; children: React.ReactNode; active?: boolean; badge?: string }) {
  return (
    <div className={`flex items-center justify-between px-2 py-1.5 rounded-md text-[11px] font-medium ${active ? "bg-gradient-to-r from-brand-600/30 to-brand-600/10 text-white border-l-2 border-brand-500" : "text-ink-400 hover:bg-ink-900/50 hover:text-ink-200"}`}>
      <span className="flex items-center gap-2">
        {icon}
        {children}
      </span>
      {badge && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold">{badge}</span>}
    </div>
  );
}

function StatCard({ label, value, target, trend, highlight, sparkline, inverse }: { label: string; value: string; target: string; trend?: string; highlight?: boolean; sparkline: number[]; inverse?: boolean }) {
  const max = Math.max(...sparkline);
  const points = sparkline.map((v, i) => `${(i / (sparkline.length - 1)) * 100},${100 - (v / max) * 100}`).join(" ");
  return (
    <div className={`rounded-xl p-3 border relative overflow-hidden ${highlight ? "bg-gradient-to-br from-amber-50 to-amber-100/30 border-amber-200" : "bg-white border-ink-100"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-wider font-bold text-ink-500">{label}</span>
        {highlight && <Sparkles className="h-3 w-3 text-amber-500" />}
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`font-display text-2xl font-bold ${highlight ? "text-amber-700" : "text-ink-900"}`}>{value}</span>
        <span className="text-[9px] text-ink-500">{target}</span>
      </div>
      {trend && (
        <div className="flex items-center gap-1 text-[10px]">
          <TrendingUp className={`h-2.5 w-2.5 ${inverse ? "text-rose-500" : "text-emerald-500"}`} />
          <span className={`font-bold ${inverse ? "text-rose-600" : "text-emerald-600"}`}>{trend}</span>
          <span className="text-ink-400">vs mois -1</span>
        </div>
      )}
      {/* Sparkline */}
      <svg className="absolute bottom-0 right-0 w-20 h-8 opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={highlight ? "#f59e0b" : "#2563eb"}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function ScoreBadge({ score, hot, large }: { score: number; hot?: boolean; large?: boolean }) {
  const sizeClass = large ? "px-2.5 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]";
  if (hot) {
    return (
      <span className={`inline-flex items-center gap-0.5 ${sizeClass} rounded-md bg-gradient-to-br from-amber-400 to-amber-600 text-white font-bold shadow-sm shadow-amber-500/30`}>
        <Zap className={large ? "h-3 w-3" : "h-2 w-2"} />
        {score}/10
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center ${sizeClass} rounded-md bg-emerald-100 text-emerald-700 font-bold border border-emerald-200`}>
      {score}/10
    </span>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: "emerald" | "blue" | "amber" }) {
  const colorClass = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-brand-50 text-brand-700 border-brand-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  }[color];
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${colorClass}`}>{children}</span>;
}

function ContactRow({ icon, value, verified }: { icon: React.ReactNode; value: string; verified?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ink-50 border border-ink-100">
      <div className="text-ink-500">{icon}</div>
      <span className="text-[10px] font-mono text-ink-700 flex-1 truncate">{value}</span>
      {verified && <span className="text-emerald-500 text-[9px] font-bold">✓</span>}
    </div>
  );
}

function Lock() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

