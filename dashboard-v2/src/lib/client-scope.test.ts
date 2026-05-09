// Sprint 4 (10/05/2026) — Tests d'integration multi-tenant.
//
// Couvre la fonction critique resolveClientScope qui decide si un user
// peut acceder a un client donne. Pure function, testable sans DB ni HTTP.
//
// Hypotheses :
//   - ADMIN : voit tout (clientId requested ou null)
//   - COMMERCIAL : voit ses scopeClientIds, refuse les autres
//   - CLIENT/EDITOR/VIEWER : voit son seul clientId, refuse les autres
//   - User sans clientId associe : 403 (sauf ADMIN/COMMERCIAL)

import { describe, it, expect } from "vitest";
import { resolveClientScope, type ClientScopeUser } from "@/lib/client-scope";

function fakeUser(overrides: Partial<ClientScopeUser> = {}): ClientScopeUser {
  return {
    id: "u-test",
    role: "CLIENT" as ClientScopeUser["role"],
    clientId: null,
    scopeClientIds: [],
    ...overrides,
  };
}

describe("resolveClientScope — ADMIN", () => {
  it("ADMIN sans param → ok, clientId null (vue globale)", () => {
    const r = resolveClientScope(fakeUser({ role: "ADMIN" }), null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBeNull();
  });
  it("ADMIN avec clientId requested → ok, retourne le requested", () => {
    const r = resolveClientScope(fakeUser({ role: "ADMIN" }), "client-X");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBe("client-X");
  });
});

describe("resolveClientScope — CLIENT/EDITOR/VIEWER", () => {
  it("CLIENT sans clientId associe → 403", () => {
    const r = resolveClientScope(fakeUser({ role: "CLIENT" }), null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toContain("Aucun client");
    }
  });
  it("CLIENT avec clientId associe → retourne SON clientId (ignore param)", () => {
    const r = resolveClientScope(
      fakeUser({ role: "CLIENT", clientId: "client-A" }),
      "client-B", // tente d'acceder a un autre client
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBe("client-A"); // toujours son propre client
  });
  it("EDITOR avec clientId → retourne SON clientId", () => {
    const r = resolveClientScope(
      fakeUser({ role: "EDITOR", clientId: "client-A" }),
      null,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBe("client-A");
  });
  it("VIEWER avec clientId → retourne SON clientId", () => {
    const r = resolveClientScope(
      fakeUser({ role: "VIEWER", clientId: "client-Y" }),
      "client-X",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBe("client-Y");
  });
});

describe("resolveClientScope — COMMERCIAL", () => {
  it("COMMERCIAL sans param + scope vide → ok clientId null", () => {
    const r = resolveClientScope(
      fakeUser({ role: "COMMERCIAL", scopeClientIds: [] }),
      null,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBeNull();
  });
  it("COMMERCIAL sans param + scope avec 2 clients → premier client", () => {
    const r = resolveClientScope(
      fakeUser({ role: "COMMERCIAL", scopeClientIds: ["client-1", "client-2"] }),
      null,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBe("client-1");
  });
  it("COMMERCIAL avec clientId requested DANS scope → ok le requested", () => {
    const r = resolveClientScope(
      fakeUser({ role: "COMMERCIAL", scopeClientIds: ["client-1", "client-2"] }),
      "client-2",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clientId).toBe("client-2");
  });
  it("COMMERCIAL avec clientId requested HORS scope → 403", () => {
    const r = resolveClientScope(
      fakeUser({ role: "COMMERCIAL", scopeClientIds: ["client-1"] }),
      "client-evil", // pas dans scope
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toContain("périmètre");
    }
  });
});

describe("resolveClientScope — anti-fuite cross-client", () => {
  it("CLIENT-A ne peut JAMAIS acceder a client-B (meme via param)", () => {
    const tests = [
      { role: "CLIENT" as const, requested: "client-B" },
      { role: "EDITOR" as const, requested: "client-B" },
      { role: "VIEWER" as const, requested: "client-B" },
    ];
    for (const { role, requested } of tests) {
      const r = resolveClientScope(
        fakeUser({ role, clientId: "client-A" }),
        requested,
      );
      // ok=true mais clientId reste "client-A" (jamais "client-B")
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.clientId).toBe("client-A");
    }
  });
  it("COMMERCIAL ne peut acceder qu'a ses scopeClientIds, pas un id arbitraire", () => {
    const r = resolveClientScope(
      fakeUser({ role: "COMMERCIAL", scopeClientIds: ["c1", "c2", "c3"] }),
      "c-stranger",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});
