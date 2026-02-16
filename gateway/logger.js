// iFIND - Structured JSON logger
'use strict';

function _toJson(tag, level, args) {
  const msg = args.map(a => {
    if (a instanceof Error) return a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
    return String(a);
  }).join(' ');
  return JSON.stringify({ ts: new Date().toISOString(), level, tag, msg });
}

function _fmt(tag, level, args) {
  const ts = new Date().toISOString();
  const parts = ['[' + ts + ']', '[' + tag + ']'];
  if (level === 'warn') parts.push('WARN');
  if (level === 'error') parts.push('ERROR');
  return parts.concat(args);
}

const STRUCTURED = process.env.LOG_FORMAT === 'json';

function info(tag, ...args) {
  if (STRUCTURED) { process.stdout.write(_toJson(tag, 'info', args) + '\n'); }
  else { console.log(..._fmt(tag, 'info', args)); }
}

function warn(tag, ...args) {
  if (STRUCTURED) { process.stdout.write(_toJson(tag, 'warn', args) + '\n'); }
  else { console.warn(..._fmt(tag, 'warn', args)); }
}

function error(tag, ...args) {
  if (STRUCTURED) { process.stderr.write(_toJson(tag, 'error', args) + '\n'); }
  else { console.error(..._fmt(tag, 'error', args)); }
}

module.exports = { info, warn, error };
