// Three.js scene → Intermediate Representation (IR).
//
// The IR is a plain, engine-neutral description of exactly what goes into the GLB:
// nodes (asset root, merged body, separate parts), non-indexed primitives per material,
// glTF metallic-roughness materials and raw RGBA textures. Profile transforms operate on
// the IR, then ir/to-gltf.js writes it. Anything that glTF (or our parity rules) cannot
// represent is rejected here with an actionable message.

import * as THREE from 'three';

const WRAP = {
  [THREE.RepeatWrapping]: 'REPEAT',
  [THREE.ClampToEdgeWrapping]: 'CLAMP_TO_EDGE',
  [THREE.MirroredRepeatWrapping]: 'MIRRORED_REPEAT',
};

export class ExportError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ExportError';
    this.hint = hint;
  }
}

function round(v, p = 1e6) {
  return Math.round(v * p) / p;
}

function textureEntry(tex, slot, textures, issues) {
  if (!tex) return null;
  const info = tex.userData?.studio;
  if (!info?.kitTexture) {
    throw new ExportError(`material uses a texture in '${slot}' that was not made with the kit painter`, 'Create textures with k.tex.create(...) so they can be baked into the GLB.');
  }
  const identity = tex.offset.x === 0 && tex.offset.y === 0 && tex.repeat.x === 1 && tex.repeat.y === 1 && tex.rotation === 0;
  if (!identity) {
    throw new ExportError(`texture '${info.name}' uses offset/repeat/rotation`, 'Texture transforms are not portable (Roblox ignores them). Scale UVs with k.uv.scale() instead.');
  }
  if (tex.channel && tex.channel !== 0) throw new ExportError(`texture '${info.name}' uses UV channel ${tex.channel}`, 'Only one UV set (channel 0) is portable.');
  if (textures.has(tex.uuid)) return textures.get(tex.uuid).id;
  const data = tex.image?.data;
  if (!(data instanceof Uint8Array) || data.length !== info.width * info.height * 4) {
    throw new ExportError(`texture '${info.name}' has no RGBA8 pixel data`);
  }
  const entry = {
    id: textures.size,
    name: info.name,
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
    space: info.space,
    layout: info.layout,
    tileable: info.tileable,
    wrapS: WRAP[tex.wrapS] || 'REPEAT',
    wrapT: WRAP[tex.wrapT] || 'REPEAT',
    filter: tex.magFilter === THREE.NearestFilter ? 'nearest' : 'linear',
    hasAO: !!info.hasAO,
    slots: new Set(),
  };
  textures.set(tex.uuid, entry);
  if (slot && issues) void issues;
  return entry.id;
}

function materialEntry(mat, materials, textures, issues) {
  if (Array.isArray(mat)) throw new ExportError('multi-material meshes are not supported', 'Split the geometry into one k.mesh() per material.');
  if (!mat?.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    throw new ExportError(`material '${mat?.name || mat?.type}' is a ${mat?.type}`, 'Only k.mat.pbr()/k.mat.physical() (glTF metallic-roughness) can be exported.');
  }
  if (mat.side !== THREE.FrontSide) {
    throw new ExportError(`material '${mat.name}' is double-sided`, 'Engines disagree on back faces; model thickness or duplicate faces with flipped normals instead.');
  }
  if (mat.vertexColors) throw new ExportError(`material '${mat.name}' uses vertex colors`, 'Vertex colors are not portable to every engine; use materials, textures or the palette.');
  if (mat.roughnessMap && mat.metalnessMap && mat.roughnessMap !== mat.metalnessMap) {
    throw new ExportError(`material '${mat.name}' has different roughness and metalness maps`, 'Pack them with k.tex.orm({ roughness, metalness }).');
  }
  const kitInfo = mat.userData?.studio || {};
  const alpha = kitInfo.alpha || (mat.transparent ? 'blend' : mat.alphaTest > 0 ? 'mask' : 'opaque');
  const emissiveIntensity = mat.emissiveIntensity ?? 1;
  const emissive = mat.emissive ? [mat.emissive.r, mat.emissive.g, mat.emissive.b] : [0, 0, 0];
  let emissiveFactor = emissive;
  let emissiveStrength = 1;
  if (emissiveIntensity <= 1) emissiveFactor = emissive.map((v) => v * emissiveIntensity);
  else emissiveStrength = emissiveIntensity;
  const desc = {
    name: mat.name || 'material',
    baseColor: [mat.color.r, mat.color.g, mat.color.b, alpha === 'blend' ? mat.opacity : 1].map((v) => round(v)),
    metallic: round(mat.metalness),
    roughness: round(mat.roughness),
    emissive: emissiveFactor.map((v) => round(Math.min(1, v))),
    emissiveStrength: round(emissiveStrength),
    alphaMode: alpha === 'blend' ? 'BLEND' : alpha === 'mask' ? 'MASK' : 'OPAQUE',
    alphaCutoff: alpha === 'mask' ? round(kitInfo.alphaCutoff ?? mat.alphaTest ?? 0.5) : 0.5,
    doubleSided: false,
    baseColorTexture: textureEntry(mat.map, 'baseColor', textures, issues),
    metallicRoughnessTexture: textureEntry(mat.roughnessMap || mat.metalnessMap, 'metallicRoughness', textures, issues),
    normalTexture: textureEntry(mat.normalMap, 'normal', textures, issues),
    normalScale: mat.normalMap ? round(Math.abs(mat.normalScale.x)) : 1,
    occlusionTexture: textureEntry(mat.aoMap, 'occlusion', textures, issues),
    occlusionStrength: mat.aoMap ? round(mat.aoMapIntensity) : 1,
    emissiveTexture: textureEntry(mat.emissiveMap, 'emissive', textures, issues),
  };
  const signature = JSON.stringify({ ...desc, name: undefined });
  if (materials.has(signature)) return materials.get(signature).id;
  const entry = { id: materials.size, ...desc };
  materials.set(signature, entry);
  return entry.id;
}

/**
 * @param {THREE.Object3D} root asset root returned by runAsset()
 * @param {{slug: string, variant?: string|null, meta?: object}} info
 */
export function sceneToIR(root, { slug, variant = null, meta = {} }) {
  root.updateMatrixWorld(true);
  const issues = [];
  const materials = new Map();
  const textures = new Map();
  const nodes = [];
  const names = new Set();
  const partTriangles = {};

  const uniqueName = (base) => {
    let name = base.replace(/[^A-Za-z0-9_-]/g, '_') || 'node';
    let i = 2;
    while (names.has(name)) name = `${base}_${i++}`;
    names.add(name);
    return name;
  };

  const makeNode = (name, parent, frame) => {
    const node = { id: nodes.length, name: uniqueName(name), parent, frame, frameInv: frame.clone().invert(), prims: new Map(), children: [] };
    nodes.push(node);
    if (parent !== null) nodes[parent].children.push(node.id);
    return node;
  };

  const rootNode = makeNode(slug, null, new THREE.Matrix4());
  const bodyNode = makeNode('body', rootNode.id, new THREE.Matrix4());

  const addGeometry = (node, geometry, material, world, partName) => {
    const matId = materialEntry(material, materials, textures, issues);
    const local = node.frameInv.clone().multiply(world);
    const det = local.determinant();
    if (Math.abs(det) < 1e-12) throw new ExportError(`a mesh in '${partName}' has zero scale`);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(local);
    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    if (!pos) throw new ExportError(`a mesh in '${partName}' has no positions`);
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) issues.push({ id: 'scene.extra-attribute', severity: 'info', message: `attribute '${name}' on '${partName}' is not exported`, where: partName });
    }
    const index = geometry.index ? geometry.index.array : null;
    const triCount = index ? index.length / 3 : pos.count / 3;
    if (!Number.isInteger(triCount)) throw new ExportError(`geometry in '${partName}' is not made of triangles`);
    let bucket = node.prims.get(matId);
    if (!bucket) {
      bucket = { positions: [], normals: [], uvs: [], hasUV: true };
      node.prims.set(matId, bucket);
    }
    if (!uv) bucket.hasUV = false;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const flip = det < 0;
    if (flip) issues.push({ id: 'scene.negative-scale', severity: 'warning', message: `negative scale baked into '${partName}' (winding fixed)`, where: partName, hint: 'Use k.op.mirror() instead of negative scale.' });
    for (let t = 0; t < triCount; t++) {
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        const vi = index ? index[t * 3 + k] : t * 3 + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(local);
        bucket.positions.push(v.x, v.y, v.z);
        if (nrm) {
          n.fromBufferAttribute(nrm, vi).applyMatrix3(normalMatrix).normalize();
          bucket.normals.push(n.x, n.y, n.z);
        } else {
          bucket.normals.push(0, 0, 0);
          bucket.missingNormals = true;
        }
        if (uv) bucket.uvs.push(uv.getX(vi), uv.getY(vi));
        else bucket.uvs.push(0, 0);
      }
    }
    partTriangles[partName] = (partTriangles[partName] || 0) + triCount;
  };

  const visit = (obj, owner, partOwner, partName) => {
    const role = obj.userData?.studio?.role;
    if (obj.isLight || obj.isCamera) {
      issues.push({ id: 'scene.removed-object', severity: 'warning', message: `${obj.type} '${obj.name}' removed (lights and cameras are not exported)`, where: obj.name });
      return;
    }
    if (obj.isPoints || obj.isLine || obj.isSprite) {
      throw new ExportError(`${obj.type} '${obj.name}' cannot be exported`, 'Only triangle meshes are portable. Model thin features as geometry (tubes, boxes).');
    }
    if (obj.isSkinnedMesh) throw new ExportError(`skinned mesh '${obj.name}'`, 'Rigging and animation are out of scope for V1.');
    if (!obj.visible) {
      issues.push({ id: 'scene.hidden-object', severity: 'warning', message: `hidden object '${obj.name}' skipped`, where: obj.name, hint: 'Remove it instead of hiding it; the viewport only shows what is exported.' });
      return;
    }
    let nextOwner = owner;
    let nextPartOwner = partOwner;
    let nextPart = partName;
    if (role === 'part') {
      nextPart = obj.name;
      if (obj.userData.studio.separate) {
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        obj.matrixWorld.decompose(pos, quat, scl);
        const frame = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
        const node = makeNode(obj.name, partOwner.id, frame);
        nextOwner = node;
        nextPartOwner = node;
      }
    }
    if (obj.isInstancedMesh) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, m);
        addGeometry(nextOwner, obj.geometry, obj.material, obj.matrixWorld.clone().multiply(m), nextPart);
      }
      issues.push({ id: 'scene.instances-flattened', severity: 'info', message: `${obj.count} instances of '${obj.name}' flattened into geometry`, where: nextPart });
    } else if (obj.isMesh) {
      addGeometry(nextOwner, obj.geometry, obj.material, obj.matrixWorld, nextPart);
    }
    for (const child of obj.children) visit(child, nextOwner, nextPartOwner, nextPart);
  };

  for (const child of root.children) visit(child, bodyNode, rootNode, 'body');

  // Build final node list (drop an empty body), compute local TRS relative to parent frames.
  const outNodes = [];
  const idMap = new Map();
  for (const node of nodes) {
    if (node === bodyNode && node.prims.size === 0) continue;
    idMap.set(node.id, outNodes.length);
    outNodes.push(node);
  }
  const irNodes = outNodes.map((node) => {
    const parent = node.parent === null ? null : nodes[node.parent];
    const localFrame = parent ? parent.frameInv.clone().multiply(node.frame) : node.frame.clone();
    const t = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    localFrame.decompose(t, q, s);
    const primitives = [...node.prims.entries()].map(([material, b]) => ({
      material,
      positions: new Float32Array(b.positions),
      normals: new Float32Array(b.normals),
      uvs: new Float32Array(b.uvs),
      hasUV: b.hasUV,
      missingNormals: !!b.missingNormals,
    }));
    return {
      name: node.name,
      parent: node.parent === null ? null : idMap.get(node.parent === bodyNode.id ? rootNode.id : node.parent),
      translation: [round(t.x), round(t.y), round(t.z)],
      rotation: [round(q.x), round(q.y), round(q.z), round(q.w)],
      scale: [1, 1, 1],
      primitives,
    };
  });

  const matList = [...materials.values()].sort((a, b) => a.id - b.id);
  const texList = [...textures.values()].sort((a, b) => a.id - b.id);
  for (const m of matList) {
    for (const [slot, key] of [['baseColor', 'baseColorTexture'], ['metallicRoughness', 'metallicRoughnessTexture'], ['normal', 'normalTexture'], ['occlusion', 'occlusionTexture'], ['emissive', 'emissiveTexture']]) {
      if (m[key] !== null) texList[m[key]].slots.add(slot);
    }
  }
  for (const t of texList) t.slots = [...t.slots];

  return {
    asset: { slug, variant, title: meta.title || slug, category: meta.category || 'prop', origin: meta.origin || 'base-center', budget: meta.budget || null, style: meta.style || [] },
    units: { name: 'm', metersPerUnit: 1 },
    nodes: irNodes,
    materials: matList,
    textures: texList,
    stats: { partTriangles },
    issues,
    notes: [],
  };
}
