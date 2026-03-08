// iFIND - Handler HTTP endpoint desabonnement (extrait de telegram-router.js)
'use strict';

const log = require('./logger.js');

/**
 * Cree le handler HTTP pour les endpoints /unsubscribe (GET page + POST confirmation).
 * @param {Object} deps - { getAutomailerStorage, sendTelegram, adminChatId }
 * @returns {Function} (req, res) => boolean — true si la requete a ete traitee
 */
function createUnsubscribeHandler(deps) {
  const { getAutomailerStorage, sendTelegram, adminChatId } = deps;

  return function handleUnsubscribe(req, res) {
    if (!req.url || !req.url.startsWith('/unsubscribe')) return false;

    const urlObj = new URL(req.url, 'http://localhost');
    const email = decodeURIComponent(urlObj.searchParams.get('email') || '').trim().toLowerCase();

    if (req.method === 'GET') {
      const pageHtml = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Se desabonner</title>' +
        '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}' +
        '.card{background:#fff;border-radius:12px;padding:40px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.08)}' +
        'h1{font-size:20px;color:#222;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.5}' +
        'button{background:#dc3545;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;cursor:pointer;margin-top:16px}' +
        'button:hover{background:#c82333}.ok{color:#28a745;font-size:48px;margin-bottom:8px}</style></head>' +
        '<body><div class="card">' +
        (email ? '<h1>Se desabonner ?</h1><p>Vous ne recevrez plus d\'emails de notre part a l\'adresse :</p><p><strong>' + email.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</strong></p>' +
          '<form method="POST" action="/unsubscribe"><input type="hidden" name="email" value="' + email.replace(/"/g, '&quot;') + '">' +
          '<button type="submit">Confirmer le desabonnement</button></form>' :
          '<h1>Lien invalide</h1><p>Aucune adresse email fournie.</p>') +
        '</div></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml);
      return true;
    }

    if (req.method === 'POST') {
      let postBody = '';
      req.on('data', chunk => { postBody += chunk; if (postBody.length > 10240) req.destroy(); });
      req.on('end', () => {
        let unsubEmail = email;
        if (!unsubEmail) {
          const match = postBody.match(/email=([^&\s]+)/);
          if (match) unsubEmail = decodeURIComponent(match[1]).trim().toLowerCase();
        }

        const confirmHtml = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Desabonne</title>' +
          '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}' +
          '.card{background:#fff;border-radius:12px;padding:40px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.08)}' +
          'h1{font-size:20px;color:#222;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.5}.ok{color:#28a745;font-size:48px;margin-bottom:8px}</style></head>';

        if (unsubEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(unsubEmail)) {
          try {
            const automailerStorage = getAutomailerStorage();
            automailerStorage.addToBlacklist(unsubEmail, 'unsubscribe_link');
            // Stopper les follow-ups campagne en marquant hasReplied
            try {
              const allEmails = automailerStorage.getAllEmails();
              for (const em of allEmails) {
                if ((em.to || '').toLowerCase() === unsubEmail.toLowerCase() && !em.hasReplied) {
                  automailerStorage.updateEmailStatus(em.id, em.status, { hasReplied: true, replyType: 'unsubscribed' });
                }
              }
            } catch (ufErr) { log.warn('unsubscribe', 'Stop follow-ups echoue: ' + ufErr.message); }
            log.info('unsubscribe', 'Desabonnement confirme (blacklist + follow-ups annules): ' + unsubEmail);
            sendTelegram(adminChatId, '🚫 *Desabonnement* via lien email : `' + unsubEmail + '`', 'Markdown').catch(() => {});
          } catch (e) {
            log.error('unsubscribe', 'Erreur blacklist: ' + e.message);
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(confirmHtml + '<body><div class="card"><div class="ok">&#10003;</div><h1>Desabonnement confirme</h1>' +
            '<p>Vous ne recevrez plus d\'emails de notre part.</p></div></body></html>');
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(confirmHtml + '<body><div class="card"><h1>Erreur</h1><p>Adresse email invalide.</p></div></body></html>');
        }
      });
      return true;
    }

    return false;
  };
}

module.exports = { createUnsubscribeHandler };
