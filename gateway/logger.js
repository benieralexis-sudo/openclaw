// MoltBot - Logger centralise avec timestamp ISO et tags coherents
'use strict';

function _fmt(tag, level, args) {
  const ts = new Date().toISOString();
  const parts = ['[' + ts + ']', '[' + tag + ']'];
  if (level === 'warn') parts.push('WARN');
  if (level === 'error') parts.push('ERROR');
  return parts.concat(args);
}

function info(tag, ...args) {
  console.log(..._fmt(tag, 'info', args));
}

function warn(tag, ...args) {
  console.warn(..._fmt(tag, 'warn', args));
}

function error(tag, ...args) {
  console.error(..._fmt(tag, 'error', args));
}

module.exports = { info, warn, error };
