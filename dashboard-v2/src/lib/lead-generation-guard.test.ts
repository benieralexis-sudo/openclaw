import { describe, it, expect } from "vitest";
import { checkLeadCanGenerate } from "./lead-generation-guard";

describe("checkLeadCanGenerate", () => {
  it("bloque INCOMPLETE (reason=incomplete)", () => {
    const r = checkLeadCanGenerate({ status: "INCOMPLETE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("incomplete");
  });

  it("bloque ARCHIVED (reason=archived)", () => {
    const r = checkLeadCanGenerate({ status: "ARCHIVED" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("archived");
  });

  it("passe NEW", () => {
    const r = checkLeadCanGenerate({ status: "NEW" });
    expect(r.ok).toBe(true);
  });

  it("passe ENRICHED — lead-status-sync promeut quand email+li+fullName posés (Jour 14 Sujet 6)", () => {
    const r = checkLeadCanGenerate({ status: "ENRICHED" });
    expect(r.ok).toBe(true);
  });

  it("passe CONTACTABLE / CONTACTED / NOT_INTERESTED — statuts manuels Fred", () => {
    expect(checkLeadCanGenerate({ status: "CONTACTABLE" }).ok).toBe(true);
    expect(checkLeadCanGenerate({ status: "CONTACTED" }).ok).toBe(true);
    expect(checkLeadCanGenerate({ status: "NOT_INTERESTED" }).ok).toBe(true);
  });

  it("bloque doNotContact (reason=doNotContact)", () => {
    const r = checkLeadCanGenerate({ status: "NEW", doNotContact: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("doNotContact");
  });

  it("doNotContactReason est incluse dans le message si présente", () => {
    const r = checkLeadCanGenerate({
      status: "NEW",
      doNotContact: true,
      doNotContactReason: "email_domain_mismatch",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("email_domain_mismatch");
  });

  it("bloque bouncedAt récent (<30j)", () => {
    const r = checkLeadCanGenerate({
      status: "NEW",
      bouncedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bouncedAt");
  });

  it("passe bouncedAt ancien (>30j)", () => {
    const r = checkLeadCanGenerate({
      status: "NEW",
      bouncedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    expect(r.ok).toBe(true);
  });

  it("doNotContact prime sur status NEW", () => {
    const r = checkLeadCanGenerate({ status: "NEW", doNotContact: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("doNotContact");
  });

  it("INCOMPLETE prime sur doNotContact=false", () => {
    const r = checkLeadCanGenerate({ status: "INCOMPLETE", doNotContact: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("incomplete");
  });
});
