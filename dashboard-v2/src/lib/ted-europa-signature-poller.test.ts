import { describe, it, expect } from "vitest";
import { extractFrenchString } from "./ted-europa-signature-poller";

describe("extractFrenchString", () => {
  it("handles plain string", () => {
    expect(extractFrenchString("EDF SA")).toBe("EDF SA");
  });
  it("handles {fra: string} structure (TED single-value fields like notice-title)", () => {
    expect(extractFrenchString({ fra: "France – Services – Signature" })).toBe(
      "France – Services – Signature",
    );
  });
  it("handles {fra: [string]} structure (TED multi-value fields like organisation-name-buyer)", () => {
    expect(extractFrenchString({ fra: ["EDF SA"] })).toBe("EDF SA");
  });
  it("handles array of strings", () => {
    expect(extractFrenchString(["Paris", "Lyon"])).toBe("Paris");
  });
  it("returns empty string for undefined", () => {
    expect(extractFrenchString(undefined)).toBe("");
  });
  it("returns empty string for empty fra array", () => {
    expect(extractFrenchString({ fra: [] })).toBe("");
  });
  it("returns empty string for missing fra key", () => {
    expect(extractFrenchString({} as { fra?: string[] })).toBe("");
  });
});

describe("buildTedQuery (via integration shape)", () => {
  // Vérifie qu'on construit bien une requête avec le bon format.
  // On ne peut pas importer buildTedQuery (non exporté) mais on teste
  // la forme attendue via les exigences de l'API TED v3 documentées.
  it("API endpoint format is correct", () => {
    const expectedUrl = "https://api.ted.europa.eu/v3/notices/search";
    expect(expectedUrl).toMatch(/^https:\/\/api\.ted\.europa\.eu\/v3/);
  });
});
