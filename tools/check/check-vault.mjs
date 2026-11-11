// Validates example-vault: frontmatter of every book note, every .base file, config.json,
// the view scripts (syntax only) and the links between them.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { VAULT, loadLocale, loadSettings, model, read, rel, report, walk } from '../lib/common.mjs';
import { frontmatterOf, validateBookNote } from '../lib/note-validation.mjs';

const errors = [];

const files = walk(VAULT, ['.obsidian', '.git']);
const exists = (vaultPath) => fs.existsSync(path.join(VAULT, vaultPath));

// ---- config.json ----------------------------------------------------------------------------
// The statuses, formats and categories come from config.json, the same way the views read them.
const { settings, problems } = loadSettings();
errors.push(...problems);
const english = loadLocale('en');
const catalog = model.catalog(settings, 'en', (key) => english[key]);
for (const key of ['library', 'notes', 'covers']) {
  const folder = settings.paths[key];
  if (!exists(folder))
    errors.push(
      `config.json: paths.${key} points to "${folder}", which does not exist in example-vault`,
    );
}
if (settings.language !== 'auto' && !exists(`Colophon/locales/${settings.language}.json`)) {
  errors.push(`config.json: language "${settings.language}" has no locale file`);
}

// ---- JavaScript syntax --------------------------------------------------------------------------
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
for (const file of files.filter((f) => f.endsWith('.js'))) {
  try {
    // lib.js receives (dv, root) from the view scripts; the views receive (dv, input) from Dataview.
    new AsyncFunction(...(file.endsWith('lib.js') ? ['dv', 'root'] : ['dv', 'input']), read(file));
  } catch (error) {
    errors.push(`${rel(file)}: ${error.message}`);
  }
}

// ---- Markdown notes ------------------------------------------------------------------------------
const notes = files.filter((f) => f.endsWith('.md'));
let bookCount = 0;
let summaryCount = 0;
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
for (const file of notes) {
  const text = read(file);
  const name = rel(file);
  let data;
  try {
    data = frontmatterOf(text);
  } catch (error) {
    errors.push(`${name}: frontmatter is not valid YAML (${error.message})`);
    continue;
  }
  for (const m of text.matchAll(/dv\.view\("([^"]+)"/g)) {
    if (!exists(`${m[1]}/view.js`))
      errors.push(`${name}: dv.view("${m[1]}") has no view.js in the vault`);
  }
  if (data?.type === 'summary') {
    summaryCount++;
    if (typeof data.title !== 'string' || !data.title)
      errors.push(`${name}: summary needs a title`);
    if (data.category != null && !asList(data.category).every((c) => catalog.has('category', c)))
      errors.push(`${name}: summary has a category that is not a known key`);
    continue;
  }
  if (!data || data.type !== 'book') continue;
  bookCount++;
  for (const message of validateBookNote({
    data,
    text,
    catalog,
    coversFolder: settings.paths.covers,
    coverExists: exists,
  })) {
    errors.push(`${name}: ${message}`);
  }
}
if (bookCount === 0) errors.push('example-vault has no book notes');

// ---- Templates -----------------------------------------------------------------------------------
for (const file of notes.filter(
  (f) => /Templates|localized/.test(f) && /(Book|Summary)(\.[\w-]+)?\.md$/.test(f),
)) {
  const data = frontmatterOf(read(file));
  const isSummary = /Summary(\.[\w-]+)?\.md$/.test(file);
  if (!data) errors.push(`${rel(file)}: template has no frontmatter`);
  else if (isSummary) {
    if (data.type === 'summary')
      errors.push(
        `${rel(file)}: template must not have type "summary" or it would show up as a summary`,
      );
  } else if (data.type === 'book')
    errors.push(`${rel(file)}: template must not have type "book" or it would show up as a book`);
  else if (catalog.kindOf(data.status) !== 'planned')
    errors.push(
      `${rel(file)}: the template status "${data.status}" must be a status of kind planned`,
    );
}

// ---- Bases ---------------------------------------------------------------------------------------
const TYPES = new Set(['table', 'cards']);
for (const file of files.filter((f) => f.endsWith('.base'))) {
  const name = rel(file);
  let base;
  try {
    base = YAML.parse(read(file));
  } catch (error) {
    errors.push(`${name}: not valid YAML (${error.message})`);
    continue;
  }
  const formulas = new Set(Object.keys(base.formulas || {}).map((f) => `formula.${f}`));
  const known = (column) =>
    formulas.has(column) || /^(note|file)\./.test(column) || !column.includes('.');
  if (!Array.isArray(base.views) || !base.views.length) errors.push(`${name}: no views`);
  const names = new Set();
  for (const view of base.views || []) {
    if (!TYPES.has(view.type))
      errors.push(`${name}: view "${view.name}" has unknown type "${view.type}"`);
    if (!view.name || names.has(view.name))
      errors.push(`${name}: view name "${view.name}" is empty or duplicated`);
    names.add(view.name);
    for (const column of view.order || []) {
      if (!known(column))
        errors.push(`${name}: view "${view.name}" uses unknown column "${column}"`);
    }
    for (const sort of view.sort || []) {
      if (!['ASC', 'DESC'].includes(sort.direction))
        errors.push(`${name}: view "${view.name}" has a bad sort direction`);
    }
  }
  for (const key of Object.keys(base.properties || {})) {
    if (key.startsWith('formula.') && !formulas.has(key))
      errors.push(`${name}: property ${key} has no formula`);
  }
}

report(
  `vault (${bookCount} books, ${summaryCount} summaries, ${files.filter((f) => f.endsWith('.base')).length} bases)`,
  errors,
);
