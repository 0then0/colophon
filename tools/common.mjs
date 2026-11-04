// Helpers shared by the repository tools. Node only, no Colophon runtime code lives here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VAULT = path.join(ROOT, 'example-vault');
export const COLOPHON = path.join(VAULT, 'Colophon');
export const LOCALES_DIR = path.join(COLOPHON, 'locales');

export const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

export const read = (file) => fs.readFileSync(file, 'utf8');

// Parses JSON with a YAML parser so that duplicate keys are reported (JSON.parse ignores them).
export const parseStrictJson = (text, name) => {
  try {
    return YAML.parse(text, { uniqueKeys: true });
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
};

export const localeCodes = () =>
  fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));

export const loadLocale = (code) => {
  const file = path.join(LOCALES_DIR, `${code}.json`);
  return parseStrictJson(read(file), rel(file));
};

export const loadLocales = () => Object.fromEntries(localeCodes().map((c) => [c, loadLocale(c)]));

// Walks a directory and returns files, skipping tooling and VCS folders.
export const walk = (dir, skip = ['node_modules', '.git']) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, skip));
    else out.push(full);
  }
  return out;
};

// Reads the top-level array constants (STATUSES, FORMATS, ...) from Colophon/lib.js, so the
// stable property values are defined in exactly one place. Later constants may use earlier ones.
export const libConstant = (name) => {
  const source = read(path.join(COLOPHON, 'lib.js'));
  const known = {};
  for (const match of source.matchAll(/^const (\w+) = (\[[\s\S]*?\]);$/gm)) {
    known[match[1]] = new Function(...Object.keys(known), `return ${match[2]};`)(...Object.values(known));
  }
  if (!(name in known)) throw new Error(`Constant ${name} not found in Colophon/lib.js`);
  return known[name];
};

export const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// Every string of a message (a plain string or the variants of a plural message).
export const variants = (message) => (typeof message === 'string' ? [message] : Object.values(message));

export const report = (name, errors, warnings = []) => {
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`${name}: ${errors.length} problem(s)`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: ok`);
  }
};
