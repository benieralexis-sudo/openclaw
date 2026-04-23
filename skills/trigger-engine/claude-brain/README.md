# Claude Brain — Module Trigger Engine

Module d'intelligence Opus pour le Trigger Engine FR. Transforme les signaux pré-filtrés
par ICP en leads commercialement qualifiés, pitchs perso, briefs RDV et patterns sémantiques.

## Architecture

```
claude-brain/
├── index.js              Orchestrateur (start/stop, enqueue*, waitForResult, stats)
├── queue.js              File SQLite idempotente, backoff, dead letter
├── worker.js             Boucle claim/execute avec circuit breaker + kill switch
├── pipelines.js          Dispatcher qualify/pitch/brief/discover + post-process
├── context-builder.js    Assemble (system + voice + data) par pipeline
├── cache.js              Prompt caching Anthropic ephemeral
├── budget.js             Tracking coût, alertes Telegram, pause auto hard limit
├── anthropic-client.js   Wrapper SDK unifié (Opus/Sonnet/Haiku + retry JSON)
├── circuit-breaker.js    CLOSED/OPEN/HALF_OPEN + rate limiter token bucket
├── auto-send-gate.js     8 règles de sécurité avant envoi
├── smartlead-client.js   Client Smartlead opt-in via SMARTLEAD_API_KEY
└── prompts/
    ├── qualify.md
    ├── pitch.md
    ├── brief.md
    └── discover.md
```

## Kill switches (par ordre de priorité)

| Variable | Effet |
|---|---|
| `CLAUDE_BRAIN_ENABLED=false` | Worker ne démarre pas, enqueue skippés |
| `SMARTLEAD_API_KEY` absent | Aucun envoi réel |
| `AUTO_SEND_ENABLED=false` | Gate refuse systématiquement (si wired) |
| `clients.claude_brain_config.enabled=false` | Tenant paused, pipelines skippés |
| Hard budget atteint | Auto-pause via budget tracker |

## Configuration par tenant

`clients.claude_brain_config` (JSON) :

```json
{
  "enabled": true,
  "pipelines": ["qualify", "pitch", "brief", "discover"],
  "monthly_budget_eur": 300,
  "hard_cap_eur": 500,
  "voice_template": "Direct, tech-first, pas corporate",
  "icp_nuance": "Éviter mairies/assoc même si NAF passe",
  "pitch_language": "vous",
  "model_preference": "claude-opus-4-7",
  "auto_send_threshold_opus": 8.5,
  "auto_send_threshold_email_confidence": 0.85,
  "auto_send_enabled": false,
  "paused_at": null,
  "paused_reason": null,
  "paused_patterns": [],
  "paused_mailboxes": []
}
```

## Pipelines

### QUALIFY (priority 5)
- Trigger auto : nouveau match routé via cron (score >= tenant min_score)
- Contexte : 90 jours events, matches actifs, contacts
- Output JSON : phase, priority_score_opus, decision_maker_real, angle_primary,
  anti_angles, timing_window_days, red_flags, personalization_hooks
- Post-process : met à jour `client_leads.opus_score` + `opus_qualified_at`

### PITCH (priority 2)
- Trigger : user click dashboard "✍ Pitch Opus"
- Contexte : 60 jours events + qualification Opus précédente (injectée auto)
- Output JSON : subject, body (80-130 mots), tone_used, personalization_hooks_used, cta_type
- Versionné : régénération produit v2, v3... (historique gardé)

### BRIEF (priority 2)
- Trigger : user click dashboard "📋 Brief RDV"
- Contexte : **1825 jours (5 ans)** — exploite les 1M tokens d'Opus 4.7
- Output : markdown 7 sections, 1500-3000 mots
- Téléchargeable `?format=md`, affichable dans UI

### DISCOVER (priority 8)
- Trigger : cron weekly dimanche 23h
- Contexte : 50 convertis + 50 ignorés + 20 négatifs + patterns actuels
- Output JSON : proposed_patterns[] avec définition technique
- Post-process : insert dans `claude_brain_pattern_proposals` (status=pending)
- **Validation humaine obligatoire** avant ajout au catalogue

## Auto-Send Gate (8 règles)

Appelé AVANT tout envoi Smartlead. Early exit au premier fail.

1. **opus_score** ≥ `auto_send_threshold_opus` (défaut 8.5)
2. **email deliverability** : confidence >= 0.85 OU mx-verified + >= 0.5
3. **no_recent_contact** : pas de sent sur ce SIREN depuis 60 jours
4. **timing** : hors nuit 20h-8h, hors weekend, pas lundi <10h, pas vendredi >=15h
5. **mailbox_quota** : 50 envois/jour/mailbox max
6. **reply_rate** : >= 2% sur 7 jours glissants (ignore si <20 samples)
7. **semantic_blacklist** : procédure collective, liquidation, red_flags Opus
8. **opus_final** : validation Haiku (OUI/NON/DOUTE) — optionnelle si caller fourni

## Prompt caching

Anthropic cache les blocs marqués `cache_control: ephemeral` pendant 5 min.
Seuil : `MIN_CACHEABLE_TOKENS = 512`. Les blocs stables (system + voice) sont cachés,
le data context varie par appel. Économie : -90% sur les tokens cachés.

## Budget & alertes

Hiérarchie :
- `monthly_budget_eur` (soft, défaut 300€) : alerte Telegram admin à 80% franchi
- `hard_cap_eur` (défaut 500€) : **pause automatique du tenant** + alerte rouge
- Reset implicite via `month_key = 'YYYY-MM'`

## Endpoints Dashboard

| Endpoint | Role | Description |
|---|---|---|
| `GET /api/trigger-engine/leads/:id/qualification` | tous | Qualification Opus + metadata |
| `POST /api/trigger-engine/leads/:id/pitch/generate` | tous (scope) | Génère pitch (sync 45s) |
| `GET /api/trigger-engine/leads/:id/pitches` | tous (scope) | Historique versions pitch |
| `POST /api/trigger-engine/leads/:id/brief/generate` | tous (scope) | Génère brief (sync 90s) |
| `GET /api/trigger-engine/leads/:id/brief[?format=md]` | tous (scope) | Lecture/download brief |
| `POST /api/trigger-engine/leads/:id/action` | tous (scope) | validate\|skip\|sent\|booked |
| `GET /api/trigger-engine/to-validate` | tous (scope) | File leads 6-8 avec pitch prêt |
| `GET /api/trigger-engine/controls` | admin | Vue config + pause tenant |
| `POST /api/trigger-engine/controls/:tenantId` | admin | Patch config |
| `GET /api/trigger-engine/claude-brain/stats` | admin | Queue + coûts + latence + fails |
| `GET /api/trigger-engine/pattern-proposals?status=pending` | admin | Propositions Discover |
| `POST /api/trigger-engine/pattern-proposals/:id/action` | admin | accept\|reject |

## Commandes opérationnelles

```bash
# Qualification batch sur les leads actifs (n'a pas encore de qualif)
CLAUDE_BRAIN_ENABLED=true node scripts/qualify-backfill.js --limit 100

# Filtrer par tenant
CLAUDE_BRAIN_ENABLED=true node scripts/qualify-backfill.js --tenant ifind

# Dry-run pour voir les candidats sans consommer
CLAUDE_BRAIN_ENABLED=true node scripts/qualify-backfill.js --dry-run

# Test pitch sur top 5 leads
CLAUDE_BRAIN_ENABLED=true node scripts/pitch-test.js 5

# Test brief sur le top lead iFIND
CLAUDE_BRAIN_ENABLED=true node scripts/brief-test.js
```

## Troubleshooting

### Worker idle alors que CLAUDE_BRAIN_ENABLED=true
Vérifier les logs du container `telegram-router` : circuit breaker peut être OPEN
(>20% erreurs 5 min). Se reset après 15 min (HALF_OPEN → CLOSED si trial ok).

### Budget hard limit atteint
Le tenant est auto-pause (`claude_brain_config.enabled=false`). Réactiver via
`POST /api/trigger-engine/controls/:tenantId` avec `{"enabled": true}`.

### JSON parse fail sur Opus output
Le wrapper retry 1x avec demande explicite de correction. Si re-fail → dead letter
(retry_count atteint max_retries=3). Vérifier les prompts si récurrent.

### Cache hit rate à 0%
Vérifier taille prompts (`systemPrompt + voicePrompt`) >= `MIN_CACHEABLE_TOKENS` (512).
Si trop court, enrichir le prompt ou abaisser le seuil.
