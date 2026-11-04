// Validation of one book note, shared by check-vault (the example vault) and the importer tests.
// Pure functions: no file access, so they run on text that was never written to disk.
import YAML from 'yaml';
import { model } from './common.mjs';

export const frontmatterOf = (text) => {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  return match ? YAML.parse(match[1]) : null;
};

const isDate = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const positiveInt = (v) => Number.isInteger(v) && v > 0;
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Number of reads listed in the "Reading history" section ("- 2024-08-02 → 2024-08-30").
export const historyCount = (text) => {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => l.trim() === model.HISTORY_HEADING);
  let count = 0;
  if (head >= 0) {
    for (let i = head + 1; i < lines.length && !lines[i].startsWith('#'); i++) {
      if (/^- \S+\s*→\s*\d{4}-\d{2}-\d{2}\s*$/.test(lines[i])) count++;
    }
  }
  return count;
};

// Returns a list of problems (strings) for a note whose properties are `data` and whose full text
// is `text`.
//   catalog        model.catalog(...) of the settings the note is checked against
//   coversFolder   the covers folder from the settings, without trailing slash
//   coverExists    (vaultPath) => boolean
export const validateBookNote = ({ data, text, catalog, coversFolder, coverExists }) => {
  const errors = [];
  const fail = (message) => errors.push(message);
  const statusKeys = catalog.statuses.map((s) => s.key);

  if (typeof data.title !== 'string' || !data.title) fail('title must be a non-empty string');
  if (!asList(data.author).length || !asList(data.author).every((a) => typeof a === 'string')) {
    fail('author must be a list of names');
  }
  if (!catalog.has('status', data.status)) {
    fail(`status "${data.status}" is not one of ${statusKeys.join(', ')}`);
  }
  if (data.format != null && !catalog.has('format', data.format)) {
    fail(`format "${data.format}" is not one of ${catalog.formats.map((f) => f.key).join(', ')}`);
  }
  for (const c of asList(data.category)) {
    if (!catalog.has('category', c)) fail(`category "${c}" is not a known key`);
  }
  if (
    data.rating != null &&
    !(
      typeof data.rating === 'number' &&
      data.rating > 0 &&
      data.rating <= 5 &&
      (data.rating * 2) % 1 === 0
    )
  ) {
    fail('rating must be a number from 0.5 to 5 in steps of 0.5');
  }
  for (const key of ['pages', 'publication_year', 'series_index', 'queue', 'reread_count']) {
    if (data[key] != null && !positiveInt(data[key]))
      fail(`${key} must be a positive whole number`);
  }
  for (const key of ['started', 'finished', 'date_added', 'snoozed_until']) {
    if (data[key] != null && !isDate(data[key])) fail(`${key} must be a YYYY-MM-DD date`);
  }
  if (data.started && data.finished && data.finished < data.started)
    fail('finished is earlier than started');
  const kind = catalog.kindOf(data.status);
  if (kind === 'finished' && !data.finished) fail('a finished book needs a finished date');
  if (data.queue != null && kind !== 'planned')
    fail('only a planned book can have a queue position');
  if (data.series_index != null && !data.series) fail('series_index without series');
  if (!asList(data.cssclasses).includes('book-page')) fail('cssclasses must include book-page');
  if (data.cover) {
    const target = String(data.cover)
      .replace(/^!?\[\[|\]\]$/g, '')
      .split('|')[0];
    if (!coverExists(target)) fail(`cover "${target}" does not exist`);
    if (!target.startsWith(`${coversFolder}/`)) fail(`cover is outside ${coversFolder}`);
  }
  if (!text.includes('await dv.view("Colophon/book")'))
    fail('missing the Colophon book view block');
  // Rereads: reread_count must match the number of lines in the Reading history section.
  const history = historyCount(text);
  if ((data.reread_count || 0) !== history) {
    fail(`reread_count is ${data.reread_count || 0} but the history lists ${history} read(s)`);
  }
  return errors;
};
