import fs from 'node:fs';
import path from 'node:path';

const AUDIT_DIR = '/var/log/ifind-agents';
const AUDIT_FILE = path.join(AUDIT_DIR, 'doctor-audit.jsonl');

if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

export function logAuditEntry(entry) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(AUDIT_FILE, line);
}

const DESTRUCTIVE_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i,
  /\bdocker\s+(rm|stop|kill|prune)\b/i,
  /\bgit\s+(push|reset|checkout)\b/i,
  />\s*\/dev\//,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

export function isBashCommandSafeForObserveMode(command) {
  if (typeof command !== 'string') return false;
  for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Matches destructive pattern: ${pattern}` };
    }
  }
  return { safe: true };
}

export function buildHooks() {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            const { tool_name, tool_input } = input;
            logAuditEntry({
              event: 'PreToolUse',
              tool: tool_name,
              input: tool_input,
            });

            if (tool_name === 'Bash') {
              const cmd = tool_input?.command ?? '';
              const safety = isBashCommandSafeForObserveMode(cmd);
              if (!safety.safe) {
                logAuditEntry({
                  event: 'BLOCKED',
                  tool: tool_name,
                  command: cmd,
                  reason: safety.reason,
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: `Doctor is in observe-only mode. Destructive command blocked: ${safety.reason}`,
                  },
                };
              }
            }
            return {};
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async (input) => {
            const { tool_name, tool_response } = input;
            const responseStr = typeof tool_response === 'string'
              ? tool_response
              : JSON.stringify(tool_response);
            logAuditEntry({
              event: 'PostToolUse',
              tool: tool_name,
              responseSnippet: responseStr.slice(0, 500),
            });
            return {};
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          async (input) => {
            logAuditEntry({ event: 'Stop', stop_hook_active: input?.stop_hook_active });
            return {};
          },
        ],
      },
    ],
  };
}
