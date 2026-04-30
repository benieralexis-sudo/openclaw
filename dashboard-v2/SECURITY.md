# Sécurité iFIND Dashboard v2

Dernière mise à jour : 30/04/2026

## Liste des secrets en jeu

| Secret | Stockage | Usage | Rotation cible |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `.env` | Opus/Sonnet/Haiku (qualify, brief, classify) | 90j |
| `PAPPERS_API_TOKEN` | `.env` | Lookup SIRENE + dirigeants | 180j |
| `FULLENRICH_API_KEY` | `.env` | Email/phone waterfall (étage 4-bis) | 90j |
| `KASPR_API_KEY` | `.env` | LinkedIn → email/phone (étage 4) | 90j |
| `RODZ_API_KEY` | container env | Webhooks fundraising + enrichContact | 180j |
| `RODZ_WEBHOOK_SECRET` | container env | Auth webhooks Rodz entrants | 365j |
| `APIFY_API_TOKEN` | `.env` | HarvestAPI + pollers Apify | 90j |
| `RESEND_API_KEY` | `.env` | Envoi emails commerciaux + tracking | 180j |
| `RESEND_WEBHOOK_SECRET` | `.env` | Auth webhooks bounces/opens/clicks | 365j |
| `GOOGLE_API_KEY` | `.env` | Custom Search Engine (LinkedIn fallback) | 90j |
| `GOOGLE_CSE_ID` | `.env` | Identifiant moteur de recherche | 365j |
| `CRON_SECRET` | `.env` (dashboard) + container env (router) | Auth `/api/internal/*` endpoints | 180j |
| `BETTER_AUTH_SECRET` | `.env` | Signature sessions dashboard | 365j |
| `TELEGRAM_BOT_TOKEN` | `.env` (root) | Bot Telegram + alertes système | 365j |
| `CAL_WEBHOOK_SECRET` | `.env` | Auth webhooks Cal.com booking | 365j |

## Protocole de rotation

### Procédure générale
1. Générer un nouveau secret côté provider (UI ou API)
2. **Mettre à jour `.env` AVANT de révoquer l'ancien** (éviter downtime)
3. Restart le service concerné (`systemctl restart dashboard-v2` + `docker compose restart telegram-router` selon le secret)
4. Vérifier `/api/health/deep` retourne `up`
5. Révoquer l'ancien secret côté provider
6. Documenter la rotation dans ce fichier (date + opérateur)

### Cas particuliers
- **Anthropic** : 2 clés possibles côté console.anthropic.com (active+staging) → rotation sans downtime
- **Pappers** : 1 seule clé, downtime ~2 min
- **FullEnrich** : 1 seule clé, downtime ~2 min
- **Resend** : 2 clés possibles (1 par domaine) → rotation par domaine sans downtime
- **CRON_SECRET** : ⚠️ doit être changé EN MÊME TEMPS dans `dashboard-v2/.env` ET dans le container `telegram-router` (`/opt/moltbot/.env` puis `docker compose restart telegram-router`)

## Endpoints internes (`/api/internal/*`)

Tous **DOIVENT** vérifier le header `x-cron-secret`. Audit grep automatisé via `npm run audit:internal-endpoints` (à coder).

## Permissions fichiers sensibles

```bash
# Cible
-rw------- 1 root root /opt/moltbot/.env
-rw------- 1 root root /opt/moltbot/dashboard-v2/.env

# Vérification
ls -la /opt/moltbot/.env /opt/moltbot/dashboard-v2/.env
```

Si pas en `600` : `chmod 600 /opt/moltbot/.env /opt/moltbot/dashboard-v2/.env`

## Logs : pas de secrets

Lancer un grep régulier des patterns de clés (Google AIza*, hex 32-chars, Anthropic sk-ant*, Bearer tokens) dans `/var/log/dashboard-v2.log` doit retourner 0 ligne.

Si secrets détectés → identifier le code qui logge + masquer + commit.

## Historique des rotations

| Date | Secret | Raison | Opérateur |
|---|---|---|---|
| 2026-04-30 | `GOOGLE_API_KEY` | Mismatch projet `digidemat.ro` → `benieralexis@gmail.com` | Alexis |
| 2026-04-30 | `GOOGLE_CSE_ID` | Idem | Alexis |
| 2026-04-29 | `KASPR_API_KEY` | Setup initial | Alexis |
| 2026-04-29 | `FULLENRICH_API_KEY` | Setup initial | Alexis |

## Secrets exposés à risque

Si un secret est collé en clair dans un système logged (chat assistant, ticket support, GitHub issue) :
1. **Considérer le secret compromis** dans les heures qui suivent
2. **Rotater dans les 24h** au plus tard
3. Documenter dans la table ci-dessus

### Exposition connue (30/04/2026)

| Secret exposé | Lieu | Statut |
|---|---|---|
| Ancienne `GOOGLE_API_KEY` projet `digidemat.ro` | Chat assistant (session 30/04) | Plus utilisée (remplacée par la clé du projet `ifind` sur compte `benieralexis@gmail.com`). À révoquer côté Google Cloud (projet `digidemat.ro`) |
| `FULLENRICH_API_KEY` actuelle | Chat assistant (session 30/04) | 🟡 Toujours active. À rotater dans la semaine. |

## Rate limiting

- `/api/auth/*` : protégé par Better Auth (rate limit par IP, à vérifier en prod)
- `/api/internal/*` : protégé par `x-cron-secret`, pas de rate limit par IP (à ajouter si exposé publiquement)
- `/api/triggers`, `/api/leads/*` : auth session, pas de rate limit (acceptable pour usage interne)
