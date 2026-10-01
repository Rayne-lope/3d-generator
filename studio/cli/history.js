// node studio history <slug|set:name>

import { parse } from './args.js';
import { parseTarget, workingState, versionsForAsset, historyDir } from '../core/history.js';
import { setOfAsset } from '../core/targets.js';
import { loadConfig } from '../core/config.js';
import { rel } from '../core/paths.js';
import { c, fmtNum } from '../core/log.js';

const USAGE = `Usage: node studio history <slug | set:<name>> [--json]

Lists the saved versions (newest last) with the request each one answers, its triangle count,
which one the working copy matches, and pinned/auto-saved markers.

Related: node studio diff <slug> [vA] [vB] · revert <slug> <vNNN> · undo <slug> · pin <slug> <vNNN>`;

function when(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function run(argv) {
  const { args, opts } = parse(argv, {}, USAGE);
  if (args.length !== 1) throw new Error(USAGE);
  const t = parseTarget(args[0]);
  const state = workingState(t);
  const setName = t.kind === 'asset' ? setOfAsset(t.name) : null;
  const setVersions = setName ? versionsForAsset(t.name).filter((v) => v.target !== t.name) : [];
  if (opts.json) {
    console.log(JSON.stringify({ target: t.label, dir: rel(historyDir(t)), head: state.head?.id || null, current: state.current?.id || null, dirty: state.dirty, versions: state.versions, setVersions: setVersions.map((v) => ({ target: v.target, id: v.id, note: v.note, createdAt: v.createdAt })) }, null, 2));
    return 0;
  }
  if (!state.versions.length) {
    console.log(`${c.bold(t.label)}: no saved versions yet. Save one with: node studio save ${t.label} -m "<request>"`);
    if (setVersions.length) console.log(c.gray(`(${setVersions.length} version(s) saved with set:${setName} — node studio history set:${setName})`));
    return 0;
  }
  const keep = loadConfig().history.keep;
  console.log(`${c.bold(t.label)} — ${state.versions.length} version(s) ${c.gray(`(keeps last ${keep} + pinned · ${rel(historyDir(t))})`)}`);
  for (const v of state.versions) {
    const isHead = state.head && v.id === state.head.id;
    const marker = state.current && v.id === state.current.id ? c.green('●') : isHead ? c.yellow('○') : ' ';
    const flags = [v.pinned ? '📌' : '', v.auto ? c.gray('auto') : ''].filter(Boolean).join(' ');
    const parent = v.parent && state.versions.findIndex((x) => x.id === v.parent) !== state.versions.findIndex((x) => x.id === v.id) - 1 ? c.gray(` ← ${v.parent}`) : '';
    console.log(`${marker} ${c.cyan(v.id)}  ${c.gray(when(v.createdAt))}  ${fmtNum(v.triangles).padStart(7)}△  ${v.note ? `"${v.note}"` : c.gray('(no message)')}${parent}${flags ? `  ${flags}` : ''}`);
  }
  if (state.dirty) console.log(`\n${c.yellow('○')} working copy has unsaved changes since ${state.head.id} — 'node studio diff ${t.label}' to see them, 'save' to keep them, 'undo' to drop them (auto-saved first).`);
  else console.log(`\n${c.green('●')} working copy = ${state.current.id}`);
  if (setVersions.length) console.log(c.gray(`Also ${setVersions.length} version(s) saved with set:${setName} (node studio history set:${setName}).`));
  return 0;
}
