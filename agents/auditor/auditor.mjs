#!/usr/bin/env node
// Auditor — QA Lead virtuel iFIND
//
// Mission : surveiller la QUALITÉ (leads, contacts, briefs, cohérence) en
// complément de Doctor qui surveille la RELIABILITY (infra, services, quotas).
//
// Cf. CARTE-4-PROBLEMATIQUES.md (56 problématiques atomiques, axe Q + R + C).
// Cf. ANTHROPIC-DOCTRINE-AGENTS.md §5 (modèle Opus 4.7 justifié pour deep dives
// multi-source nuancés).
//
// Phase 1 MVP — Auditor v0.1 (11/05/2026)
//   - 15/56 problématiques (les plus critiques de Carte 4 §Q1 + Q2 + R3 + C1)
//   - 3 MCP tools existants (query_postgres, get_system_snapshot, telegram)
//   - 5 nouveaux MCP tools à coder (R5 quotas, check_external, check_brief_sync,
//     cost_report, deep_dive_lead)
//   - Mode observe-only (pas d'action, juste rapport Telegram)

import { runAgent } from '../lib/agent-base.mjs';
import { buildIfindMcpServer } from '../lib/mcp-tools.mjs';
import { buildHooks } from '../lib/audit.mjs';

await runAgent({
  agentName: 'Auditor',
  // Opus 4.7 : raisonnement profond requis pour deep dives multi-source
  // (NAF Pappers vs site web, brief V2 vs Lead, persona tier vs signal).
  // Cf. doctrine §5 : "1 erreur audit = 5 leads pourris à Fred = 10× pire
  // que coût Opus supplémentaire."
  model: 'claude-opus-4-7',
  systemPromptFile: '../prompts/auditor-system.md',
  callerFile: import.meta.url,
  userPromptLines: [
    'Effectue ton audit complet QUALITÉ + RELIABILITY iFIND maintenant.',
    `Heure de référence : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (Europe/Paris).`,
    'Procédure : snapshot reliability → analyse qualité 20 leads récents → deep dive 3-5 leads suspects → rapport Telegram structuré.',
    'Tu DOIS terminer en envoyant EXACTEMENT UN message Telegram via mcp__ifind__send_telegram_alert.',
  ],
  allowedTools: [
    'Bash',
    'Read',
    'Grep',
    'Glob',
    'mcp__ifind__query_postgres',
    'mcp__ifind__send_telegram_alert',
    'mcp__ifind__get_system_snapshot',
    // Phase 2 (11/05/2026) — 4 nouveaux MCP tools dédiés Auditor
    'mcp__ifind__get_cost_report',
    'mcp__ifind__check_external_endpoint',
    'mcp__ifind__check_brief_persona_sync',
    'mcp__ifind__deep_dive_lead',
  ],
  mcpServer: buildIfindMcpServer(),
  hooks: buildHooks(),
  // Auditor a besoin de plus de turns que Doctor :
  //   - snapshot reliability (3-5 turns)
  //   - SQL queries qualité (5-10 turns)
  //   - deep dives 3-5 leads (3-5 turns chacun = 15-25 turns)
  //   - rapport final (1 turn)
  maxTurns: 35,
  // Timeout 20 min (vs Doctor 8 min) — deep dives multi-source plus longs.
  // Surchargeable via env AGENT_TIMEOUT_MS si besoin.
  timeoutMs: 20 * 60 * 1000,
});
