// Rendering setup shared by the live viewport and the headless capture page, so what the
// agent reviews is exactly what the user sees. Everything here is a viewing aid: none of it
// is part of the exported GLB.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const BACKGROUND = '#4b5057';

/** Camera directions (unit vectors from the target toward the camera). Front = +Z. */
export const VIEWS = {
  front: { dir: [0, 0, 1], up: [0, 1, 0], label: 'Front' },
  back: { dir: [0, 0, -1], up: [0, 1, 0], label: 'Back' },
  left: { dir: [-1, 0, 0], up: [0, 1, 0], label: 'Left' },
  right: { dir: [1, 0, 0], up: [0, 1, 0], label: 'Right' },
  top: { dir: [0, 1, 0], up: [0, 0, -1], label: 'Top' },
  iso: { dir: [0.62, 0.48, 0.62], up: [0, 1, 0], label: 'Iso' },
  'iso-back': { dir: [-0.62, 0.48, -0.62], up: [0, 1, 0], label: 'Iso back' },
  'iso-wire': { dir: [0.62, 0.48, 0.62], up: [0, 1, 0], label: 'Wireframe' },
  low: { dir: [0.7, 0.12, 0.7], up: [0, 1, 0], label: 'Low' },
};

export function createRenderer(canvas, { preserveDrawingBuffer = false, antialias = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, preserveDrawingBuffer, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(BACKGROUND, 1);
  return renderer;
}

/** Plain gray gradient environment (light above, darker below): engine-like ambient, no HDRI tricks. */
function neutralEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const colors = [];
  const pos = geo.attributes.position;
  const top = new THREE.Color('#d9dde3');
  const horizon = new THREE.Color('#9a9ea5');
  const bottom = new THREE.Color('#4a4743');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 10;
    const c = t > 0 ? horizon.clone().lerp(top, t) : horizon.clone().lerp(bottom, -t);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  return tex;
}

const envCache = new WeakMap();
const roomCache = new WeakMap();

/**
 * Lighting rigs.
 * neutral  — gray gradient ambient + one key + one fill, no tone mapping, no shadows.
 *            Close to an engine's default sky/ambient, and the parity reference: if it
 *            looks right here, it is the asset, not the lighting.
 * showcase — room environment reflections + filmic tone mapping + soft shadow. Pretty,
 *            but not a parity reference.
 */
export function applyLighting(renderer, scene, mode = 'neutral', { size = 1 } = {}) {
  const old = scene.getObjectByName('__lights');
  if (old) scene.remove(old);
  const rig = new THREE.Group();
  rig.name = '__lights';
  if (mode === 'showcase') {
    if (!roomCache.has(renderer)) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      roomCache.set(renderer, pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
      pmrem.dispose();
    }
    scene.environment = roomCache.get(renderer);
    scene.environmentIntensity = 1;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4).multiplyScalar(size);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = size * 2;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.01, far: size * 20 });
    key.shadow.bias = -0.0005;
    rig.add(key);
    renderer.shadowMap.enabled = true;
  } else {
    // PMREM generation is slow on software WebGL: build it once per renderer, not per scene.
    if (!envCache.has(renderer)) envCache.set(renderer, neutralEnvironment(renderer));
    scene.environment = envCache.get(renderer);
    scene.environmentIntensity = 0.85;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = false;
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(0.55, 1, 0.75);
    rig.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.45);
    fill.position.set(-0.8, 0.35, -0.6);
    rig.add(fill);
  }
  scene.add(rig);
  return rig;
}

/** Bounding box of renderable meshes only (helpers excluded). */
export function contentBox(root) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh && !o.userData.__helper) box.expandByObject(o, true);
  });
  return box;
}

/** Place the camera to fit `box` from a named view (tight fit of the projected box corners). */
export function frameCamera(camera, box, viewName = 'iso', { fit = 1.08, target = null } = {}) {
  const view = VIEWS[viewName] || VIEWS.iso;
  const center = target || box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(...view.dir).normalize();
  const up = new THREE.Vector3(...view.up);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const trueUp = new THREE.Vector3().crossVectors(dir, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanH = tanV * camera.aspect;
  let dist = 1e-3;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    const depth = corner.dot(dir);
    dist = Math.max(dist, depth + Math.abs(corner.dot(right)) / tanH, depth + Math.abs(corner.dot(trueUp)) / tanV);
  }
  dist *= fit;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.up.copy(trueUp);
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  camera.near = Math.max((dist - radius * 1.5) * 0.5, dist / 1000, 1e-4);
  camera.far = dist + radius * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  return { center, dist };
}

/** Engines cull back faces; the viewport must too, so missing faces are visible here. */
export function forceSingleSided(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.side = THREE.FrontSide;
  });
}

export function makeGrid(unitsPerMeter, extentMeters = 20) {
  const grid = new THREE.GridHelper(extentMeters * unitsPerMeter, extentMeters, 0x8a9099, 0x5f656d);
  grid.name = '__grid';
  grid.userData.__helper = true;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  grid.position.y = -0.0005 * unitsPerMeter;
  return grid;
}

/** Simple 1.75 m mannequin (scale reference). */
export function makeHuman(unitsPerMeter) {
  const g = new THREE.Group();
  g.name = '__human';
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa7b8, roughness: 0.8 });
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.__helper = true;
    g.add(m);
  };
  add(new THREE.CapsuleGeometry(0.06, 0.72, 4, 8), -0.1, 0.42, 0); // legs
  add(new THREE.CapsuleGeometry(0.06, 0.72, 4, 8), 0.1, 0.42, 0);
  add(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), 0, 1.13, 0); // torso
  add(new THREE.CapsuleGeometry(0.045, 0.6, 4, 8), -0.24, 1.08, 0); // arms
  add(new THREE.CapsuleGeometry(0.045, 0.6, 4, 8), 0.24, 1.08, 0);
  add(new THREE.SphereGeometry(0.11, 16, 12), 0, 1.62, 0); // head
  g.scale.setScalar(unitsPerMeter);
  g.userData.__helper = true;
  return g;
}

function labelSprite(text, scale) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 44px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.width = w;
  canvas.height = 64;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(20,22,26,0.82)';
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set((w / 64) * scale, scale, 1);
  sprite.renderOrder = 10;
  sprite.userData.__helper = true;
  return sprite;
}

/** Bounding box outline with width/height/depth labels in meters (and studs). */
export function makeDimensions(box, unitsPerMeter, { studs = false } = {}) {
  const g = new THREE.Group();
  g.name = '__dims';
  g.userData.__helper = true;
  const helper = new THREE.Box3Helper(box, 0xffc857);
  helper.userData.__helper = true;
  g.add(helper);
  const size = box.getSize(new THREE.Vector3());
  const fmt = (v) => {
    const m = v / unitsPerMeter;
    const metric = m < 1 ? `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm` : `${m.toFixed(2)} m`;
    return studs ? `${metric} · ${(m / 0.28).toFixed(1)} st` : metric;
  };
  const s = Math.max(size.x, size.y, size.z) * 0.06;
  const x = labelSprite(fmt(size.x), s);
  x.position.set((box.min.x + box.max.x) / 2, box.min.y, box.max.z + s);
  const y = labelSprite(fmt(size.y), s);
  y.position.set(box.max.x + s * 1.5, (box.min.y + box.max.y) / 2, box.max.z);
  const z = labelSprite(fmt(size.z), s);
  z.position.set(box.max.x + s, box.min.y, (box.min.z + box.max.z) / 2);
  g.add(x, y, z);
  return g;
}

function checkerTexture(cells = 8, size = 512, colors = ['#e8e8e8', '#3a3f47']) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cs = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? colors[1] : colors[0];
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }
  ctx.fillStyle = '#e4572e';
  ctx.fillRect(0, 0, cs / 2, cs / 2);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

/**
 * Debug view modes. 'shaded' restores the file's own materials.
 * 'normals' | 'uv' (checker over UV 0..1) | 'density' (16-texel checker at each texture's real resolution).
 */
export function setViewMode(root, mode) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.__helper) return;
    if (!o.userData.__orig) o.userData.__orig = o.material;
    const orig = o.userData.__orig;
    if (mode === 'shaded') {
      o.material = orig;
    } else if (mode === 'normals') {
      o.material = new THREE.MeshNormalMaterial();
    } else if (mode === 'uv') {
      o.material = new THREE.MeshBasicMaterial({ map: checkerTexture(8) });
    } else if (mode === 'density') {
      const ref = orig.map || orig.normalMap || orig.emissiveMap;
      if (!ref || ref.name?.startsWith('palette') || !ref.image) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x777777 });
      } else {
        const w = ref.image.width || 256;
        o.material = new THREE.MeshBasicMaterial({ map: checkerTexture(Math.max(2, Math.round(w / 16)), 1024, ['#f0f0f0', '#2f343b']) });
      }
    }
  });
}

/** Wireframe overlay and back-face highlight (red shows where faces are missing/inverted). */
export function setOverlays(root, { wire = false, backfaces = false } = {}) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.__helper) return;
    for (const key of ['__wire', '__back']) {
      if (o.userData[key]) {
        o.remove(o.userData[key]);
        o.userData[key].geometry.dispose?.();
        o.userData[key] = null;
      }
    }
    if (wire) {
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), new THREE.LineBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.45 }));
      w.userData.__helper = true;
      o.add(w);
      o.userData.__wire = w;
    }
    if (backfaces) {
      const b = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: 0xff2d55, side: THREE.BackSide }));
      b.userData.__helper = true;
      o.add(b);
      o.userData.__back = b;
    }
  });
}

/** Units of a loaded studio GLB: file units per meter (1 for meters, 3.57 for studs). */
export function unitsPerMeter(gltf) {
  const u = gltf?.asset?.extras?.studio?.units;
  if (u && u.metersPerUnit) return 1 / u.metersPerUnit;
  return 1;
}
