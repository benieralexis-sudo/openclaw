"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Target,
  Users,
  Settings,
  Activity,
  LogOut,
  CreditCard,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScope } from "@/hooks/use-scope";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  badge?: string;
  shortcut?: string;
}

const navManagementBase: NavItem[] = [
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/settings", label: "Paramètres", icon: Settings },
];
const navManagementAdmin: NavItem[] = [
  ...navManagementBase,
  { href: "/system", label: "Système", icon: Activity },
];

interface CreditsStatus {
  creditsBalance: number;
  creditsMonthlyQuota: number;
  pepitesThisMonth: number;
  pepitesGuaranteed: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const { role, me } = useScope();
  const navManagement = role === "admin" ? navManagementAdmin : navManagementBase;

  const { data: credits } = useQuery<CreditsStatus | null>({
    queryKey: ["credits-status"],
    queryFn: async () => {
      if (!me?.clientId) return null;
      const res = await fetch(`/api/clients/${me.clientId}`).catch(() => null);
      if (!res || !res.ok) return null;
      const c = await res.json();
      return {
        creditsBalance: c.creditsBalance ?? 0,
        creditsMonthlyQuota: c.creditsMonthlyQuota ?? 60,
        pepitesThisMonth: c.pepitesThisMonth ?? 0,
        pepitesGuaranteed: c.pepitesGuaranteed ?? 6,
      };
    },
    enabled: !!me?.clientId,
    refetchInterval: 60_000,
  });

  const navMain: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" },
    { href: "/triggers", label: "Leads & Pépites", icon: Target, shortcut: "G L" },
  ];

  const pepitesPct = credits ? Math.min(100, Math.round((credits.pepitesThisMonth / credits.pepitesGuaranteed) * 100)) : 0;
  const pepitesOk = credits ? credits.pepitesThisMonth >= credits.pepitesGuaranteed : false;

  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[240px] flex-col border-r border-ink-800 bg-ink-950 md:flex">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-ink-800 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/30">
          <span className="font-display text-[18px] font-bold leading-none text-white">i</span>
        </div>
        <div className="flex-1">
          <div className="font-display text-[15px] font-semibold leading-tight tracking-tight text-white">
            iFIND
          </div>
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-brand-400 leading-tight">
            <span>Trigger Engine</span>
            <span className="text-ink-600">·</span>
            <span className="text-ink-500">FR</span>
          </div>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
        <NavSection label="Trigger Engine" items={navMain} pathname={pathname} />
        <NavSection label="Gestion" items={navManagement} pathname={pathname} className="mt-6" />
      </nav>

      {/* Garantie card */}
      {credits && (
        <div className="px-3 mb-3">
          <div className={cn(
            "rounded-xl p-3 border",
            pepitesOk
              ? "bg-gradient-to-br from-emerald-500/10 to-emerald-700/10 border-emerald-700/30"
              : "bg-gradient-to-br from-amber-500/10 to-amber-700/10 border-amber-700/30"
          )}>
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className={cn("h-3 w-3", pepitesOk ? "text-emerald-400" : "text-amber-400")} />
              <p className={cn("text-[10px] font-bold uppercase tracking-wider", pepitesOk ? "text-emerald-300" : "text-amber-300")}>
                Garantie Pépite
              </p>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="font-display text-2xl font-bold text-white leading-none">{credits.pepitesThisMonth}</span>
              <span className="text-[10px] text-ink-400">/ {credits.pepitesGuaranteed} min</span>
            </div>
            <div className="h-1.5 bg-ink-800 rounded-full overflow-hidden">
              <div className={cn(
                "h-full transition-all",
                pepitesOk ? "bg-gradient-to-r from-emerald-400 to-emerald-500" : "bg-gradient-to-r from-amber-400 to-amber-500"
              )} style={{ width: `${pepitesPct}%` }} />
            </div>
            <p className="text-[10px] text-ink-500 mt-2">
              <CreditCard className="h-2.5 w-2.5 inline mr-1" />
              {credits.creditsBalance} crédits restants
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-ink-800 p-3">
        <Link
          href={"/logout" as never}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-400 transition-colors hover:bg-ink-900 hover:text-white"
          prefetch={false}
        >
          <LogOut className="h-4 w-4" />
          <span>Déconnexion</span>
        </Link>
      </div>
    </aside>
  );
}

function NavSection({
  label,
  items,
  pathname,
  className,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="px-2.5 mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href as never}
              className={cn(
                "group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all",
                isActive
                  ? "bg-gradient-to-r from-brand-600/25 to-brand-600/5 text-white border-l-2 border-brand-500 -ml-0.5 shadow-sm"
                  : "text-ink-400 hover:bg-ink-900/60 hover:text-ink-100"
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon className={cn("h-4 w-4 transition-colors", isActive ? "text-brand-400" : "text-ink-500 group-hover:text-ink-300")} strokeWidth={2} />
                {item.label}
              </span>
              {item.badge && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold">
                  {item.badge}
                </span>
              )}
              {item.shortcut && (
                <span className="text-[10px] font-mono text-ink-600 group-hover:text-ink-500">{item.shortcut}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
