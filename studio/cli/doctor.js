// node studio doctor — check that this machine can run the studio.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { parse } from './args.js';
import { paths } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { listProfiles, loadProfile } from '../profiles/index.js';
import { listAssets, listSets } from '../core/targets.js';
import { loadAssetDef } from '../core/load-asset.js';
import { findGodot } from '../core/engines.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio doctor [--json]

Checks Node, dependencies, the headless browser (WebGL renders for reviews, parity and golden
tests), folders, profiles, assets and the optional engine tools. Exit code 1 if something
required is missing.`;

const DEPS = ['three', 'three-bvh-csg/src/index.js', '@gltf-transform/core', '@gltf-transform/functions', 'gltf-validator', 'meshoptimizer', 'mikktspace', 'pngjs', 'pixelmatch', 'playwright'];

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function run(argv) {
  const { opts } = parse(argv, {}, USAGE);
  const checks = [];
  const add = (level, name, detail, fix = '') => checks.push({ level, name, detail, fix });

  // Node
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 20 || (maj === 20 && min >= 11)) add('ok', 'Node.js', `v${process.versions.node}`);
  else add('fail', 'Node.js', `v${process.versions.node}`, 'Install Node.js 20.11 or newer (22 LTS recommended).');

  // Dependencies
  const missing = [];
  for (const dep of DEPS) {
    try {
      await import(dep);
    } catch {
      missing.push(dep.split('/src/')[0]);
    }
  }
  if (missing.length) add('fail', 'npm dependencies', `missing: ${missing.join(', ')}`, "Run 'npm install' in the repo.");
  else add('ok', 'npm dependencies', `${DEPS.length} packages`);

  // Config + profiles
  try {
    const config = loadConfig();
    add('ok', 'studio.config.json', `default profile ${config.defaultProfile}, history keeps ${config.history.keep}`);
  } catch (err) {
    add('fail', 'studio.config.json', err.message, 'Fix the JSON syntax.');
  }
  try {
    const ids = listProfiles();
    for (const id of ids) loadProfile(id);
    add('ok', 'engine profiles', ids.join(', '));
  } catch (err) {
    add('fail', 'engine profiles', err.message);
  }

  // Folders
  for (const [name, dir] of [['state folder (.studio)', paths.state], ['exports folder', paths.exports]]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.doctor-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe);
      add('ok', name, path.relative(paths.root, dir) || dir);
    } catch (err) {
      add('fail', name, err.message, 'Check folder permissions.');
    }
  }

  // Assets
  const assets = listAssets();
  const broken = [];
  for (const slug of assets) {
    try {
      await loadAssetDef(slug);
    } catch (err) {
      broken.push(`${slug} (${err.message.split('\n')[0]})`);
    }
  }
  if (broken.length) add('warn', 'assets', `${broken.length} of ${assets.length} fail to load: ${broken.join('; ')}`, 'Run node studio build <slug> to see the error.');
  else add('ok', 'assets', `${assets.length} assets, ${listSets().length} set(s)`);

  // Headless browser + WebGL
  if (!missing.includes('playwright')) {
    try {
      const { withCapture } = await import('../core/render/capture.js');
      const info = await withCapture(async (api) => {
        const gl = await api.webglInfo();
        let rendered = null;
        if (assets.length && !broken.includes(assets[0])) {
          const { buildItem } = await import('../core/build.js');
          await buildItem({ slug: assets[0], profileId: 'generic' });
          const shot = await api.renderGLB({ url: `${api.url}files/preview/${assets[0]}/generic.glb`, views: ['iso'], size: 96 });
          rendered = shot.images.iso.length > 1000;
        }
        return { ...gl, rendered };
      });
      const soft = /swiftshader/i.test(info.renderer);
      add('ok', 'headless Chromium + WebGL', `${info.webgl2 ? 'WebGL2' : 'WebGL1'} · ${info.renderer} · max texture ${info.maxTextureSize}${info.rendered === null ? '' : info.rendered ? ' · test render OK' : ' · test render EMPTY'}`);
      if (!soft) add('warn', 'deterministic renderer', 'not SwiftShader: renders may differ from the committed golden baselines', 'Use the Chromium installed by "npx playwright install chromium".');
      if (info.rendered === false) add('fail', 'test render', 'the test render came back empty');
    } catch (err) {
      add('fail', 'headless Chromium + WebGL', err.message.split('\n')[0], 'Run: npx playwright install chromium   (Linux: npx playwright install --with-deps chromium)');
    }
  }

  // Dev server
  const config = loadConfig();
  const port = (() => {
    try {
      return JSON.parse(fs.readFileSync(paths.serverInfo, 'utf8')).port;
    } catch {
      return config.server.port;
    }
  })();
  add('info', 'viewport server', (await ping(port)) ? `running on http://127.0.0.1:${port}` : `not running (start: node studio dev → http://127.0.0.1:${config.server.port})`);

  // Engines
  const godot = findGodot();
  if (godot) add(godot.major === 4 && godot.minor >= 3 ? 'ok' : 'warn', 'Godot (optional)', `${godot.version} · ${godot.bin}`, godot.major === 4 && godot.minor >= 3 ? '' : 'Godot 4.3+ is recommended for engine-verify.');
  else add('info', 'Godot (optional)', 'not found: engine-verify godot will be skipped', 'Install Godot 4.3+ and add it to PATH as "godot", or set GODOT_BIN.');
  add('info', 'Roblox Studio (optional)', 'manual check: node studio engine-pack roblox, then engines/roblox/CHECKLIST.md');

  // Golden baselines
  const base = path.join(paths.golden, 'baselines');
  const count = fs.existsSync(base) ? fs.readdirSync(base).reduce((s, p) => s + fs.readdirSync(path.join(base, p)).length, 0) : 0;
  add(count ? 'ok' : 'warn', 'golden baselines', count ? `${count} baseline images` : 'none', count ? '' : 'Run: node studio golden --update-baselines');

  if (opts.json) {
    console.log(JSON.stringify({ ok: !checks.some((x) => x.level === 'fail'), checks }, null, 2));
  } else {
    const icon = { ok: sym.ok, warn: sym.warn, fail: sym.fail, info: sym.info };
    for (const x of checks) {
      console.log(`${icon[x.level]} ${c.bold(x.name)}: ${x.detail}`);
      if (x.fix && x.level !== 'ok') console.log(c.gray(`    → ${x.fix}`));
    }
    const fails = checks.filter((x) => x.level === 'fail').length;
    console.log(fails ? c.red(`\n${fails} problem(s) to fix.`) : c.green('\nAll required checks passed.'));
  }
  return checks.some((x) => x.level === 'fail') ? 1 : 0;
}
