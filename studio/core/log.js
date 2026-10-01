// Terminal output helpers (no dependencies). Respects NO_COLOR and non-TTY output.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  gray: wrap(90),
};

export const sym = {
  ok: useColor ? c.green('✔') : 'OK',
  fail: useColor ? c.red('✖') : 'FAIL',
  warn: useColor ? c.yellow('⚠') : 'WARN',
  info: useColor ? c.blue('ℹ') : 'INFO',
  arrow: useColor ? c.gray('→') : '->',
};

let quiet = false;

export function setQuiet(q) {
  quiet = q;
}

export function log(...args) {
  if (!quiet) console.log(...args);
}

export function fmtNum(n) {
  return Number(n).toLocaleString('en-US');
}

export function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtMs(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function table(rows, { header = null } = {}) {
  const all = header ? [header, ...rows] : rows;
  const widths = [];
  for (const r of all) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] || 0, stripAnsi(String(cell)).length)));
  const line = (r) => r.map((cell, i) => String(cell) + ' '.repeat(widths[i] - stripAnsi(String(cell)).length)).join('  ');
  const out = [];
  if (header) {
    out.push(c.bold(line(header)));
    out.push(c.gray(widths.map((w) => '─'.repeat(w)).join('  ')));
  }
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
