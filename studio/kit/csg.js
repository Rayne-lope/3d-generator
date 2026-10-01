// Boolean operations (three-bvh-csg). Great for hard-surface cutouts (holes, slots,
// window recesses). Results can contain thin slivers: keep cutters simple and check the
// review sheet. For wall openings prefer k.arch.wall({ openings }) — it is cleaner.

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg/src/index.js';
import { ensureAttributes, nonIndexed } from './ops.js';

function quietly(fn) {
  const warn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('maxLeafSize')) return;
    warn(...args);
  };
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

function toBrush(input) {
  let geometry;
  let matrix = null;
  if (input?.isMesh) {
    geometry = input.geometry;
    input.updateMatrix();
    matrix = input.matrix;
  } else if (input?.isBufferGeometry) {
    geometry = input;
  } else {
    throw new Error('k.csg: inputs must be geometries or meshes');
  }
  const src = ensureAttributes(nonIndexed(geometry.clone()));
  const clean = new THREE.BufferGeometry();
  clean.setAttribute('position', src.attributes.position);
  clean.setAttribute('normal', src.attributes.normal);
  clean.setAttribute('uv', src.attributes.uv);
  const brush = new Brush(clean);
  if (matrix) brush.applyMatrix4(matrix);
  brush.updateMatrixWorld(true);
  return brush;
}

function run(op, a, cutters) {
  return quietly(() => {
    const evaluator = new Evaluator();
    evaluator.useGroups = false;
    evaluator.attributes = ['position', 'uv', 'normal'];
    let current = toBrush(a);
    for (const c of cutters.flat()) {
      const result = evaluator.evaluate(current, toBrush(c), op);
      result.updateMatrixWorld(true);
      current = result;
    }
    const g = nonIndexed(current.geometry);
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position.clone());
    out.setAttribute('normal', g.attributes.normal.clone());
    out.setAttribute('uv', g.attributes.uv.clone());
    out.userData = { shading: (a.isMesh ? a.geometry : a).userData?.shading || { mode: 'flat', angle: 0 } };
    return out;
  });
}

/** a minus every cutter. Inputs are geometries (or meshes, whose transform is applied). */
export function subtract(a, ...cutters) {
  return run(SUBTRACTION, a, cutters);
}

export function union(a, ...others) {
  return run(ADDITION, a, others);
}

export function intersect(a, ...others) {
  return run(INTERSECTION, a, others);
}
