// Static lint of asset source files: things that break determinism, portability or the
// browser parity render, caught before they cause confusing results.

import fs from 'node:fs';
import { issue } from '../issues.js';

const RULES = [
  [/Math\.random\s*\(/, 'source.random', 'error', 'Math.random() makes builds non-reproducible', 'Use the seeded rng from build({ rng }) (rng.stream("name") per part).'],
  [/\b(Date\.now|performance\.now)\s*\(|new\s+Date\s*\(/, 'source.time', 'error', 'time-dependent code makes builds non-reproducible', 'Remove clocks from build(); use params or seeds.'],
  [/from\s+['"]node:|require\s*\(|\bprocess\./, 'source.node-api', 'error', 'asset code uses Node APIs', 'Asset code must run in the browser too (parity render). Use only the kit.'],
  [/\bfetch\s*\(|\bimport\s*\(/, 'source.dynamic-load', 'error', 'asset code loads files at runtime', 'Everything must be procedural inside build().'],
  [/\b(ShaderMaterial|RawShaderMaterial|MeshBasicMaterial|MeshLambertMaterial|MeshPhongMaterial|MeshToonMaterial|MeshPhysicalMaterial|MeshNormalMaterial)\b/, 'source.material', 'error', 'non-portable three.js material used', 'Use k.mat.pbr() / k.mat.physical() (glTF metallic-roughness).'],
  [/\bDoubleSide\b|\bBackSide\b/, 'source.side', 'error', 'double/back-sided rendering requested', 'Model thickness instead (see rules/05-topology-and-efficiency.md).'],
  [/scale\.(set\s*\(\s*-|[xyz]\s*=\s*-)/, 'source.negative-scale', 'warning', 'negative scale in source', 'Use k.op.mirror(geometry, axis) to mirror safely.'],
  [/new\s+THREE\.Mesh\s*\(/, 'source.raw-mesh', 'warning', 'THREE.Mesh created directly', 'Use k.mesh(geometry, material) so materials are checked early.'],
];

export function checkSource({ files }) {
  const out = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const [re, id, severity, message, hint] of RULES) {
      const lineNo = lines.findIndex((l) => re.test(l.replace(/\/\/.*$/, '')));
      if (lineNo >= 0) {
        const where = `${file.split(/[\\/]/).slice(-2).join('/')}:${lineNo + 1}`;
        out.push(issue(id, severity, `${message} (${where})`, { where, hint }));
      }
    }
  }
  return out;
}
