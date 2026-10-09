// node studio scene <new|list|library|validate|build|review|export|save|history|restore> ...

import { parse } from './args.js';
import { resolveProfiles } from '../profiles/index.js';
import { loadConfig } from '../core/config.js';
import { c, sym, table } from '../core/log.js';
import { rel } from '../core/paths.js';
import { notifyServer } from './notify.js';
import { createScene, listScenes, readScene, parseRoomSize, sceneExists, SceneError } from '../scene/schema.js';
import { composeScene, formatSceneReport } from '../scene/compose.js';
import { exportScene } from '../scene/export.js';
import { libraryEntries } from '../scene/library.js';
import { listSceneVersions, restoreSceneVersion, saveSceneVersion, sceneWorkingState } from '../scene/snapshots.js';
import { sceneFile } from '../scene/paths.js';

const USAGE = `Usage: node studio scene <command> [options]

Scenes are rooms assembled from library assets: scenes/<name>/scene.json holds a room spec
(width x depth x height, door/window openings, finishes) and a list of placed assets
(position in meters, yaw in degrees). Assets are placed at their real size, never scaled.

Commands:
  new <name> [--room 6x4x3|none] [--title t] [--prompt p]   create scenes/<name>/scene.json
  list                                                     scenes and their size
  library [--set s] [--category c] [--looks]               assets you can place, with real sizes
  validate <name> [--profile p]                            check without writing files
  build <name> [--profile p|all] [--force] [--strict]      compose the preview GLB + report
  review <name> [--profile p]                              build + render a contact sheet (plan, iso, eye level)
  export <name> --profile <p|all>                          strict export to exports/<profile>/scenes/
  save <name> -m "<what changed>"                          save a version of scene.json
  history <name>                                           list saved versions
  restore <name> <vNNN>                                    restore a version (unsaved work is auto-saved)

Options:
  --json         machine-readable output
  --verbose, -v  show info messages and hints`;

function requireName(args) {
  const name = args[1];
  if (!name) throw new Error(`pass a scene name\n\n${USAGE}`);
  if (!sceneExists(name)) throw new Error(`unknown scene '${name}' (scenes: ${listScenes().join(', ') || 'none'}). Create one with: node studio scene new ${name}`);
  return name;
}

const fmtSize = (m) => (m ? m.map((v) => v.toFixed(2)).join(' × ') : '—');

export async function run(argv) {
  const { args, opts } = parse(argv, {
    room: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    set: { type: 'string' },
    category: { type: 'string' },
    looks: { type: 'boolean', default: false },
    profile: { type: 'string' },
    force: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    message: { type: 'string', short: 'm' },
  }, USAGE);
  const command = args[0];
  const config = loadConfig();
  try {
    if (!command) {
      console.log(USAGE);
      return 2;
    }
    if (command === 'new') {
      const name = args[1];
      if (!name) throw new Error(`pass a scene name\n\n${USAGE}`);
      const room = opts.room === undefined ? undefined : parseRoomSize(opts.room);
      const created = createScene(name, { title: opts.title, prompt: opts.prompt || '', room });
      await notifyServer({ type: 'scene-changed', name, revision: created.revision });
      if (opts.json) console.log(JSON.stringify({ name, file: rel(sceneFile(name)), revision: created.revision, scene: created.scene }, null, 2));
      else console.log(`${sym.ok} created ${c.bold(rel(sceneFile(name)))}${created.scene.room ? ` (room ${created.scene.room.width} × ${created.scene.room.depth} × ${created.scene.room.height} m)` : ' (no room shell)'}\nNext: node studio scene library  ·  edit the file or open the Scenes tab in node studio dev`);
      return 0;
    }
    if (command === 'list') {
      const rows = listScenes().map((name) => {
        try {
          const { scene } = readScene(name);
          return { name, title: scene.title, room: scene.room ? [scene.room.width, scene.room.depth, scene.room.height] : null, instances: scene.instances.length };
        } catch (err) {
          return { name, error: err.message };
        }
      });
      if (opts.json) console.log(JSON.stringify({ scenes: rows }, null, 2));
      else if (!rows.length) console.log('No scenes yet. Create one with: node studio scene new <name> --room 6x4x3');
      else console.log(table(rows.map((r) => [r.name, r.error ? c.red('invalid') : r.title, r.room ? `${fmtSize(r.room)} m` : 'no room', r.error ? r.error : `${r.instances} instance(s)`]), { header: ['Scene', 'Title', 'Room', 'Content'] }));
      return 0;
    }
    if (command === 'library') {
      const entries = await libraryEntries({ set: opts.set || null, category: opts.category || null, looks: opts.looks });
      if (opts.json) {
        console.log(JSON.stringify({ assets: entries.map(({ thumb, glbHash, ...rest }) => rest) }, null, 2));
        return 0;
      }
      const rows = entries.map((e) => [e.slug, e.set || '', e.category, e.size ? fmtSize(e.size.meters) : c.yellow('not built'), e.size ? e.size.triangles.toLocaleString('en-US') : '', [...e.variants.map((v) => `--${v}`), ...e.skins.map((s) => `@${s}`)].join(' ')]);
      console.log(table(rows, { header: ['Asset', 'Set', 'Category', 'W × H × D (m)', 'Tris', 'Variants / skins'] }));
      const unbuilt = entries.filter((e) => !e.built).length;
      if (unbuilt) console.log(c.gray(`\n${unbuilt} asset(s) have no preview yet: node studio build <slug> gives them a size.`));
      return 0;
    }
    if (command === 'validate' || command === 'build') {
      const name = requireName(args);
      const profiles = resolveProfiles(opts.profile, config.defaultProfile);
      const results = [];
      let errors = 0;
      for (const profileId of profiles) {
        const { report, cached } = await composeScene({ name, profileId, write: command === 'build', force: opts.force });
        errors += report.counts.error;
        results.push({ name, profile: profileId, ok: report.ok, counts: report.counts, file: report.file?.path || null, cached, report: opts.json ? report : undefined });
        if (!opts.json) console.log(formatSceneReport(report, { verbose: opts.verbose }) + (cached ? c.gray('  (cached)') : ''));
      }
      if (command === 'build') await notifyServer({ type: 'scene-built', name, profiles });
      if (opts.json) console.log(JSON.stringify({ results }, null, 2));
      else if (errors) console.log(c.yellow(`\n${errors} error(s) would block 'scene export'.`));
      return (opts.strict || command === 'validate') && errors ? 1 : 0;
    }
    if (command === 'review') {
      const name = requireName(args);
      const { reviewScene } = await import('../scene/review.js');
      const profileId = resolveProfiles(opts.profile, config.defaultProfile)[0];
      const result = await reviewScene({ name, profileId });
      await notifyServer({ type: 'scene-built', name, profiles: [profileId] });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(formatSceneReport(result.report, { verbose: opts.verbose }));
        console.log(`\nReview sheet: ${c.bold(result.sheet)}\nOpen it and check the layout: walkways, furniture against walls, nothing blocking the door.`);
      }
      return result.report.counts.error ? 1 : 0;
    }
    if (command === 'export') {
      const name = requireName(args);
      if (!opts.profile) throw new Error('pass --profile <generic|godot|roblox|all>');
      const results = [];
      let blocked = 0;
      for (const profileId of resolveProfiles(opts.profile, config.defaultProfile)) {
        const r = await exportScene({ name, profileId });
        results.push({ name, profile: profileId, blocked: r.blocked, reason: r.reason || null, files: r.files || null, errors: r.errors || [] });
        if (r.blocked) {
          blocked++;
          if (!opts.json) console.log(`${sym.fail} ${c.bold(name)} ${c.gray(`[${profileId}]`)} export blocked: ${r.reason}\n${(r.errors || []).map((e) => `  ${e.id}: ${e.message}`).join('\n')}`);
        } else if (!opts.json) console.log(`${sym.ok} ${c.bold(name)} ${c.gray(`[${profileId}]`)} ${sym.arrow} ${r.files.glb}\n  report ${r.files.md} · layout ${r.files.layout}`);
      }
      if (opts.json) console.log(JSON.stringify({ results }, null, 2));
      return blocked ? 1 : 0;
    }
    if (command === 'save') {
      const name = requireName(args);
      if (!opts.message) throw new Error('pass -m "<what changed>"');
      const saved = saveSceneVersion(name, { note: opts.message, force: opts.force });
      if (opts.json) console.log(JSON.stringify(saved, null, 2));
      else console.log(saved.skipped ? `${sym.info} ${saved.reason}` : `${sym.ok} saved ${c.bold(saved.version.id)} of scene ${name}: ${saved.version.note}`);
      return 0;
    }
    if (command === 'history') {
      const name = requireName(args);
      const versions = listSceneVersions(name);
      const state = sceneWorkingState(name);
      if (opts.json) console.log(JSON.stringify({ versions, ...state }, null, 2));
      else if (!versions.length) console.log('No saved versions yet: node studio scene save <name> -m "<what changed>"');
      else {
        console.log(table(versions.map((v) => [v.id + (v.id === state.current ? ' ←' : ''), new Date(v.createdAt).toLocaleString(), `${v.instances} inst`, (v.auto ? '(auto) ' : '') + v.note]), { header: ['Version', 'Saved', 'Content', 'Note'] }));
        if (state.dirty) console.log(c.yellow('\nThe working copy has unsaved changes.'));
      }
      return 0;
    }
    if (command === 'restore') {
      const name = requireName(args);
      if (!args[2] || !/^v\d+$/.test(args[2])) throw new Error('pass a version id, e.g. v003 (see: node studio scene history <name>)');
      const result = restoreSceneVersion(name, args[2]);
      await notifyServer({ type: 'scene-changed', name, revision: result.revision });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`${sym.ok} restored ${c.bold(result.restored)} of scene ${name}${result.autosaved ? ` (unsaved work kept as ${result.autosaved})` : ''}`);
      return 0;
    }
    throw new Error(`unknown scene command '${command}'\n\n${USAGE}`);
  } catch (err) {
    if (opts.json && err instanceof SceneError) {
      console.log(JSON.stringify({ error: err.message, code: err.code, field: err.field }, null, 2));
      return 1;
    }
    throw err;
  }
}
