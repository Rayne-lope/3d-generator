import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { syncAgents, loadSkills, parseFrontmatter, renderClaude, renderGemini, GENERATED_MARK } from '../studio/core/agents.js';

const EXPECTED = ['asset', 'asset-export', 'asset-publish', 'asset-review', 'asset-revise', 'asset-set', 'asset-skins', 'asset-undo', 'asset-variants'];

test('the agent skills are valid Agent Skills', () => {
  const { skills, problems } = loadSkills(ROOT);
  assert.deepEqual(problems, []);
  assert.deepEqual(skills.map((s) => s.name), EXPECTED);
  for (const s of skills) {
    assert.match(s.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(s.description.length > 40 && s.description.length <= 1024, `${s.name}: description length`);
    assert.ok(s.argumentHint, `${s.name}: argument hint`);
    assert.ok(s.body.includes('node studio'), `${s.name}: body uses the CLI`);
    assert.ok(!/\$ARGUMENTS|\{\{args\}\}/.test(s.body), `${s.name}: skills stay tool-neutral (placeholders are added per tool)`);
  }
});

test('generated Claude Code and Gemini CLI commands are in sync with the skills', () => {
  const res = syncAgents({ root: ROOT, check: true });
  assert.deepEqual(res.problems, []);
  assert.deepEqual(res.outdated, [], "run 'node studio agents' and commit the result");
});

test('per-tool renderers put the arguments where each tool expects them', () => {
  const skill = { name: 'demo', description: 'Demo: "quoted" text', argumentHint: '<slug | set:name>', body: '# Demo\n\nSteps.\n' };
  const claude = renderClaude(skill);
  assert.match(claude, /^---\n# Generated from \.agents\/skills\/demo\/SKILL\.md/);
  assert.match(claude, /\ndescription: "Demo: \\"quoted\\" text"\n/);
  assert.match(claude, /\nRequest: \$ARGUMENTS\n\n# Demo/);
  const gemini = renderGemini(skill);
  assert.match(gemini, /\ndescription = "Demo: \\"quoted\\" text"\n/);
  assert.match(gemini, /\nprompt = '''\nRequest: \{\{args\}\}\n\n# Demo\n\nSteps\.\n'''\n$/);
  const { data } = parseFrontmatter('---\nname: x\ndescription: "a: b"\nmetadata:\n  argument-hint: "<p>"\n---\nbody');
  assert.deepEqual(data, { name: 'x', description: 'a: b', metadata: { 'argument-hint': '<p>' } });
});

test('sync writes missing files and removes generated files whose skill is gone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agents-'));
  try {
    const skillDir = path.join(root, '.agents', 'skills', 'demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: A demo skill used by the sync test, long enough to be useful.\nmetadata:\n  argument-hint: "<x>"\n---\n\n# Demo\n');
    fs.mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'commands', 'old.md'), `---\n# ${GENERATED_MARK}old/SKILL.md\n---\n`);
    fs.writeFileSync(path.join(root, '.claude', 'commands', 'mine.md'), '---\ndescription: hand-written\n---\n');
    assert.equal(syncAgents({ root, check: true }).outdated.length, 3); // 2 missing + 1 stale
    const res = syncAgents({ root });
    assert.deepEqual(res.written.sort(), ['.claude/commands/demo.md', '.gemini/commands/demo.toml']);
    assert.deepEqual(res.removed, ['.claude/commands/old.md']);
    assert.ok(fs.existsSync(path.join(root, '.claude', 'commands', 'mine.md')), 'hand-written commands are kept');
    assert.deepEqual(syncAgents({ root, check: true }).outdated, []);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: other\ndescription: wrong folder\n---\n');
    assert.match(syncAgents({ root, check: true }).problems[0], /must equal the folder name/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
