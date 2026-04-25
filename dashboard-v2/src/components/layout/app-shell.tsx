"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { Toaster } from "@/components/ui/sonner";

interface AppShellProps {
  children: React.ReactNode;
}

const TITLES: Record<string, { title: string; description?: string }> = {
  "/dashboard": { title: "Dashboard", description: "Vue d'ensemble de votre pipeline temps réel" },
  "/triggers": { title: "Leads FR", description: "Tous les signaux d'achat détectés sur les PME françaises" },
  "/pipeline": { title: "Pipeline RDV", description: "Suivi des opportunités du premier contact au RDV booké" },
  "/unibox": { title: "Replies", description: "Inbox unifiée des réponses prospects" },
  "/clients": { title: "Clients", description: "Gestion des comptes clients et de leur configuration" },
  "/settings": { title: "Paramètres", description: "ICP, notifications, intégrations" },
  "/system": { title: "Système", description: "Santé du moteur, sources actives, logs" },
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const meta = React.useMemo(() => {
    for (const [path, m] of Object.entries(TITLES)) {
      if (pathname === path || pathname.startsWith(path + "/")) return m;
    }
    return { title: "iFIND" };
  }, [pathname]);

  // Raccourcis clavier globaux
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K — open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      // / — focus search (when not in input)
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-ink-50/40">
      <Sidebar />
      <div className="md:pl-[240px]">
        <Topbar
          title={meta.title}
          description={meta.description}
          onCommandPaletteOpen={() => setPaletteOpen(true)}
          notificationCount={3}
        />
        <main className="container-app py-8">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster />
    </div>
  );
}
