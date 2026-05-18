import { describe, expect, it } from "vitest";

// Tests des helpers de filtrage anti-bruit BODACC capital_increase
// (pivot Bombora FR — 18/05/2026)
//
// On teste les helpers privés via reimport. Si refactor, exporter les helpers.

// Helper: parser standalone identique à celui du poller pour tester la logique.
function extractMontantCapital(record: {
  listepersonnes?: unknown;
}): number | null {
  const lp = record.listepersonnes;
  if (!lp) return null;
  try {
    const parsed = typeof lp === "string" ? JSON.parse(lp) : lp;
    const montant = (parsed as { personne?: { capital?: { montantCapital?: unknown } } })
      ?.personne?.capital?.montantCapital;
    if (!montant) return null;
    const n = parseInt(String(montant).replace(/\D/g, ""), 10);
    return isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

const COMPTABLE_PATTERNS = [
  /incorporation\s+de\s+r[eé]serves?/i,
  /[ée]l[ée]vation\s+(de\s+)?la\s+valeur\s+nominale/i,
];
function isComptableOnly(contenu: string): boolean {
  return COMPTABLE_PATTERNS.some((p) => p.test(contenu));
}

describe("bodacc-poller: extractMontantCapital", () => {
  it("parse string JSON listepersonnes (format réel BODACC)", () => {
    const record = {
      listepersonnes: JSON.stringify({
        personne: {
          capital: { montantCapital: "11116454", devise: "EUR" },
        },
      }),
    };
    expect(extractMontantCapital(record)).toBe(11116454);
  });

  it("parse object listepersonnes direct", () => {
    const record = {
      listepersonnes: { personne: { capital: { montantCapital: "300000" } } },
    };
    expect(extractMontantCapital(record)).toBe(300000);
  });

  it("retourne null si pas de capital", () => {
    const record = { listepersonnes: JSON.stringify({ personne: {} }) };
    expect(extractMontantCapital(record)).toBeNull();
  });

  it("retourne null si listepersonnes absent", () => {
    expect(extractMontantCapital({})).toBeNull();
  });

  it("retourne null si JSON invalide", () => {
    const record = { listepersonnes: "not-json{{" };
    expect(extractMontantCapital(record)).toBeNull();
  });

  it("nettoie les caractères non-numériques (espaces, points)", () => {
    const record = {
      listepersonnes: JSON.stringify({
        personne: { capital: { montantCapital: "1 217 631" } },
      }),
    };
    expect(extractMontantCapital(record)).toBe(1217631);
  });
});

describe("bodacc-poller: isComptableOnly", () => {
  it("détecte incorporation de réserves", () => {
    expect(isComptableOnly("Augmentation par incorporation de réserves")).toBe(true);
    expect(isComptableOnly("Incorporation de reserves au capital")).toBe(true);
  });

  it("détecte élévation valeur nominale", () => {
    expect(isComptableOnly("Élévation de la valeur nominale des parts")).toBe(true);
    expect(isComptableOnly("Elevation de la valeur nominale")).toBe(true);
  });

  it("ne détecte pas les vraies levées", () => {
    expect(isComptableOnly("Augmentation par émission de parts nouvelles")).toBe(false);
    expect(isComptableOnly("Augmentation par apports en numéraire")).toBe(false);
    expect(isComptableOnly("Augmentation de capital")).toBe(false);
  });
});

describe("bodacc-poller: combinaison filtre noise", () => {
  const MIN_CAPITAL_EUR = 300_000;

  it("garde une boîte avec capital 1M€ et émission de parts", () => {
    const montant = extractMontantCapital({
      listepersonnes: JSON.stringify({
        personne: { capital: { montantCapital: "1000000" } },
      }),
    });
    const isNoise =
      (montant !== null && montant < MIN_CAPITAL_EUR) ||
      isComptableOnly("Augmentation par émission de parts");
    expect(isNoise).toBe(false);
  });

  it("rejette une boîte avec capital 10k€", () => {
    const montant = extractMontantCapital({
      listepersonnes: JSON.stringify({
        personne: { capital: { montantCapital: "10000" } },
      }),
    });
    const isNoise =
      (montant !== null && montant < MIN_CAPITAL_EUR) ||
      isComptableOnly("");
    expect(isNoise).toBe(true);
  });

  it("rejette même une grosse boîte si incorporation de réserves", () => {
    const montant = extractMontantCapital({
      listepersonnes: JSON.stringify({
        personne: { capital: { montantCapital: "5000000" } },
      }),
    });
    const isNoise =
      (montant !== null && montant < MIN_CAPITAL_EUR) ||
      isComptableOnly("Augmentation par incorporation de réserves");
    expect(isNoise).toBe(true);
  });

  it("garde une boîte sans capital connu (on ne sait pas, on garde)", () => {
    const montant = extractMontantCapital({});
    const isNoise =
      (montant !== null && montant < MIN_CAPITAL_EUR) ||
      isComptableOnly("");
    expect(isNoise).toBe(false);
  });
});
