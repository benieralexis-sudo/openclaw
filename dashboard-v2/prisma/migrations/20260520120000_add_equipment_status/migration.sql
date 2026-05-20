-- Pilier 3 (20/05/2026) — anti-filter "déjà équipé d'un concurrent".
-- Ajoute enum EquipmentStatus + 3 colonnes sur Trigger pour tracer le check :
--   - equipmentStatus : PENDING/NONE/EQUIPPED/UNKNOWN
--   - equipmentDetails : JSON { competitor, source, url, matchedText, confidence, evidence[] }
--   - equipmentCheckedAt : horodatage dernier check (cache TTL 30j côté runner)

CREATE TYPE "EquipmentStatus" AS ENUM ('PENDING', 'NONE', 'EQUIPPED', 'UNKNOWN');

ALTER TABLE "Trigger"
  ADD COLUMN "equipmentStatus" "EquipmentStatus",
  ADD COLUMN "equipmentDetails" JSONB,
  ADD COLUMN "equipmentCheckedAt" TIMESTAMP(3);

-- Index pour le runner async qui dépile les PENDING.
-- Filtre partial : seuls les PENDING + verdict OUI sont scannés (cap 50/cron).
CREATE INDEX "Trigger_equipment_pending_idx"
  ON "Trigger" ("clientId", "equipmentStatus", "capturedAt" DESC)
  WHERE "equipmentStatus" = 'PENDING' AND "deletedAt" IS NULL;
