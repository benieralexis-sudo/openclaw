-- Reply.messageId UNIQUE pour dédupliquer les replies remontées par sync-inbox.
-- Avant cette migration : aucun moyen propre d'éviter les doublons quand le
-- cron sync-inbox poll IMAP toutes les 5 min sur une fenêtre 1h.
-- L'unique constraint laisse Postgres gérer la dédup (catch P2002 côté code).
ALTER TABLE "Reply" ADD COLUMN "messageId" TEXT;
CREATE UNIQUE INDEX "Reply_messageId_key" ON "Reply"("messageId") WHERE "messageId" IS NOT NULL;
