import { describe, expect, it, beforeEach } from "vitest";
import { clearSmtpVerifyCache, verifyEmailSMTP } from "./email-smtp-verifier";

describe("email-smtp-verifier — cache", () => {
  beforeEach(() => {
    clearSmtpVerifyCache();
  });

  it("clearSmtpVerifyCache vide le cache", () => {
    // Pas d'erreur même quand le cache est vide
    clearSmtpVerifyCache();
    expect(true).toBe(true); // assertion bidon, le test vérifie juste que la fonction ne throw pas
  });

  it("verifyEmailSMTP retourne INVALID immédiatement sur syntaxe cassée", async () => {
    const r = await verifyEmailSMTP("");
    expect(r.status).toBe("INVALID");
    expect(r.detail).toContain("invalid");
  });

  it("verifyEmailSMTP retourne INVALID sur email sans @", async () => {
    const r = await verifyEmailSMTP("notanemail");
    expect(r.status).toBe("INVALID");
  });

  it("verifyEmailSMTP retourne INVALID sur domain trop court", async () => {
    const r = await verifyEmailSMTP("a@b");
    expect(r.status).toBe("INVALID");
  });

  it("verifyEmailSMTP retourne INVALID sur local part vide", async () => {
    const r = await verifyEmailSMTP("@acme.fr");
    expect(r.status).toBe("INVALID");
  });

  it("verifyEmailSMTP cache les résultats INVALID (second appel retourne cached)", async () => {
    const first = await verifyEmailSMTP("invalid");
    expect(first.status).toBe("INVALID");
    expect(first.detail).not.toContain("cached");

    const second = await verifyEmailSMTP("invalid");
    expect(second.status).toBe("INVALID");
    expect(second.detail).toContain("cached");
  });
});
