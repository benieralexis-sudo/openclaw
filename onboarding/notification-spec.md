# Spec Systeme de Notifications Intelligent — iFIND Bot

> **Version** : 1.0
> **Date** : 1er avril 2026
> **Statut** : SPEC (bot OFF — implementation quand credits Anthropic recharges)
> **Destinataire** : Alexis Benier (Telegram chat_id: 1409505520, via @Myironpro_bot)

---

## Probleme actuel

Le bot envoie **toutes les notifications** sur Telegram sans filtrage :
- Chaque email envoye → notification individuelle
- Chaque open/click → notification individuelle
- Logs techniques (DNS, SPF/DKIM, Docker) → notification
- Health checks, metriques systeme normales → notification

Le mode `quietMode` (dans `gateway/app-config.js`) limite a 3 messages auto/jour mais c'est un plafond brutal, pas un filtre intelligent. Il ne distingue pas une reply positive d'un health check.

**Resultat** : Telegram est inutilisable, les vraies alertes business sont noyees dans le bruit.

---

## Architecture cible : 3 niveaux de notification

### Principe

Chaque evenement du bot est classe en 3 niveaux. Un nouveau module centralise le routage : `gateway/notification-manager.js` remplace tous les appels `sendMessage(adminChatId, ...)` disperses dans le code.

```
Evenement → notification-manager.classify(event) → URGENT / IMPORTANT / INFO
                                                      ↓          ↓          ↓
                                               Telegram    Telegram     Buffer
                                              (avec son)  (silencieux)  (digest 20h)
```

---

## 1. URGENT — Notification immediate, son active

### Evenements

| Evenement | Source dans le code | Condition |
|-----------|-------------------|-----------|
| Reply positive (interested) | `gateway/reply-pipeline.js` L895-1060 `_sendTelegramNotification()` | `sentiment === 'interested'` ET `score >= 0.7` |
| Meeting bookee | `skills/meeting-scheduler/meeting-handler.js` | Webhook Google Calendar ou Calendly confirme |
| Nouveau paiement client | Webhook Stripe (a creer) | `event.type === 'payment_intent.succeeded'` |
| Questionnaire client rempli | Webhook Tally (a creer via `workflow-make-onboarding.md`) | Formulaire soumis |
| Delivrabilite critique | `gateway/resend-handler.js` L6-14 (events bounced/complained) | Bounce rate > 5% sur 24h OU domaine blackliste |
| Erreur systeme critique | `skills/system-advisor/system-advisor-handler.js` L554-595 | Container down, API key expired, disk > 90% |

### Format Telegram

```
🔴 REPLY POSITIVE — [Client: DigitestLab]
Prospect: Jean Dupont (CTO, Societe X)
Message: "Interessant, on peut en discuter ?"
Sentiment: INTERESSE (confiance 92%)
→ Action: Repondre dans les 2h
```

```
🔴 MEETING BOOKEE — [Client: DigitestLab]
Prospect: Marie Martin (DG, Tech Corp)
Creneau: Mercredi 3 avril, 14h30-15h00
Lien: https://meet.google.com/xxx
→ Action: Preparer le pre-call brief
```

```
🔴 PAIEMENT RECU — 890€
Client: Frederic Flandrin (DigitestLab)
Plan: Pipeline (mensuel)
→ Action: Lancer le setup client (SOP)
```

```
🔴 DELIVRABILITE CRITIQUE
Domaine: alexis@getifind.fr
Bounce rate: 7.2% (seuil: 5%)
Derniers bounces: 3 en 1h
→ Action: Pause envois, verifier DNS/blacklists
```

```
🔴 ERREUR SYSTEME
Type: API Key Expired
Detail: ANTHROPIC_API_KEY retourne 401 depuis 15 min
→ Action: Recharger credits / changer cle
```

### Parametres Telegram

```javascript
await telegramAPI('sendMessage', {
  chat_id: ADMIN_CHAT_ID,
  text: message,
  parse_mode: 'Markdown',
  // PAS de disable_notification → son actif par defaut
});
```

---

## 2. IMPORTANT — Notification silencieuse (sans son)

### Evenements

| Evenement | Source dans le code | Condition |
|-----------|-------------------|-----------|
| Reply neutre/question/objection | `gateway/reply-pipeline.js` `_sendTelegramNotification()` | `sentiment === 'question'` OU (`not_interested` avec objection douce) |
| Campagne lancee | `skills/automailer/automailer-handler.js` | Nouvelle campagne demarre |
| Warmup termine | `skills/proactive-agent/proactive-engine.js` L100-103 | Score warmup atteint 100% |
| Objectif SLA atteint | `skills/proactive-agent/report-generator.js` | 300 prospects contactes ce mois |
| Nouveau client cree | `gateway/telegram-router.js` (via onboarding webhook) | Client ajoute dans le systeme |
| Auto-reply envoye (HITL) | `gateway/reply-pipeline.js` L1022-1038 | Bot a repondu automatiquement |

### Format Telegram

```
🟡 REPLY QUESTION — [Client: iFIND]
Prospect: Paul Bernard (DSI, Acme SAS)
Message: "Quels sont vos tarifs ?"
Sentiment: QUESTION (confiance 85%)
→ Brouillon pret, validation Telegram

[✅ Accepter] [✏️ Modifier] [⏭️ Passer]
```

```
🟡 CAMPAGNE LANCEE — [Client: DigitestLab]
Campagne: "ESN Paris - Q2 2026"
Cohorte: 50 prospects
Cadence: J0 / J+3 / J+10
```

### Parametres Telegram

```javascript
await telegramAPI('sendMessage', {
  chat_id: ADMIN_CHAT_ID,
  text: message,
  parse_mode: 'Markdown',
  disable_notification: true  // ← silencieux, pas de son/vibration
});
```

---

## 3. INFO — Digest quotidien unique a 20h

### Evenements (bufferises toute la journee)

| Evenement | Source dans le code |
|-----------|-------------------|
| Resume journalier par client (emails, opens, replies, bounces) | `skills/proactive-agent/report-generator.js` L160-220 |
| Progression warmup | `skills/proactive-agent/proactive-engine.js` (email status check) |
| Nouveaux leads enrichis dans Clay | Webhook Clay → `gateway/telegram-router.js` L1832+ |
| Unsubscribes (nombre agrege) | `gateway/resend-handler.js` + `gateway/unsubscribe-handler.js` |
| Suggestions Self-Improve | `skills/self-improve/self-improve-handler.js` |
| Web Intelligence insights | `skills/web-intelligence/web-intelligence-handler.js` |
| Opens/clicks agreges | `gateway/resend-handler.js` (events opened/clicked) |
| Rotation de domaines | `skills/automailer/automailer-handler.js` |

### Format Telegram — UN SEUL message a 20h

```
📊 Digest quotidien — 1er avril 2026

[DigitestLab]
├ 23 emails envoyes | 15 ouverts (65%) | 2 replies
├ Warmup: 78% → 82%
└ 12 nouveaux leads enrichis

[iFIND (meta-prospection)]
├ 45 emails envoyes | 28 ouverts (62%) | 3 replies
├ 1 reply positive (deja notifie 🔴)
└ Warmup: 100%

[Systeme]
├ Disk: 71% | RAM: 45% | Uptime: 14j
├ 2 unsubscribes
└ 0 bounces

💡 Self-Improve: suggere de tester un CTA "audit gratuit" sur la niche ESN
🌐 Veille: 3 articles pertinents (Gartner nearshore, etc.)
```

### Implementation du buffer

```javascript
// Dans notification-manager.js
const _digestBuffer = []; // Accumule les events INFO toute la journee

function bufferForDigest(event) {
  _digestBuffer.push({
    type: event.type,
    clientId: event.clientId || 'system',
    data: event.data,
    timestamp: new Date().toISOString()
  });
}

// Cron 20h Paris — envoie le digest et vide le buffer
// Cron expression: '0 20 * * *' timezone 'Europe/Paris'
```

---

## 4. Ce qui DISPARAIT completement

Les evenements suivants ne generent **plus aucune notification** (ni Telegram, ni digest) :

| Evenement supprime | Source actuelle | Pourquoi |
|-------------------|-----------------|----------|
| Chaque email envoye individuellement | `resend-handler.js` event `email.sent` | Bruit pur, visible dans le digest |
| Opens/clicks individuels | `resend-handler.js` events `opened`/`clicked`, L288-297 | Agrege dans le digest |
| Logs techniques DNS/SPF/DKIM | `system-advisor` | Visible dans le dashboard uniquement |
| Details rotation domaines | `automailer-handler.js` | Technique, aucune action requise |
| API rate limits (sauf critique) | Divers handlers | Log fichier uniquement |
| Health checks routine | `system-advisor-handler.js` L554+ | Sauf si seuil critique depasse |
| Metriques systeme normales | `system-advisor` storage.js L16 | CPU/RAM/disk < 85% = tout va bien |
| Reactive follow-up programmes | `resend-handler.js` L288-297 (clic → relance) | Notification clic supprimee |

### Comment supprimer

Dans chaque fichier source, remplacer les `sendMessage(ADMIN_CHAT_ID, ...)` par un appel au notification-manager qui classe l'event. Si le niveau est `SUPPRESSED`, le manager ne fait rien (juste un `log.debug`).

---

## 5. Implementation technique

### 5.1. Nouveau module : `gateway/notification-manager.js`

Ce module centralise TOUT le routage des notifications. Plus aucun skill n'appelle directement `sendMessage(adminChatId, ...)` pour les notifications automatiques.

```javascript
// gateway/notification-manager.js
'use strict';

const log = require('./logger.js');
const { Cron } = require('croner');

// Niveaux de notification
const LEVEL = {
  URGENT: 'urgent',       // Telegram immediat, avec son
  IMPORTANT: 'important', // Telegram immediat, silencieux
  INFO: 'info',           // Buffer → digest 20h
  SUPPRESSED: 'suppressed' // Rien du tout (log.debug)
};

// Classification des evenements
const EVENT_CLASSIFICATION = {
  // URGENT
  'reply.interested':       LEVEL.URGENT,
  'reply.meeting':          LEVEL.URGENT,
  'meeting.booked':         LEVEL.URGENT,
  'payment.received':       LEVEL.URGENT,
  'onboarding.completed':   LEVEL.URGENT,
  'deliverability.critical': LEVEL.URGENT,
  'system.critical':        LEVEL.URGENT,

  // IMPORTANT
  'reply.question':         LEVEL.IMPORTANT,
  'reply.objection_soft':   LEVEL.IMPORTANT,
  'campaign.launched':      LEVEL.IMPORTANT,
  'warmup.complete':        LEVEL.IMPORTANT,
  'sla.reached':            LEVEL.IMPORTANT,
  'client.created':         LEVEL.IMPORTANT,
  'hitl.draft_ready':       LEVEL.IMPORTANT,
  'hitl.auto_sent':         LEVEL.IMPORTANT,

  // INFO (digest)
  'email.daily_summary':    LEVEL.INFO,
  'warmup.progress':        LEVEL.INFO,
  'leads.enriched':         LEVEL.INFO,
  'unsubscribe.batch':      LEVEL.INFO,
  'self_improve.suggestion': LEVEL.INFO,
  'web_intel.insight':      LEVEL.INFO,
  'email.opens_summary':    LEVEL.INFO,
  'domain.rotation':        LEVEL.INFO,

  // SUPPRESSED
  'email.sent':             LEVEL.SUPPRESSED,
  'email.delivered':        LEVEL.SUPPRESSED,
  'email.opened':           LEVEL.SUPPRESSED,
  'email.clicked':          LEVEL.SUPPRESSED,
  'system.health_ok':       LEVEL.SUPPRESSED,
  'system.dns_check':       LEVEL.SUPPRESSED,
  'system.metrics_normal':  LEVEL.SUPPRESSED,
  'ratelimit.warning':      LEVEL.SUPPRESSED
};

class NotificationManager {
  constructor({ sendTelegram, sendTelegramSilent, sendTelegramButtons, adminChatId }) {
    this.sendTelegram = sendTelegram;           // sendMessage(chatId, text, 'Markdown')
    this.sendTelegramSilent = sendTelegramSilent; // avec disable_notification: true
    this.sendTelegramButtons = sendTelegramButtons;
    this.adminChatId = adminChatId;
    this._digestBuffer = [];
    this._digestCron = null;
    this._escalationTimers = new Map(); // eventId → timeout pour re-notification 4h
  }

  start() {
    // Cron digest quotidien a 20h Paris
    this._digestCron = new Cron('0 20 * * *', { timezone: 'Europe/Paris' }, () => {
      this._sendDigest();
    });
    log.info('notification-manager', 'Digest quotidien programme a 20h');
  }

  stop() {
    if (this._digestCron) this._digestCron.stop();
    for (const timer of this._escalationTimers.values()) clearTimeout(timer);
    this._escalationTimers.clear();
  }

  /**
   * Point d'entree unique pour toutes les notifications.
   * @param {string} eventType - Cle dans EVENT_CLASSIFICATION
   * @param {object} data - Donnees de l'evenement
   * @param {object} [opts] - Options (clientId, buttons, etc.)
   */
  async notify(eventType, data, opts = {}) {
    const level = EVENT_CLASSIFICATION[eventType] || LEVEL.SUPPRESSED;

    switch (level) {
      case LEVEL.URGENT:
        await this._sendUrgent(eventType, data, opts);
        break;
      case LEVEL.IMPORTANT:
        await this._sendImportant(eventType, data, opts);
        break;
      case LEVEL.INFO:
        this._bufferForDigest(eventType, data, opts);
        break;
      case LEVEL.SUPPRESSED:
        log.debug('notification-manager', 'Suppressed: ' + eventType);
        break;
    }
  }

  async _sendUrgent(eventType, data, opts) {
    const message = this._formatMessage(eventType, data, opts);
    if (opts.buttons) {
      await this.sendTelegramButtons(this.adminChatId, message, opts.buttons);
    } else {
      await this.sendTelegram(this.adminChatId, message);
    }
    // Escalation : re-notifier dans 4h si pas d'action
    if (opts.escalate !== false) {
      const eventId = opts.eventId || eventType + '_' + Date.now();
      this._escalationTimers.set(eventId, setTimeout(() => {
        this.sendTelegram(this.adminChatId,
          '⏰ *RAPPEL* — Pas d\'action depuis 4h\n\n' + message
        ).catch(() => {});
        this._escalationTimers.delete(eventId);
      }, 4 * 3600 * 1000));
    }
    log.info('notification-manager', 'URGENT: ' + eventType);
  }

  async _sendImportant(eventType, data, opts) {
    const message = this._formatMessage(eventType, data, opts);
    if (opts.buttons) {
      await this.sendTelegramButtons(this.adminChatId, message, opts.buttons);
    } else {
      await this.sendTelegramSilent(this.adminChatId, message);
    }
    log.info('notification-manager', 'IMPORTANT: ' + eventType);
  }

  _bufferForDigest(eventType, data, opts) {
    this._digestBuffer.push({
      eventType,
      clientId: opts.clientId || 'system',
      data,
      timestamp: new Date().toISOString()
    });
    log.debug('notification-manager', 'Buffered for digest: ' + eventType);
  }

  async _sendDigest() {
    if (this._digestBuffer.length === 0) {
      log.info('notification-manager', 'Digest vide, pas d\'envoi');
      return;
    }

    const today = new Date().toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    // Grouper par client
    const byClient = {};
    for (const item of this._digestBuffer) {
      if (!byClient[item.clientId]) byClient[item.clientId] = [];
      byClient[item.clientId].push(item);
    }

    let lines = ['📊 *Digest quotidien* — ' + today, ''];

    for (const [clientId, events] of Object.entries(byClient)) {
      if (clientId === 'system') continue;
      lines.push('*[' + clientId + ']*');
      // Agreger les metriques email
      const emailSummary = events.find(e => e.eventType === 'email.daily_summary');
      if (emailSummary && emailSummary.data) {
        const d = emailSummary.data;
        lines.push('├ ' + (d.sent || 0) + ' emails envoyes | ' +
          (d.opened || 0) + ' ouverts (' + (d.openRate || 0) + '%) | ' +
          (d.replies || 0) + ' replies');
      }
      const warmup = events.find(e => e.eventType === 'warmup.progress');
      if (warmup && warmup.data) {
        lines.push('├ Warmup: ' + warmup.data.score + '%');
      }
      const leads = events.find(e => e.eventType === 'leads.enriched');
      if (leads && leads.data) {
        lines.push('└ ' + leads.data.count + ' nouveaux leads enrichis');
      }
      lines.push('');
    }

    // Section systeme
    const systemEvents = byClient['system'] || [];
    if (systemEvents.length > 0) {
      lines.push('*[Systeme]*');
      const unsubs = systemEvents.filter(e => e.eventType === 'unsubscribe.batch');
      if (unsubs.length > 0) {
        const total = unsubs.reduce((sum, e) => sum + (e.data.count || 0), 0);
        lines.push('├ ' + total + ' unsubscribes');
      }
      const suggestions = systemEvents.filter(e => e.eventType === 'self_improve.suggestion');
      for (const s of suggestions.slice(0, 2)) {
        lines.push('💡 ' + (s.data.suggestion || ''));
      }
      const webInsights = systemEvents.filter(e => e.eventType === 'web_intel.insight');
      if (webInsights.length > 0) {
        lines.push('🌐 ' + webInsights.length + ' articles de veille');
      }
      lines.push('');
    }

    await this.sendTelegramSilent(this.adminChatId, lines.join('\n'));
    log.info('notification-manager', 'Digest envoye (' + this._digestBuffer.length + ' events)');
    this._digestBuffer = []; // Vider le buffer
  }

  _formatMessage(eventType, data, opts) {
    // Deleguee aux formateurs specifiques (voir section 5.3)
    if (data._formattedMessage) return data._formattedMessage;
    return data.message || eventType;
  }

  /** Annule l'escalation quand l'utilisateur agit */
  cancelEscalation(eventId) {
    const timer = this._escalationTimers.get(eventId);
    if (timer) {
      clearTimeout(timer);
      this._escalationTimers.delete(eventId);
    }
  }
}

module.exports = { NotificationManager, LEVEL, EVENT_CLASSIFICATION };
```

### 5.2. Nouvelle fonction `sendTelegramSilent` dans `gateway/telegram-client.js`

Ajouter dans `createTelegramClient()` :

```javascript
async function sendMessageSilent(chatId, text, parseMode) {
  const maxLen = 4096;
  if (text.length <= maxLen) {
    const result = await telegramAPI('sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode || undefined,
      disable_notification: true  // ← cle Telegram API pour silencieux
    });
    if (!result.ok && parseMode) {
      return telegramAPI('sendMessage', {
        chat_id: chatId,
        text: text,
        disable_notification: true
      });
    }
    return result;
  }
  // Chunking identique a sendMessage mais avec disable_notification
  for (let i = 0; i < text.length; i += maxLen) {
    const chunk = text.slice(i, i + maxLen);
    await telegramAPI('sendMessage', {
      chat_id: chatId,
      text: chunk,
      parse_mode: parseMode || undefined,
      disable_notification: true
    }).catch(() => telegramAPI('sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_notification: true
    }));
  }
}
```

Exporter en plus : `return { telegramAPI, sendMessage, sendMessageSilent, sendTyping, sendMessageWithButtons };`

### 5.3. Instanciation dans `gateway/telegram-router.js`

Remplacer les callbacks disperses par le notification-manager :

```javascript
// Ligne ~144 — apres creation du tgClient
const { NotificationManager } = require('./notification-manager.js');
const notifManager = new NotificationManager({
  sendTelegram: (chatId, msg) => sendMessage(chatId, msg, 'Markdown'),
  sendTelegramSilent: (chatId, msg) => sendMessageSilent(chatId, msg, 'Markdown'),
  sendTelegramButtons: sendMessageWithButtons,
  adminChatId: ADMIN_CHAT_ID
});
notifManager.start();
```

### 5.4. Modifications fichier par fichier

#### `gateway/reply-pipeline.js` — `_sendTelegramNotification()` (L895-1060)

**Avant** : Construit le message et appelle directement `sendMessage(adminChatId, ...)`.

**Apres** : Passe par `notifManager.notify()` :

```javascript
// Determiner le type d'evenement
let eventType;
if (sentiment === 'interested' && score >= 0.7) {
  eventType = 'reply.interested';
} else if (sentiment === 'question') {
  eventType = 'reply.question';
} else if (sentiment === 'not_interested') {
  // Objection douce → IMPORTANT, refus net → SUPPRESSED (juste log)
  eventType = subClass === 'soft_objection' ? 'reply.objection_soft' : null;
} else if (sentiment === 'out_of_office') {
  eventType = null; // Gere automatiquement, pas de notif
} else if (sentiment === 'bounce') {
  eventType = null; // Gere automatiquement
}

if (eventType) {
  await notifManager.notify(eventType, {
    _formattedMessage: notifLines.join('\n'),
    sentiment, score, prospect: replyData
  }, {
    clientId: replyData.clientId || 'ifind',
    buttons: hitlDraftCreated ? hitlButtons : undefined,
    escalate: sentiment === 'interested'
  });
}
```

#### `gateway/resend-handler.js` — Events email (L144+, L288-297)

**Avant** : Chaque open/click/sent envoie une notification Telegram.

**Apres** :
- `email.sent`, `email.delivered`, `email.opened`, `email.clicked` → `notifManager.notify('email.sent', ...)` → **SUPPRESSED**
- `email.bounced` avec taux > 5% → `notifManager.notify('deliverability.critical', ...)` → **URGENT**
- Clic individuel (L288-297) : supprimer les `sendMessage`/`sendMessageWithButtons` pour les notifications clic. Garder la logique de reactive follow-up mais sans notifier.

#### `skills/proactive-agent/proactive-engine.js` — Rapports et alertes

**Avant** : `_morningReport()`, `_pipelineAlerts()`, `_weeklyReport()` etc. appellent `this.sendTelegram(adminChatId, report)`.

**Apres** :
- Rapport matinal → remplace par le digest quotidien 20h (supprimer le cron 8h ou le garder pour les donnees internes sans notification)
- `_pipelineAlerts()` → `notifManager.notify('sla.reached', ...)` si milestone atteint
- `_checkSmartAlerts()` → Smart alerts hot lead → `notifManager.notify('reply.interested', ...)` si le lead est chaud
- `_emailStatusCheck()` → Ne notifie plus directement. Alimente le buffer digest via `notifManager.notify('warmup.progress', ...)`

#### `skills/system-advisor/system-advisor-handler.js` — Alertes systeme (L554-595)

**Avant** : `sendTelegram(config.adminChatId, msg)` pour chaque alerte RAM/CPU/disk.

**Apres** :
```javascript
// Seuils critiques → URGENT
if (alert.level === 'critical') {
  notifManager.notify('system.critical', { _formattedMessage: msg });
}
// Seuils normaux → SUPPRESSED (juste log)
else {
  notifManager.notify('system.health_ok', { metric: alert.type, value: alert.value });
}
```

#### `skills/web-intelligence/web-intelligence-handler.js`

**Avant** : Envoie les insights directement sur Telegram.

**Apres** : `notifManager.notify('web_intel.insight', { suggestion, articles })` → buffer digest.

#### `skills/self-improve/self-improve-handler.js`

**Avant** : Envoie les suggestions sur Telegram.

**Apres** : `notifManager.notify('self_improve.suggestion', { suggestion })` → buffer digest.

---

## 6. Gestion du mode quiet existant

Le `quietMode` dans `app-config.js` (L258-285) devient **obsolete**. Le notification-manager le remplace completement :

- `quietMode = false` (mode normal) → le manager gere tout via les 3 niveaux
- `quietMode = true` → le manager peut passer en mode "digest only" : URGENT reste URGENT, IMPORTANT bascule en INFO

Les commandes Telegram `/quiet` et `/normal` dans `telegram-router.js` (L1024, L1034) restent mais pilotent le notification-manager au lieu du flag `quietMode`.

---

## 7. Preferences de notification (futur — Phase 2)

### 7.1. Preferences par client dans le dashboard

Ajouter dans `dashboard/notification-manager.js` (fichier existant, L1-100) :

```javascript
// Preferences par client
const DEFAULT_PREFS = {
  urgentEnabled: true,    // Toujours true (pas desactivable)
  importantEnabled: true, // Peut etre desactive par client
  digestEnabled: true,    // Peut etre desactive par client
  mutedUntil: null        // ISO date — mute temporaire
};
```

Interface dashboard : toggle par client pour recevoir ou non les notifications IMPORTANT.

### 7.2. Mute temporaire

```javascript
// Mute un client pour X heures
notifManager.muteClient(clientId, hours);

// Verifie avant d'envoyer
if (notifManager.isClientMuted(clientId)) {
  // Buffer tout en INFO, meme les URGENT
  // Exception : system.critical n'est JAMAIS mute
}
```

Commande Telegram : `mute digitestlab 4h` → mute les notifications DigitestLab pendant 4h.

### 7.3. Escalation automatique

Si une notification URGENT n'a pas ete "vue" (pas de callback_data clique) dans les 4 heures :
1. Re-envoyer la notification avec le prefixe `⏰ RAPPEL`
2. Si toujours pas d'action apres 8h, envoyer un SMS (via Twilio, Phase 3)

Implementation : `_escalationTimers` dans le notification-manager (voir code section 5.1).

Pour annuler l'escalation quand l'utilisateur agit :
```javascript
// Dans telegram-router.js, callback_query handler
if (callbackData.startsWith('hitl_')) {
  notifManager.cancelEscalation('reply.interested_' + draftId);
}
```

---

## 8. Migration — Plan de deploiement

### Etape 1 : Creer les fichiers
- [ ] `gateway/notification-manager.js` (nouveau)
- [ ] Ajouter `sendMessageSilent` dans `gateway/telegram-client.js`

### Etape 2 : Brancher le manager
- [ ] Instancier dans `gateway/telegram-router.js`
- [ ] Passer `notifManager` comme dependance aux handlers

### Etape 3 : Migrer les notifications (par ordre de priorite)
1. [ ] `gateway/reply-pipeline.js` — reply notifications (impact business maximal)
2. [ ] `gateway/resend-handler.js` — supprimer notifs open/click/sent individuels
3. [ ] `skills/system-advisor/` — filtrer les alertes non-critiques
4. [ ] `skills/proactive-agent/` — remplacer rapports par digest
5. [ ] `skills/web-intelligence/` — passer en digest
6. [ ] `skills/self-improve/` — passer en digest

### Etape 4 : Tests
- [ ] Tester chaque niveau avec un mock Telegram
- [ ] Verifier que les URGENT passent toujours
- [ ] Verifier que les SUPPRESSED ne generent aucun message
- [ ] Verifier le digest 20h (timer ou test manuel)

### Etape 5 : Nettoyage
- [ ] Supprimer le mode `quietMode` de `app-config.js` (ou le garder comme alias)
- [ ] Supprimer les `sendMessage(ADMIN_CHAT_ID, ...)` directs dans les handlers migres

---

## 9. Resume des volumes attendus

| Niveau | Volume estime/jour | Notifications Telegram/jour |
|--------|-------------------|----------------------------|
| URGENT | 0-3 | 0-3 messages (son actif) |
| IMPORTANT | 2-10 | 2-10 messages (silencieux) |
| INFO | 20-100+ events | 1 message (digest 20h) |
| SUPPRESSED | 100-500+ events | 0 message |
| **TOTAL** | **~500 events** | **3-14 messages** (au lieu de 500+) |

Reduction estimee : **97% de bruit en moins** sur Telegram.
