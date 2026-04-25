"use client";

import * as React from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Role = "admin" | "commercial" | "client" | "editor" | "viewer";

export interface ScopedClient {
  id: string;
  name: string;
  industry?: string;
  status?: "active" | "paused" | "deleted";
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

/**
 * Hook unifié pour le scope client courant.
 *
 * En attendant la vraie API (Phase 1.4 + 1.6), on fournit des données mock
 * pour valider le composant ScopeSwitcher. Sera branché sur Better Auth
 * + GET /api/clients dès Phase 1.4.
 */
export function useScope() {
  const { activeClientId, setActiveClientId } = useScopeStore();

  // TODO Phase 1.4 — remplacer par useQuery sur /api/me
  const role = "admin" as Role;

  // TODO Phase 1.6 — remplacer par useQuery sur /api/clients
  const availableClients: ScopedClient[] = React.useMemo(
    () => [
      { id: "ifind", name: "iFIND (interne)", industry: "SaaS B2B", status: "active" },
      { id: "digitestlab", name: "DigitestLab", industry: "Conseil digital", status: "active" },
      { id: "fimmop", name: "FIMMOP", industry: "Immobilier", status: "active" },
    ],
    [],
  );

  const activeClient =
    availableClients.find((c) => c.id === activeClientId) ?? null;

  const switchClient = React.useCallback(
    (clientId: string | null) => {
      setActiveClientId(clientId);
      // Phase 1.4+ : invalidate React Query cache here
    },
    [setActiveClientId],
  );

  return {
    role,
    activeClient,
    availableClients,
    activeClientId,
    switchClient,
  };
}
