-- Fix B4 (11/05/2026) — Séparer holdingPath du jobTitle.
-- Avant : jobTitle contenait "CTO (via AMALTH)" → polluant pour les exports
-- et le copier-coller commercial.
-- Après : jobTitle = "CTO" propre, holdingPath = "AMALTH" en metadata.

ALTER TABLE "Lead" ADD COLUMN "holdingPath" TEXT;
