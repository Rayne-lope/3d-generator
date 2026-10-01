// Unit helpers. Assets are authored in meters. Roblox measures in studs:
// since 2026-06-16 the Roblox importer converts with 25:7 studs per meter (1 stud = 0.28 m).
// For Roblox modular kits, choose module sizes in whole studs and convert with studs().

export const STUD = 0.28;

export const units = {
  STUD,
  /** studs → meters */
  studs: (n) => n * STUD,
  /** meters → studs */
  toStuds: (m) => m / STUD,
  cm: (n) => n / 100,
  mm: (n) => n / 1000,
  inch: (n) => n * 0.0254,
  ft: (n) => n * 0.3048,
  /** Snap a value to a grid step. */
  snap: (value, step) => Math.round(value / step) * step,
};
