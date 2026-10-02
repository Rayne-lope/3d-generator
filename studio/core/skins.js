// Skin packs: everything an engine needs to swap skins on one model.
//
//   exports/<profile>/<item>.skins/skins.json     looks, meshes, materials and the files of their maps
//   exports/<profile>/<item>.skins/<look>/*.png   the exact maps inside each look's exported GLB
//   roblox  + <look>/<material>_color|metalness|roughness|normal.png (SurfaceAppearance maps)
//           + SkinSwitcher.lua (swaps premade SurfaceAppearances by parenting)
//   generic + exports/generic/<item>.skins.glb    one GLB with every look (KHR_materials_variants)
//
// Every look is a strict export of its own (exports/<profile>/<item>@<skin>.glb). The skin
// lock guarantees that all looks share nodes, triangles and UVs, so only materials differ.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength, KHRMaterialsVariants } from '@gltf-transform/extensions';
import { copyToDocument, dedup, prune } from '@gltf-transform/functions';
import { paths, itemId, rel } from './paths.js';
import { exportPaths } from './export.js';
import { ensureDir, removeDir, sha256, writeFileAtomic, writeJson } from './fsutil.js';
import { decodePNG } from './inspect.js';
import { encodePNG } from './ir/to-gltf.js';
import { runKhronos } from './validate/index.js';

export const DEFAULT_LOOK = 'default';
export const lookName = (skin) => skin || DEFAULT_LOOK;

const SLOTS = [
  ['baseColor', 'getBaseColorTexture'],
  ['metallicRoughness', 'getMetallicRoughnessTexture'],
  ['normal', 'getNormalTexture'],
  ['occlusion', 'getOcclusionTexture'],
  ['emissive', 'getEmissiveTexture'],
];

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

export function skinPackDir(slug, variant, profileId) {
  return path.join(paths.exports, profileId, `${itemId(slug, variant)}.skins`);
}

export function variantsGlbPath(slug, variant) {
  return path.join(paths.exports, 'generic', `${itemId(slug, variant)}.skins.glb`);
}

function createSkinIO() {
  return new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength, KHRMaterialsVariants]);
}

/** Mesh primitives in scene order (node tree depth first), with the node that holds them. */
function listPrimitives(doc) {
  const out = [];
  const visit = (node) => {
    const mesh = node.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) out.push({ node: node.getName(), prim });
    for (const child of node.listChildren()) visit(child);
  };
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  for (const n of scene.listChildren()) visit(n);
  return out;
}

async function readLook(file) {
  const doc = await createSkinIO().readBinary(new Uint8Array(fs.readFileSync(file)));
  const prims = listPrimitives(doc);
  const meshes = [];
  for (const { node, prim } of prims) {
    let m = meshes.find((x) => x.node === node);
    if (!m) meshes.push((m = { node, materials: [] }));
    m.materials.push(prim.getMaterial()?.getName() || null);
  }
  const materials = doc.getRoot().listMaterials().map((m) => ({
    name: m.getName(),
    alphaMode: m.getAlphaMode(),
    emissive: m.getEmissiveFactor().some((v) => v > 0),
    maps: Object.fromEntries(SLOTS.map(([slot, getter]) => [slot, m[getter]()]).filter(([, t]) => t)),
  }));
  return { doc, prims, meshes, materials };
}

/** Grayscale PNG from one channel of an RGBA PNG (Roblox wants separate metalness/roughness maps). */
function channelPNG(png, channel) {
  const { width, height, data } = decodePNG(png);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const v = data[i + channel];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return encodePNG(width, height, out);
}

/**
 * Write the skin pack of one item for one profile. Every look must already be exported.
 * @param {{slug: string, variant?: string|null, profileId: string, title?: string, skins: string[]}} opts
 */
export async function writeSkinPack({ slug, variant = null, profileId, title = slug, skins }) {
  const dir = skinPackDir(slug, variant, profileId);
  removeDir(dir);
  ensureDir(dir);
  const looks = [null, ...skins].map((skin) => ({ skin, name: lookName(skin), file: exportPaths(slug, variant, profileId, skin).glb }));
  for (const l of looks) if (!fs.existsSync(l.file)) throw new Error(`skin pack: ${rel(l.file)} is missing (export every look first)`);
  const roblox = profileId === 'roblox';
  const manifest = {
    schema: 1,
    asset: slug,
    variant: variant || null,
    title,
    profile: profileId,
    looks: looks.map((l) => l.name),
    meshes: null,
    looksData: {},
    notes: [],
  };
  const written = [];
  const write = (relPath, bytes) => {
    writeFileAtomic(path.join(dir, relPath), bytes);
    written.push(relPath);
    return relPath;
  };
  for (const look of looks) {
    const data = await readLook(look.file);
    if (!manifest.meshes) manifest.meshes = data.meshes;
    const entry = { glb: path.relative(dir, look.file).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(look.file)), materials: {} };
    for (const m of data.materials) {
      if (roblox) {
        // SurfaceAppearance maps only: color, separate metalness/roughness, normal.
        const sa = {};
        if (m.maps.baseColor) sa.ColorMap = write(`${look.name}/${safe(m.name)}_color.png`, m.maps.baseColor.getImage());
        if (m.maps.metallicRoughness) {
          sa.MetalnessMap = write(`${look.name}/${safe(m.name)}_metalness.png`, channelPNG(m.maps.metallicRoughness.getImage(), 2));
          sa.RoughnessMap = write(`${look.name}/${safe(m.name)}_roughness.png`, channelPNG(m.maps.metallicRoughness.getImage(), 1));
        }
        if (m.maps.normal) sa.NormalMap = write(`${look.name}/${safe(m.name)}_normal.png`, m.maps.normal.getImage());
        entry.materials[m.name] = { alphaMode: m.alphaMode, surfaceAppearance: sa };
        if (m.emissive && !manifest.notes.some((n) => n.includes('emissive'))) manifest.notes.push(`material '${m.name}' is emissive: SurfaceAppearance has no emissive map, so the glow stays only in the imported mesh's default look`);
      } else {
        const maps = {};
        for (const [slot, tex] of Object.entries(m.maps)) maps[slot] = write(`${look.name}/${safe(m.name)}_${slot}.png`, tex.getImage());
        entry.materials[m.name] = { alphaMode: m.alphaMode, maps };
      }
    }
    manifest.looksData[look.name] = entry;
  }
  if (roblox) {
    // One SurfaceAppearance per MeshPart (Roblox meshes have exactly one material).
    manifest.surfaceAppearances = Object.fromEntries(looks.map((look) => [look.name, Object.fromEntries(manifest.meshes.map((m) => {
      const mat = manifest.looksData[look.name].materials[m.materials[0]];
      return [m.node, { material: m.materials[0], alphaMode: mat?.alphaMode || 'OPAQUE', ...(mat?.surfaceAppearance || {}) }];
    }))]));
    fs.writeFileSync(path.join(dir, 'SkinSwitcher.lua'), skinSwitcherLua());
    written.push('SkinSwitcher.lua');
  }
  let variantsGlb = null;
  if (profileId === 'generic') {
    const out = variantsGlbPath(slug, variant);
    const glb = await buildVariantsGlb(looks);
    const khronos = await runKhronos(glb);
    const errors = khronos.issues.filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(`KHR_materials_variants GLB failed the glTF validator: ${errors[0].message}`);
    writeFileAtomic(out, glb);
    variantsGlb = { file: path.relative(dir, out).split(path.sep).join('/'), bytes: glb.byteLength, khronos: khronos.summary };
    manifest.variantsGlb = variantsGlb;
  }
  fs.writeFileSync(path.join(dir, 'README.md'), packReadme({ slug, variant, profileId, title, looks: manifest.looks, roblox, variantsGlb }));
  writeJson(path.join(dir, 'skins.json'), manifest);
  return { dir: rel(dir), looks: manifest.looks, files: written.length + 2, variantsGlb: variantsGlb ? rel(variantsGlbPath(slug, variant)) : null, manifest };
}

/**
 * One GLB holding every look: the default look's materials stay on the primitives and each
 * skin's materials are added with a KHR_materials_variants mapping (Blender, three.js,
 * Babylon.js and model-viewer can switch them).
 * @param {{name: string, file: string}[]} looks the default look first
 */
export async function buildVariantsGlb(looks) {
  const io = createSkinIO();
  const doc = await io.readBinary(new Uint8Array(fs.readFileSync(looks[0].file)));
  const ext = doc.createExtension(KHRMaterialsVariants);
  const basePrims = listPrimitives(doc);
  const variants = looks.map((l) => ext.createVariant(l.name));
  const lists = basePrims.map(({ prim }) => {
    const list = ext.createMappingList();
    list.addMapping(ext.createMapping().setMaterial(prim.getMaterial()).addVariant(variants[0]));
    prim.setExtension('KHR_materials_variants', list);
    return list;
  });
  for (let li = 1; li < looks.length; li++) {
    const src = await io.readBinary(new Uint8Array(fs.readFileSync(looks[li].file)));
    const prims = listPrimitives(src);
    if (prims.length !== basePrims.length || prims.some((p, i) => p.node !== basePrims[i].node)) {
      throw new Error(`look '${looks[li].name}' does not have the same meshes as '${looks[0].name}' (skin lock)`);
    }
    for (const e of src.getRoot().listExtensionsUsed()) doc.createExtension(e.constructor);
    const mats = src.getRoot().listMaterials();
    const map = copyToDocument(doc, src, mats);
    for (const m of mats) map.get(m).setName(`${m.getName()}@${looks[li].name}`);
    prims.forEach(({ prim }, i) => lists[i].addMapping(ext.createMapping().setMaterial(map.get(prim.getMaterial())).addVariant(variants[li])));
  }
  const asset = doc.getRoot().getAsset();
  const extras = asset.extras || {};
  asset.extras = { ...extras, studio: { ...(extras.studio || {}), skin: undefined, looks: looks.map((l) => l.name), variants: 'KHR_materials_variants' } };
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.TEXTURE] }),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true, keepSolidTextures: true }),
  );
  return io.writeBinary(doc);
}

/** Luau ModuleScript that swaps premade SurfaceAppearances (their textures are not scriptable). */
export function skinSwitcherLua() {
  return `-- SkinSwitcher (generated by AI 3D Asset Studio)
--
-- Roblox cannot change SurfaceAppearance textures from scripts, so every skin is a set of
-- premade SurfaceAppearances, one per MeshPart, named after the MeshPart:
--
--   Skins (Folder)
--     default (Folder) -> SurfaceAppearance "body", SurfaceAppearance "magazine", ...
--     desert  (Folder) -> ...
--
-- 'node studio publish <asset> --roblox --skins' uploads the maps and writes that folder as
-- exports/roblox/<asset>.skins.rbxmx. Without publishing, build it by hand from the PNGs in
-- this pack (skins.json lists which map goes into which property).
--
-- Usage:
--   local SkinSwitcher = require(path.to.SkinSwitcher)
--   SkinSwitcher.apply(workspace.MyRifle, "desert", path.to.Skins)
--   print(SkinSwitcher.list(path.to.Skins))

local SkinSwitcher = {}

local function findSkins(model, skins)
	local found = skins or model:FindFirstChild("Skins") or (script.Parent and script.Parent:FindFirstChild("Skins"))
	assert(found, "SkinSwitcher: no Skins folder (pass it as the third argument)")
	return found
end

-- Names of the available skins, sorted.
function SkinSwitcher.list(skins)
	local names = {}
	for _, child in ipairs(skins:GetChildren()) do
		table.insert(names, child.Name)
	end
	table.sort(names)
	return names
end

-- Put the SurfaceAppearances of skin \`name\` on every matching MeshPart of \`model\`.
-- Returns how many MeshParts changed.
function SkinSwitcher.apply(model, name, skins)
	local folder = findSkins(model, skins):FindFirstChild(name)
	assert(folder, "SkinSwitcher: unknown skin '" .. name .. "'")
	local changed = 0
	for _, part in ipairs(model:GetDescendants()) do
		if part:IsA("MeshPart") then
			local premade = folder:FindFirstChild(part.Name)
			if premade and premade:IsA("SurfaceAppearance") then
				local old = part:FindFirstChildOfClass("SurfaceAppearance")
				if old then
					old:Destroy()
				end
				premade:Clone().Parent = part
				changed = changed + 1
			end
		end
	end
	model:SetAttribute("Skin", name)
	return changed
end

return SkinSwitcher
`;
}

function packReadme({ slug, variant, profileId, title, looks, roblox, variantsGlb }) {
  const id = itemId(slug, variant);
  const lines = [
    `# ${title} — skin pack (${profileId})`,
    '',
    `Looks: ${looks.map((l) => `\`${l}\``).join(', ')}. Every look has the same mesh (checked at export), so only the materials change.`,
    '',
    `- Per-look GLBs: \`../${id}.glb\` (default) and \`../${id}@<skin>.glb\`.`,
    '- `skins.json` lists every look, its materials and the PNG of each map (the exact images inside the GLBs).',
  ];
  if (roblox) {
    lines.push(
      '',
      '## Roblox',
      '',
      '1. Import or publish the default GLB once (`node studio publish ' + id + ' --roblox --skins` does it through Open Cloud).',
      '2. Each skin is a set of SurfaceAppearances, one per MeshPart, named after the MeshPart (`surfaceAppearances` in skins.json: ColorMap, MetalnessMap, RoughnessMap, NormalMap).',
      '   `publish --skins` uploads the PNGs and writes `exports/roblox/' + id + '.skins.rbxmx` with those SurfaceAppearances ready to insert.',
      '3. `SkinSwitcher.lua` (a ModuleScript) swaps them at runtime: `SkinSwitcher.apply(model, "desert", skinsFolder)`.',
    );
  } else if (profileId === 'godot') {
    lines.push(
      '',
      '## Godot',
      '',
      '- Import the per-look GLBs, or keep one model and set `surface_material_override` on its MeshInstance3D to a material that uses this look\'s PNGs.',
    );
  } else {
    lines.push(
      '',
      '## glTF viewers and engines',
      '',
      `- \`../${id}.skins.glb\` holds every look in one file (KHR_materials_variants${variantsGlb ? ', passes the Khronos glTF validator' : ''}). Blender, three.js, Babylon.js and <model-viewer> can switch variants.`,
      '- Unity/Unreal: import the per-look GLBs or build materials from the PNGs.',
    );
  }
  lines.push('');
  return lines.join('\n');
}
