// Validates example-vault: frontmatter of every book note, every .base file, config.json,
// the view scripts (syntax only) and the links between them.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { COLOPHON, VAULT, libConstant, read, rel, report, walk } from './common.mjs';

const errors = [];
const STATUSES = libConstant('STATUSES');
const FORMATS = libConstant('FORMATS');
const CATEGORIES = libConstant('CATEGORIES');
const HISTORY_HEADING = new Function(`return ${/const HISTORY_HEADING = ('[^']*');/.exec(read(path.join(COLOPHON, 'lib.js')))[1]};`)();

const files = walk(VAULT, ['.obsidian', '.git']);
const exists = (vaultPath) => fs.existsSync(path.join(VAULT, vaultPath));

// ---- config.json ----------------------------------------------------------------------------
const config = JSON.parse(read(path.join(COLOPHON, 'config.json')));
for (const key of ['library', 'notes', 'covers']) {
  const folder = config.paths?.[key];
  if (typeof folder !== 'string' || !folder) errors.push(`config.json: paths.${key} is missing`);
  else if (!exists(folder)) errors.push(`config.json: paths.${key} points to "${folder}", which does not exist in example-vault`);
}
if (config.language !== 'auto' && !exists(`Colophon/locales/${config.language}.json`)) {
  errors.push(`config.json: language "${config.language}" has no locale file`);
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
const frontmatterOf = (text) => {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  return match ? YAML.parse(match[1]) : null;
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const positiveInt = (v) => Number.isInteger(v) && v > 0;
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const notes = files.filter((f) => f.endsWith('.md'));
let bookCount = 0;
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
    if (!exists(`${m[1]}/view.js`)) errors.push(`${name}: dv.view("${m[1]}") has no view.js in the vault`);
  }
  if (!data || data.type !== 'book') continue;
  bookCount++;
  const fail = (message) => errors.push(`${name}: ${message}`);

  if (typeof data.title !== 'string' || !data.title) fail('title must be a non-empty string');
  if (!asList(data.author).length || !asList(data.author).every((a) => typeof a === 'string')) {
    fail('author must be a list of names');
  }
  if (!STATUSES.includes(data.status)) fail(`status "${data.status}" is not one of ${STATUSES.join(', ')}`);
  if (data.format != null && !FORMATS.includes(data.format)) fail(`format "${data.format}" is not one of ${FORMATS.join(', ')}`);
  for (const c of asList(data.category)) if (!CATEGORIES.includes(c)) fail(`category "${c}" is not a known key`);
  if (data.rating != null && !(typeof data.rating === 'number' && data.rating > 0 && data.rating <= 5 && (data.rating * 2) % 1 === 0)) {
    fail('rating must be a number from 0.5 to 5 in steps of 0.5');
  }
  for (const key of ['pages', 'publication_year', 'series_index', 'queue', 'reread_count']) {
    if (data[key] != null && !positiveInt(data[key])) fail(`${key} must be a positive whole number`);
  }
  for (const key of ['started', 'finished', 'date_added']) {
    if (data[key] != null && !isDate(data[key])) fail(`${key} must be a YYYY-MM-DD date`);
  }
  if (data.started && data.finished && data.finished < data.started) fail('finished is earlier than started');
  if (data.status === 'finished' && !data.finished) fail('a finished book needs a finished date');
  if (data.queue != null && data.status !== 'planned') fail('only a planned book can have a queue position');
  if (data.series_index != null && !data.series) fail('series_index without series');
  if (!asList(data.cssclasses).includes('book-page')) fail('cssclasses must include book-page');
  if (data.cover) {
    const target = String(data.cover).replace(/^!?\[\[|\]\]$/g, '').split('|')[0];
    if (!exists(target)) fail(`cover "${target}" does not exist`);
    if (!target.startsWith(`${config.paths.covers}/`)) fail(`cover is outside ${config.paths.covers}`);
  }
  if (!text.includes('await dv.view("Colophon/book")')) fail('missing the Colophon book view block');
  // Rereads: reread_count must match the number of lines in the Reading history section.
  const lines = text.split('\n');
  const head = lines.findIndex((l) => l.trim() === HISTORY_HEADING);
  let history = 0;
  if (head >= 0) {
    for (let i = head + 1; i < lines.length && !lines[i].startsWith('#'); i++) {
      if (/^- \S+\s*→\s*\d{4}-\d{2}-\d{2}\s*$/.test(lines[i])) history++;
    }
  }
  if ((data.reread_count || 0) !== history) fail(`reread_count is ${data.reread_count || 0} but the history lists ${history} read(s)`);
}
if (bookCount === 0) errors.push('example-vault has no book notes');

// ---- Templates -----------------------------------------------------------------------------------
for (const file of notes.filter((f) => /Templates|localized/.test(f) && /Book(\.[\w-]+)?\.md$/.test(f))) {
  const data = frontmatterOf(read(file));
  if (!data) errors.push(`${rel(file)}: template has no frontmatter`);
  else if (data.type === 'book') errors.push(`${rel(file)}: template must not have type "book" or it would show up as a book`);
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
  const known = (column) => formulas.has(column) || /^(note|file)\./.test(column) || !column.includes('.');
  if (!Array.isArray(base.views) || !base.views.length) errors.push(`${name}: no views`);
  const names = new Set();
  for (const view of base.views || []) {
    if (!TYPES.has(view.type)) errors.push(`${name}: view "${view.name}" has unknown type "${view.type}"`);
    if (!view.name || names.has(view.name)) errors.push(`${name}: view name "${view.name}" is empty or duplicated`);
    names.add(view.name);
    for (const column of view.order || []) {
      if (!known(column)) errors.push(`${name}: view "${view.name}" uses unknown column "${column}"`);
    }
    for (const sort of view.sort || []) {
      if (!['ASC', 'DESC'].includes(sort.direction)) errors.push(`${name}: view "${view.name}" has a bad sort direction`);
    }
  }
  for (const key of Object.keys(base.properties || {})) {
    if (key.startsWith('formula.') && !formulas.has(key)) errors.push(`${name}: property ${key} has no formula`);
  }
}

report(`vault (${bookCount} books, ${files.filter((f) => f.endsWith('.base')).length} bases)`, errors);
