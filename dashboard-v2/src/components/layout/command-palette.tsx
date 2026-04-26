"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Target,
  GitBranch,
  Inbox,
  Users,
  Settings,
  Activity,
  LogOut,
  Sparkles,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href as never);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Tapez une commande ou un nom de client…" />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard />
            <span>Dashboard</span>
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/triggers")}>
            <Target />
            <span>Leads FR (Triggers)</span>
            <CommandShortcut>G L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/pipeline")}>
            <GitBranch />
            <span>Pipeline RDV</span>
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/unibox")}>
            <Inbox />
            <span>Replies (Unibox)</span>
            <CommandShortcut>G U</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/clients")}>
            <Users />
            <span>Clients</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings />
            <span>Paramètres</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/system")}>
            <Activity />
            <span>Système</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions rapides">
          <CommandItem onSelect={() => go("/triggers")}>
            <Sparkles />
            <span>Voir les pépites du jour (≥9/10)</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/logout")}>
            <LogOut />
            <span>Se déconnecter</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
