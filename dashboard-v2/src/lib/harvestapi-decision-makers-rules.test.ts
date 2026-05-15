import { describe, it, expect } from "vitest";
import { inferSignalType } from "./harvestapi-signal-rules";

describe("inferSignalType — DTL tech routing", () => {
  it("QA trigger → qa-hire", () => {
    expect(inferSignalType("apify.linkedin-jobs", "QA Engineer Senior")).toBe("qa-hire");
    expect(inferSignalType("francetravail.tech", "Test Manager")).toBe("qa-hire");
  });

  it("Tech hire générique → tech-hire", () => {
    expect(inferSignalType("apify.linkedin-jobs", "Backend Developer")).toBe("tech-hire");
    expect(inferSignalType("apify.wttj-jobs", "Senior Engineer")).toBe("tech-hire");
  });

  it("Fundraising → fundraising (peu importe domain)", () => {
    expect(inferSignalType("rodz.fundraising", "Levée Series A 5M€")).toBe("fundraising");
    expect(inferSignalType("rss-levees", "Funding seed 2M€", "sales")).toBe("fundraising");
  });

  it("M&A → expansion", () => {
    expect(inferSignalType("rodz.mergers-acquisitions", "Acquisition annoncée")).toBe("expansion");
  });
});

describe("inferSignalType — iFIND sales routing (Fix B11.2)", () => {
  it("Sales-explicit → sales-hire", () => {
    expect(inferSignalType("apify.linkedin-jobs", "Head of Sales France")).toBe("sales-hire");
    expect(inferSignalType("apify.linkedin-jobs", "SDR Senior")).toBe("sales-hire");
    expect(inferSignalType("apify.linkedin-jobs", "Growth Lead")).toBe("sales-hire");
  });

  it("Hire ambigu (QA) + domain=sales → sales-hire", () => {
    // iFIND : on cherche un Sales decision-maker même si la boîte hire un QA
    expect(inferSignalType("apify.linkedin-jobs", "QA Engineer", "sales")).toBe("sales-hire");
    expect(inferSignalType("apify.wttj-jobs", "Senior Engineer", "sales")).toBe("sales-hire");
  });

  it("Hire ambigu + domain=tech → tech-hire (DTL behavior preserved)", () => {
    expect(inferSignalType("apify.linkedin-jobs", "Backend Developer", "tech")).toBe("tech-hire");
    expect(inferSignalType("apify.linkedin-jobs", "QA Engineer", "tech")).toBe("qa-hire");
  });

  it("default fallback", () => {
    expect(inferSignalType("rodz.company-page-engagement", "Post sponsorisé")).toBe("default");
  });
});
