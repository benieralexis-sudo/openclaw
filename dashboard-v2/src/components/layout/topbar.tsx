"use client";

import * as React from "react";
import { Search, Command, Bell } from "lucide-react";
import { ScopeSwitcher } from "@/components/scope/scope-switcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface TopbarProps {
  title: string;
  description?: string;
  onCommandPaletteOpen?: () => void;
  notificationCount?: number;
}

export function Topbar({ title, description, onCommandPaletteOpen, notificationCount = 0 }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/85 px-6 backdrop-blur-md backdrop-saturate-150">
      {/* Left — page title */}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[15px] font-semibold tracking-tight text-ink-900 truncate">
          {title}
        </h1>
        {description && (
          <p className="text-xs text-ink-500 truncate">{description}</p>
        )}
      </div>

      {/* Center — Scope switcher (multi-tenant) */}
      <div className="hidden md:block">
        <ScopeSwitcher />
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCommandPaletteOpen}
          className="hidden gap-2 text-ink-500 md:inline-flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-[13px]">Rechercher</span>
          <kbd className="ml-2 inline-flex h-5 items-center gap-0.5 rounded border border-ink-200 bg-ink-50 px-1.5 font-mono text-[10px] font-medium text-ink-500">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </Button>

        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {notificationCount > 0 && (
            <Badge
              variant="fire"
              size="sm"
              className="absolute -right-1 -top-1 h-4 min-w-[16px] justify-center rounded-full px-1 font-mono tabular-nums"
            >
              {notificationCount > 9 ? "9+" : notificationCount}
            </Badge>
          )}
        </Button>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </div>
      </div>
    </header>
  );
}
