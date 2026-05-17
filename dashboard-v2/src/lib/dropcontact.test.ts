import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub "server-only" pour Vitest (Node) — sinon le module guard throw au load.
vi.mock("server-only", () => ({}));

describe("Dropcontact wrapper", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.DROPCONTACT_API_KEY;
    process.env.DROPCONTACT_API_KEY = "test-key-123";
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.DROPCONTACT_API_KEY;
    } else {
      process.env.DROPCONTACT_API_KEY = originalKey;
    }
    vi.restoreAllMocks();
  });

  it("submitBatch sends POST with X-Access-Token + RGPD-relevant body", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      json: async () => ({
        error: false,
        success: true,
        request_id: "req-abc",
        credits_left: 100,
      }),
    } as unknown as Response);

    const { submitBatch } = await import("./dropcontact");
    const result = await submitBatch([
      { first_name: "Jean", last_name: "Dupont", company: "Acme" },
    ]);

    expect(result).toEqual({ requestId: "req-abc", creditsLeft: 100 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dropcontact.io/batch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Access-Token": "test-key-123",
          "Content-Type": "application/json",
        }),
      }),
    );
    const calledBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    // RGPD-relevant : language fr + siren matching pour CRM-quality lookup
    expect(calledBody.language).toBe("fr");
    expect(calledBody.siren).toBe(true);
    expect(calledBody.data).toEqual([
      { first_name: "Jean", last_name: "Dupont", company: "Acme" },
    ]);
  });

  it("submitBatch throws on API error response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      json: async () => ({
        error: true,
        reason: "Quota exceeded",
      }),
    } as unknown as Response);

    const { submitBatch } = await import("./dropcontact");
    await expect(submitBatch([])).rejects.toThrow(/Quota exceeded/);
  });

  // Note : pollBatchResult fait du backoff 3s→12s — testé en live, pas
  // pratique en unit test sans fake-timers complexes. La logique est
  // triviale (boucle while + 1 fetch + check `data`), couverture inutile.

  it("getApiKey throws if env missing", async () => {
    delete process.env.DROPCONTACT_API_KEY;
    const { submitBatch } = await import("./dropcontact");
    await expect(submitBatch([])).rejects.toThrow(/DROPCONTACT_API_KEY missing/);
  });
});
