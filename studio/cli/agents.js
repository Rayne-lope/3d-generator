// node studio agents [--check]

import { parse } from './args.js';
import { syncAgents } from '../core/agents.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio agents [--check] [--json]

The workflow shortcuts (asset, asset-revise, asset-variants, asset-set, asset-review,
asset-export, asset-undo) are written once as Agent Skills in .agents/skills/<name>/SKILL.md.

  Codex       reads .agents/skills directly:   $asset <prompt>  (or the /skills menu)
  Gemini CLI  reads .agents/skills directly, plus the generated /asset commands
  Claude Code uses the generated /asset commands

This command regenerates .claude/commands/<name>.md and .gemini/commands/<name>.toml from the
skills (and removes generated files whose skill is gone). Run it after editing a skill.

Options:
  --check   only compare; exit with code 1 when a generated file is out of date (tests, CI)
  --json`;

export async function run(argv) {
  const { opts } = parse(argv, { check: { type: 'boolean', default: false } }, USAGE);
  const res = syncAgents({ check: opts.check });
  if (opts.json) {
    const { skills, ...rest } = res;
    console.log(JSON.stringify({ ...rest, skills: skills.map((s) => s.name) }, null, 2));
    return res.problems.length || res.outdated.length ? 1 : 0;
  }
  if (res.problems.length) {
    for (const p of res.problems) console.log(`${sym.fail} ${p}`);
    return 1;
  }
  const names = res.skills.map((s) => s.name).join(', ');
  if (opts.check) {
    if (res.outdated.length) {
      console.log(`${sym.fail} agent command files are out of date:`);
      for (const f of res.outdated) console.log(`    ${f}`);
      console.log(c.gray("  run 'node studio agents' and commit the result"));
      return 1;
    }
    console.log(`${sym.ok} agent command files are up to date (${res.skills.length} skills: ${names})`);
    return 0;
  }
  for (const f of res.written) console.log(`${sym.ok} wrote ${f}`);
  for (const f of res.removed) console.log(`${sym.ok} removed ${f}`);
  if (!res.written.length && !res.removed.length) console.log(`${sym.ok} already up to date`);
  console.log(c.gray(`${res.skills.length} skills (${names}) → .claude/commands, .gemini/commands; Codex and Gemini also read .agents/skills directly`));
  return 0;
}
