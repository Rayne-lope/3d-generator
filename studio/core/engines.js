// Engine packs: golden exports + manifests for checks inside real engines.
//   godot  → engines/godot/golden/*.glb + manifest.json, verified headless by verify_golden.gd
//   roblox → engines/roblox/golden/*.glb + GoldenManifest.lua + GoldenVerify.rbxlx (template place)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { paths, itemId, previewGlb, rel } from './paths.js';
import { buildItem } from './build.js';
import { loadGolden, goldenItems, fingerprint } from './golden.js';
import { ensureDir, removeDir, writeJson } from './fsutil.js';
import { KIT_VERSION } from '../kit/index.js';

export const godotDir = () => path.join(paths.engines, 'godot');
export const robloxDir = () => path.join(paths.engines, 'roblox');

/** Locate a Godot 4 binary: $GODOT_BIN, then godot/godot4 on PATH, then the macOS app. */
export function findGodot() {
  const candidates = [];
  if (process.env.GODOT_BIN) candidates.push(process.env.GODOT_BIN);
  const names = process.platform === 'win32' ? ['godot.exe', 'godot4.exe', 'Godot.exe'] : ['godot', 'godot4', 'Godot', 'godot-4'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const n of names) if (dir) candidates.push(path.join(dir, n));
  if (process.platform === 'darwin') candidates.push('/Applications/Godot.app/Contents/MacOS/Godot');
  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop().trim();
      const m = out.match(/^(\d+)\.(\d+)/);
      return { bin, version: out, major: m ? Number(m[1]) : 0, minor: m ? Number(m[2]) : 0 };
    } catch {
      // not runnable, try the next one
    }
  }
  return null;
}

async function packItems(profileId, outDir, { variants }) {
  const golden = loadGolden();
  const items = await goldenItems(golden, { variants });
  removeDir(outDir);
  ensureDir(outDir);
  const entries = [];
  const skipped = [];
  for (const it of items) {
    const id = itemId(it.slug, it.variant);
    const { report } = await buildItem({ slug: it.slug, variant: it.variant, profileId });
    if (report.counts.error) {
      skipped.push({ id, reason: `${report.counts.error} validation error(s)` });
      continue;
    }
    fs.copyFileSync(previewGlb(it.slug, it.variant, profileId), path.join(outDir, `${id}.glb`));
    entries.push({ id, file: `${id}.glb`, rootNode: report.nodes.find((n) => n.parent === null)?.name || id, type: it.entry.type, style: it.entry.style, ...fingerprint(report) });
  }
  return { entries, skipped };
}

/** engines/godot/golden: godot-profile GLBs + manifest.json for verify_golden.gd and the gallery. */
export async function packGodot({ variants = true } = {}) {
  const dir = path.join(godotDir(), 'golden');
  const { entries, skipped } = await packItems('godot', dir, { variants });
  const items = entries.map((e) => ({ ...e, surfaces: e.meshNodes.reduce((s, m) => s + m.materials.length, 0) }));
  writeJson(path.join(dir, 'manifest.json'), {
    schema: 1,
    generatedAt: new Date().toISOString(),
    kit: KIT_VERSION,
    profile: 'godot',
    units: 'm',
    tolerance: { size: 0.002, sizeRel: 0.005, color: 0.012, factor: 0.01 },
    items,
  });
  return { dir: rel(dir), count: items.length, skipped };
}

function luaValue(v, indent = '') {
  const next = `${indent}\t`;
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return `{ ${v.map((x) => luaValue(x)).join(', ')} }`;
    return `{\n${v.map((x) => `${next}${luaValue(x, next)},`).join('\n')}\n${indent}}`;
  }
  return `{\n${Object.entries(v).map(([k, x]) => `${next}${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${JSON.stringify(k)}]`} = ${luaValue(x, next)},`).join('\n')}\n${indent}}`;
}

const cdata = (s) => `<![CDATA[${s.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

/** A minimal Roblox place: baseplate, an empty GoldenImports folder, the manifest and the verify script. */
function placeXml({ manifestLua, verifyLua }) {
  const ident = '<CoordinateFrame name="CFrame"><X>0</X><Y>-0.5</Y><Z>0</Z><R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>';
  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
	<External>null</External>
	<External>nil</External>
	<Item class="Workspace" referent="RBX0">
		<Properties>
			<string name="Name">Workspace</string>
		</Properties>
		<Item class="Part" referent="RBX1">
			<Properties>
				<string name="Name">Baseplate</string>
				<bool name="Anchored">true</bool>
				<bool name="Locked">true</bool>
				${ident}
				<Vector3 name="size"><X>512</X><Y>1</Y><Z>512</Z></Vector3>
				<Color3uint8 name="Color3uint8">${(0xff000000 + (99 << 16) + (102 << 8) + 107) >>> 0}</Color3uint8>
			</Properties>
		</Item>
		<Item class="Folder" referent="RBX2">
			<Properties>
				<string name="Name">GoldenImports</string>
			</Properties>
		</Item>
	</Item>
	<Item class="ServerScriptService" referent="RBX3">
		<Properties>
			<string name="Name">ServerScriptService</string>
		</Properties>
		<Item class="ModuleScript" referent="RBX4">
			<Properties>
				<string name="Name">GoldenManifest</string>
				<ProtectedString name="Source">${cdata(manifestLua)}</ProtectedString>
			</Properties>
		</Item>
		<Item class="Script" referent="RBX5">
			<Properties>
				<string name="Name">VerifyGolden</string>
				<ProtectedString name="Source">${cdata(verifyLua)}</ProtectedString>
			</Properties>
		</Item>
	</Item>
</roblox>
`;
}

/** engines/roblox: roblox-profile GLBs + GoldenManifest.lua + GoldenVerify.rbxlx. */
export async function packRoblox({ variants = false } = {}) {
  const dir = robloxDir();
  const goldenDir = path.join(dir, 'golden');
  const { entries, skipped } = await packItems('roblox', goldenDir, { variants });
  const items = entries.map((e) => ({
    id: e.id,
    name: e.id,
    rootNode: e.rootNode,
    file: e.file,
    title: e.title,
    sizeStuds: e.sizeUnits,
    sizeMeters: e.sizeMeters,
    meshParts: e.meshes,
    triangles: e.triangles,
    meshes: e.meshNodes.map((m) => ({ name: m.node, triangles: m.triangles })),
    textured: e.textures.length > 0,
  }));
  const manifestLua = `-- Generated by \`node studio engine-pack roblox\` (${new Date().toISOString()}). Do not edit.\n-- Expected values for the golden GLBs in engines/roblox/golden/ (Roblox profile, studs).\nreturn ${luaValue({ generatedAt: new Date().toISOString(), kit: KIT_VERSION, profile: 'roblox', units: 'stud', items })}\n`;
  fs.writeFileSync(path.join(dir, 'GoldenManifest.lua'), manifestLua);
  const verifyLua = fs.readFileSync(path.join(dir, 'VerifyGolden.lua'), 'utf8');
  fs.writeFileSync(path.join(dir, 'GoldenVerify.rbxlx'), placeXml({ manifestLua, verifyLua }));
  return { dir: rel(goldenDir), count: items.length, skipped, place: rel(path.join(dir, 'GoldenVerify.rbxlx')), manifest: rel(path.join(dir, 'GoldenManifest.lua')) };
}

function run(bin, args, { cwd, env, timeout = 600000, onLine = () => {} }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env } });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const take = (chunk) => {
      const s = chunk.toString();
      out += s;
      for (const line of s.split('\n')) if (line.trim()) onLine(line);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, out: String(err) });
    });
  });
}

/** Run verify_golden.gd headless. Returns the parsed report (or null) and the exit code. */
export async function verifyGodot(godot, { onLine } = {}) {
  const project = godotDir();
  const reportFile = path.join(project, 'verify', 'report.json');
  fs.rmSync(reportFile, { force: true });
  const res = await run(godot.bin, ['--headless', '--path', project, '--script', 'res://verify/verify_golden.gd'], { cwd: project, onLine });
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  return { code: res.code, report, output: res.out };
}

/**
 * Render every golden item in Godot from the studio's iso camera (needs a display: a desktop
 * session, or Xvfb on Linux). Writes engines/godot/verify/items/<id>.png.
 */
export async function captureGodot(godot, { onLine } = {}) {
  const project = godotDir();
  const outDir = path.join(project, 'verify', 'items');
  removeDir(outDir);
  const args = ['--path', project, '--resolution', '512x512', '--rendering-driver', 'opengl3', '--', '--capture-items=res://verify/items'];
  let bin = godot.bin;
  let finalArgs = args;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const xvfb = (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'xvfb-run')).find((p) => fs.existsSync(p));
    if (!xvfb) throw new Error('no display for Godot rendering: run in a desktop session or install Xvfb (xvfb-run)');
    bin = xvfb;
    finalArgs = ['-a', '-s', '-screen 0 1024x768x24', godot.bin, ...args];
  }
  const res = await run(bin, finalArgs, { cwd: project, onLine, env: { LIBGL_ALWAYS_SOFTWARE: process.env.LIBGL_ALWAYS_SOFTWARE || '1' } });
  const images = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort() : [];
  return { code: res.code, dir: outDir, images, output: res.out };
}
