-- Sprint 7 — Outcomes loop Data-only (05/05/2026)
-- Étend ActivityType pour tracker les interactions dashboard du commercial
-- (copy email/phone, click LinkedIn, export CSV, view profil).
-- Le but : nourrir une boucle d'apprentissage future few-shot dynamique
-- pour le judge Opus, sans demander 👍/👎 au client (qui ne le fait pas).
--
-- DASHBOARD_INTERACTION = générique passif. Le payload distingue le kind :
--   { kind: "view" | "copy_email" | "copy_phone" | "copy_linkedin"
--          | "copy_brief" | "click_linkedin" | "export_csv" | "archive_manual" }

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'DASHBOARD_INTERACTION';
