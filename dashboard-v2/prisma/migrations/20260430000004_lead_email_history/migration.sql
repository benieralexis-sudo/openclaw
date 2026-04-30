-- Lead.emailHistory (audit 30/04 soir)
-- Archive les emails écrasés par de nouvelles sources (waterfall Kaspr →
-- FullEnrich → manual). Format : Json array of { email, source, replacedAt }.

ALTER TABLE "Lead" ADD COLUMN "emailHistory" JSONB;
