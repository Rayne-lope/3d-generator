// Preflight validation of a written GLB: Khronos glTF-Validator + studio checks.
// Errors block `export`; warnings are reported everywhere (CLI, report, viewport).

import validator from 'gltf-validator';
import { checkScene } from './checks/scene.js';
import { checkGeometry } from './checks/geometry.js';
import { checkTexturesAndUVs } from './checks/texture-uv.js';
import { checkMaterials } from './checks/material.js';
import { checkSource } from './checks/source.js';
import { issue, sortIssues, countIssues } from './issues.js';

const KHRONOS_SEVERITY = ['error', 'warning', 'info', 'info'];
// Informational codes that are expected for studio output.
const KHRONOS_IGNORE = new Set(['NODE_EMPTY', 'UNUSED_OBJECT']);

export async function runKhronos(glb) {
  const report = await validator.validateBytes(glb, { maxIssues: 300, format: 'glb' });
  const issues = [];
  for (const m of report.issues.messages) {
    if (KHRONOS_IGNORE.has(m.code)) continue;
    issues.push(issue(`khronos.${m.code}`, KHRONOS_SEVERITY[m.severity] || 'info', `glTF validator: ${m.message}${m.pointer ? ` (${m.pointer})` : ''}`));
  }
  return {
    issues,
    summary: { validatorVersion: report.validatorVersion, errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos, hints: report.issues.numHints },
  };
}

/**
 * @param {{glb: Uint8Array, info: any, ir: any, profile: any, meta: any, sourceFiles: string[]}} ctx
 */
export async function validate({ glb, info, ir, profile, meta, sourceFiles = [] }) {
  const khronos = await runKhronos(glb);
  const tex = checkTexturesAndUVs({ info, profile });
  const all = [
    ...(ir.issues || []),
    ...khronos.issues,
    ...checkScene({ info, profile, meta }),
    ...checkGeometry({ info, profile }),
    ...tex.issues,
    ...checkMaterials({ info, profile, sourceMaterials: ir.sourceMaterials || ir.materials }),
    ...checkSource({ files: sourceFiles }),
  ];
  const issues = sortIssues(all);
  return { issues, counts: countIssues(issues), khronos: khronos.summary, textures: tex.textures };
}
