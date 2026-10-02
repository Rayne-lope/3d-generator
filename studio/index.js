#!/usr/bin/env node
// AI 3D Asset Studio CLI:  node studio <command> [options]

import { c } from './core/log.js';

const COMMANDS = {
  dev: ['Start the live viewport (watch + auto rebuild + reload)', () => import('./cli/dev.js')],
  new: ['Scaffold a new asset', () => import('./cli/new.js')],
  'new-set': ['Scaffold a set (pack) with a shared style module and member assets', () => import('./cli/new-set.js')],
  build: ['Build preview GLBs (Preview = Export) and validate them', () => import('./cli/build.js')],
  validate: ['Run the export preflight without writing exports', () => import('./cli/validate.js')],
  review: ['Build + render multi-view contact sheets + source-vs-GLB parity check', () => import('./cli/review.js')],
  export: ['Strict export to exports/<profile>/ (blocked by errors)', () => import('./cli/export.js')],
  save: ['Save a version (snapshot of the source + GLB) after a generate/revise step', () => import('./cli/save.js')],
  history: ['List saved versions', () => import('./cli/history.js')],
  revert: ['Restore a saved version into the working copy', () => import('./cli/revert.js')],
  undo: ['Restore the version before the latest one', () => import('./cli/undo.js')],
  pin: ['Pin a version (never pruned)', () => import('./cli/pin.js')],
  unpin: ['Unpin a version', () => import('./cli/pin.js')],
  diff: ['Visual + stats + source diff between versions (or working copy)', () => import('./cli/diff.js')],
  compare: ['Side-by-side render of two assets (A/B)', () => import('./cli/compare.js')],
  report: ['Show the latest build report of an asset', () => import('./cli/report.js')],
  stats: ['Project statistics and success metrics', () => import('./cli/stats.js')],
  list: ['List assets and sets', () => import('./cli/list.js')],
  golden: ['Run the golden set (build, validate, parity, regression) for all profiles', () => import('./cli/golden.js')],
  'engine-pack': ['Prepare golden exports + manifests for Godot/Roblox engine tests', () => import('./cli/engine-pack.js')],
  'engine-verify': ['Run the Godot headless verification (needs Godot 4.3+ on PATH)', () => import('./cli/engine-verify.js')],
  doctor: ['Check the environment (Node, Chromium/WebGL, folders)', () => import('./cli/doctor.js')],
  agents: ['Regenerate the Claude Code / Gemini CLI commands from .agents/skills (Codex reads them directly)', () => import('./cli/agents.js')],
};

function help() {
  console.log(`${c.bold('AI 3D Asset Studio')} — prompt → procedural asset → live GLB viewport → engine export\n`);
  console.log(`Usage: node studio <command> [options]   (add --help to any command)\n`);
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, [summary]] of Object.entries(COMMANDS)) console.log(`  ${c.cyan(name.padEnd(width))}  ${summary}`);
  console.log(`\nTypical loop: node studio dev  ·  node studio new barrel  ·  node studio review barrel  ·  node studio save barrel -m "<prompt>"  ·  node studio export barrel --profile roblox`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    help();
    return 0;
  }
  const entry = COMMANDS[cmd];
  if (!entry) {
    console.error(`unknown command '${cmd}'. Run 'node studio help'.`);
    return 2;
  }
  const mod = await entry[1]();
  return (await mod.run(rest, cmd)) ?? 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(c.red(err?.message || String(err)));
    if (process.env.STUDIO_DEBUG) console.error(err?.stack);
    process.exitCode = 1;
  },
);
