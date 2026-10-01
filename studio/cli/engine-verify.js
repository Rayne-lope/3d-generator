// node studio engine-verify godot [--no-pack] [--capture]

import fs from 'node:fs';
import path from 'node:path';
import { parse } from './args.js';
import { findGodot, packGodot, verifyGodot, captureGodot, godotDir } from '../core/engines.js';
import { withCapture } from '../core/render/capture.js';
import { readPNG, writePNG, dataUrlToBuffer, sideBySide, grid } from '../core/render/image.js';
import { rel } from '../core/paths.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio engine-verify godot [options]

Runs the golden set inside Godot 4.3+ (headless): every GLB is loaded with GLTFDocument and
compared with the studio's manifest (size, base, triangles, meshes, surfaces, pivots, material
colors/factors, texture slots, transparency, culling). Report: engines/godot/verify/report.json.

Godot is looked up as $GODOT_BIN, then godot / godot4 on PATH (macOS: /Applications/Godot.app).
Roblox Studio cannot be scripted from outside: see engines/roblox/CHECKLIST.md.

Options:
  --no-pack    use the existing engines/godot/golden files
  --capture    also render every item in Godot (needs a display or Xvfb) and write a
               side-by-side sheet: studio viewport | Godot (engines/godot/verify/compare.png)
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, { 'no-pack': { type: 'boolean', default: false }, capture: { type: 'boolean', default: false } }, USAGE);
  if (args[0] !== 'godot') throw new Error(args[0] === 'roblox' ? 'Roblox Studio has no headless mode. Run `node studio engine-pack roblox` and follow engines/roblox/CHECKLIST.md.' : USAGE);
  const godot = findGodot();
  if (!godot) {
    console.log(`${sym.warn} Godot not found. Install Godot 4.3+ and put it on PATH as 'godot', or set GODOT_BIN=/path/to/godot.`);
    console.log(c.gray('   https://godotengine.org/download — the standard (non-.NET) build is enough.'));
    return 2;
  }
  if (godot.major < 4 || (godot.major === 4 && godot.minor < 3)) console.log(`${sym.warn} Godot ${godot.version}: 4.3 or newer is recommended`);
  if (!opts['no-pack']) {
    const pack = await packGodot({ variants: true });
    if (!opts.json) console.log(`${sym.ok} packed ${pack.count} golden GLBs (Godot profile) → ${pack.dir}`);
  } else if (!fs.existsSync(path.join(godotDir(), 'golden', 'manifest.json'))) {
    throw new Error('no engines/godot/golden/manifest.json — run without --no-pack');
  }
  if (!opts.json) console.log(c.gray(`running ${godot.bin} (${godot.version}) headless…`));
  const res = await verifyGodot(godot, { onLine: opts.json ? undefined : (l) => (/^(PASS|FAIL)/.test(l) ? console.log(`  ${l.startsWith('PASS') ? sym.ok : sym.fail} ${l.slice(4).trim()}`) : null) });
  if (!res.report) {
    console.log(res.output.split('\n').slice(-30).join('\n'));
    throw new Error(`Godot did not write a report (exit code ${res.code})`);
  }
  let compare = null;
  if (opts.capture) compare = await captureAndCompare(godot, opts);
  if (opts.json) {
    console.log(JSON.stringify({ godot: godot.version, ...res.report, compare }, null, 2));
  } else {
    const r = res.report;
    console.log(`\n${r.failed ? sym.fail : sym.ok} Godot ${r.godotVersion}: ${r.passed}/${r.total} golden items imported without manual fixes (${Math.round((r.passed / r.total) * 100)}%)`);
    console.log(`report: ${c.cyan(rel(path.join(godotDir(), 'verify', 'report.json')))}`);
    if (compare) console.log(`side-by-side (studio | Godot): ${c.cyan(compare)}`);
  }
  return res.report.failed ? 1 : 0;
}

async function captureAndCompare(godot, opts) {
  const cap = await captureGodot(godot, { onLine: () => {} });
  if (!cap.images.length) {
    console.log(cap.output.split('\n').slice(-20).join('\n'));
    throw new Error(`Godot rendered no images (exit code ${cap.code})`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(godotDir(), 'golden', 'manifest.json'), 'utf8'));
  const pairs = [];
  await withCapture(async (api) => {
    for (const item of manifest.items) {
      const godotPng = path.join(cap.dir, `${item.id}.png`);
      if (!fs.existsSync(godotPng)) continue;
      const shot = await api.renderGLB({ url: `${api.url}files/engines/godot/golden/${item.file}`, views: ['iso'], size: 512 });
      pairs.push(sideBySide([readPNG(dataUrlToBuffer(shot.images.iso)), readPNG(godotPng)], { gap: 4 }));
    }
  });
  const file = path.join(godotDir(), 'verify', 'compare.png');
  writePNG(file, grid(pairs, 3, { gap: 12 }));
  if (!opts.json) console.log(`${sym.ok} rendered ${cap.images.length} items in Godot`);
  return rel(file);
}
