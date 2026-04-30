-- Index de perf (audit 30/04 nuit) — anticipation montée en charge
-- À 79 leads ces queries font 0.8ms en seq scan. À 5K leads (5 clients × 1K)
-- elles passeront en 50-200ms sans index. Ces 2 index sont préventifs.

-- 1. Lead dedup persona+siret (utilisé par mergeDuplicatePersonaLeads)
CREATE INDEX IF NOT EXISTS "Lead_persona_dedup_idx"
  ON "Lead" ("firstName", "lastName", "companySiret")
  WHERE "deletedAt" IS NULL;

-- 2. Trigger listing dashboard (utilisé par /api/triggers)
-- Ordre : (clientId, score DESC, capturedAt DESC) avec partial index
-- pour ne couvrir que les non-deleted. Plus efficace que l'index séparé existant.
CREATE INDEX IF NOT EXISTS "Trigger_listing_active_idx"
  ON "Trigger" ("clientId", score DESC, "capturedAt" DESC)
  WHERE "deletedAt" IS NULL;

-- 3. Lead.linkedinUrl pour les jointures Pappers cross-source merge
CREATE INDEX IF NOT EXISTS "Lead_linkedinUrl_idx"
  ON "Lead" ("linkedinUrl")
  WHERE "deletedAt" IS NULL AND "linkedinUrl" IS NOT NULL;
