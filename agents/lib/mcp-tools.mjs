import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runQuery } from './postgres.mjs';
import { sendTelegramMessage } from './telegram.mjs';

const QUERY_TIMEOUT_MS = 15_000;
const MAX_ROWS = 50;

const READ_ONLY_REGEX = /^\s*(SELECT|WITH|EXPLAIN|SHOW)\b/i;
const FORBIDDEN_REGEX = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

export function buildIfindMcpServer() {
  return createSdkMcpServer({
    name: 'ifind',
    version: '0.1.0',
    tools: [
      tool(
        'query_postgres',
        'Execute a READ-ONLY SQL query against the iFIND Postgres database. Use this to inspect leads, triggers, clients, lead_credit, and any operational data. Only SELECT/WITH/EXPLAIN/SHOW allowed. Results are capped at 50 rows. Use LIMIT clauses to be efficient.',
        {
          sql: z.string().describe('A read-only SQL statement (SELECT, WITH, EXPLAIN, SHOW only)'),
          reason: z.string().describe('Brief reason why you need this data (for audit log)'),
        },
        async ({ sql, reason }) => {
          if (!READ_ONLY_REGEX.test(sql)) {
            return {
              content: [{ type: 'text', text: 'ERROR: Only SELECT/WITH/EXPLAIN/SHOW queries are allowed.' }],
              isError: true,
            };
          }
          if (FORBIDDEN_REGEX.test(sql)) {
            return {
              content: [{ type: 'text', text: 'ERROR: Mutation keywords detected. Read-only queries only.' }],
              isError: true,
            };
          }
          try {
            const queryPromise = runQuery(sql);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Query timeout (15s)')), QUERY_TIMEOUT_MS)
            );
            const result = await Promise.race([queryPromise, timeoutPromise]);
            const truncated = result.rows.slice(0, MAX_ROWS);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      rowCount: result.rowCount,
                      truncatedTo: truncated.length,
                      rows: truncated,
                      reason,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Query error: ${err.message}` }],
              isError: true,
            };
          }
        }
      ),

      tool(
        'send_telegram_alert',
        'Send a Telegram message to the iFIND admin (Alexis). Use this when you have completed an audit and need to communicate findings. Use Markdown formatting. Be concise but specific. Include severity emoji at start (✅ all good / ⚠️ warning / 🔴 critical). Include verdict + key facts + recommendation when relevant.',
        {
          message: z.string().describe('Markdown-formatted Telegram message'),
          severity: z.enum(['ok', 'warning', 'critical']).describe('Severity level for the audit log'),
        },
        async ({ message, severity }) => {
          try {
            await sendTelegramMessage(message);
            return {
              content: [{ type: 'text', text: `Telegram message sent (severity: ${severity}).` }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Telegram send failed: ${err.message}` }],
              isError: true,
            };
          }
        }
      ),

      tool(
        'get_system_snapshot',
        'Get a fast structured snapshot of system health: running Docker containers, systemd services iFIND, disk space, memory, load average. Use this FIRST to get quick context before deeper investigation.',
        {},
        async () => {
          const { execSync } = await import('node:child_process');
          const safeExec = (cmd) => {
            try {
              return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
            } catch (err) {
              return `ERROR: ${err.message}`;
            }
          };
          const snapshot = {
            timestamp: new Date().toISOString(),
            docker_ps: safeExec('docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}"'),
            ifind_services: safeExec(
              'systemctl list-units --type=service --state=running --no-legend | grep -iE "dashboard|digit|ifind" | awk \'{print $1, $4}\''
            ),
            disk_free: safeExec('df -h / | tail -1'),
            mem_free: safeExec('free -h | head -2 | tail -1'),
            load_avg: safeExec('uptime'),
            postgres_up: safeExec('docker exec ifind-postgres pg_isready -U postgres 2>&1 || echo DOWN'),
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
          };
        }
      ),
    ],
  });
}
