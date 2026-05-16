import { describe, expect, it } from "vitest";
import { isSourceDisabled } from "./source-toggle";

describe("isSourceDisabled", () => {
  it("retourne false si ICP null", () => {
    expect(isSourceDisabled(null, "theirstack.buying-intent")).toBe(false);
  });

  it("retourne false si ICP undefined", () => {
    expect(isSourceDisabled(undefined, "theirstack.buying-intent")).toBe(false);
  });

  it("retourne false si disabledSources absent", () => {
    expect(isSourceDisabled({}, "theirstack.buying-intent")).toBe(false);
  });

  it("retourne false si disabledSources vide", () => {
    expect(isSourceDisabled({ disabledSources: [] }, "theirstack.buying-intent")).toBe(false);
  });

  it("retourne true si source dans la liste", () => {
    const icp = { disabledSources: ["theirstack.buying-intent", "apify.indeed-jobs"] };
    expect(isSourceDisabled(icp, "theirstack.buying-intent")).toBe(true);
    expect(isSourceDisabled(icp, "apify.indeed-jobs")).toBe(true);
  });

  it("retourne false si source pas dans la liste", () => {
    const icp = { disabledSources: ["theirstack.buying-intent"] };
    expect(isSourceDisabled(icp, "rodz.fundraising")).toBe(false);
    expect(isSourceDisabled(icp, "apify.wttj-jobs")).toBe(false);
  });

  it("match exact, pas de préfixe ni regex", () => {
    const icp = { disabledSources: ["theirstack"] };
    expect(isSourceDisabled(icp, "theirstack.buying-intent")).toBe(false);
    expect(isSourceDisabled(icp, "theirstack.job-offer")).toBe(false);
  });

  it("case-sensitive", () => {
    const icp = { disabledSources: ["TheirStack.Buying-Intent"] };
    expect(isSourceDisabled(icp, "theirstack.buying-intent")).toBe(false);
  });
});
