import { describe, it, expect } from "vitest";
import { combineScores, dedupTodoByCompany, type TodoItem } from "./todo-today";

describe("combineScores", () => {
  it("priority seul (fit null) = priority", () => {
    expect(combineScores(38, null)).toBe(38);
  });

  it("fit seul (priority null) = 0 (priorité = signal commercial réel, fit seul ne suffit pas)", () => {
    expect(combineScores(null, 100)).toBe(0);
  });

  it("les 2 null → 0", () => {
    expect(combineScores(null, null)).toBe(0);
  });

  it("combo priority+fit : priority dominant, fit pondéré 0.3 (moins fort)", () => {
    // 38 + 100*0.3 = 68
    expect(combineScores(38, 100)).toBe(68);
  });

  it("priority moyen + fit haut peut battre priority haut + fit nul", () => {
    // A : 23 + 100*0.3 = 53
    // B : 38 + 0 = 38
    expect(combineScores(23, 100)).toBeGreaterThan(combineScores(38, 0));
  });

  it("priority très haut bat priority moyen même avec fit max", () => {
    // 80 + 0 = 80 vs 23 + 100*0.3 = 53
    expect(combineScores(80, 0)).toBeGreaterThan(combineScores(23, 100));
  });

  it("0+0 = 0 (lead non scoré)", () => {
    expect(combineScores(0, 0)).toBe(0);
  });
});

describe("dedupTodoByCompany", () => {
  function makeItem(over: Partial<TodoItem>): TodoItem {
    return {
      id: "id-1",
      companyName: "Société",
      companySiret: null,
      firstName: null,
      lastName: null,
      jobTitle: null,
      title: "Trigger title",
      score: 7,
      priorityScore: 20,
      freshnessScore: 80,
      multiSourceBoost: 0,
      fitScore: 60,
      capturedAt: "2026-05-01T20:00:00Z",
      hasEmail: false,
      hasPhone: false,
      hasLinkedin: false,
      ...over,
    };
  }

  it("ne supprime rien si toutes sociétés distinctes", () => {
    const items = [
      makeItem({ companyName: "A" }),
      makeItem({ companyName: "B" }),
      makeItem({ companyName: "C" }),
    ];
    expect(dedupTodoByCompany(items)).toHaveLength(3);
  });

  it("dédupe par companyName si pas de siret", () => {
    const items = [
      makeItem({ id: "1", companyName: "Asys", priorityScore: 30 }),
      makeItem({ id: "2", companyName: "Asys", priorityScore: 25 }),
    ];
    const r = dedupTodoByCompany(items);
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe("1"); // garde le 1er (déjà trié par caller)
  });

  it("dédupe par siret prioritaire (vs companyName)", () => {
    const items = [
      makeItem({ id: "1", companyName: "Asys", companySiret: "348284977", priorityScore: 30 }),
      makeItem({ id: "2", companyName: "Asys Groupe", companySiret: "348284977", priorityScore: 25 }),
    ];
    expect(dedupTodoByCompany(items)).toHaveLength(1);
  });

  it("case-insensitive sur companyName", () => {
    const items = [
      makeItem({ id: "1", companyName: "Asys" }),
      makeItem({ id: "2", companyName: "ASYS" }),
    ];
    expect(dedupTodoByCompany(items)).toHaveLength(1);
  });

  it("ignore companyName vides ou whitespace seulement", () => {
    const items = [
      makeItem({ id: "1", companyName: "Asys" }),
      makeItem({ id: "2", companyName: "   " }),
    ];
    // Le 2e est skip (clé vide)
    expect(dedupTodoByCompany(items)).toHaveLength(1);
  });
});
