#!/usr/bin/env node
// Colophon installer. No dependencies and no `npm install`: it only needs Node 20 or newer and
// runs from an unpacked release archive (or from a clone of the repository).
//
//   node install.mjs <vault> [options]          show the plan, change nothing
//   node install.mjs <vault> [options] --apply  install
//
// It copies the Colophon folder into the vault, writes Colophon/config.json with the chosen language
// and folders, and puts the book template, the Library base and the statistics note (in the chosen
// language) where they belong. It never touches the vault's .obsidian folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_NODE = 20;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE) {
  console.error(
    `error: Node ${MIN_NODE} or newer is required, this is Node ${process.versions.node}. Get it from https://nodejs.org or follow the manual steps in INSTALL.md.`,
  );
  process.exit(1);
}

const USAGE = `Usage: node install.mjs <vault> [options]

Installs Colophon into an Obsidian vault. Without --apply it only prints what it would do.

Options:
  --apply              write the files (default: show the plan only)
  --force              overwrite files that exist and differ (never deletes anything)
  --language <code>    interface language and language of the template, Library base and statistics
                       note: en, ru, es, de, fr, ja, pt-BR (default: auto, which follows Obsidian
                       and installs the English files)
  --library <folder>   folder of book notes, relative to the vault (default: Books/Library)
  --notes <folder>     folder of series notes (default: Books/Notes)
  --covers <folder>    folder of cover images (default: Books/covers)
  --templates <folder> folder for the book template (default: Templates)
  --skip-template      do not install the book template
  --skip-base          do not install Library.base
  --skip-statistics    do not install the statistics note
  --summaries          also install the Summary template and Summaries.base (notes of type "summary"
                       for books you know only from a summary)
  --no-vault-check     install even if the folder has no .obsidian folder
  --help               show this text

Library.base and Statistics.md are placed in the parent folder of --library (Books by default).
The installer never creates or changes .obsidian: enable the plugins yourself (see the list at the end).`;

const fail = (message, code = 1) => {
  console.error(`error: ${message}`);
  process.exit(code);
};

// ---- Arguments --------------------------------------------------------------------------------

const FLAGS = new Set([
  'apply',
  'force',
  'help',
  'skip-template',
  'skip-base',
  'skip-statistics',
  'summaries',
  'no-vault-check',
]);
const VALUES = new Set(['language', 'library', 'notes', 'covers', 'templates', 'source']);
const options = {};
const positional = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) {
    positional.push(arg);
    continue;
  }
  const [name, inline] = arg.slice(2).split(/=(.*)/s);
  if (FLAGS.has(name)) {
    if (inline !== undefined) fail(`--${name} does not take a value`, 2);
    options[name] = true;
  } else if (VALUES.has(name)) {
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined || (inline === undefined && value.startsWith('--')))
      fail(`--${name} needs a value`, 2);
    options[name] = value;
  } else {
    fail(`unknown option --${name}\n\n${USAGE}`, 2);
  }
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positional.length !== 1) fail(`give exactly one vault folder\n\n${USAGE}`, 2);

// ---- Source (the Colophon folder next to this script, or in a clone of the repository) --------

const here = path.dirname(fileURLToPath(import.meta.url));
const source = options.source
  ? path.resolve(options.source)
  : [path.join(here, 'Colophon'), path.join(here, '..', '..', 'example-vault', 'Colophon')].find(
      (dir) => fs.existsSync(path.join(dir, 'lib.js')),
    );
if (!source || !fs.existsSync(path.join(source, 'model.js'))) {
  fail(
    'the Colophon folder was not found next to install.mjs. Run the installer from the unpacked release archive.',
  );
}
const model = new Function(fs.readFileSync(path.join(source, 'model.js'), 'utf8'))();
const locales = fs
  .readdirSync(path.join(source, 'locales'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length));

// ---- Choices ----------------------------------------------------------------------------------

let language = 'auto';
let filesLanguage = 'en';
if (options.language !== undefined && options.language !== 'auto') {
  const wanted = model.normalizeTag(options.language);
  const code = locales.find((c) => model.normalizeTag(c) === wanted);
  if (!code)
    fail(
      `language "${options.language}" is not available. Available: ${locales.join(', ')}, auto`,
      2,
    );
  language = filesLanguage = code;
}

const folder = (name, value, fallback) => {
  const given = (value ?? fallback).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segments = given.split('/');
  if (
    !given ||
    /^[A-Za-z]:/.test(given) ||
    (value ?? fallback).startsWith('/') ||
    segments.some((s) => s === '' || s.startsWith('.')) ||
    [...given].some((c) => c.charCodeAt(0) < 32 || '<>:"|?*'.includes(c))
  ) {
    fail(
      `--${name} "${value}" must be a folder inside the vault, written relative to its root, without ".", ".." or hidden folders such as .obsidian`,
      2,
    );
  }
  return given;
};
const paths = {
  library: folder('library', options.library, model.DEFAULT_PATHS.library),
  notes: folder('notes', options.notes, model.DEFAULT_PATHS.notes),
  covers: folder('covers', options.covers, model.DEFAULT_PATHS.covers),
};
const templates = folder('templates', options.templates, 'Templates');
const config = { language, paths };
const settings = model.resolve(config);
if (settings.problems.length)
  fail(`the chosen settings are not valid: ${JSON.stringify(settings.problems)}`);

// ---- Vault ------------------------------------------------------------------------------------

const vault = path.resolve(positional[0]);
let vaultStat;
try {
  vaultStat = fs.statSync(vault);
} catch {
  fail(`the vault folder ${vault} does not exist`);
}
if (!vaultStat.isDirectory()) fail(`${vault} is not a folder`);
if (!options['no-vault-check'] && !fs.existsSync(path.join(vault, '.obsidian'))) {
  fail(
    `${vault} does not look like an Obsidian vault: it has no .obsidian folder. Open the folder as a vault in Obsidian once, or pass --no-vault-check to install anyway.`,
  );
}
const realVault = fs.realpathSync(vault);
const realSource = fs.realpathSync(source);
const installedCopy = path.join(realVault, 'Colophon');
if (
  realVault === realSource ||
  realVault.startsWith(realSource + path.sep) ||
  (fs.existsSync(installedCopy) && fs.realpathSync(installedCopy) === realSource)
) {
  fail('the vault and the Colophon source folder are the same folder; pick another vault');
}

// ---- Plan -------------------------------------------------------------------------------------

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.name === '.DS_Store') return [];
      return entry.isDirectory() ? walk(full) : [full];
    });

const items = []; // { rel, dir?, content?, label }
const addDir = (rel) => items.push({ rel, dir: true });
const addFile = (rel, content, group) => items.push({ rel, content, group });

addDir(paths.library);
addDir(paths.notes);
addDir(paths.covers);

for (const file of walk(source)) {
  const rel = `Colophon/${path.relative(source, file).split(path.sep).join('/')}`;
  if (rel === 'Colophon/config.json') continue;
  addFile(rel, fs.readFileSync(file), 'Colophon');
}
addFile('Colophon/config.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`), 'Colophon');

const booksRoot =
  path.posix.dirname(paths.library) === '.' ? '' : path.posix.dirname(paths.library);
const inBooks = (name) => (booksRoot ? `${booksRoot}/${name}` : name);
const localized = (name) => {
  const file = path.join(source, 'localized', name);
  if (!fs.existsSync(file))
    fail(`${path.relative(source, file)} is missing; the release is incomplete`);
  return fs.readFileSync(file);
};
if (!options['skip-template'])
  addFile(`${templates}/Book.md`, localized(`Book.${filesLanguage}.md`), 'template');
if (!options['skip-base'])
  addFile(inBooks('Library.base'), localized(`Library.${filesLanguage}.base`), 'base');
if (!options['skip-statistics'])
  addFile(inBooks('Statistics.md'), localized(`Statistics.${filesLanguage}.md`), 'statistics');
if (options.summaries) {
  if (!options['skip-template'])
    addFile(`${templates}/Summary.md`, localized(`Summary.${filesLanguage}.md`), 'template');
  if (!options['skip-base'])
    addFile(inBooks('Summaries.base'), localized(`Summaries.${filesLanguage}.base`), 'base');
}

const inside = (target) => target === vault || target.startsWith(vault + path.sep);
const lstat = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

// state: new | same | differs | blocked
for (const item of items) {
  if (item.rel === '.obsidian' || item.rel.startsWith('.obsidian/'))
    throw new Error(`internal error: refusing to touch ${item.rel}`);
  item.target = path.join(vault, ...item.rel.split('/'));
  if (!inside(item.target)) throw new Error(`internal error: ${item.rel} is outside the vault`);
  // Every existing parent must be a real folder: the installer does not write through links or files.
  item.blocked = null;
  let current = vault;
  for (const part of item.rel.split('/').slice(0, item.dir ? undefined : -1)) {
    current = path.join(current, part);
    const stat = lstat(current);
    if (!stat) break;
    if (stat.isSymbolicLink())
      item.blocked = `${path.relative(vault, current).split(path.sep).join('/')} is a symbolic link`;
    else if (!stat.isDirectory())
      item.blocked = `${path.relative(vault, current).split(path.sep).join('/')} exists and is not a folder`;
    if (item.blocked) break;
  }
  if (item.blocked) {
    item.state = 'blocked';
    continue;
  }
  const stat = lstat(item.target);
  if (!stat) item.state = 'new';
  else if (item.dir) item.state = 'same';
  else if (stat.isSymbolicLink()) {
    item.state = 'blocked';
    item.blocked = `${item.rel} is a symbolic link`;
  } else if (!stat.isFile()) {
    item.state = 'blocked';
    item.blocked = `${item.rel} exists and is a folder`;
  } else item.state = fs.readFileSync(item.target).equals(item.content) ? 'same' : 'differs';
}

const count = (state) => items.filter((i) => !i.dir && i.state === state).length;
const blocked = items.filter((i) => i.state === 'blocked');
const differs = items.filter((i) => i.state === 'differs');
const conflicts = [...blocked, ...(options.force ? [] : differs)];

// ---- Report -----------------------------------------------------------------------------------

const apply = Boolean(options.apply);
console.log(`Colophon installer${apply ? '' : ' (plan only: nothing is changed)'}`);
console.log(`  vault:     ${vault}`);
console.log(
  `  language:  ${language}${language === 'auto' ? ' (follows Obsidian; English template, base and statistics note)' : ''}`,
);
console.log(`  folders:   library ${paths.library}, notes ${paths.notes}, covers ${paths.covers}`);
console.log('');

const colophonFiles = items.filter((i) => i.group === 'Colophon');
const newColophon = colophonFiles.filter((i) => i.state === 'new').length;
if (newColophon)
  console.log(`  create     Colophon/ (${newColophon} file${newColophon === 1 ? '' : 's'})`);
for (const item of items) {
  if (item.dir) {
    if (item.state === 'new') console.log(`  mkdir      ${item.rel}`);
    continue;
  }
  if (item.group === 'Colophon' && item.state === 'new') continue;
  const verb = {
    new: 'create',
    same: 'up to date',
    differs: options.force ? 'overwrite' : 'DIFFERS',
    blocked: 'BLOCKED',
  }[item.state];
  const why =
    item.state === 'blocked'
      ? `  (${item.blocked})`
      : item.state === 'differs' && !options.force
        ? '  (exists with different content; --force overwrites it)'
        : '';
  if (item.state === 'same' && item.group === 'Colophon') continue;
  console.log(`  ${verb.padEnd(10)} ${item.rel}${why}`);
}
const sameColophon = colophonFiles.filter((i) => i.state === 'same').length;
if (sameColophon)
  console.log(`  up to date Colophon/ (${sameColophon} file${sameColophon === 1 ? '' : 's'})`);
console.log('');
const toWrite = items.filter((i) => i.state === 'new' || (i.state === 'differs' && options.force));
console.log(
  `${count('new')} file(s) to create, ${count('same')} up to date, ${options.force ? count('differs') : 0} to overwrite, ${conflicts.length} conflict(s)`,
);

if (conflicts.length) {
  console.error('');
  console.error('Nothing was written because of the conflicts above.');
  if (differs.length && !options.force && !blocked.length) {
    console.error(
      'Check that the differing files are yours to replace, then run again with --force. Files are only overwritten, never deleted.',
    );
  }
  process.exit(1);
}

if (!apply) {
  console.log('');
  console.log(
    toWrite.length
      ? 'Plan only. Add --apply to install.'
      : 'Everything is already installed. Nothing to do.',
  );
  process.exit(0);
}

for (const item of items) {
  if (item.state === 'same' || item.state === 'blocked') continue;
  if (item.dir) {
    fs.mkdirSync(item.target, { recursive: true });
    continue;
  }
  fs.mkdirSync(path.dirname(item.target), { recursive: true });
  fs.writeFileSync(item.target, item.content);
}
console.log('');
console.log(
  toWrite.length
    ? `Installed ${toWrite.filter((i) => !i.dir).length} file(s).`
    : 'Everything is already installed. Nothing to do.',
);

console.log(`
Next steps in Obsidian (the installer never changes .obsidian, so these are manual):
  1. Settings > Community plugins: turn off Restricted mode, then install and enable "Dataview".
  2. Settings > Dataview: turn on "Enable JavaScript Queries".${
    options['skip-template']
      ? ''
      : `
  3. Settings > Core plugins: enable "Templates", then set Template folder to "${templates}".
  4. Create a note in ${paths.library}, run "Templates: Insert template" and choose Book.`
  }${
    options['skip-statistics'] && options['skip-base']
      ? ''
      : `
  5. Open ${[options['skip-statistics'] ? null : inBooks('Statistics.md'), options['skip-base'] ? null : inBooks('Library.base')].filter(Boolean).join(' and ')}.`
  }`);
