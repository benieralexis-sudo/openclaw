"use client";

import * as React from "react";
import { Building2, Briefcase, Zap, Brain, Mail, Phone, Linkedin, MapPin, Search, Filter, Sparkles, Home, Users, CreditCard, Settings, Target } from "lucide-react";
import { MOCK_PEPITES, MOCK_BRIEF, type MockCompany } from "./_data/mock-companies";

// Pool de Pépites supplémentaires pour rotation animée
const ROTATING_POOL: MockCompany[] = [
  { company: "Demo Edutech E", siret: "999 224 891", industry: "EdTech B2B", size: "60 p.", location: "Nantes", score: 9, signal: "Recrute Lead Engineer", funding: "Série A 6 M€", time: "il y a 1 min", isHot: true },
  { company: "Demo Fintech F", siret: "999 567 320", industry: "Fintech", size: "95 p.", location: "Paris", score: 8, signal: "Lance offre B2B", funding: "Série B 18 M€", time: "il y a 3 min", isHot: false },
  { company: "Demo Cleantech G", siret: "999 102 478", industry: "Cleantech", size: "35 p.", location: "Lyon", score: 9, signal: "CTO change + 2 jobs Tech Lead", funding: "Pré-seed 1.2 M€", time: "il y a 5 min", isHot: true },
  { company: "Demo AI Startup H", siret: "999 875 612", industry: "AI Tech", size: "25 p.", location: "Paris", score: 10, signal: "Sortie produit + recrute", funding: "Seed 3 M€", time: "à l'instant", isHot: true },
];

export function DashboardMockup() {
  const [pepites, setPepites] = React.useState<MockCompany[]>(MOCK_PEPITES);
  const [poolIndex, setPoolIndex] = React.useState(0);
  const [counter, setCounter] = React.useState(14);

  // Animation : toutes les 4.5s, une nouvelle Pépite arrive en haut, la
  // dernière est éjectée. Compteur "14 nouvelles" s'incrémente.
  React.useEffect(() => {
    const interval = setInterval(() => {
      setPepites((prev) => {
        const newPepite = ROTATING_POOL[poolIndex % ROTATING_POOL.length];
        if (!newPepite) return prev;
        return [newPepite, ...prev.slice(0, 3)];
      });
      setPoolIndex((i) => i + 1);
      setCounter((c) => c + 1);
    }, 4500);
    return () => clearInterval(interval);
  }, [poolIndex]);

  return (
    <div className="relative rounded-xl border border-ink-200 bg-white shadow-xl overflow-hidden">
      {/* Browser chrome — sobre */}
      <div className="flex items-center gap-3 px-4 h-10 bg-ink-50 border-b border-ink-200">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-ink-300" />
          <div className="w-2.5 h-2.5 rounded-full bg-ink-300" />
          <div className="w-2.5 h-2.5 rounded-full bg-ink-300" />
        </div>
        <div className="flex-1 max-w-sm mx-auto">
          <div className="flex items-center justify-center gap-1.5 px-3 h-6 rounded-md bg-white border border-ink-200 text-[11px] text-ink-500">
            <LockIcon />
            <span>app.ifind.fr/dashboard</span>
          </div>
        </div>
        <div className="w-12" />
      </div>

      {/* Dashboard body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[480px] bg-white">
        {/* Sidebar — desktop full, mobile mini */}
        <aside className="lg:col-span-2 bg-brand-950 text-ink-300 p-3 lg:flex flex-col hidden lg:block">
          <div className="flex items-center gap-2 px-2 mb-6 pt-1">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
              <span className="text-white font-display font-bold text-sm">i</span>
            </div>
            <span className="font-display text-sm font-semibold text-white">iFIND</span>
          </div>

          {/* Live activity indicator */}
          <div className="px-2 mb-4 -mt-2">
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              <span className="font-medium">3 signaux en cours d&apos;analyse</span>
            </div>
          </div>

          <div className="space-y-0.5">
            <NavItem icon={<Home className="h-3.5 w-3.5" />} active>Dashboard</NavItem>
            <NavItem icon={<Sparkles className="h-3.5 w-3.5" />} badge={String(counter)}>Pépites</NavItem>
            <NavItem icon={<Users className="h-3.5 w-3.5" />}>Leads</NavItem>
            <NavItem icon={<CreditCard className="h-3.5 w-3.5" />}>Crédits</NavItem>
            <NavItem icon={<Settings className="h-3.5 w-3.5" />}>Réglages</NavItem>
          </div>
          <div className="mt-auto p-3 rounded-lg bg-brand-900/60 border border-brand-800/50">
            <p className="text-[10px] text-ink-400 font-medium uppercase tracking-wider mb-2">Garantie ce mois</p>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-xl font-semibold text-white tabular-nums">{counter}</span>
              <span className="text-[10px] text-ink-500">/ 6 min.</span>
            </div>
            <div className="mt-2 h-1 bg-brand-800/60 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: "100%" }} />
            </div>
          </div>
        </aside>

        {/* Mobile-only top bar */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-brand-950 text-white border-b border-brand-800/50">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
              <span className="text-white font-display font-bold text-xs">i</span>
            </div>
            <span className="font-display text-xs font-semibold">iFIND</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-400 uppercase tracking-wider">Garantie</span>
            <span className="font-display text-sm font-semibold tabular-nums text-white">{counter}</span>
            <span className="text-[10px] text-ink-500">/ 6</span>
          </div>
        </div>

        {/* Main */}
        <div className="lg:col-span-7 bg-white p-5 lg:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-display font-semibold text-ink-900">Pépites du mois</h3>
              <p className="text-xs text-ink-500 tabular-nums">Mis à jour à l&apos;instant · {counter} nouvelles cette semaine</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2.5 h-7 inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white text-xs text-ink-700 hover:bg-ink-50">
                <Filter className="h-3 w-3" />
                Filtrer
              </button>
              <button className="px-2.5 h-7 inline-flex items-center gap-1 rounded-md bg-brand-700 text-white text-xs hover:bg-brand-800">
                <Search className="h-3 w-3" />
                Recherche
              </button>
            </div>
          </div>

          {/* Filter pills — adapte en mobile (mots courts) */}
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            <FilterPill active>Tout</FilterPill>
            <FilterPill>Score ≥ 9</FilterPill>
            <FilterPill>Levée</FilterPill>
            <FilterPill>Recrutement</FilterPill>
            <FilterPill className="hidden lg:inline-flex">30 derniers jours</FilterPill>
          </div>

          {/* Liste Pépites animée — clé sur company pour reuse animations */}
          <div className="space-y-1.5">
            {pepites.map((p, i) => (
              <PepiteRow key={p.company} pepite={p} highlight={i === 0} />
            ))}
          </div>
        </div>

        {/* Side panel détail — desktop */}
        <aside className="hidden lg:block lg:col-span-3 bg-ink-50 border-l border-ink-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-100 text-brand-700 text-[10px] font-medium uppercase tracking-wider">
              Pépite
            </span>
            <ScoreBadge score={9} hot large />
          </div>
          <h4 className="font-display text-sm font-semibold text-ink-900 mb-0.5">{MOCK_BRIEF.company}</h4>
          <p className="text-xs text-ink-500 mb-3">SIRET {MOCK_BRIEF.siret} · {MOCK_BRIEF.location}</p>

          <div className="flex flex-wrap gap-1 mb-4">
            <Tag>Série B 12 M€</Tag>
            <Tag>QA × 3</Tag>
            <Tag>CTO actif</Tag>
          </div>

          <div className="rounded-md bg-white border border-ink-200 p-3 mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Brain className="h-3 w-3 text-brand-600" />
              <span className="text-[10px] font-semibold text-ink-700 uppercase tracking-wider">Brief IA</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-700">
              <strong>Angle :</strong> {MOCK_BRIEF.company} vient de boucler une Série B et publie 3 offres QA. CTO actif.
            </p>
            <p className="text-xs leading-relaxed text-ink-700 mt-2">
              <strong>Pitch :</strong> « Vous recrutez QA — on externalise l&apos;infra test pour PME tech qui scalent. ROI 6 mois. 15 min ? »
            </p>
          </div>

          <div className="space-y-1">
            <ContactRow icon={<Mail className="h-3 w-3" />} value={MOCK_BRIEF.contactEmail} verified />
            <ContactRow icon={<Phone className="h-3 w-3" />} value={MOCK_BRIEF.contactPhone} verified />
            <ContactRow icon={<Linkedin className="h-3 w-3" />} value="linkedin.com/in/…" />
          </div>

          <button className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-brand-700 hover:bg-brand-800 text-white text-xs font-medium">
            <Target className="h-3 w-3" />
            Marquer contacté
          </button>
        </aside>
      </div>
    </div>
  );
}

function PepiteRow({ pepite: p, highlight }: { pepite: MockCompany; highlight: boolean }) {
  return (
    <div
      className={`group flex items-center gap-3 p-3 rounded-lg border transition-all duration-500 ${highlight ? "border-brand-200 bg-brand-50/40 anim-pepite-in" : "border-ink-100 bg-white hover:border-ink-200"}`}
    >
      <div className={`flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center ${highlight ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-600"}`}>
        {highlight ? <Zap className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-ink-900 truncate">{p.company}</span>
          <ScoreBadge score={p.score} hot={p.isHot} />
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <span className="flex items-center gap-1 truncate"><Briefcase className="h-2.5 w-2.5 flex-shrink-0" />{p.signal}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-400">
          <span className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{p.location}</span>
          <span>·</span>
          <span>{p.size}</span>
          <span>·</span>
          <span className="truncate">{p.industry}</span>
        </div>
      </div>
      <span className="text-[11px] text-ink-400 flex-shrink-0">{p.time}</span>
    </div>
  );
}

function NavItem({ icon, children, active, badge }: { icon: React.ReactNode; children: React.ReactNode; active?: boolean; badge?: string }) {
  return (
    <div className={`flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] ${active ? "bg-brand-700 text-white" : "text-ink-400 hover:bg-brand-900/40 hover:text-ink-200"}`}>
      <span className="flex items-center gap-2">{icon}{children}</span>
      {badge && <span className="px-1.5 py-0.5 rounded bg-brand-600 text-white text-[9px] font-semibold tabular-nums">{badge}</span>}
    </div>
  );
}

function ScoreBadge({ score, hot, large }: { score: number; hot?: boolean; large?: boolean }) {
  const sizeClass = large ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]";
  if (hot) {
    return (
      <span className={`inline-flex items-center ${sizeClass} rounded-md bg-brand-600 text-white font-semibold tabular-nums`}>
        {score}/10
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center ${sizeClass} rounded-md bg-emerald-50 text-emerald-700 font-semibold border border-emerald-100 tabular-nums`}>
      {score}/10
    </span>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white text-ink-700 text-[10px] font-medium border border-ink-200">{children}</span>;
}

function FilterPill({ children, active, className = "" }: { children: React.ReactNode; active?: boolean; className?: string }) {
  return (
    <button className={`flex-shrink-0 px-2.5 h-6 inline-flex items-center rounded-full text-[11px] font-medium transition-colors ${active ? "bg-brand-700 text-white" : "bg-white text-ink-600 border border-ink-200 hover:border-ink-300"} ${className}`}>
      {children}
    </button>
  );
}

function ContactRow({ icon, value, verified }: { icon: React.ReactNode; value: string; verified?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white border border-ink-200">
      <div className="text-ink-500">{icon}</div>
      <span className="text-[10px] font-mono text-ink-700 flex-1 truncate">{value}</span>
      {verified && <span className="text-emerald-600 text-[10px]">✓</span>}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
