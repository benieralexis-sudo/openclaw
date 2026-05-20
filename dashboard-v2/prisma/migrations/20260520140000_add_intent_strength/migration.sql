-- Pilier 2 (20/05/2026) — "intentStrength" : force du signal d'achat (1-5)
--
-- Calibrage initial basé sur l'analyse 30j : boamp.tender = 100% utiles
-- (5), apify.linkedin-jobs = 79% utiles (3), github.commit = 0% utile (1).
--
-- Seuil livraison : intentStrength >= 3. Sous 3, on downgrade verdict OUI
-- en ENRICH (signal trop faible pour justifier outreach commercial sans
-- enrichissement humain supplémentaire).

ALTER TABLE "Trigger"
  ADD COLUMN "intentStrength" INTEGER;

-- Index pour le filter "Pépite forte" sur le dashboard
CREATE INDEX "Trigger_intent_strength_idx"
  ON "Trigger" ("clientId", "intentStrength" DESC, "capturedAt" DESC)
  WHERE "deletedAt" IS NULL;
