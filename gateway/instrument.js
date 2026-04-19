// iFIND — Initialisation Sentry (à require en TOUT PREMIER dans telegram-router.js)
// Doit être chargé avant tout autre require pour que l'auto-instrumentation fonctionne.

const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN || '';
const env = process.env.NODE_ENV || 'production';
const clientName = process.env.CLIENT_NAME || 'iFIND';

if (!dsn) {
  console.warn('[sentry] SENTRY_DSN non défini — erreurs NON remontées à Sentry');
} else {
  Sentry.init({
    dsn,
    environment: env,
    release: 'ifind-bot@9.5',

    // Sampling
    tracesSampleRate: 0.1,            // 10% traces performance
    profilesSampleRate: 0,             // désactivé (économie quota free tier)
    sendDefaultPii: false,             // conformité RGPD : pas d'IP ni infos perso auto

    // Ignorer les erreurs non actionnables
    ignoreErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      /Telegram.*\s4(0[139]|29)/,       // rate limits Telegram (429) et transient
      /self[_\s]signed certificate/i,
      'socket hang up',
    ],

    // Tag chaque event avec le client (Phase B3 — multi-tenant tagging)
    beforeSend(event) {
      event.tags = event.tags || {};
      event.tags.client = clientName;       // legacy tag for existing Sentry filters
      event.tags.tenant = clientName;       // B3 — canonical name aligned with logs
      event.tags.server = 'srv1319748';
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      // Filtrer les breadcrumbs console.log bruyants
      if (breadcrumb.category === 'console' && breadcrumb.level === 'log') return null;
      return breadcrumb;
    },
  });

  // Attraper les exceptions non gérées (critique pour un bot long-running)
  process.on('uncaughtException', (err) => {
    Sentry.captureException(err, { tags: { type: 'uncaughtException' } });
    console.error('[sentry] uncaughtException:', err);
    // Ne PAS exit — laisser le process continuer (bot doit rester up)
  });

  process.on('unhandledRejection', (reason, promise) => {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
      tags: { type: 'unhandledRejection' },
    });
    console.error('[sentry] unhandledRejection:', reason);
  });

  console.log('[sentry] Initialized — env=' + env + ' client=' + clientName);
}

module.exports = Sentry;
