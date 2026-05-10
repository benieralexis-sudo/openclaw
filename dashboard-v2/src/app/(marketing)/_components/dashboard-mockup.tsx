import { Building2, Briefcase, Zap, Brain, Mail, Phone, Linkedin, MapPin, Search, Filter, Sparkles, Home, Users, CreditCard, Settings, Target } from "lucide-react";
import { MOCK_PEPITES, MOCK_BRIEF } from "./_data/mock-companies";

export function DashboardMockup() {
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
            <NavItem icon={<Sparkles className="h-3.5 w-3.5" />} badge="14">Pépites</NavItem>
            <NavItem icon={<Users className="h-3.5 w-3.5" />}>Leads</NavItem>
            <NavItem icon={<CreditCard className="h-3.5 w-3.5" />}>Crédits</NavItem>
            <NavItem icon={<Settings className="h-3.5 w-3.5" />}>Réglages</NavItem>
          </div>
          <div className="mt-auto p-3 rounded-lg bg-brand-900/60 border border-brand-800/50">
            <p className="text-[10px] text-ink-400 font-medium uppercase tracking-wider mb-2">Garantie ce mois</p>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-xl font-semibold text-white tabular-nums">14</span>
              <span className="text-[10px] text-ink-500">/ 6 min.</span>
            </div>
            <div className="mt-2 h-1 bg-brand-800/60 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: "100%" }} />
            </div>
          </div>
        </aside>

        {/* Mobile-only top bar (compact info on garantie) */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-brand-950 text-white border-b border-brand-800/50">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
              <span className="text-white font-display font-bold text-xs">i</span>
            </div>
            <span className="font-display text-xs font-semibold">iFIND</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink-400 uppercase tracking-wider">Garantie</span>
            <span className="font-display text-sm font-semibold tabular-nums text-white">14</span>
            <span className="text-[10px] text-ink-500">/ 6</span>
          </div>
        </div>

        {/* Main */}
        <div className="lg:col-span-7 bg-white p-5 lg:p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-base font-display font-semibold text-ink-900">Pépites du mois</h3>
              <p className="text-xs text-ink-500">Mis à jour il y a 2 minutes · 14 nouvelles cette semaine</p>
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

          {/* Stats — sobres */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            <StatCard label="Pépites" value="14" sub="/ 6 garanties" highlight />
            <StatCard label="Leads qualifiés" value="47" sub="/ 60 quota" />
            <StatCard label="Crédits restants" value="13" sub="rollover 4 mois" />
          </div>

          {/* Liste Pépites */}
          <div className="space-y-1.5">
            {MOCK_PEPITES.map((p, i) => (
              <div
                key={p.company}
                className={`group flex items-center gap-3 p-3 rounded-lg border transition-colors ${i === 0 ? "border-brand-200 bg-brand-50/40" : "border-ink-100 bg-white hover:border-ink-200"}`}
              >
                <div className={`flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center ${i === 0 ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-600"}`}>
                  {i === 0 ? <Zap className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
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
              <span className="text-[10px] font-semibold text-ink-700 uppercase tracking-wider">Brief Opus</span>
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

function NavItem({ icon, children, active, badge }: { icon: React.ReactNode; children: React.ReactNode; active?: boolean; badge?: string }) {
  return (
    <div className={`flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] ${active ? "bg-brand-700 text-white" : "text-ink-400 hover:bg-brand-900/40 hover:text-ink-200"}`}>
      <span className="flex items-center gap-2">{icon}{children}</span>
      {badge && <span className="px-1.5 py-0.5 rounded bg-brand-600 text-white text-[9px] font-semibold tabular-nums">{badge}</span>}
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md p-3 border ${highlight ? "border-brand-200 bg-brand-50/40" : "border-ink-100 bg-white"}`}>
      <p className="text-[10px] uppercase tracking-wider font-medium text-ink-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-xl font-semibold tabular-nums ${highlight ? "text-brand-700" : "text-ink-900"}`}>{value}</span>
        <span className="text-[10px] text-ink-500">{sub}</span>
      </div>
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
