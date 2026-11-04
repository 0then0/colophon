// Helpers shared by the repository tools. Node only, no Colophon runtime code lives here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

// Colophon/model.js is a function body shared with lib.js; running it here gives the tools the
// same settings logic that runs in Obsidian.
export const loadModel = () => new Function(read(path.join(COLOPHON, 'model.js')))();
export const model = loadModel();

export const interpolate = (message, params) =>
  message.replace(/\{(\w+)\}/g, (placeholder, name) =>
    name in params ? String(params[name]) : placeholder,
  );

// Reads a config.json (a file path) into settings. `problems` are readable English sentences, taken
// from the en locale, so a tool can print them.
export const loadSettings = (file = path.join(COLOPHON, 'config.json')) => {
  const messages = loadLocale('en');
  let raw;
  const problems = [];
  try {
    raw = parseStrictJson(read(file), rel(file));
  } catch (error) {
    problems.push(error.message);
  }
  const settings = model.resolve(raw);
  if (!problems.length) {
    for (const problem of settings.problems) {
      const { key, params } = model.problemMessage(problem);
      problems.push(`${rel(file)}: ${interpolate(messages[key], params)}`);
    }
  }
  return { settings, problems };
};

export const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// Every string of a message (a plain string or the variants of a plural message).
export const variants = (message) =>
  typeof message === 'string' ? [message] : Object.values(message);

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
