# Rapport Mensuel Client — Specification

> Feature : envoi automatique d'un email HTML professionnel a chaque client actif
> le 1er du mois avec les resultats de leur campagne.
> Statut : SPEC READY — a implementer quand le bot sera rallume (credits Anthropic requis)

---

## 1. Template Email HTML

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport Mensuel — {{CLIENT_NAME}}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 640px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px 40px; text-align: center; }
    .header img { height: 36px; margin-bottom: 8px; }
    .header h1 { color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; }
    .header .period { color: #a0aec0; font-size: 14px; margin-top: 6px; }
    .header .client-name { color: #63b3ed; font-size: 15px; font-weight: 500; margin-top: 4px; }
    .section { padding: 28px 40px; }
    .section-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 0 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    .metrics-grid { display: flex; flex-wrap: wrap; gap: 12px; }
    .metric-card { flex: 1 1 calc(50% - 12px); min-width: 140px; background: #f7fafc; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
    .metric-label { font-size: 12px; color: #718096; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-delta { font-size: 12px; margin-top: 4px; }
    .delta-up { color: #38a169; }
    .delta-down { color: #e53e3e; }
    .delta-flat { color: #a0aec0; }
    .funnel { padding: 0 40px 28px; }
    .funnel-bar { display: flex; align-items: center; margin-bottom: 6px; }
    .funnel-label { width: 100px; font-size: 13px; color: #4a5568; text-align: right; padding-right: 12px; }
    .funnel-fill { height: 28px; border-radius: 4px; display: flex; align-items: center; padding-left: 10px; font-size: 12px; font-weight: 600; color: #fff; min-width: 40px; }
    .funnel-sent { background: #4299e1; }
    .funnel-opened { background: #48bb78; }
    .funnel-replied { background: #ed8936; }
    .funnel-interested { background: #9f7aea; }
    .funnel-meeting { background: #e53e3e; }
    .top-prospects { padding: 0 40px 28px; }
    .prospect-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #edf2f7; }
    .prospect-name { font-size: 14px; font-weight: 600; color: #2d3748; }
    .prospect-company { font-size: 12px; color: #718096; }
    .prospect-status { font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 12px; }
    .status-interested { background: #c6f6d5; color: #276749; }
    .status-meeting { background: #fed7d7; color: #9b2c2c; }
    .status-opened { background: #bee3f8; color: #2a4365; }
    .recommendations { padding: 0 40px 28px; }
    .reco-item { display: flex; align-items: flex-start; margin-bottom: 10px; }
    .reco-icon { width: 24px; height: 24px; background: #ebf8ff; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 10px; flex-shrink: 0; font-size: 12px; }
    .reco-text { font-size: 13px; color: #4a5568; line-height: 1.5; }
    .cta-section { text-align: center; padding: 28px 40px; background: #f7fafc; }
    .cta-button { display: inline-block; background: #1a1a2e; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; }
    .footer { padding: 24px 40px; text-align: center; background: #1a1a2e; }
    .footer p { color: #a0aec0; font-size: 12px; margin: 4px 0; }
    .footer a { color: #63b3ed; text-decoration: none; }
    @media (max-width: 480px) {
      .section, .funnel, .top-prospects, .recommendations { padding-left: 20px; padding-right: 20px; }
      .header { padding: 24px 20px; }
      .metric-card { flex: 1 1 100%; }
    }
  </style>
</head>
<body>
  <div class="container">

    <!-- HEADER -->
    <div class="header">
      <h1>Rapport Mensuel</h1>
      <div class="period">{{MONTH_NAME}} {{YEAR}}</div>
      <div class="client-name">{{CLIENT_NAME}}</div>
    </div>

    <!-- METRIQUES CLES -->
    <div class="section">
      <h2 class="section-title">Metriques cles</h2>
      <div class="metrics-grid">

        <div class="metric-card">
          <div class="metric-value">{{PROSPECTS_CONTACTED}}</div>
          <div class="metric-label">Prospects contactes</div>
          <div class="metric-delta {{DELTA_CLASS_PROSPECTS}}">{{DELTA_PROSPECTS}}</div>
        </div>

        <div class="metric-card">
          <div class="metric-value">{{EMAILS_SENT}}</div>
          <div class="metric-label">Emails envoyes</div>
          <div class="metric-delta {{DELTA_CLASS_SENT}}">{{DELTA_SENT}}</div>
        </div>

        <div class="metric-card">
          <div class="metric-value">{{OPEN_RATE}}%</div>
          <div class="metric-label">Taux d'ouverture</div>
          <div class="metric-delta {{DELTA_CLASS_OPEN}}">{{DELTA_OPEN}}</div>
        </div>

        <div class="metric-card">
          <div class="metric-value">{{REPLY_RATE}}%</div>
          <div class="metric-label">Taux de reponse</div>
          <div class="metric-delta {{DELTA_CLASS_REPLY}}">{{DELTA_REPLY}}</div>
        </div>

        <div class="metric-card">
          <div class="metric-value">{{POSITIVE_REPLIES}}</div>
          <div class="metric-label">Reponses positives</div>
          <div class="metric-delta {{DELTA_CLASS_POSITIVE}}">{{DELTA_POSITIVE}}</div>
        </div>

        <div class="metric-card">
          <div class="metric-value">{{MEETINGS_BOOKED}}</div>
          <div class="metric-label">RDV bookes</div>
          <div class="metric-delta {{DELTA_CLASS_MEETINGS}}">{{DELTA_MEETINGS}}</div>
        </div>

      </div>
    </div>

    <!-- FUNNEL VISUEL -->
    <div class="funnel">
      <h2 class="section-title">Funnel de conversion</h2>
      <div class="funnel-bar">
        <span class="funnel-label">Envoyes</span>
        <div class="funnel-fill funnel-sent" style="width: {{FUNNEL_SENT_PCT}}%">{{EMAILS_SENT}}</div>
      </div>
      <div class="funnel-bar">
        <span class="funnel-label">Ouverts</span>
        <div class="funnel-fill funnel-opened" style="width: {{FUNNEL_OPENED_PCT}}%">{{EMAILS_OPENED}}</div>
      </div>
      <div class="funnel-bar">
        <span class="funnel-label">Repondu</span>
        <div class="funnel-fill funnel-replied" style="width: {{FUNNEL_REPLIED_PCT}}%">{{TOTAL_REPLIES}}</div>
      </div>
      <div class="funnel-bar">
        <span class="funnel-label">Interesse</span>
        <div class="funnel-fill funnel-interested" style="width: {{FUNNEL_INTERESTED_PCT}}%">{{INTERESTED_COUNT}}</div>
      </div>
      <div class="funnel-bar">
        <span class="funnel-label">RDV</span>
        <div class="funnel-fill funnel-meeting" style="width: {{FUNNEL_MEETING_PCT}}%">{{MEETINGS_BOOKED}}</div>
      </div>
    </div>

    <!-- TOP 3 PROSPECTS -->
    <div class="top-prospects">
      <h2 class="section-title">Top 3 prospects les plus engages</h2>
      {{#TOP_PROSPECTS}}
      <div class="prospect-row">
        <div>
          <div class="prospect-name">{{NAME}}</div>
          <div class="prospect-company">{{COMPANY}}</div>
        </div>
        <span class="prospect-status {{STATUS_CLASS}}">{{STATUS_LABEL}}</span>
      </div>
      {{/TOP_PROSPECTS}}
    </div>

    <!-- RECOMMANDATIONS IA -->
    <div class="recommendations">
      <h2 class="section-title">Recommandations</h2>
      {{#RECOMMENDATIONS}}
      <div class="reco-item">
        <div class="reco-icon">{{ICON}}</div>
        <div class="reco-text">{{TEXT}}</div>
      </div>
      {{/RECOMMENDATIONS}}
    </div>

    <!-- CTA -->
    <div class="cta-section">
      <p style="font-size: 15px; color: #4a5568; margin-bottom: 16px;">
        Discutons de vos resultats et ajustons la strategie ensemble.
      </p>
      <a href="{{BOOKING_URL}}" class="cta-button">Booker votre review mensuelle</a>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <p><strong>iFIND</strong> — Prospection B2B autonome</p>
      <p><a href="https://ifind.fr">ifind.fr</a></p>
      <p style="margin-top: 12px; font-size: 11px;">
        Ce rapport est genere automatiquement a partir de vos donnees de campagne.
        <br>Pour toute question : <a href="mailto:alexis@getifind.fr">alexis@getifind.fr</a>
      </p>
    </div>

  </div>
</body>
</html>
```

---

## 2. Specification d'implementation

### 2.1 Fichier cible

Ajouter la logique dans **`/opt/moltbot/skills/proactive-agent/proactive-engine.js`** :

1. **Nouveau cron** dans la methode `start()`, juste apres le bloc `monthlyReport` existant (ligne ~97) :

```javascript
// Rapport mensuel CLIENT (email HTML) — 1er du mois 10h (apres le rapport PA Telegram a 9h)
if (alerts.monthlyReport.enabled) {
  const dom = alerts.monthlyReport.dayOfMonth || 1;
  this.crons.push(new Cron('0 10 ' + dom + ' * *', { timezone: tz },
    withCronGuard('pa-monthly-client-email', () => this._monthlyClientEmailReport())));
  log.info('proactive-engine', 'Cron: rapport mensuel client email (jour ' + dom + ' a 10h)');
}
```

2. **Nouvelle methode** `_monthlyClientEmailReport()` dans la classe `ProactiveEngine` :

```javascript
async _monthlyClientEmailReport() {
  const clientRegistry = require('../../dashboard/client-registry.js');
  const clients = clientRegistry.listClients(); // Filtre deja status !== 'deleted'

  for (const client of clients) {
    if (client.status !== 'active') continue;
    if (!client.config.replyToEmail) continue; // Pas d'email = pas de rapport

    try {
      const data = await this._collectClientMonthlyData(client.id);
      const html = await this._buildClientReportHtml(client, data);
      const recommendations = await this._generateClientRecommendations(client, data);

      // Injecter les recommandations dans le HTML
      const finalHtml = html.replace('{{RECOMMENDATIONS_BLOCK}}', recommendations);

      // Envoyer via Resend
      const resend = getResendClient();
      const resendInstance = new resend(this.resendKey);
      await resendInstance.sendEmail(
        client.config.replyToEmail,
        'Rapport mensuel — ' + data.monthName + ' ' + data.year,
        'Votre rapport mensuel est disponible.', // text fallback
        {
          html: finalHtml,
          fromName: 'iFIND',
          replyTo: 'alexis@getifind.fr',
          tags: [{ name: 'type', value: 'monthly-report' }, { name: 'client', value: client.id }]
        }
      );

      log.info('proactive-engine', 'Rapport mensuel email envoye a ' + client.config.replyToEmail + ' (client: ' + client.id + ')');
    } catch (e) {
      log.error('proactive-engine', 'Erreur rapport mensuel client ' + client.id + ':', e.message);
    }
  }
}
```

### 2.2 Sources de donnees

Les donnees se trouvent dans les fichiers JSON de chaque client :

| Donnee | Source | Chemin (dans container) |
|--------|--------|------------------------|
| Emails envoyes | automailer-db.json | `/clients/{id}/data/automailer/automailer-db.json` |
| Emails ouverts | automailer-db.json | Champ `openedAt` sur chaque email |
| Replies recues | inbox-manager-db.json | `/clients/{id}/data/inbox-manager/inbox-manager-db.json` |
| Classifications replies | inbox-manager-db.json | Champ `aiClassification` (interested, meeting, not-interested, etc.) |
| RDV bookes | meeting-scheduler-db.json | `/clients/{id}/data/meeting-scheduler/meeting-scheduler-db.json` |
| Hot leads | autonomous-pilot.json | `/clients/{id}/data/autonomous-pilot/autonomous-pilot.json` > `hotLeads` |
| Snapshots mois precedent | proactive-agent-db.json | `/clients/{id}/data/proactive-agent/proactive-agent-db.json` > `monthlySnapshots` |

**Pour acceder aux donnees d'un client specifique depuis le dashboard** :

```javascript
// Fonction utilitaire existante dans server.js
async function readData(skill, clientId) {
  const filePath = clientId
    ? path.join('/clients', clientId, 'data', skill, clientRegistry.SKILL_DB_FILES[skill])
    : path.join(process.env[skill.toUpperCase().replace(/-/g, '_') + '_DATA_DIR'] || '/data/' + skill, '...');
  // ... lecture JSON
}
```

**Ou depuis le router du client** (methode privilegiee car chaque client a son propre container) :

```javascript
// Via skill-loader.js (deja utilise par proactive-engine)
const amStorage = getStorage('automailer');
const emails = amStorage.getEmails(adminChatId);
```

### 2.3 Iteration sur les clients actifs

```javascript
const clientRegistry = require('../../dashboard/client-registry.js');

// listClients() retourne tous les clients avec status !== 'deleted'
const activeClients = clientRegistry.listClients().filter(c => c.status === 'active');

for (const client of activeClients) {
  // client.id = slug (ex: 'digidemat')
  // client.name = nom affiche (ex: 'Digidemat')
  // client.config.replyToEmail = email du client
  // client.config.resendApiKey = cle Resend du client (ou vide = utiliser la cle par defaut)
  // client.config.senderName = nom expediteur
  // client.config.googleBookingUrl = lien Cal.com/Google Booking
}
```

### 2.4 Envoi via Resend API

Le module existant est `/opt/moltbot/skills/automailer/resend-client.js`.

La methode `sendEmail(to, subject, body, options)` accepte deja un champ `options.html` pour envoyer du HTML brut :

```javascript
const ResendClient = getResendClient();
const resend = new ResendClient(client.config.resendApiKey || this.resendKey);

await resend.sendEmail(
  client.config.replyToEmail,          // destinataire
  'Rapport mensuel — Mars 2026',       // sujet
  'Fallback texte si HTML non supporte', // body text
  {
    html: renderedHtml,                  // HTML complet du template
    fromName: 'iFIND',
    replyTo: 'alexis@getifind.fr',
    tags: [
      { name: 'type', value: 'monthly-report' },
      { name: 'client', value: client.id }
    ]
  }
);
```

### 2.5 Planning cron

| Cron | Heure | Description |
|------|-------|-------------|
| Rapport mensuel Telegram (existant) | 1er du mois, 9h | `_monthlyReport()` — envoie un resume texte a l'admin via Telegram |
| **Rapport mensuel client email (nouveau)** | **1er du mois, 10h** | `_monthlyClientEmailReport()` — envoie le HTML a chaque client actif |

Decalage de 1h pour :
- Laisser le rapport PA existant s'executer et sauvegarder son snapshot
- Eviter de surcharger l'API Resend avec les envois de campagne du matin

### 2.6 Fichier de template

Stocker le template HTML dans `/opt/moltbot/skills/proactive-agent/templates/monthly-report.html` (ou le charger depuis ce fichier de spec).

Le rendering se fait avec un simple `String.replace()` sur les placeholders `{{VAR}}` — pas besoin de moteur de templates (coherent avec le reste du codebase qui n'utilise pas de dependances de templating).

### 2.7 Generation des recommandations par IA

```javascript
async _generateClientRecommendations(client, data) {
  const prompt = `Donnees campagne ${data.monthName} ${data.year} pour ${client.name} :
- Emails envoyes: ${data.sent}, ouverts: ${data.opened} (${data.openRate}%)
- Reponses: ${data.replies} (${data.replyRate}%), positives: ${data.positive}
- RDV bookes: ${data.meetings}
- vs mois precedent: envois ${data.deltaSent}, ouverture ${data.deltaOpen}pts, reponse ${data.deltaReply}pts

Genere exactement 3 recommandations courtes (1 phrase chacune) pour ameliorer les resultats le mois prochain.
Format: une recommandation par ligne, sans numerotation.`;

  const systemPrompt = `Tu es un expert en cold email B2B.
Donne des conseils actionnables et specifiques bases sur les donnees.
Jamais de jargon technique, jamais mentionner l'IA.
Ton professionnel, vouvoiement.`;

  return await this.callClaude(systemPrompt, prompt, 300);
}
```

---

## 3. Formules de calcul des metriques

### 3.1 Metriques de base (mois en cours)

```
Prospects contactes = nombre unique de destinataires (emails.map(e => e.to).distinct().length)
    Note : un prospect avec 3 steps = 1 prospect contacte, 3 emails envoyes

Emails envoyes = emails.filter(e => e.sentAt && inCurrentMonth(e.sentAt)).length
    Inclut : initial + follow-ups (step 1, 2, 3)

Emails ouverts = emails.filter(e => e.openedAt && inCurrentMonth(e.sentAt)).length
    Note : compter par email, pas par ouverture (un email ouvert 5x = 1 ouvert)

Taux d'ouverture = (ouverts / envoyes) * 100
    Arrondi a 1 decimale

Replies totales = inboxManager.receivedEmails.filter(r => inCurrentMonth(r.date)).length

Taux de reponse = (replies / envoyes) * 100
    Arrondi a 1 decimale

Reponses positives = replies.filter(r =>
    r.aiClassification &&
    (r.aiClassification.category === 'interested' || r.aiClassification.category === 'meeting')
).length

Taux positif = (positives / replies) * 100
    Arrondi a 1 decimale (si replies > 0, sinon 0)

RDV bookes = meetingScheduler.meetings.filter(m => inCurrentMonth(m.createdAt)).length
    Ou : replies.filter(r => r.aiClassification?.category === 'meeting').length
```

### 3.2 Comparaison mois precedent

```
delta_metric = current_month_value - previous_month_value

delta_display :
  Si delta > 0 : "↑ +{delta}" (classe: delta-up)
  Si delta < 0 : "↓ {delta}" (classe: delta-down)
  Si delta == 0 : "→ stable" (classe: delta-flat)

Pour les taux (ouverture, reponse) :
  delta = current_rate - previous_rate (en points de pourcentage)
  Affichage : "↑ +2.3 pts" ou "↓ -1.1 pts"
```

### 3.3 Funnel (largeur des barres)

```
Base = envoyes (100% de la largeur)
funnel_opened_pct = (ouverts / envoyes) * 100
funnel_replied_pct = (replies / envoyes) * 100
funnel_interested_pct = (positives / envoyes) * 100
funnel_meeting_pct = (meetings / envoyes) * 100

Minimum visible : 8% (pour que les petits nombres soient lisibles)
  bar_width = Math.max(8, calculated_pct)
```

### 3.4 Top 3 prospects les plus engages

Criteres de tri (score d'engagement) :

```
engagement_score =
  (opens * 2) +           // Chaque ouverture = 2 points
  (replied ? 15 : 0) +    // A repondu = 15 points
  (interested ? 25 : 0) + // Classification "interested" = 25 points
  (meeting ? 40 : 0) +    // Classification "meeting" = 40 points
  (clickedLink ? 10 : 0)  // A clique un lien = 10 points

Trier par engagement_score DESC, prendre les 3 premiers.
```

### 3.5 Source des donnees mois precedent

Le proactive-agent sauvegarde deja des snapshots mensuels :

```javascript
// Dans proactive-engine.js > _monthlyReport() (existant)
storage.saveMonthlySnapshot({
  date: data.date,
  hubspot: { contacts: data.hubspot.contacts, pipeline: data.hubspot.pipeline },
  emails: { sent: data.emails.sent, opened: data.emails.opened },
  leads: { total: data.leads.total, enriched: data.leads.enriched },
  budget: data.budget
});
```

Il faut etendre ce snapshot pour sauvegarder aussi :
- `replies` (nombre total)
- `positiveReplies` (interested + meeting)
- `meetings` (RDV bookes)
- `prospectsContacted` (destinataires uniques)

---

## 4. Checklist d'implementation

- [ ] Creer `/opt/moltbot/skills/proactive-agent/templates/monthly-report.html` (copier le template de la section 1)
- [ ] Ajouter `_monthlyClientEmailReport()` dans `proactive-engine.js`
- [ ] Ajouter `_collectClientMonthlyData(clientId)` — collecte cross-skill pour un client specifique
- [ ] Ajouter `_buildClientReportHtml(client, data)` — rendering du template avec les donnees
- [ ] Ajouter `_generateClientRecommendations(client, data)` — 3 recommandations via Claude
- [ ] Ajouter le cron `0 10 1 * *` dans `start()`
- [ ] Etendre `storage.saveMonthlySnapshot()` pour inclure replies, positives, meetings, prospects
- [ ] Ajouter `config.alerts.monthlyClientReport` dans la config par defaut du proactive-agent storage
- [ ] Tester avec un client actif (envoyer a soi-meme d'abord via `triggerMonthlyClientReport()`)
- [ ] Ajouter un endpoint `/api/reports/monthly-preview/:clientId` dans `server.js` pour previsualiser dans le dashboard

---

## 5. Variables du template

| Variable | Description | Exemple |
|----------|-------------|---------|
| `{{CLIENT_NAME}}` | Nom du client | `Digidemat` |
| `{{MONTH_NAME}}` | Mois en francais | `Mars` |
| `{{YEAR}}` | Annee | `2026` |
| `{{PROSPECTS_CONTACTED}}` | Destinataires uniques | `127` |
| `{{EMAILS_SENT}}` | Total emails (init + FU) | `342` |
| `{{OPEN_RATE}}` | Taux ouverture | `47.2` |
| `{{REPLY_RATE}}` | Taux reponse | `4.8` |
| `{{POSITIVE_REPLIES}}` | Interested + meeting | `8` |
| `{{MEETINGS_BOOKED}}` | RDV confirmes | `3` |
| `{{EMAILS_OPENED}}` | Nombre ouverts | `161` |
| `{{TOTAL_REPLIES}}` | Nombre total replies | `16` |
| `{{INTERESTED_COUNT}}` | Nombre interested | `5` |
| `{{DELTA_*}}` | Texte delta (ex: "↑ +12") | `↑ +12` |
| `{{DELTA_CLASS_*}}` | Classe CSS delta | `delta-up` |
| `{{FUNNEL_*_PCT}}` | Largeur barre funnel (%) | `47` |
| `{{BOOKING_URL}}` | Lien Cal.com du client | `https://calendar.app.google/...` |
| `{{TOP_PROSPECTS}}` | Block repete 3x | voir template |
| `{{RECOMMENDATIONS}}` | Block repete 2-3x | voir template |

Les noms de mois en francais :
```javascript
const MOIS_FR = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
                 'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];
```
