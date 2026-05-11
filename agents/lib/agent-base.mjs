// agent-base.mjs — Pattern abstrait réutilisable pour tous les agents iFIND.
//
// Optim 6 (11/05/2026) — Extrait depuis doctor.mjs (190L) pour permettre
// de scaffolder un nouvel agent (Auditor, Watchdog, Validator, etc.) en
// quelques lignes au lieu de copier-coller 190L.
//
// Usage type (auditor.mjs sera ~30 lignes) :
//
//   import { runAgent } from '../lib/agent-base.mjs';
//   import { buildIfindMcpServer } from '../lib/mcp-tools.mjs';
//   import { buildHooks } from '../lib/audit.mjs';
//
//   await runAgent({
//     agentName: 'Auditor',
//     model: 'claude-opus-4-7',
//     systemPromptFile: '../prompts/auditor-system.md',
//     userPromptLines: [
//       'Effectue ton audit complet qualité+reliability maintenant.',
//       'Heure : ' + new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
//       'Procédure : snapshot reliability → deep dives 10 leads → rapport Telegram.',
//       'Tu DOIS terminer en envoyant EXACTEMENT UN message Telegram.',
//     ],
//     allowedTools: [
//       'Bash', 'Read', 'Grep', 'Glob',
//       'mcp__ifind__query_postgres',
//       'mcp__ifind__send_telegram_alert',
//       'mcp__ifind__get_system_snapshot',
//       'mcp__ifind__deep_dive_lead',  // nouveau MCP tool spécifique Auditor
//     ],
//     mcpServer: buildIfindMcpServer(),
//     hooks: buildHooks(),
//     maxTurns: 30,                    // Auditor a besoin de plus que Doctor (25)
//     timeoutMs: 20 * 60 * 1000,       // Surcharge si besoin (Auditor 20 min)
//   });

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { ENV } from './env.mjs';
import { closePool } from './postgres.mjs';
import { logAuditEntry } from './audit.mjs';
import { sendTelegramMessage } from './telegram.mjs';

// Variables d'env Claude Code parentes à purger avant lancement de l'agent.
// Évite la confusion avec la session parente Claude Code qui a peut-être
// invoqué cet agent (cas dev local). En prod systemd, ces vars n'existent pas.
const PARENT_CLAUDE_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_PARENT',
];

function buildChildEnv() {
  const cleaned = { ...process.env };
  for (const key of PARENT_CLAUDE_VARS) {
    delete cleaned[key];
  }
  return cleaned;
}

/**
 * Lance un agent iFIND avec configuration standard (hooks audit, MCP tools,
 * timeout paramétrable, canUseTool whitelist, logging JSONL).
 *
 * @param {Object} opts
 * @param {string} opts.agentName — Nom pour logs/Telegram (ex: "Doctor", "Auditor")
 * @param {string} opts.model — Model Claude (ex: "claude-sonnet-4-6", "claude-opus-4-7")
 * @param {string} opts.systemPromptFile — Chemin relatif vers prompts/{agent}-system.md
 *   (depuis le fichier appelant)
 * @param {string[]} opts.userPromptLines — Lignes du user prompt (mission directive)
 * @param {string[]} opts.allowedTools — Whitelist Tools + MCP tools autorisés
 * @param {Object} opts.mcpServer — Serveur MCP (buildIfindMcpServer())
 * @param {Object} opts.hooks — Hooks (buildHooks())
 * @param {number} [opts.maxTurns=25] — Cap turns (anti boucle infinie)
 * @param {number} [opts.timeoutMs] — Timeout run (défaut ENV.AGENT_TIMEOUT_MS)
 * @param {string} [opts.callerFile] — `import.meta.url` du caller pour résoudre systemPromptFile
 */
export async function runAgent(opts) {
  const {
    agentName,
    model,
    systemPromptFile,
    userPromptLines,
    allowedTools,
    mcpServer,
    hooks,
    maxTurns = 25,
    timeoutMs,
    callerFile,
  } = opts;

  // Validation paramètres minimaux
  for (const required of ['agentName', 'model', 'systemPromptFile', 'userPromptLines', 'allowedTools', 'mcpServer', 'hooks']) {
    if (!opts[required]) throw new Error(`runAgent: missing required option '${required}'`);
  }

  const RUN_TIMEOUT_MS = timeoutMs ?? ENV.AGENT_TIMEOUT_MS;

  // Résout le chemin du system prompt depuis le caller
  const callerDir = callerFile
    ? path.dirname(fileURLToPath(callerFile))
    : process.cwd();
  const promptPath = path.resolve(callerDir, systemPromptFile);
  const SYSTEM_PROMPT = fs.readFileSync(promptPath, 'utf8');

  // canUseTool whitelist — deny by default
  const ALLOWED_TOOLS = new Set(allowedTools);
  const canUseTool = async (toolName) => {
    if (ALLOWED_TOOLS.has(toolName)) return { behavior: 'allow' };
    return {
      behavior: 'deny',
      message: `Tool '${toolName}' is not in ${agentName}'s allow-list (observe-only mode).`,
    };
  };

  const startedAt = Date.now();
  const runId = `${agentName.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  logAuditEntry({ event: 'RunStart', runId, agentName, dryRun: ENV.DRY_RUN, model, maxTurns, timeoutMs: RUN_TIMEOUT_MS });
  console.log(`[${agentName}] Run ${runId} starting (dry_run=${ENV.DRY_RUN}, model=${model}, timeout=${RUN_TIMEOUT_MS}ms)`);

  const userPrompt = userPromptLines.join('\n');

  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let toolCalls = 0;
  let lastResult = null;
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    console.error(`[${agentName}] Run timeout after ${RUN_TIMEOUT_MS}ms`);
  }, RUN_TIMEOUT_MS);

  try {
    const iter = query({
      prompt: userPrompt,
      options: {
        model,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT },
        allowedTools,
        mcpServers: { ifind: mcpServer },
        hooks,
        permissionMode: 'default',
        canUseTool,
        maxTurns,
        cwd: '/opt/moltbot',
        settingSources: [],
        env: buildChildEnv(),
      },
    });

    for await (const message of iter) {
      if (timedOut) {
        console.error(`[${agentName}] Aborting iteration due to timeout`);
        break;
      }
      if (message.type === 'system' && message.subtype === 'init') {
        logAuditEntry({ event: 'SDKInit', runId, agentName, sessionId: message.session_id, model: message.model });
        console.log(`[${agentName}] Session ${message.session_id} (model=${message.model})`);
        continue;
      }
      if (message.type === 'assistant') {
        const content = message.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim()) {
            console.log(`[${agentName}][assistant] ${block.text.slice(0, 200)}${block.text.length > 200 ? '…' : ''}`);
          } else if (block.type === 'tool_use') {
            toolCalls += 1;
            console.log(`[${agentName}][tool_use] ${block.name}`);
          }
        }
        continue;
      }
      if (message.type === 'user') continue;
      if (message.type === 'result') {
        lastResult = message;
        if (message.usage) {
          usage.input_tokens = message.usage.input_tokens ?? 0;
          usage.output_tokens = message.usage.output_tokens ?? 0;
          usage.cache_creation_input_tokens = message.usage.cache_creation_input_tokens ?? 0;
          usage.cache_read_input_tokens = message.usage.cache_read_input_tokens ?? 0;
        }
        logAuditEntry({
          event: 'RunResult',
          runId,
          agentName,
          subtype: message.subtype,
          duration_ms: message.duration_ms,
          duration_api_ms: message.duration_api_ms,
          num_turns: message.num_turns,
          total_cost_usd: message.total_cost_usd,
          usage,
        });
        console.log(
          `[${agentName}] Result: ${message.subtype} | turns=${message.num_turns} | cost=$${(message.total_cost_usd ?? 0).toFixed(4)} | tools=${toolCalls} | cache_read=${usage.cache_read_input_tokens}`,
        );
      }
    }
  } catch (err) {
    logAuditEntry({ event: 'RunError', runId, agentName, error: err.message, stack: err.stack });
    console.error(`[${agentName}] Run failed:`, err);
    try {
      await sendTelegramMessage(
        `🔴 *${agentName} — RUN ERROR*\n\nL'agent a planté.\n\n\`${err.message.slice(0, 400)}\``,
      );
    } catch (telegramErr) {
      console.error(`[${agentName}] Failed to send error to Telegram:`, telegramErr);
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    await closePool().catch(() => {});
    const elapsedMs = Date.now() - startedAt;
    logAuditEntry({ event: 'RunEnd', runId, agentName, elapsedMs, timedOut });
    console.log(`[${agentName}] Run ${runId} ended in ${(elapsedMs / 1000).toFixed(1)}s`);
  }

  if (timedOut) process.exitCode = 2;
  else if (!lastResult || lastResult.subtype !== 'success') process.exitCode = 1;
}
