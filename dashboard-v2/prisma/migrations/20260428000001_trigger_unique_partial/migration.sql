-- Index unique partial sur (clientId, sourceCode, sourceUrl) pour empêcher les
-- doublons de Triggers depuis TheirStack/Apify/Rodz qui re-scrapent les mêmes
-- jobs/levées à chaque run.
-- WHERE sourceUrl IS NOT NULL : sources sans URL (BODACC/JOAFE) ne sont pas
-- contraintes par cet index (elles ont leurs propres mécaniques de dédup).
-- Note : Prisma 5 ne supporte pas le WHERE clause sur @@unique → migration SQL.

CREATE UNIQUE INDEX IF NOT EXISTS "Trigger_clientId_sourceCode_sourceUrl_unique"
  ON "Trigger" ("clientId", "sourceCode", "sourceUrl")
  WHERE "sourceUrl" IS NOT NULL;
