#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { ENV } from '../lib/env.mjs';
import { closePool } from '../lib/postgres.mjs';
import { buildIfindMcpServer } from '../lib/mcp-tools.mjs';
import { buildHooks, logAuditEntry } from '../lib/audit.mjs';
import { sendTelegramMessage } from '../lib/telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = path.resolve(__dirname, '../prompts/doctor-system.md');

const SYSTEM_PROMPT = fs.readFileSync(PROMPT_FILE, 'utf8');

const RUN_TIMEOUT_MS = 8 * 60 * 1000;

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

const ALLOWED_TOOLS = new Set([
  'Bash',
  'Read',
  'Grep',
  'Glob',
  'mcp__ifind__query_postgres',
  'mcp__ifind__send_telegram_alert',
  'mcp__ifind__get_system_snapshot',
]);

async function canUseTool(toolName, _input, _options) {
  if (ALLOWED_TOOLS.has(toolName)) {
    return { behavior: 'allow' };
  }
  return {
    behavior: 'deny',
    message: `Tool '${toolName}' is not in Doctor's allow-list (observe-only mode).`,
  };
}

async function runDoctor() {
  const startedAt = Date.now();
  const runId = `doctor-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  logAuditEntry({ event: 'RunStart', runId, dryRun: ENV.DRY_RUN });
  console.log(`[Doctor] Run ${runId} starting (dry_run=${ENV.DRY_RUN})`);

  const userPrompt = [
    `Effectue ton audit complet du système iFIND maintenant.`,
    `Heure de référence : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (Europe/Paris).`,
    `Procédure : snapshot → investigation des anomalies → 1-2 requêtes SQL pipeline → rapport Telegram.`,
    `Tu DOIS terminer en envoyant exactement UN message Telegram via mcp__ifind__send_telegram_alert.`,
  ].join('\n');

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
    console.error(`[Doctor] Run timeout after ${RUN_TIMEOUT_MS}ms`);
  }, RUN_TIMEOUT_MS);

  try {
    const iter = query({
      prompt: userPrompt,
      options: {
        model: 'claude-sonnet-4-5',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT },
        allowedTools: [
          'Bash',
          'Read',
          'Grep',
          'Glob',
          'mcp__ifind__query_postgres',
          'mcp__ifind__send_telegram_alert',
          'mcp__ifind__get_system_snapshot',
        ],
        mcpServers: {
          ifind: buildIfindMcpServer(),
        },
        hooks: buildHooks(),
        permissionMode: 'default',
        canUseTool,
        maxTurns: 25,
        cwd: '/opt/moltbot',
        settingSources: [],
        env: buildChildEnv(),
      },
    });

    for await (const message of iter) {
      if (timedOut) {
        console.error('[Doctor] Aborting iteration due to timeout');
        break;
      }
      if (message.type === 'system' && message.subtype === 'init') {
        logAuditEntry({ event: 'SDKInit', sessionId: message.session_id, model: message.model });
        console.log(`[Doctor] Session ${message.session_id} (model=${message.model})`);
        continue;
      }
      if (message.type === 'assistant') {
        const content = message.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim()) {
            console.log(`[Doctor][assistant] ${block.text.slice(0, 200)}${block.text.length > 200 ? '…' : ''}`);
          } else if (block.type === 'tool_use') {
            toolCalls += 1;
            console.log(`[Doctor][tool_use] ${block.name}`);
          }
        }
        continue;
      }
      if (message.type === 'user') {
        continue;
      }
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
          subtype: message.subtype,
          duration_ms: message.duration_ms,
          duration_api_ms: message.duration_api_ms,
          num_turns: message.num_turns,
          total_cost_usd: message.total_cost_usd,
          usage,
        });
        console.log(
          `[Doctor] Result: ${message.subtype} | turns=${message.num_turns} | cost=$${(message.total_cost_usd ?? 0).toFixed(4)} | tools=${toolCalls}`
        );
      }
    }
  } catch (err) {
    logAuditEntry({ event: 'RunError', error: err.message, stack: err.stack });
    console.error('[Doctor] Run failed:', err);
    try {
      await sendTelegramMessage(
        `🔴 *Doctor — RUN ERROR*\n\nL'agent Doctor a planté.\n\n\`${err.message.slice(0, 400)}\``
      );
    } catch (telegramErr) {
      console.error('[Doctor] Failed to send error to Telegram:', telegramErr);
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
    await closePool().catch(() => {});
    const elapsedMs = Date.now() - startedAt;
    logAuditEntry({ event: 'RunEnd', runId, elapsedMs, timedOut });
    console.log(`[Doctor] Run ${runId} ended in ${(elapsedMs / 1000).toFixed(1)}s`);
  }

  if (timedOut) {
    process.exitCode = 2;
  } else if (!lastResult || lastResult.subtype !== 'success') {
    process.exitCode = 1;
  }
}

runDoctor().catch((err) => {
  console.error('[Doctor] Fatal:', err);
  process.exit(1);
});
