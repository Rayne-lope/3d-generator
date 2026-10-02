// Publish to Roblox through Open Cloud: strict export → upload the model GLB (or a new version
// of it) → with skins, upload every SurfaceAppearance map as an Image asset and write an
// insertable .rbxmx with one premade SurfaceAppearance per MeshPart per skin + SkinSwitcher.
//
// Registry .studio/roblox/published.json remembers asset ids per item and per image hash, so
// publishing again only uploads what changed (models get new versions, images are reused).

import fs from 'node:fs';
import path from 'node:path';
import { paths, itemId, rel } from './paths.js';
import { exportItem, exportPaths } from './export.js';
import { writeSkinPack, skinSwitcherLua } from './skins.js';
import { readJson, writeJson, sha256, writeFileAtomic } from './fsutil.js';
import { loadAssetDef } from './load-asset.js';
import { creatorLabel } from './roblox-cloud.js';

export const registryFile = () => path.join(paths.state, 'roblox', 'published.json');

export function readRegistry() {
  return readJson(registryFile(), { schema: 1, items: {}, images: {} });
}

const MAP_PROPS = ['ColorMap', 'MetalnessMap', 'RoughnessMap', 'NormalMap'];
const xml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const cdata = (s) => `<![CDATA[${s.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

/**
 * Roblox XML model: Folder "<id> skins" with the SkinSwitcher ModuleScript and
 * Skins/<look>/<MeshPart> SurfaceAppearances pointing at uploaded Image assets.
 * @param {{id: string, looks: string[], surfaceAppearances: Record<string, Record<string, any>>, imageIds: Record<string, string>}} o
 *   imageIds maps a pack-relative PNG path to its asset id
 */
export function skinsRbxmx({ id, looks, surfaceAppearances, imageIds }) {
  let ref = 0;
  const next = () => `RBX${ref++}`;
  const lines = [];
  const open = (cls, name, indent) => lines.push(`${indent}<Item class="${cls}" referent="${next()}">`, `${indent}\t<Properties>`, `${indent}\t\t<string name="Name">${xml(name)}</string>`);
  lines.push('<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">');
  lines.push('\t<External>null</External>', '\t<External>nil</External>');
  open('Folder', `${id} skins`, '\t');
  lines.push('\t\t</Properties>');
  open('ModuleScript', 'SkinSwitcher', '\t\t');
  lines.push(`\t\t\t\t<ProtectedString name="Source">${cdata(skinSwitcherLua())}</ProtectedString>`, '\t\t\t</Properties>', '\t\t</Item>');
  open('Folder', 'Skins', '\t\t');
  lines.push('\t\t\t</Properties>');
  for (const look of looks) {
    open('Folder', look, '\t\t\t');
    lines.push('\t\t\t\t</Properties>');
    for (const [node, sa] of Object.entries(surfaceAppearances[look] || {})) {
      open('SurfaceAppearance', node, '\t\t\t\t');
      // AlphaMode: 0 = Overlay (opaque maps), 1 = Transparency (alpha cut-outs / blending).
      lines.push(`\t\t\t\t\t\t<token name="AlphaMode">${sa.alphaMode && sa.alphaMode !== 'OPAQUE' ? 1 : 0}</token>`);
      for (const prop of MAP_PROPS) {
        if (!sa[prop]) continue;
        const assetId = imageIds[sa[prop]];
        if (!assetId) throw new Error(`no uploaded image for ${sa[prop]}`);
        lines.push(`\t\t\t\t\t\t<Content name="${prop}"><url>rbxassetid://${assetId}</url></Content>`);
      }
      lines.push('\t\t\t\t\t</Properties>', '\t\t\t\t</Item>');
    }
    lines.push('\t\t\t</Item>');
  }
  lines.push('\t\t</Item>', '\t</Item>', '</roblox>', '');
  return lines.join('\n');
}

/**
 * Publish items (slug + optional variant) to Roblox.
 * @param {{items: {slug: string, variant: string|null}[], creator: object|null, client: any, dryRun?: boolean,
 *          skins?: boolean, force?: boolean, api?: any, log?: (line: string) => void}} o
 */
export async function publishRoblox({ items, creator, client, dryRun = false, skins = false, force = false, api = null, log = () => {} }) {
  const registry = readRegistry();
  const who = creator ? creatorLabel(creator) : null;
  const results = [];
  const seen = new Set();
  for (const it of items) {
    const id = itemId(it.slug, it.variant);
    if (seen.has(id)) continue;
    seen.add(id);
    const def = await loadAssetDef(it.slug);
    const result = { id, slug: it.slug, variant: it.variant || null, title: def.meta.title, creator: who, dryRun, model: null, skins: null, problems: [] };
    results.push(result);
    // 1. Strict export of the default look (and every skin).
    const base = await exportItem({ slug: it.slug, variant: it.variant, profileId: 'roblox', api, parity: !!api });
    if (base.blocked) {
      result.problems.push(`export blocked: ${base.reason}`);
      log(`✗ ${id}: export blocked (${base.reason})`);
      continue;
    }
    const glbFile = exportPaths(it.slug, it.variant, 'roblox').glb;
    const glb = new Uint8Array(fs.readFileSync(glbFile));
    const hash = sha256(glb);
    // 2. Model: create, new version, or skip when unchanged.
    const prev = registry.items[id];
    const sameOwner = prev && prev.creator === who;
    const action = sameOwner && prev.sha256 === hash && !force ? 'unchanged' : sameOwner ? 'update' : 'create';
    result.model = { action, file: rel(glbFile), bytes: glb.byteLength, sha256: hash, assetId: sameOwner ? prev.assetId : null };
    if (!dryRun && action !== 'unchanged') {
      const file = { bytes: glb, name: `${id}.glb`, contentType: 'model/gltf-binary' };
      const asset = action === 'update'
        ? await client.updateAsset({ assetId: prev.assetId, file })
        : await client.createAsset({ assetType: 'Model', displayName: def.meta.title, description: `${def.meta.prompt || def.meta.title}\n\nMade with AI 3D Asset Studio (${id}).`, creator, file });
      result.model.assetId = String(asset.assetId);
      result.model.revisionId = asset.revisionId || null;
      result.model.moderation = asset.moderationResult?.moderationState || null;
      registry.items[id] = { assetId: result.model.assetId, sha256: hash, creator: who, revisionId: result.model.revisionId, updatedAt: new Date().toISOString() };
      writeJson(registryFile(), registry);
    }
    log(`${action === 'unchanged' ? '=' : dryRun ? '~' : '✓'} ${id}: model ${dryRun ? `would ${action === 'unchanged' ? 'stay unchanged' : action}` : action}${result.model.assetId ? ` (asset ${result.model.assetId})` : ''}`);
    // 3. Skins: every look exported, maps uploaded once, rbxmx written.
    const skinNames = Object.keys(def.skins || {});
    if (!skins || !skinNames.length) continue;
    const blocked = [];
    for (const s of skinNames) {
      const r = await exportItem({ slug: it.slug, variant: it.variant, skin: s, profileId: 'roblox', api, parity: !!api });
      if (r.blocked) blocked.push(`${s}: ${r.reason}`);
    }
    if (blocked.length) {
      result.problems.push(`skins not published, export blocked: ${blocked.join('; ')}`);
      log(`✗ ${id}: skins skipped (${blocked.join('; ')})`);
      continue;
    }
    const pack = await writeSkinPack({ slug: it.slug, variant: it.variant, profileId: 'roblox', title: def.meta.title, skins: skinNames });
    const packDir = path.join(paths.root, pack.dir);
    const sa = pack.manifest.surfaceAppearances;
    const files = new Map();
    for (const look of pack.looks) for (const maps of Object.values(sa[look])) for (const prop of MAP_PROPS) if (maps[prop]) files.set(maps[prop], null);
    const imageIds = {};
    let created = 0;
    let reused = 0;
    const byHash = new Map();
    for (const relPath of files.keys()) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(packDir, relPath)));
      const h = sha256(bytes);
      const key = `${who || 'nobody'}:${h}`;
      const known = registry.images[key]?.assetId || byHash.get(h);
      if (known) {
        imageIds[relPath] = known;
        reused++;
        continue;
      }
      if (dryRun) {
        imageIds[relPath] = null;
        byHash.set(h, 'pending');
        created++;
        continue;
      }
      const name = `${id} ${relPath.replace(/\.png$/, '').replace(/[/_]/g, ' ')}`;
      const asset = await client.createAsset({ assetType: 'Image', displayName: name, description: `SurfaceAppearance map for ${id} (AI 3D Asset Studio).`, creator, file: { bytes, name: path.basename(relPath), contentType: 'image/png' } });
      imageIds[relPath] = String(asset.assetId);
      byHash.set(h, imageIds[relPath]);
      registry.images[key] = { assetId: imageIds[relPath], file: `${id}/${relPath}`, uploadedAt: new Date().toISOString() };
      writeJson(registryFile(), registry);
      created++;
      log(`  ✓ image ${relPath} → ${imageIds[relPath]}`);
    }
    result.skins = { looks: pack.looks, pack: pack.dir, images: { total: files.size, created, reused } };
    if (dryRun) {
      log(`~ ${id}: ${pack.looks.length} looks, ${files.size} maps (${created} would upload, ${reused} shared with another look or uploaded before)`);
      continue;
    }
    const rbxmx = path.join(paths.exports, 'roblox', `${id}.skins.rbxmx`);
    writeFileAtomic(rbxmx, skinsRbxmx({ id, looks: pack.looks, surfaceAppearances: sa, imageIds }));
    result.skins.rbxmx = rel(rbxmx);
    result.skins.imageIds = imageIds;
    log(`✓ ${id}: ${pack.looks.length} looks, ${files.size} maps (${created} uploaded, ${reused} shared or reused) → ${rel(rbxmx)}`);
  }
  for (const r of results) {
    if (r.dryRun || !r.model?.assetId) continue;
    const file = path.join(paths.exports, 'roblox', `${r.id}.publish.json`);
    writeJson(file, { schema: 1, publishedAt: new Date().toISOString(), ...r, insert: insertSteps(r) });
    r.file = rel(file);
  }
  return results;
}

/** How to bring a published item into Roblox Studio. */
export function insertSteps(r) {
  const steps = [];
  if (r.model?.assetId) {
    steps.push(`Model: Toolbox → Inventory → My Models → "${r.title}" (asset ${r.model.assetId}), or run in the Studio command bar: game:GetService("InsertService"):LoadAsset(${r.model.assetId}).Parent = workspace`);
  }
  if (r.skins?.rbxmx) {
    steps.push(`Skins: drag ${r.skins.rbxmx} into Studio (or Model → Insert from File / right-click → Insert from File), put the folder next to the model, then: require(folder.SkinSwitcher).apply(model, "${r.skins.looks[1] || 'default'}", folder.Skins)`);
    steps.push('New images go through moderation: until approved they render blank, so wait a few minutes before judging the skins.');
  }
  return steps;
}
