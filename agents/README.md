# iFIND Agents — Phase 1 (Doctor)

Agents Claude Sonnet 4.5 autonomes qui surveillent / auditent / améliorent le système iFIND 24/7.

## Phase 1 : Doctor (livré 11/05/2026)

**Doctor** = agent de surveillance système (mode observe + alert uniquement).

- Toutes les **30 min** via systemd timer (`ifind-doctor.timer`)
- Récupère un snapshot infra (docker, systemd, disk, postgres) via outil custom
- Investigue le pipeline iFIND via SQL read-only sur la DB Postgres
- Envoie un rapport Telegram à `ADMIN_CHAT_ID` (Alexis)
- Mode strict observe-only : hooks PreToolUse bloquent toute commande destructive (rm -rf, DROP, DELETE, systemctl stop, docker rm, git push…)
- Audit log JSONL exhaustif dans `/var/log/ifind-agents/doctor-audit.jsonl`
- Logs runtime dans `/var/log/ifind-agents/doctor.log`

### Coût observé

~$0.29 par run (avec caching Anthropic actif, ~95% cache hit ratio sur input tokens).
À 30min cron : ~$14/jour, ~$420/mois. Si trop, baisser à `OnCalendar=hourly` dans le timer.

### Lancer un run manuel

```bash
cd /opt/moltbot/agents
node doctor/doctor.mjs              # vrai run (envoi Telegram)
DOCTOR_DRY_RUN=1 node doctor/doctor.mjs   # simule envoi Telegram
```

### Voir ce que fait Doctor

```bash
# Logs runtime
tail -f /var/log/ifind-agents/doctor.log

# Audit log structuré (toutes les actions)
tail -f /var/log/ifind-agents/doctor-audit.jsonl | jq

# Status timer
systemctl status ifind-doctor.timer
systemctl list-timers ifind-doctor.timer

# Désactiver temporairement
systemctl stop ifind-doctor.timer
systemctl disable ifind-doctor.timer
```

### Architecture

```
/opt/moltbot/agents/
├── doctor/
│   └── doctor.mjs              # Entry point (Agent SDK loop)
├── lib/
│   ├── env.mjs                 # Charge .env (root + dashboard-v2)
│   ├── postgres.mjs            # Pool pg vers ifind-postgres
│   ├── telegram.mjs            # sendTelegramMessage helper
│   ├── audit.mjs               # Hooks PreToolUse / PostToolUse / Stop + JSONL audit
│   └── mcp-tools.mjs           # 3 MCP tools custom :
│                               #   - mcp__ifind__query_postgres (SELECT-only, capped)
│                               #   - mcp__ifind__send_telegram_alert
│                               #   - mcp__ifind__get_system_snapshot (docker+systemd+disk+pg)
├── prompts/
│   └── doctor-system.md        # System prompt Doctor (~5KB)
├── package.json
└── README.md
```

### Sécurité

- **canUseTool callback** : whitelist stricte des outils (Bash, Read, Grep, Glob + 3 MCP custom). Tout autre tool = deny.
- **PreToolUse hook** : bloque les commandes Bash destructives par regex (rm -rf, DROP, DELETE, systemctl stop, docker rm, git push…).
- **MCP query_postgres** : valide que SQL commence par SELECT/WITH/EXPLAIN/SHOW, refuse INSERT/UPDATE/DELETE/DROP/etc.
- **Env nettoyé** : `CLAUDECODE`, `CLAUDE_CODE_*` purgés avant lancement du child claude (évite confusion session parente).

## Roadmap (à venir)

- **Phase 2** : Auditor (qualité briefs vs ICP, propose patches prompt) — Opus 4.7
- **Phase 3** : Hunter (analyse outcomes, trouve patterns cachés)
- **Phase 4** : Mirror per-client (refine ICP en continu via feedback)
- **Phase 5** : Scout (découverte autonome nouvelles sources triggers FR)
- **Phase 6** : Orchestrator (Opus 4.7 qui coordonne les 5 spécialistes)
