// Sprint 6 (10/05/2026) — Stub no-op pour skills/automailer/storage.js (supprime).
// Le bot post-pivot Data-only n'envoie plus d'emails. Tous les handlers qui
// requirent automailer/storage.js sont caducs mais on garde le stub pour eviter
// un crash si un code path est encore appele (ex: via commande Telegram admin).

'use strict';

module.exports = {
  data: { emails: [], blacklist: [], campaigns: [] },
  addToBlacklist() { /* no-op */ },
  isBlacklisted() { return false; },
  save() { /* no-op */ },
  getEmail() { return null; },
  getEmails() { return []; },
  // Toute methode appelee retourne undefined silencieusement
};
