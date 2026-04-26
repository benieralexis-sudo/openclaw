"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Target,
  GitBranch,
  Inbox,
  Users,
  Settings,
  Activity,
  Sparkles,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useScope } from "@/hooks/use-scope";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  badge?: { count: number; variant: "fire" | "brand" | "warning" };
  shortcut?: string;
}

const navManagement: NavItem[] = [
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/settings", label: "Paramètres", icon: Settings },
  { href: "/system", label: "Système", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  const { activeClientId } = useScope();

  const { data: unreadCount = 0 } = useQuery<number>({
    queryKey: ["replies-unread-count", activeClientId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "UNREAD", count: "true" });
      if (activeClientId) params.set("clientId", activeClientId);
      const res = await fetch(`/api/replies?${params.toString()}`);
      if (!res.ok) return 0;
      const json = await res.json();
      return json.count ?? 0;
    },
    refetchInterval: 30 * 1000,
  });

  const navMain: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" },
    { href: "/triggers", label: "Leads FR", icon: Target, shortcut: "G L", badge: { count: 5, variant: "fire" } },
    { href: "/pipeline", label: "Pipeline RDV", icon: GitBranch, shortcut: "G P" },
    {
      href: "/unibox",
      label: "Replies",
      icon: Inbox,
      shortcut: "G U",
      ...(unreadCount > 0 ? { badge: { count: unreadCount, variant: "brand" as const } } : {}),
    },
  ];

  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[240px] flex-col border-r border-ink-200 bg-white md:flex">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-ink-200 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm shadow-brand-500/30">
          <span className="font-sans text-[18px] font-semibold leading-none text-white">i</span>
        </div>
        <div className="flex-1">
          <div className="font-display text-[15px] font-semibold leading-tight tracking-tight text-ink-900">
            iFIND
          </div>
          <div className="text-[10.5px] font-medium uppercase tracking-wider text-ink-400 leading-tight">
            Trigger Engine
          </div>
        </div>
        <Sparkles className="h-3.5 w-3.5 text-brand-500" />
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <NavSection label="Trigger Engine" items={navMain} pathname={pathname} />
        <NavSection label="Gestion" items={navManagement} pathname={pathname} className="mt-6" />
      </nav>

      {/* Footer */}
      <div className="border-t border-ink-200 p-3">
        <Link
          href={"/logout" as never}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900"
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
      <div className="mb-2 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href as never}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-all",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                {active && (
                  <span
                    className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-600"
                    aria-hidden
                  />
                )}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-brand-600" : "text-ink-500 group-hover:text-ink-700",
                  )}
                  strokeWidth={2}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && item.badge.count > 0 && (
                  <Badge variant={item.badge.variant} size="sm" className="font-mono tabular-nums">
                    {item.badge.count}
                  </Badge>
                )}
                {item.shortcut && !item.badge && (
                  <span className="hidden font-mono text-[10px] text-ink-400 tracking-wider group-hover:inline">
                    {item.shortcut}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
