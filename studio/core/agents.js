// Agent shortcuts for every coding agent, from one source of truth.
//
// .agents/skills/<name>/SKILL.md (the open Agent Skills format) is the source:
//   - Codex reads it directly (invoke with $name, the /skills menu, or automatically),
//   - Gemini CLI reads it directly (.agents/skills is an alias of .gemini/skills).
// Generated from it, for tools that want their own command files:
//   - .claude/commands/<name>.md   → /name in Claude Code   ($ARGUMENTS = text after the command)
//   - .gemini/commands/<name>.toml → /name in Gemini CLI    ({{args}} = text after the command)

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

export const GENERATED_MARK = 'Generated from .agents/skills/';
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CLAUDE_TOOLS = 'Bash(node studio:*), Read, Write, Edit, Glob, Grep';

const dirs = (root) => ({
  skills: path.join(root, '.agents', 'skills'),
  claude: path.join(root, '.claude', 'commands'),
  gemini: path.join(root, '.gemini', 'commands'),
});

const unquote = (v) => {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
};

/**
 * Minimal YAML frontmatter reader for SKILL.md: `key: value` lines and one level of nested
 * maps (`metadata:` followed by indented `key: value`). Enough for the Agent Skills fields.
 */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  let parent = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const nested = /^\s+/.test(raw);
    const kv = raw.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) throw new Error(`cannot parse frontmatter line: ${raw}`);
    const [, key, value] = kv;
    if (nested && parent) data[parent][key] = unquote(value);
    else if (value === '') {
      data[key] = {};
      parent = key;
    } else {
      data[key] = unquote(value);
      parent = null;
    }
  }
  return { data, body: text.slice(m[0].length) };
}

/** Read and check every skill. Returns { skills, problems }. */
export function loadSkills(root = paths.root) {
  const { skills: dir } = dirs(root);
  const skills = [];
  const problems = [];
  if (!fs.existsSync(dir)) return { skills, problems: [`missing ${path.relative(root, dir)}`] };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(root, file).split(path.sep).join('/');
    let parsed;
    try {
      parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${rel}: ${err.message}`);
      continue;
    }
    const { data, body } = parsed;
    const name = data.name;
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    if (!name) problems.push(`${rel}: frontmatter needs a name`);
    else if (name !== entry.name) problems.push(`${rel}: name '${name}' must equal the folder name '${entry.name}'`);
    else if (!NAME_RE.test(name) || name.length > 64) problems.push(`${rel}: name '${name}' must be lowercase letters, digits and single hyphens (≤ 64)`);
    if (!description) problems.push(`${rel}: frontmatter needs a description`);
    else if (description.length > 1024) problems.push(`${rel}: description is ${description.length} characters (≤ 1024)`);
    if (body.includes("'''")) problems.push(`${rel}: body must not contain ''' (used as the TOML string delimiter)`);
    skills.push({ name: name || entry.name, description, argumentHint: data.metadata?.['argument-hint'] || '', body: `${body.trim()}\n`, file: rel });
  }
  return { skills, problems };
}

function header(skill) {
  return `${GENERATED_MARK}${skill.name}/SKILL.md by \`node studio agents\`. Edit that file, not this one.`;
}

/** Claude Code command: /name, the text after it is $ARGUMENTS. */
export function renderClaude(skill) {
  const fm = ['---', `# ${header(skill)}`, `description: ${JSON.stringify(skill.description)}`];
  if (skill.argumentHint) fm.push(`argument-hint: ${JSON.stringify(skill.argumentHint)}`);
  fm.push(`allowed-tools: ${CLAUDE_TOOLS}`, '---');
  return `${fm.join('\n')}\n\nRequest: $ARGUMENTS\n\n${skill.body}`;
}

/** Gemini CLI custom command: /name, the text after it replaces {{args}}. */
export function renderGemini(skill) {
  return `# ${header(skill)}\ndescription = ${JSON.stringify(skill.description)}\nprompt = '''\nRequest: {{args}}\n\n${skill.body}'''\n`;
}

/** Files that should exist, keyed by absolute path. */
export function expectedFiles(skills, root = paths.root) {
  const d = dirs(root);
  const out = new Map();
  for (const s of skills) {
    out.set(path.join(d.claude, `${s.name}.md`), renderClaude(s));
    out.set(path.join(d.gemini, `${s.name}.toml`), renderGemini(s));
  }
  return out;
}

/** Generated files (carrying the marker) that no skill produces any more. */
function staleGenerated(expected, root) {
  const d = dirs(root);
  const stale = [];
  for (const [dir, ext] of [[d.claude, '.md'], [d.gemini, '.toml']]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f);
      if (!f.endsWith(ext) || expected.has(file)) continue;
      if (fs.readFileSync(file, 'utf8').includes(GENERATED_MARK)) stale.push(file);
    }
  }
  return stale;
}

/**
 * Generate (or with check: true, only compare) the per-tool command files.
 * @returns {{skills: any[], problems: string[], written: string[], removed: string[], outdated: string[]}}
 */
export function syncAgents({ root = paths.root, check = false } = {}) {
  const { skills, problems } = loadSkills(root);
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const result = { skills, problems, written: [], removed: [], outdated: [] };
  if (problems.length) return result;
  const expected = expectedFiles(skills, root);
  for (const [file, content] of expected) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === content) continue;
    if (check) result.outdated.push(rel(file));
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      result.written.push(rel(file));
    }
  }
  for (const file of staleGenerated(expected, root)) {
    if (check) result.outdated.push(rel(file));
    else {
      fs.rmSync(file);
      result.removed.push(rel(file));
    }
  }
  return result;
}
