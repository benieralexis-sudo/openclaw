#!/usr/bin/env node
// Doctor — agent surveillance santé système iFIND
// Refactor 11/05/2026 (Optim 6) : utilise lib/agent-base.mjs pour mutualiser
// la machinerie Agent SDK (190L → 35L). Toute la logique commune (canUseTool,
// hooks, timeout, audit, env purge, telegram on error) est dans agent-base.

import { runAgent } from '../lib/agent-base.mjs';
import { buildIfindMcpServer } from '../lib/mcp-tools.mjs';
import { buildHooks } from '../lib/audit.mjs';

await runAgent({
  agentName: 'Doctor',
  // Optim 1 (11/05/2026) : upgrade Sonnet 4.5 → 4.6 (drop-in, contexte 1M vs 200K)
  model: 'claude-sonnet-4-6',
  systemPromptFile: '../prompts/doctor-system.md',
  callerFile: import.meta.url,
  userPromptLines: [
    'Effectue ton audit complet du système iFIND maintenant.',
    `Heure de référence : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (Europe/Paris).`,
    'Procédure : snapshot → investigation des anomalies → 1-2 requêtes SQL pipeline → rapport Telegram.',
    'Tu DOIS terminer en envoyant exactement UN message Telegram via mcp__ifind__send_telegram_alert.',
  ],
  allowedTools: [
    'Bash',
    'Read',
    'Grep',
    'Glob',
    'mcp__ifind__query_postgres',
    'mcp__ifind__send_telegram_alert',
    'mcp__ifind__get_system_snapshot',
  ],
  mcpServer: buildIfindMcpServer(),
  hooks: buildHooks(),
  maxTurns: 25,
  // timeoutMs: défaut ENV.AGENT_TIMEOUT_MS (8 min) — Doctor pas besoin de surcharge
});
