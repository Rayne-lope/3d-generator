// IR → glTF 2.0 binary (GLB) via glTF-Transform.
// Output is deterministic (no timestamps), lossless (PNG textures, float attributes,
// no Draco/meshopt/quantization) and uses only core glTF features plus
// KHR_materials_emissive_strength when a profile allows emissive strength > 1.

import { Document, NodeIO, PropertyType } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { weld, dedup, prune } from '@gltf-transform/functions';
import { generateTangents } from 'mikktspace';
import { PNG } from 'pngjs';

const FILTER = { linear: { mag: 9729, min: 9987 }, nearest: { mag: 9728, min: 9984 } };
const WRAP = { REPEAT: 10497, CLAMP_TO_EDGE: 33071, MIRRORED_REPEAT: 33648 };

export function encodePNG(width, height, rgba) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const png = new PNG({ width, height, colorType: opaque ? 2 : 6, inputColorType: 6, inputHasAlpha: true });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return new Uint8Array(PNG.sync.write(png, { colorType: opaque ? 2 : 6, inputColorType: 6, inputHasAlpha: true, deflateLevel: 6 }));
}

export function createIO() {
  return new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]);
}

/**
 * @param {any} ir
 * @param {{profileId: string, allowEmissiveStrength?: boolean, keepMaterialNames?: boolean, extras?: object}} opts
 *   keepMaterialNames: never merge materials with different names (assets with skins).
 * @returns {Promise<{glb: Uint8Array, document: Document}>}
 */
export async function irToGLB(ir, { profileId, allowEmissiveStrength = true, keepMaterialNames = false, extras = {} } = {}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'AI 3D Asset Studio';
  doc.getRoot().getAsset().extras = {
    studio: { asset: ir.asset.slug, variant: ir.asset.variant || null, ...(ir.asset.skin ? { skin: ir.asset.skin } : {}), profile: profileId, units: ir.units, ...extras },
  };
  const buffer = doc.createBuffer();

  const texObjs = ir.textures.map((t) => doc.createTexture(t.name).setImage(encodePNG(t.width, t.height, t.data)).setMimeType('image/png'));
  let emissiveExt = null;

  const setInfo = (info, t) => {
    if (!info) return;
    const f = FILTER[t.filter] || FILTER.linear;
    info.setMagFilter(f.mag).setMinFilter(f.min).setWrapS(WRAP[t.wrapS] || WRAP.REPEAT).setWrapT(WRAP[t.wrapT] || WRAP.REPEAT);
  };

  const matObjs = ir.materials.map((m) => {
    const mat = doc.createMaterial(m.name)
      .setBaseColorFactor(m.baseColor)
      .setMetallicFactor(m.metallic)
      .setRoughnessFactor(m.roughness)
      .setEmissiveFactor(m.emissive)
      .setAlphaMode(m.alphaMode)
      .setDoubleSided(false);
    if (m.alphaMode === 'MASK') mat.setAlphaCutoff(m.alphaCutoff);
    if (m.baseColorTexture !== null) {
      mat.setBaseColorTexture(texObjs[m.baseColorTexture]);
      setInfo(mat.getBaseColorTextureInfo(), ir.textures[m.baseColorTexture]);
    }
    if (m.metallicRoughnessTexture !== null) {
      mat.setMetallicRoughnessTexture(texObjs[m.metallicRoughnessTexture]);
      setInfo(mat.getMetallicRoughnessTextureInfo(), ir.textures[m.metallicRoughnessTexture]);
    }
    if (m.normalTexture !== null) {
      mat.setNormalTexture(texObjs[m.normalTexture]).setNormalScale(m.normalScale);
      setInfo(mat.getNormalTextureInfo(), ir.textures[m.normalTexture]);
    }
    if (m.occlusionTexture !== null) {
      mat.setOcclusionTexture(texObjs[m.occlusionTexture]).setOcclusionStrength(m.occlusionStrength);
      setInfo(mat.getOcclusionTextureInfo(), ir.textures[m.occlusionTexture]);
    }
    if (m.emissiveTexture !== null) {
      mat.setEmissiveTexture(texObjs[m.emissiveTexture]);
      setInfo(mat.getEmissiveTextureInfo(), ir.textures[m.emissiveTexture]);
    }
    if (m.emissiveStrength > 1 && allowEmissiveStrength) {
      emissiveExt = emissiveExt || doc.createExtension(KHRMaterialsEmissiveStrength);
      mat.setExtension('KHR_materials_emissive_strength', emissiveExt.createEmissiveStrength().setEmissiveStrength(m.emissiveStrength));
    }
    return mat;
  });

  const scene = doc.createScene(ir.asset.slug);
  const nodeObjs = ir.nodes.map((n) => {
    const node = doc.createNode(n.name).setTranslation(n.translation).setRotation(n.rotation).setScale(n.scale);
    if (n.primitives.length) {
      const mesh = doc.createMesh(n.name);
      for (const p of n.primitives) {
        const prim = doc.createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.positions).setBuffer(buffer))
          .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(p.normals).setBuffer(buffer))
          .setMaterial(matObjs[p.material]);
        const mat = ir.materials[p.material];
        const textured = mat.baseColorTexture !== null || mat.metallicRoughnessTexture !== null || mat.normalTexture !== null || mat.occlusionTexture !== null || mat.emissiveTexture !== null;
        if (p.hasUV || textured) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.uvs).setBuffer(buffer));
        if (mat.normalTexture !== null) {
          const tangents = generateTangents(p.positions, p.normals, p.uvs);
          for (let i = 3; i < tangents.length; i += 4) tangents[i] *= -1;
          prim.setAttribute('TANGENT', doc.createAccessor().setType('VEC4').setArray(tangents).setBuffer(buffer));
        }
        mesh.addPrimitive(prim);
      }
      node.setMesh(mesh);
    }
    return node;
  });
  ir.nodes.forEach((n, i) => {
    if (n.parent === null) scene.addChild(nodeObjs[i]);
    else nodeObjs[n.parent].addChild(nodeObjs[i]);
  });
  doc.getRoot().setDefaultScene(scene);

  // keepSolidTextures: solid-color textures carry baked colors for engines that ignore factors (Roblox).
  const dedupSteps = keepMaterialNames
    ? [dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }), dedup({ propertyTypes: [PropertyType.MATERIAL], keepUniqueNames: true })]
    : [dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MATERIAL, PropertyType.TEXTURE] })];
  await doc.transform(weld(), ...dedupSteps, prune({ keepLeaves: true, keepAttributes: true, keepExtras: true, keepSolidTextures: true }));
  const glb = await createIO().writeBinary(doc);
  return { glb, document: doc };
}
