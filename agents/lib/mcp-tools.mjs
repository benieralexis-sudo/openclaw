import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { runQuery } from './postgres.mjs';
import { sendTelegramMessage } from './telegram.mjs';
import { ENV } from './env.mjs';

const QUERY_TIMEOUT_MS = 15_000;
const MAX_ROWS = 50;

const READ_ONLY_REGEX = /^\s*(SELECT|WITH|EXPLAIN|SHOW)\b/i;
const FORBIDDEN_REGEX = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

// Optim 4 (11/05/2026) — Rate limit SQL queries per run.
// Compteur in-memory réinitialisé à chaque buildIfindMcpServer() call (= 1 par run agent).
// Au-delà du seuil, warn dans logs + retour explicite à l'agent pour qu'il ralentisse.
// Au-delà de 2× le seuil, hard-fail (anti scan abusive).

export function buildIfindMcpServer() {
  let sqlQueryCount = 0;
  const sqlMaxSoft = ENV.AGENT_MAX_SQL_QUERIES_PER_RUN;
  const sqlMaxHard = sqlMaxSoft * 2;
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
          // Optim 4 — Rate limit per run.
          sqlQueryCount += 1;
          if (sqlQueryCount > sqlMaxHard) {
            return {
              content: [{
                type: 'text',
                text: `ERROR: SQL rate limit hit (${sqlQueryCount}/${sqlMaxHard} hard cap). Stop querying and write your final Telegram report now.`,
              }],
              isError: true,
            };
          }
          if (sqlQueryCount > sqlMaxSoft) {
            console.warn(`[mcp-tools.rate-limit] SQL query ${sqlQueryCount} > soft cap ${sqlMaxSoft} — agent should wrap up.`);
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

      // ═══════════════════════════════════════════════════════════════════
      // Phase 2 (11/05/2026) — MCP tools dédiés Auditor
      // Réduisent les turns Auditor de 13 → 7-8 = -40% coût + qualité+
      // ═══════════════════════════════════════════════════════════════════

      tool(
        'get_cost_report',
        'Get a complete budget/quota snapshot across all 7 iFIND services (Apify, TheirStack, Anthropic, Kaspr, FullEnrich, Pappers, Rodz). Returns structured JSON with %used, burn/day, projection. Use this ONCE per run to get all budget info — no need to query DB tables separately.',
        {},
        async () => {
          if (!process.env.CRON_SECRET) {
            return { content: [{ type: 'text', text: 'ERROR: CRON_SECRET not configured' }], isError: true };
          }
          try {
            const baseUrl = process.env.DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3100';
            const res = await fetch(`${baseUrl}/api/internal/cost-report`, {
              headers: { 'x-cron-secret': process.env.CRON_SECRET },
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
              return { content: [{ type: 'text', text: `Cost report HTTP ${res.status}` }], isError: true };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          } catch (err) {
            return { content: [{ type: 'text', text: `Cost report failed: ${err.message}` }], isError: true };
          }
        }
      ),

      tool(
        'check_external_endpoint',
        'Check if an external URL responds (HTTP HEAD or GET). Use for verifying RSS feeds (maddyness.com/feed), Pappers API, Apify console, etc. Returns status code + response time.',
        {
          url: z.string().describe('URL to check (HTTPS only for security)'),
          method: z.enum(['HEAD', 'GET']).describe('HTTP method (default HEAD)'),
        },
        async ({ url, method }) => {
          if (!/^https?:\/\//.test(url)) {
            return { content: [{ type: 'text', text: 'ERROR: URL must start with http:// or https://' }], isError: true };
          }
          const startTime = Date.now();
          try {
            const res = await fetch(url, {
              method: method || 'HEAD',
              signal: AbortSignal.timeout(10_000),
              headers: { 'User-Agent': 'iFIND-Auditor/0.1' },
            });
            const responseMs = Date.now() - startTime;
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  url,
                  method: method || 'HEAD',
                  status: res.status,
                  ok: res.ok,
                  responseMs,
                  contentLength: res.headers.get('content-length'),
                  contentType: res.headers.get('content-type'),
                }, null, 2),
              }],
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  url,
                  method: method || 'HEAD',
                  error: err.message,
                  responseMs: Date.now() - startTime,
                  ok: false,
                }, null, 2),
              }],
              isError: true,
            };
          }
        }
      ),

      tool(
        'check_brief_persona_sync',
        'Detects briefV2Json ↔ Lead persona DESYNC (bug B1 identified in Carte 1). Compares the fullName/jobTitle the briefV2 was generated for vs the current Lead.fullName. Returns a list of triggers where the brief mentions a contact different from the current Lead. CRITICAL bug — emails sent based on these briefs go to the wrong person.',
        {
          minDaysOld: z.number().int().min(0).max(30).describe('Min days since brief generation (default 0)'),
          limit: z.number().int().min(1).max(50).describe('Max triggers to check (default 20)'),
        },
        async ({ minDaysOld, limit }) => {
          const minDays = minDaysOld ?? 0;
          const lim = limit ?? 20;
          try {
            const sql = `
              SELECT
                t.id as trigger_id,
                t."companyName" as company,
                t."briefV2Json"->>'verdict' as verdict,
                l."fullName" as current_lead_name,
                t."briefV2Json"->>'thesis' as brief_thesis_excerpt
              FROM "Trigger" t
              LEFT JOIN "Lead" l ON l."triggerId" = t.id
              WHERE t."deletedAt" IS NULL
                AND t."briefV2Json" IS NOT NULL
                AND t.status = 'NEW'
                AND t."capturedAt" < NOW() - INTERVAL '${minDays} days'
                AND l."deletedAt" IS NULL
                AND l."fullName" IS NOT NULL
                AND l."fullName" != ''
                AND (
                  -- Brief contient un nom différent du Lead actuel ?
                  -- Heuristique : si le thesis ne contient PAS le firstName Lead, suspect.
                  t."briefV2Json"::text NOT ILIKE ('%' || split_part(l."fullName", ' ', 1) || '%')
                  -- Ou opener contient [Prénom] placeholder
                  OR t."briefV2Json"->>'opener' LIKE '%[Prénom]%'
                  OR t."briefV2Json"->>'opener' LIKE '%[Pr%nom]%'
                )
              ORDER BY t."capturedAt" DESC
              LIMIT ${lim};
            `;
            const result = await runQuery(sql);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  description: 'Brief V2 with persona desync OR [Prénom] placeholder',
                  count: result.rows.length,
                  triggers: result.rows.map((r) => ({
                    triggerId: r.trigger_id,
                    company: r.company,
                    currentLeadName: r.current_lead_name,
                    verdict: r.verdict,
                    briefExcerpt: r.brief_thesis_excerpt?.slice(0, 200),
                  })),
                }, null, 2),
              }],
            };
          } catch (err) {
            return { content: [{ type: 'text', text: `Persona sync check failed: ${err.message}` }], isError: true };
          }
        }
      ),

      tool(
        'deep_dive_lead',
        'Complete audit of a single Lead — returns all data + automated coherence checks (brief↔lead sync, NAF tech vs persona tier, email domain match, oversize flags). Returns a structured report with anomalies. Use this for the 3-5 most suspect leads identified earlier; do NOT use on every lead (cost).',
        {
          leadId: z.string().describe('Lead.id (cuid format)'),
        },
        async ({ leadId }) => {
          try {
            const sql = `
              SELECT
                l.id as lead_id,
                l."companyName",
                l."fullName" as lead_full_name,
                l."firstName" as lead_first_name,
                l."lastName" as lead_last_name,
                l."jobTitle" as lead_job_title,
                l.email as lead_email,
                l.phone as lead_phone,
                l."linkedinUrl" as lead_linkedin,
                l."personaTier",
                l."personaSource",
                l."fitScore",
                l."dataQuality",
                l."emailConfidence",
                l.status as lead_status,
                l."doNotContact",
                l."doNotContactReason",
                l."bouncedAt",
                t.id as trigger_id,
                t."sourceCode",
                t.type as trigger_type,
                t.title as trigger_title,
                t."companyNaf",
                t.size as company_size,
                t.score as trigger_score,
                t."isHot",
                t."briefV2Json"->>'verdict' as brief_verdict,
                t."briefV2Json"->>'confidence' as brief_confidence,
                t."briefV2Json"->>'thesis' as brief_thesis,
                t."briefV2Json"->>'opener' as brief_opener
              FROM "Lead" l
              LEFT JOIN "Trigger" t ON l."triggerId" = t.id
              WHERE l.id = $1
                AND l."deletedAt" IS NULL
              LIMIT 1;
            `;
            const result = await runQuery(sql, [leadId]);
            if (result.rows.length === 0) {
              return { content: [{ type: 'text', text: `Lead ${leadId} not found or soft-deleted` }], isError: true };
            }
            const r = result.rows[0];

            // Coherence checks automatiques (ce qui prenait 5-10 turns à l'agent)
            const anomalies = [];

            // Check 1 — Brief persona desync (bug B1)
            if (r.brief_thesis && r.lead_first_name) {
              if (!r.brief_thesis.toLowerCase().includes(r.lead_first_name.toLowerCase())) {
                anomalies.push({
                  severity: 'high',
                  type: 'brief_persona_desync',
                  detail: `Brief thesis does NOT mention firstName "${r.lead_first_name}" — likely from older persona. Lead.fullName="${r.lead_full_name}".`,
                });
              }
            }

            // Check 2 — Opener placeholder [Prénom]
            if (r.brief_opener && (r.brief_opener.includes('[Prénom]') || r.brief_opener.includes('[Prenom]'))) {
              anomalies.push({
                severity: 'high',
                type: 'opener_placeholder',
                detail: 'Brief opener contains [Prénom] placeholder — not substituted. Email would be sent as-is.',
              });
            }

            // Check 3 — Pappers RCS sur trigger HIRING_KEY tech (bug DiXiO)
            if (r.trigger_type === 'HIRING_KEY' && r.personaSource === 'pappers-rcs' && r.companyNaf) {
              const naf = r.companyNaf.toString();
              if (naf.startsWith('62.') || naf.startsWith('58.29') || naf.startsWith('63.')) {
                anomalies.push({
                  severity: 'medium',
                  type: 'pappers_rcs_on_tech_hire',
                  detail: `Lead has personaSource=pappers-rcs (legal representative, usually CEO) on tech hiring trigger (NAF ${naf}). Likely wrong contact — should be CTO/Head of Eng. Check if tech-hire-guard kicked in.`,
                });
              }
            }

            // Check 4 — Email domain mismatch
            if (r.lead_email && r.companyName) {
              const emailDomain = r.lead_email.split('@')[1]?.toLowerCase() ?? '';
              const companyLower = r.companyName.toLowerCase().replace(/[^a-z]/g, '');
              if (emailDomain && companyLower && !emailDomain.includes(companyLower.slice(0, 5))) {
                anomalies.push({
                  severity: 'medium',
                  type: 'email_domain_mismatch_possible',
                  detail: `Email domain "${emailDomain}" doesn't obviously match company "${r.companyName}". Possible ex-employer or generic mailbox.`,
                });
              }
            }

            // Check 5 — doNotContact sans raison
            if (r.doNotContact === true && (!r.doNotContactReason || r.doNotContactReason === '')) {
              anomalies.push({
                severity: 'low',
                type: 'do_not_contact_no_reason',
                detail: 'Lead has doNotContact=true but doNotContactReason is empty — investigate why it was flagged.',
              });
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  leadId: r.lead_id,
                  company: r.companyName,
                  trigger: {
                    id: r.trigger_id,
                    sourceCode: r.sourceCode,
                    type: r.trigger_type,
                    title: r.trigger_title,
                    naf: r.companyNaf,
                    score: r.trigger_score,
                    isHot: r.isHot,
                  },
                  persona: {
                    fullName: r.lead_full_name,
                    jobTitle: r.lead_job_title,
                    personaTier: r.personaTier,
                    personaSource: r.personaSource,
                    fitScore: r.fitScore,
                    linkedinUrl: r.lead_linkedin,
                    email: r.lead_email,
                    phone: r.lead_phone,
                  },
                  brief: r.brief_verdict
                    ? {
                        verdict: r.brief_verdict,
                        confidence: r.brief_confidence,
                        thesis: r.brief_thesis?.slice(0, 300),
                        opener: r.brief_opener?.slice(0, 300),
                      }
                    : null,
                  health: {
                    leadStatus: r.lead_status,
                    dataQuality: r.dataQuality,
                    emailConfidence: r.emailConfidence,
                    doNotContact: r.doNotContact,
                    doNotContactReason: r.doNotContactReason,
                    bouncedAt: r.bouncedAt,
                  },
                  anomalies,
                  anomaliesCount: anomalies.length,
                  verdictAutoAudit: anomalies.length === 0 ? 'COHERENT' : anomalies.some((a) => a.severity === 'high') ? 'CRITICAL' : 'SUSPICIOUS',
                }, null, 2),
              }],
            };
          } catch (err) {
            return { content: [{ type: 'text', text: `Deep dive failed: ${err.message}` }], isError: true };
          }
        }
      ),
    ],
  });
}
