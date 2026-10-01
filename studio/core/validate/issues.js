// Issue helpers shared by all checks.

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * @param {string} id stable issue id (documented in rules/07-export-hygiene.md)
 * @param {'error'|'warning'|'info'} severity
 * @param {string} message
 * @param {{hint?: string, where?: string, data?: any}} [extra]
 */
export function issue(id, severity, message, extra = {}) {
  return { id, severity, message, ...extra };
}

/** Map a profile policy value ('ok' | 'warn' | 'error') to a severity or null. */
export function policy(value) {
  if (value === 'error') return 'error';
  if (value === 'warn') return 'warning';
  return null;
}

export function sortIssues(list) {
  return list.slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
}

export function countIssues(list) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of list) counts[i.severity]++;
  return counts;
}
