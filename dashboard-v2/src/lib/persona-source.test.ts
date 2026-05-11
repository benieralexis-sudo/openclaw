import { describe, expect, it } from "vitest";
import {
  formatPersonaSources,
  getPrimaryAttributionSources,
  hasPersonaSourceTag,
  parsePersonaSources,
} from "./persona-source";

describe("parsePersonaSources (Fix B7)", () => {
  it("parses composite string like 'none + jobtitle-upgrade + headline-upgrade'", () => {
    const r = parsePersonaSources("none + jobtitle-upgrade + headline-upgrade");
    expect(r.known).toEqual(["none", "jobtitle-upgrade", "headline-upgrade"]);
    expect(r.unknown).toEqual([]);
  });

  it("parses single tag", () => {
    const r = parsePersonaSources("pappers-rcs");
    expect(r.known).toEqual(["pappers-rcs"]);
    expect(r.unknown).toEqual([]);
  });

  it("handles whitespace variations", () => {
    expect(parsePersonaSources("rodz-payload+harvestapi-search").known).toEqual([
      "rodz-payload",
      "harvestapi-search",
    ]);
    expect(parsePersonaSources("  pappers-rcs  ").known).toEqual(["pappers-rcs"]);
  });

  it("flags unknown tokens without throwing", () => {
    const r = parsePersonaSources("pappers-rcs + unknown-token + headline-upgrade");
    expect(r.known).toEqual(["pappers-rcs", "headline-upgrade"]);
    expect(r.unknown).toEqual(["unknown-token"]);
  });

  it("handles null/empty gracefully", () => {
    expect(parsePersonaSources(null).known).toEqual([]);
    expect(parsePersonaSources(undefined).known).toEqual([]);
    expect(parsePersonaSources("").known).toEqual([]);
    expect(parsePersonaSources("  ").known).toEqual([]);
  });
});

describe("hasPersonaSourceTag (Fix B7)", () => {
  it("returns true only for exact tag presence", () => {
    expect(
      hasPersonaSourceTag("rodz-payload + headline-upgrade", "headline-upgrade"),
    ).toBe(true);
    expect(hasPersonaSourceTag("pappers-rcs", "rodz-payload")).toBe(false);
  });

  it("avoids substring false positives (typed enum)", () => {
    // "upgrade" est un substring de "headline-upgrade" mais pas un tag valide
    expect(
      hasPersonaSourceTag("headline-upgrade", "headline-upgrade"),
    ).toBe(true);
  });

  it("returns false on null/empty", () => {
    expect(hasPersonaSourceTag(null, "pappers-rcs")).toBe(false);
  });
});

describe("getPrimaryAttributionSources (Fix B7)", () => {
  it("filters out technical tags (none, *-upgrade)", () => {
    expect(
      getPrimaryAttributionSources("none + headline-upgrade + jobtitle-upgrade"),
    ).toEqual([]);
    expect(
      getPrimaryAttributionSources("rodz-payload + headline-upgrade"),
    ).toEqual(["rodz-payload"]);
  });

  it("keeps real attribution sources", () => {
    expect(
      getPrimaryAttributionSources("pappers-rcs + harvestapi-search"),
    ).toEqual(["pappers-rcs", "harvestapi-search"]);
  });
});

describe("formatPersonaSources (Fix B7)", () => {
  it("joins with ' + ' separator (round-trip with parse)", () => {
    const tags = ["rodz-payload", "harvestapi-search"] as const;
    const formatted = formatPersonaSources(tags);
    expect(formatted).toBe("rodz-payload + harvestapi-search");
    expect(parsePersonaSources(formatted).known).toEqual([...tags]);
  });

  it("handles empty array", () => {
    expect(formatPersonaSources([])).toBe("");
  });
});
