import { describe, it, expect } from "vitest";
import { simplifyTriggerTitle } from "./simplify-trigger-title";

describe("simplifyTriggerTitle", () => {
  it("strip pattern Rodz '[client] — [type] — [société]' (cas Collective.work)", () => {
    const r = simplifyTriggerTitle(
      "Digi Test Lab — Recrutement QA/Testeur (HOT) — Collective.work",
      "Collective.work",
    );
    expect(r).toBe("Recrutement QA/Testeur");
  });

  it("strip pattern Rodz recruitment_campaign", () => {
    const r = simplifyTriggerTitle(
      "Digi Test Lab — Campagne recrutement Test — Collective.work",
      "Collective.work",
    );
    expect(r).toBe("Campagne recrutement Test");
  });

  it("strip '(HOT)' / '(QA match)' / '(combo)' parasites", () => {
    expect(simplifyTriggerTitle("Recrutement (HOT)", "X")).toBe("Recrutement");
    expect(simplifyTriggerTitle("Ingénieur QA H/F (QA match)", "X")).toBe("Ingénieur QA H/F");
    expect(simplifyTriggerTitle("Hire (combo)", "X")).toBe("Hire");
  });

  it("strip ID interne type ' - 042026/PST/ERZ' (cas SERMA Apify)", () => {
    expect(simplifyTriggerTitle(
      "Ingénieur banc de tests H/F - 042026/PST/ERZ",
      "SERMA",
    )).toBe("Ingénieur banc de tests H/F");
  });

  it("préserve les titres déjà propres", () => {
    expect(simplifyTriggerTitle("Levée — 15MUSD", "Société")).toBe("Levée — 15MUSD");
    expect(simplifyTriggerTitle("Ingénieur QA Engineer", "X")).toBe("Ingénieur QA Engineer");
  });

  it("strip seulement le suffixe société si exact match", () => {
    // " — Collective.work" en suffixe → strippé
    expect(simplifyTriggerTitle("Truc — Collective.work", "Collective.work")).toBe("Truc");
    // Pas de suffixe société → préservé
    expect(simplifyTriggerTitle("Truc — Autre", "Collective.work")).toBe("Truc — Autre");
  });

  it("retourne null/empty propre si input vide", () => {
    expect(simplifyTriggerTitle("", "X")).toBe("");
    expect(simplifyTriggerTitle(null as unknown as string, "X")).toBe("");
  });

  it("trim espaces résiduels après strip", () => {
    expect(simplifyTriggerTitle("  Recrutement   (HOT)  ", "X")).toBe("Recrutement");
  });
});
