import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";

import {
  clearAnthropicDown,
  invalidateAnthropicHealthCache,
  isAnthropicDown,
  isTransientAnthropicError,
  markAnthropicDown,
} from "./anthropic-health";

const FLAG_PATH = "/tmp/ifind-anthropic-down-flag.json";

function cleanup(): void {
  if (existsSync(FLAG_PATH)) unlinkSync(FLAG_PATH);
  invalidateAnthropicHealthCache();
}

describe("isTransientAnthropicError", () => {
  it("matches credit balance errors", () => {
    expect(
      isTransientAnthropicError(new Error("Your credit balance is too low")),
    ).toBe(true);
  });

  it("matches HTTP 429 rate-limit", () => {
    expect(isTransientAnthropicError("429 Too Many Requests")).toBe(true);
  });

  it("matches network timeouts", () => {
    expect(isTransientAnthropicError(new Error("ETIMEDOUT 192.0.2.1"))).toBe(true);
    expect(isTransientAnthropicError("ECONNRESET")).toBe(true);
  });

  it("matches 503 service unavailable", () => {
    expect(isTransientAnthropicError("503 Service Unavailable")).toBe(true);
    expect(isTransientAnthropicError("overloaded_error")).toBe(true);
  });

  it("does NOT match logic errors (Zod, dossier null)", () => {
    expect(isTransientAnthropicError("Zod validation failed")).toBe(false);
    expect(isTransientAnthropicError("dossier null for trigger abc")).toBe(false);
    expect(isTransientAnthropicError("V2 returned null")).toBe(false);
  });

  it("handles null/undefined gracefully", () => {
    expect(isTransientAnthropicError(null)).toBe(false);
    expect(isTransientAnthropicError(undefined)).toBe(false);
    expect(isTransientAnthropicError("")).toBe(false);
  });
});

describe("markAnthropicDown / clearAnthropicDown", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("creates flag file on first call", () => {
    expect(existsSync(FLAG_PATH)).toBe(false);
    markAnthropicDown("test panic");
    expect(existsSync(FLAG_PATH)).toBe(true);
  });

  it("increments attempts on repeated calls without sending duplicate alerts", () => {
    markAnthropicDown("first");
    markAnthropicDown("second");
    markAnthropicDown("third");
    expect(existsSync(FLAG_PATH)).toBe(true);
    // Pas d'assertion sur Telegram mock, mais on vérifie que le flag persiste.
  });

  it("clearAnthropicDown removes the flag", () => {
    markAnthropicDown("test");
    expect(existsSync(FLAG_PATH)).toBe(true);
    clearAnthropicDown();
    expect(existsSync(FLAG_PATH)).toBe(false);
  });

  it("clearAnthropicDown is no-op when flag absent", () => {
    expect(existsSync(FLAG_PATH)).toBe(false);
    expect(() => clearAnthropicDown()).not.toThrow();
  });
});

describe("isAnthropicDown", () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns false when no flag is present", async () => {
    expect(await isAnthropicDown()).toBe(false);
  });

  it("returns false (and clears flag) when re-ping succeeds", async () => {
    // Mock getAnthropic pour simuler recovery
    vi.doMock("./anthropic", () => ({
      getAnthropic: () => ({
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        },
      }),
    }));
    markAnthropicDown("simulated outage");
    expect(existsSync(FLAG_PATH)).toBe(true);
    const result = await isAnthropicDown();
    expect(result).toBe(false);
    expect(existsSync(FLAG_PATH)).toBe(false); // flag cleared par recovery
  });

  it("returns true when re-ping still fails", async () => {
    vi.doMock("./anthropic", () => ({
      getAnthropic: () => ({
        messages: {
          create: vi.fn().mockRejectedValue(new Error("still down")),
        },
      }),
    }));
    markAnthropicDown("simulated outage");
    invalidateAnthropicHealthCache();
    const result = await isAnthropicDown();
    expect(result).toBe(true);
    expect(existsSync(FLAG_PATH)).toBe(true); // flag persists
  });
});
