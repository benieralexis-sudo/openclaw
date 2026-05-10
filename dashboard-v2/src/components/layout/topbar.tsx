"use client";

import * as React from "react";
import { Search, Command, Bell } from "lucide-react";
import { ScopeSwitcher } from "@/components/scope/scope-switcher";

interface TopbarProps {
  title: string;
  description?: string;
  onCommandPaletteOpen?: () => void;
  notificationCount?: number;
}

export function Topbar({ title, description, onCommandPaletteOpen, notificationCount = 0 }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/85 px-6 backdrop-blur-md backdrop-saturate-150">
      {/* Left — page title */}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-base font-semibold tracking-tight text-ink-900 truncate leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-[12px] text-ink-500 truncate mt-0.5">{description}</p>
        )}
      </div>

      {/* Center — Scope switcher (multi-tenant) */}
      <div className="hidden md:block">
        <ScopeSwitcher />
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onCommandPaletteOpen}
          className="hidden md:inline-flex items-center gap-2 px-3 h-9 rounded-md text-[13px] text-ink-500 hover:text-ink-700 hover:bg-ink-50 transition-colors"
          aria-label="Recherche (Cmd+K)"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Rechercher</span>
          <kbd className="ml-1 inline-flex h-5 items-center gap-0.5 rounded border border-ink-200 bg-ink-50 px-1.5 font-mono text-[10px] font-medium text-ink-500">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>

        <button
          className="relative inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-500 hover:text-ink-900 hover:bg-ink-50 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notificationCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-600 text-white text-[10px] font-semibold tabular-nums">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </button>

        {/* Live indicator — cohérent avec marketing */}
        <div className="ml-1 flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-emerald-50 border border-emerald-100 text-[11px] font-medium text-emerald-700">
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
