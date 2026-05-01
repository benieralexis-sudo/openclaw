import { describe, it, expect } from "vitest";
import {
  humanizeCompanySize,
  humanizeRevenue,
  humanizeResultNet,
  humanizeEtabsCount,
} from "./format-company";

describe("humanizeCompanySize", () => {
  it("dans la cible ICP → label positif", () => {
    expect(humanizeCompanySize({ etabsCount: 50, sizeText: null, icpMin: 11, icpMax: 200 })).toMatch(/dans\s*la\s*cible/i);
  });
  it("trop grosse (>3x sizeMax) → label rouge", () => {
    const r = humanizeCompanySize({ etabsCount: 1400, sizeText: null, icpMin: 11, icpMax: 200 });
    expect(r).toMatch(/grand|grosse|hors\s*cible/i);
    expect(r).toContain("1400");
  });
  it("trop petite (<sizeMin) → label gris", () => {
    expect(humanizeCompanySize({ etabsCount: 3, sizeText: null, icpMin: 11, icpMax: 200 })).toMatch(/trop\s*petite/i);
  });
  it("null + sizeText '1000+' → utilise sizeText", () => {
    expect(humanizeCompanySize({ etabsCount: null, sizeText: "1000+", icpMin: 11, icpMax: 200 })).toContain("1000");
  });
  it("tout null → '—'", () => {
    expect(humanizeCompanySize({ etabsCount: null, sizeText: null, icpMin: 11, icpMax: 200 })).toBe("—");
  });
});

describe("humanizeRevenue", () => {
  it("63M€ → '63 M€ — solide'", () => {
    expect(humanizeRevenue(63_000_000)).toMatch(/63\s*M€/);
    expect(humanizeRevenue(63_000_000)).toMatch(/solide/i);
  });
  it("12M€ → '12 M€ — scale-up'", () => {
    expect(humanizeRevenue(12_000_000)).toMatch(/scale|croissance/i);
  });
  it("500k€ → 'early stage / petit'", () => {
    expect(humanizeRevenue(500_000)).toMatch(/early|petit|<\s*1\s*M/i);
  });
  it("100M€+ → 'grand groupe'", () => {
    expect(humanizeRevenue(150_000_000)).toMatch(/grand|établi/i);
  });
  it("null → '—'", () => {
    expect(humanizeRevenue(null)).toBe("—");
  });
  it("0 → '—'", () => {
    expect(humanizeRevenue(0)).toBe("—");
  });
});

describe("humanizeResultNet", () => {
  it("positif → '+X M€ — rentable'", () => {
    expect(humanizeResultNet(6_190_000)).toMatch(/\+.+M€/);
    expect(humanizeResultNet(6_190_000)).toMatch(/rentable/i);
  });
  it("négatif → '-X M€ — déficit'", () => {
    expect(humanizeResultNet(-2_500_000)).toMatch(/-.+M€/);
    expect(humanizeResultNet(-2_500_000)).toMatch(/déficit|perte/i);
  });
  it("null → '—'", () => {
    expect(humanizeResultNet(null)).toBe("—");
  });
});

describe("humanizeEtabsCount", () => {
  it("1 → 'mono-site'", () => {
    expect(humanizeEtabsCount(1)).toMatch(/mono.?site/i);
  });
  it(">5 → 'multi-sites'", () => {
    expect(humanizeEtabsCount(14)).toMatch(/multi.?sites/i);
    expect(humanizeEtabsCount(14)).toContain("14");
  });
  it("null → '—'", () => {
    expect(humanizeEtabsCount(null)).toBe("—");
  });
});
