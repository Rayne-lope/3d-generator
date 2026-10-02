// Read a GLB back and describe exactly what is inside it. Reports and validation always
// look at the written file (never at the source scene): Preview = Export.

import crypto from 'node:crypto';
import * as THREE from 'three';
import { PNG } from 'pngjs';
import { createIO } from './ir/to-gltf.js';

export function decodePNG(bytes) {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
}

const WRAP_NAME = { 10497: 'REPEAT', 33071: 'CLAMP_TO_EDGE', 33648: 'MIRRORED_REPEAT' };

const hashOf = (...parts) => {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(typeof p === 'string' ? p : Buffer.from(p.buffer, p.byteOffset, p.byteLength));
  return h.digest('hex').slice(0, 16);
};

/**
 * Geometry fingerprint: per mesh, hashes of positions + indices, normals and UVs (and the
 * material slot each primitive uses), plus one hash over the node tree. Two builds with the
 * same fingerprint have the same mesh, so their textures can be swapped (skins).
 */
function geometryFingerprint(nodes, meshes) {
  const list = meshes.map((m) => {
    const pos = hashOf(...m.primitives.flatMap((p) => [`m${p.material}|`, p.positions, p.indices]));
    const nrm = hashOf(...m.primitives.map((p) => p.normals || new Float32Array(0)));
    const uv = hashOf(...m.primitives.map((p) => p.uvs || new Float32Array(0)));
    return { node: m.node, triangles: m.triangles, pos, nrm, uv, hash: hashOf(pos, nrm, uv) };
  });
  const tree = nodes.map((n) => `${n.name}|${n.parent}|${n.translation.join(',')}|${n.rotation.join(',')}|${n.scale.join(',')}`).join(';');
  return { hash: hashOf(tree, ...list.map((m) => m.hash)), meshes: list };
}

function texInfo(material, getter, infoGetter, texIndex) {
  const tex = material[getter]();
  if (!tex) return null;
  const info = material[infoGetter]();
  return {
    texture: texIndex.get(tex),
    texCoord: info ? info.getTexCoord() : 0,
    wrapS: info ? WRAP_NAME[info.getWrapS()] || 'REPEAT' : 'REPEAT',
    wrapT: info ? WRAP_NAME[info.getWrapT()] || 'REPEAT' : 'REPEAT',
  };
}

/**
 * @param {Uint8Array} glb
 */
export async function inspectGLB(glb) {
  const doc = await createIO().readBinary(glb);
  const root = doc.getRoot();
  const extras = root.getAsset().extras || {};
  const texList = root.listTextures();
  const texIndex = new Map(texList.map((t, i) => [t, i]));
  const textures = texList.map((t, i) => {
    const size = t.getSize() || [0, 0];
    return { index: i, name: t.getName(), width: size[0], height: size[1], mime: t.getMimeType(), bytes: t.getImage()?.byteLength || 0, slots: [], _tex: t, _pixels: null };
  });
  const materials = root.listMaterials().map((m, i) => {
    const strengthExt = m.getExtension('KHR_materials_emissive_strength');
    const mat = {
      index: i,
      name: m.getName(),
      baseColor: m.getBaseColorFactor(),
      metallic: m.getMetallicFactor(),
      roughness: m.getRoughnessFactor(),
      emissive: m.getEmissiveFactor(),
      emissiveStrength: strengthExt ? strengthExt.getEmissiveStrength() : 1,
      alphaMode: m.getAlphaMode(),
      alphaCutoff: m.getAlphaCutoff(),
      doubleSided: m.getDoubleSided(),
      normalScale: m.getNormalScale(),
      occlusionStrength: m.getOcclusionStrength(),
      maps: {
        baseColor: texInfo(m, 'getBaseColorTexture', 'getBaseColorTextureInfo', texIndex),
        metallicRoughness: texInfo(m, 'getMetallicRoughnessTexture', 'getMetallicRoughnessTextureInfo', texIndex),
        normal: texInfo(m, 'getNormalTexture', 'getNormalTextureInfo', texIndex),
        occlusion: texInfo(m, 'getOcclusionTexture', 'getOcclusionTextureInfo', texIndex),
        emissive: texInfo(m, 'getEmissiveTexture', 'getEmissiveTextureInfo', texIndex),
      },
    };
    for (const [slot, ref] of Object.entries(mat.maps)) if (ref) textures[ref.texture].slots.push(slot);
    return mat;
  });
  const matIndex = new Map(root.listMaterials().map((m, i) => [m, i]));

  const nodes = [];
  const meshes = [];
  const bbox = new THREE.Box3();
  let triangles = 0;
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const visit = (node, parentIndex) => {
    const index = nodes.length;
    const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    nodes.push({ index, name: node.getName(), parent: parentIndex, translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(), hasMesh: !!node.getMesh() });
    const mesh = node.getMesh();
    if (mesh) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
      const prims = [];
      let meshTris = 0;
      for (const prim of mesh.listPrimitives()) {
        const posAcc = prim.getAttribute('POSITION');
        const nrmAcc = prim.getAttribute('NORMAL');
        const uvAcc = prim.getAttribute('TEXCOORD_0');
        const count = posAcc.getCount();
        const positions = new Float32Array(count * 3);
        const normals = nrmAcc ? new Float32Array(count * 3) : null;
        const v = new THREE.Vector3();
        const el = [0, 0, 0];
        for (let i = 0; i < count; i++) {
          posAcc.getElement(i, el);
          v.set(el[0], el[1], el[2]).applyMatrix4(world);
          positions[i * 3] = v.x;
          positions[i * 3 + 1] = v.y;
          positions[i * 3 + 2] = v.z;
          bbox.expandByPoint(v);
          if (nrmAcc) {
            nrmAcc.getElement(i, el);
            v.set(el[0], el[1], el[2]).applyMatrix3(normalMatrix);
            normals[i * 3] = v.x;
            normals[i * 3 + 1] = v.y;
            normals[i * 3 + 2] = v.z;
          }
        }
        const idxAcc = prim.getIndices();
        const indices = idxAcc ? Uint32Array.from(idxAcc.getArray()) : Uint32Array.from({ length: count }, (_, i) => i);
        const tris = indices.length / 3;
        meshTris += tris;
        prims.push({
          material: prim.getMaterial() ? matIndex.get(prim.getMaterial()) : null,
          positions,
          normals,
          uvs: uvAcc ? Float32Array.from(uvAcc.getArray()) : null,
          hasTangents: !!prim.getAttribute('TANGENT'),
          attributes: prim.listSemantics(),
          indices,
          triangles: tris,
          mode: prim.getMode(),
        });
      }
      triangles += meshTris;
      meshes.push({ node: node.getName(), nodeIndex: index, mesh: mesh.getName(), primitives: prims, triangles: meshTris, worldDeterminant: world.determinant() });
    }
    for (const child of node.listChildren()) visit(child, index);
  };
  for (const n of scene.listChildren()) visit(n, null);

  return {
    doc,
    extras,
    generator: root.getAsset().generator,
    textures,
    materials,
    nodes,
    meshes,
    geometry: geometryFingerprint(nodes, meshes),
    triangles,
    bbox: bbox.isEmpty() ? { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] } : { min: bbox.min.toArray(), max: bbox.max.toArray(), size: bbox.getSize(new THREE.Vector3()).toArray() },
    /** Decoded RGBA pixels of a texture (cached). */
    pixels(i) {
      const t = textures[i];
      if (!t._pixels) t._pixels = decodePNG(t._tex.getImage());
      return t._pixels;
    },
  };
}
