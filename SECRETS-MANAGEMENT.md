# Secrets Management — iFIND

**Sprint 8 (10/05/2026)** — Procédure d'externalisation des secrets.

## Etat actuel

- 78 secrets dans `/opt/moltbot/.env` (bot trigger-engine)
- 30 secrets dans `/opt/moltbot/dashboard-v2/.env` (Next.js)
- Total : ~108 secrets en clair sur disque, lus par les services systemd au boot

**Risques** :
- Pas de rotation automatique — toute clé fuitée reste valide jusqu'à révocation manuelle
- Pas d'audit log d'accès aux secrets
- Backup `/opt/moltbot/backups/` contient les `.env` chiffrés GPG mais le master clé GPG est sur le VPS
- Multi-VPS : pas de mécanisme central pour propager une rotation à plusieurs déploiements

## Cible — Doppler (recommandé)

[Doppler](https://www.doppler.com) = SaaS secrets manager avec CLI léger, intégration native Node.js et systemd. Free tier suffisant pour iFIND (jusqu'à 5 user / 1 workplace).

### Avantages vs Vault

| Critère | Doppler | HashiCorp Vault |
|---|---|---|
| Setup time | 30 min | 1-2 jours (cluster + auth + policies) |
| Coût | Free tier OK | Self-hosted = VPS dédié + maintenance |
| Audit log | Inclus dashboard | Inclus mais à wirer Splunk/ELK |
| Rotation auto | Manuel + alertes | Possible via lease+renew |
| Multi-VPS sync | `doppler secrets download` au deploy | Idem (vault read) |

**Verdict** : Doppler pour MVP, migration Vault si on dépasse 10 VPS ou contraintes compliance (GDPR audit, SOC2).

## Procédure de migration (~3h)

### Phase 1 — Setup Doppler (30 min)

1. Créer compte sur https://doppler.com (signup avec email pro)
2. Créer projet `ifind` → environnements `dev`, `staging`, `prod`
3. Installer CLI Doppler sur le VPS :
   ```bash
   curl -Ls https://cli.doppler.com/install.sh | sh
   doppler login  # ouvre navigateur, authentification
   doppler setup  # selectionne projet ifind, env prod
   ```

### Phase 2 — Import secrets (45 min)

Import en bulk depuis les `.env` existants :

```bash
cd /opt/moltbot
doppler secrets upload --silent .env

cd /opt/moltbot/dashboard-v2
doppler secrets upload --silent --config prod-dashboard .env
```

**Vérifications post-import** :
- `doppler secrets` (liste)
- `doppler secrets get OPENAI_API_KEY` (sanity check)
- Comparer le count : `doppler secrets --raw | wc -l` doit matcher le `.env`

### Phase 3 — Wire systemd (1h)

Modifier `/etc/systemd/system/dashboard-v2.service` :

```ini
[Service]
# Avant : EnvironmentFile=/opt/moltbot/dashboard-v2/.env
ExecStart=/usr/local/bin/doppler run --config prod-dashboard -- /usr/bin/node /opt/moltbot/dashboard-v2/.next/standalone/server.js
```

Idem pour `digitestlab-frontend.service`. Reload :

```bash
systemctl daemon-reload
systemctl restart dashboard-v2 digitestlab-frontend
```

**Validation** : `systemctl status dashboard-v2` doit montrer "Doppler service token authenticated" dans les logs au boot.

### Phase 4 — Bot trigger-engine (30 min)

Le bot `node gateway/telegram-router.js` lit `.env` via `dotenv`. Switch :

```bash
# Avant : node gateway/telegram-router.js
doppler run -- node gateway/telegram-router.js
```

Modifier les wrappers cron (`/opt/moltbot/scripts/run-pollers-cron.sh`, `reset-quotas-cron.sh`, etc.) pour wrapper aussi :

```bash
# Avant : source /opt/moltbot/scripts/.run-pollers.env
doppler run --config prod -- /opt/moltbot/scripts/run-pollers-original.sh
```

### Phase 5 — Cleanup (15 min)

1. Renommer les `.env` en `.env.backup-pre-doppler-2026MMDD`
2. Ajouter à `.gitignore` (déjà fait normalement)
3. Documenter dans `CLAUDE.md` que le projet utilise Doppler

## Rotation des clés (procédure standard)

1. **Générer nouvelle clé** côté provider (ex: Anthropic → Console → API Keys → Create)
2. **Update Doppler** : `doppler secrets set ANTHROPIC_API_KEY="sk-ant-..."`
3. **Restart services** : `systemctl restart dashboard-v2 digitestlab-frontend`
4. **Test** : `curl -H "x-cron-secret: $(doppler secrets get CRON_SECRET --plain)" http://localhost:3100/api/internal/health`
5. **Révoquer ancienne clé** côté provider (toujours en dernier — rollback possible)

**Doppler trail** : la rotation est trackée dans le dashboard Doppler avec qui/quand/quoi.

## Secrets critiques à rotater EN PRIORITÉ

D'après l'audit memory `MEMORY.md` (action user en attente) :

| Clé | Risque | Action |
|---|---|---|
| `PRIMEFORGE_API_KEY` | Exposée transcript Claude | Révoquer immédiatement |
| `FULLENRICH_API_KEY` | Exposée chat 30/04 | Rotater |
| `GOOGLE_API_KEY` (digidemat.ro) | Ancienne clé exposée | Révoquer |
| `ANTHROPIC_API_KEY` | Pas de fuite connue | Préventif 90 jours |
| `CRON_SECRET` | Pas de fuite connue | Préventif si fuite logs |

## Multi-tenant : segmentation

Une fois sur Doppler, créer 1 config par client si on veut isoler les budgets API par tenant :

- `prod-shared` : Anthropic, Apify, TheirStack (multi-tenant via quota-checker Sprint 7+8)
- `prod-dtl` : clés spécifiques DigitestLab (Resend domain, Cal.com, etc.)
- `prod-tenant-N` : pour chaque nouveau client

Le wrapper systemd lit `prod-shared` + `prod-dtl` (Doppler supporte le merge).

## Disaster recovery

Doppler ne tombe quasi jamais (SLA 99.99%) mais procédure :

1. **Backup quotidien** : `doppler secrets download --no-file --format env > /opt/moltbot/backups/doppler-$(date -I).env.gpg` puis `gpg -e` (cron 03h)
2. **Token Doppler service** stocké chiffré dans `/etc/doppler-token.gpg` (recovery via mot de passe maître admin)
3. **Plan B** : si Doppler down + token perdu → restore le dernier backup chiffré, redémarrer services avec `.env` local temporaire

## Coût

- Doppler **Developer (free)** : 5 users, 1 workplace, illimité secrets, 30j audit log → suffisant MVP
- Doppler **Team ($7/user/mo)** : 90j audit, SAML SSO, environments illimités → à considérer post-2e client

## Ressources

- Docs Doppler : https://docs.doppler.com
- CLI install : https://docs.doppler.com/docs/install-cli
- Comparison Doppler vs Vault : https://www.doppler.com/blog/doppler-vs-vault
