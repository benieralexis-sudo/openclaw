-- Sprint D.1 (07/05/2026) — Add briefV2Json to Trigger.
-- Champ JSONB nullable : double-write avec scoreReason pendant 30j (Sprint D.5)
-- avant migration complète vers le format v2 (verdict OUI/NON/ENRICH + thesis +
-- triggers cités + risks + opener + sources). Schéma TS validé Zod dans
-- lib/lead-brief-v2.ts.

ALTER TABLE "Trigger" ADD COLUMN "briefV2Json" JSONB;
