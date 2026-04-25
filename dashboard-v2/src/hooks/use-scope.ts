"use client";

import * as React from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type Role = "admin" | "commercial" | "client" | "editor" | "viewer";

/** Structure renvoyée par l'API /api/clients */
export interface ApiClient {
  id: string;
  slug: string;
  name: string;
  industry: string | null;
  region: string | null;
  size: string | null;
  status: "PROSPECT" | "ACTIVE" | "PAUSED" | "CHURNED";
  plan: "LEADS_DATA" | "FULL_SERVICE" | "CUSTOM";
  activatedAt: string | null;
}

/** Structure exposée à l'UI (ScopeSwitcher etc.) */
export interface ScopedClient {
  id: string;
  slug: string;
  name: string;
  industry?: string;
  status: "active" | "paused" | "deleted";
}

interface ScopeStore {
  activeClientId: string | null;
  setActiveClientId: (id: string | null) => void;
}

const useScopeStore = create<ScopeStore>()(
  persist(
    (set) => ({
      activeClientId: null,
      setActiveClientId: (id) => set({ activeClientId: id }),
    }),
    {
      name: "ifind:active-client",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

const API_TO_UI_STATUS: Record<ApiClient["status"], ScopedClient["status"]> = {
  ACTIVE: "active",
  PAUSED: "paused",
  PROSPECT: "paused",
  CHURNED: "deleted",
};

function toUi(c: ApiClient): ScopedClient {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    industry: c.industry ?? undefined,
    status: API_TO_UI_STATUS[c.status],
  };
}

interface ApiMe {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "COMMERCIAL" | "CLIENT" | "EDITOR" | "VIEWER";
  clientId: string | null;
  client: { id: string; slug: string; name: string } | null;
  scopeClientIds: string[];
  onboardingDone: boolean;
}

/**
 * Hook unifié pour le scope client courant — connecté à l'API + Better Auth.
 * Phase 1.4 : `role` provient de /api/me (session vérifiée côté serveur).
 */
export function useScope() {
  const { activeClientId, setActiveClientId } = useScopeStore();
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery<ApiMe>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) throw new Error("Erreur chargement session");
      return res.json();
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const role: Role = me ? (me.role.toLowerCase() as Role) : "viewer";

  const { data: rawClients = [], isLoading: clientsLoading } = useQuery<ApiClient[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients");
      if (!res.ok) throw new Error("Erreur chargement clients");
      return res.json();
    },
    enabled: !!me,
  });

  const isLoading = meLoading || clientsLoading;

  const availableClients = React.useMemo(() => rawClients.map(toUi), [rawClients]);

  // Pour les rôles client/editor/viewer : on lock leur clientId (peuvent pas switch)
  // Pour les rôles admin/commercial : on autorise le switch via UI
  const lockedClientId =
    me && (me.role === "CLIENT" || me.role === "EDITOR" || me.role === "VIEWER")
      ? me.clientId
      : null;

  const effectiveActiveId = lockedClientId ?? activeClientId;

  const activeClient =
    availableClients.find((c) => c.id === effectiveActiveId) ?? null;

  const switchClient = React.useCallback(
    (clientId: string | null) => {
      setActiveClientId(clientId);
      queryClient.invalidateQueries({ queryKey: ["triggers"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    [setActiveClientId, queryClient],
  );

  return {
    role,
    me,
    activeClient,
    availableClients,
    activeClientId: effectiveActiveId,
    isLoading,
    switchClient,
  };
}
