"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { useScope } from "@/hooks/use-scope";
import { cn, initials } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

export function ScopeSwitcher() {
  const { activeClient, availableClients, role, switchClient } = useScope();
  const [open, setOpen] = React.useState(false);

  // Client/editor/viewer ne peuvent pas switcher — badge fixe
  if (role === "client" || role === "viewer" || role === "editor") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-[13px]">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-brand-700/70">
          Vue
        </span>
        <Building2 className="h-3.5 w-3.5 text-brand-600" />
        <span className="font-medium text-ink-900 max-w-[180px] truncate">
          {activeClient?.name ?? "Mon espace"}
        </span>
      </div>
    );
  }

  // Commercial / Admin → switcher actif
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-[13px] transition-all",
            "hover:bg-brand-100 hover:border-brand-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-brand-700/70">
            Vue
          </span>
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-[10px] font-semibold text-white">
            {activeClient ? initials(activeClient.name) : "?"}
          </div>
          <span className="font-medium text-ink-900 max-w-[200px] truncate">
            {activeClient?.name ?? (role === "admin" ? "Vue admin globale" : "Sélectionner...")}
          </span>
          <ChevronsUpDown className="h-3 w-3 text-ink-500" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] p-0" align="center">
        <Command>
          <CommandInput placeholder="Rechercher un client..." />
          <CommandList>
            <CommandEmpty>Aucun client trouvé.</CommandEmpty>

            {role === "admin" && (
              <>
                <CommandGroup heading="Vues globales">
                  <CommandItem
                    onSelect={() => {
                      switchClient(null);
                      setOpen(false);
                    }}
                  >
                    <Building2 className="h-4 w-4 text-ink-500" />
                    <span>Vue admin globale</span>
                    {!activeClient && <Check className="ml-auto h-4 w-4 text-brand-600" />}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            <CommandGroup heading={role === "admin" ? "Tous les clients" : "Mes clients"}>
              {availableClients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => {
                    switchClient(c.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-100 to-brand-200 text-[10px] font-semibold text-brand-700">
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink-900">{c.name}</div>
                    {c.industry && (
                      <div className="truncate text-[11px] text-ink-500">{c.industry}</div>
                    )}
                  </div>
                  {c.status === "active" && (
                    <Badge variant="success" size="sm" dot>
                      Actif
                    </Badge>
                  )}
                  {activeClient?.id === c.id && (
                    <Check className="h-4 w-4 text-brand-600" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
