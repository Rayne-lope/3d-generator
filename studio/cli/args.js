// Argument parsing shared by commands (node:util parseArgs, no dependencies).

import { parseArgs } from 'node:util';

export const COMMON = {
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  verbose: { type: 'boolean', short: 'v', default: false },
};

/**
 * @param {string[]} argv
 * @param {object} options parseArgs option config
 * @param {string} usage help text
 */
export function parse(argv, options, usage) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { ...COMMON, ...options }, allowPositionals: true, strict: true });
  } catch (err) {
    throw new Error(`${err.message}\n\n${usage}`);
  }
  if (parsed.values.help) {
    console.log(usage);
    process.exit(0);
  }
  return { args: parsed.positionals, opts: parsed.values };
}

export function out(opts, data, text) {
  if (opts.json) console.log(JSON.stringify(data, null, 2));
  else if (text) console.log(text);
}
