#!/usr/bin/env node
// Local StoryGraph CSV import. Node 20 or newer, no npm dependencies.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CsvError,
  cleanDate,
  cleanIsbn,
  fail,
  loadHeadings,
  loadImportSettings,
  outputFolder,
  parseCsv,
  planNames,
  renderNote,
  walkMarkdown,
} from './import-library.mjs';
import { parseStoryGraphReadings } from './storygraph-readings.mjs';

const USAGE = `Usage: node import-storygraph.mjs <export.csv> --out <folder> [options]

Shows the import plan without writing anything. Add --apply to create notes.
Use the Colophon library folder as --out. Existing notes are never overwritten.

Options:
  --out <folder>       Colophon library folder (required)
  --apply              create notes (default: report only)
  --config <file>      your vault's Colophon/config.json (default: bundled config)
  --language <code>    language of the note headings (default: config language, or en)
  --help               show this text`;

const STATUS_KINDS = new Map([
  ['read', 'finished'],
  ['currently-reading', 'in_progress'],
  ['paused', 'in_progress'],
  ['to-read', 'planned'],
  ['did-not-finish', 'abandoned'],
]);
const FORMATS = new Map([
  ['audio', 'audiobook'],
  ['digital', 'ebook'],
  ['hardcover', 'hardcover'],
  ['paperback', 'paperback'],
]);

const validIsbn13 = (isbn) =>
  /^97[89]/.test(isbn) &&
  [...isbn].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0;

const identifiers = (row) => {
  const raw = row['ISBN/UID'].trim();
  const isbn = cleanIsbn(raw);
  if (isbn?.length === 10) {
    const sum = [...isbn].reduce(
      (total, digit, i) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - i),
      0,
    );
    // StoryGraph can use equivalent ISBN-10 and ISBN-13 values on different editions.
    if (sum % 11 === 0) return { isbn, storygraph_id: isbn };
  }
  if (isbn?.length === 13 && validIsbn13(isbn)) return { isbn13: isbn, storygraph_id: isbn };
  const uid = raw.toUpperCase();
  if (/^B[A-Z0-9]{9}$/.test(uid)) return { storygraph_uid: uid, storygraph_id: uid };

  // Use all exported cells, including fields we do not import. Two different rows without a
  // reliable ID may represent different editions even when their title and authors match.
  const cells = Object.keys(row)
    .sort()
    .map((key) => [key, row[key]]);
  const hash = createHash('sha256').update(JSON.stringify(cells)).digest('hex').slice(0, 32);
  return { ...(raw ? { storygraph_uid: raw } : {}), storygraph_row: hash };
};

const normalizeText = (value) => value.replace(/\s+/g, ' ').trim();

const convert = (records, catalog) => {
  const [headers, ...rows] = records;
  if (!headers) throw new CsvError('the file is empty');
  const keys = headers.map((header) => header.trim());
  if (new Set(keys).size !== keys.length) throw new CsvError('duplicate column names');
  const missing = ['Title', 'Authors', 'ISBN/UID', 'Read Status'].filter(
    (key) => !keys.includes(key),
  );
  if (missing.length)
    throw new CsvError(
      `this does not look like a StoryGraph export: missing column(s) ${missing.join(', ')}`,
    );

  const books = [];
  const skipped = [];
  rows.forEach((cells, index) => {
    const number = index + 2;
    if (cells.length !== keys.length) {
      skipped.push(`row ${number}: has ${cells.length} fields, the header has ${keys.length}`);
      return;
    }

    const row = Object.fromEntries(keys.map((key, i) => [key, cells[i]]));
    const title = normalizeText(row.Title);
    const authors = [...new Set(row.Authors.split(',').map(normalizeText).filter(Boolean))];
    if (!title || !authors.length) {
      skipped.push(`row ${number}: missing ${title ? 'authors' : 'title'}`);
      return;
    }

    const label = `row ${number} (${JSON.stringify(title)})`;
    const readStatus = row['Read Status'].trim();
    const kind = STATUS_KINDS.get(readStatus);
    const status = catalog.keysOfKind(kind)[0];
    if (!status) {
      skipped.push(`${label}: no Colophon status for Read Status ${JSON.stringify(readStatus)}`);
      return;
    }

    const { startedOn, finishedOn, history, warnings } = parseStoryGraphReadings(row, kind);
    if (readStatus === 'paused') warnings.push('Read Status paused imported as in progress');
    const ids = identifiers(row);
    const { isbn, isbn13, ...provenance } = ids;
    if (!ids.storygraph_id) {
      const reason = ids.storygraph_uid ? 'unrecognised ISBN/UID' : 'missing ISBN/UID';
      warnings.push(`${reason}; repeat imports match the exact CSV row`);
    }
    const book = {
      id: ids.storygraph_id ?? `row-${ids.storygraph_row}`,
      label,
      title,
      authors,
      status,
      started: startedOn,
      finished: finishedOn,
      history,
      warnings,
      isbn,
      isbn13,
      provenance,
    };

    const ratingText = row['Star Rating']?.trim();
    if (ratingText) {
      const rating = Number(ratingText);
      if (/^\d+(?:\.[05]0*)?$/.test(ratingText) && rating > 0 && rating <= 5) {
        book.rating = rating;
      } else if (rating !== 0) {
        warnings.push(
          `Star Rating ${JSON.stringify(ratingText)} omitted; Colophon uses half-star steps`,
        );
      }
    }
    const formatText = row.Format?.trim();
    if (formatText) {
      const format = FORMATS.get(formatText.toLowerCase());
      if (catalog.has('format', format)) book.format = format;
      else
        warnings.push(`Format ${JSON.stringify(formatText)} omitted; no matching Colophon format`);
    }
    const added = row['Date Added']?.trim();
    if (added) {
      book.dateAdded = cleanDate(added);
      if (!book.dateAdded)
        warnings.push(`Date Added ${JSON.stringify(added)} omitted; no exact date`);
    }
    books.push(book);
  });
  return { books, skipped, rows: rows.length };
};

const addMatch = (index, key, value) => {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
};

const existingImports = (out) => {
  const found = new Map();
  for (const file of walkMarkdown(out)) {
    const text = fs.readFileSync(file, 'utf8');
    const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
    if (!front) continue;
    // The importer writes ASCII IDs as quoted YAML strings; also accept plain scalars
    // and single quotes, including inline comments added by hand.
    const id = /^storygraph_id:[ \t]*(["']?)([A-Z0-9]+)\1(?:[ \t]+#.*)?[ \t]*$/m.exec(front)?.[2];
    const row = /^storygraph_row:[ \t]*(["']?)([a-f0-9]{32})\1(?:[ \t]+#.*)?[ \t]*$/m.exec(
      front,
    )?.[2];
    if (id) addMatch(found, id, file);
    if (row) addMatch(found, `row-${row}`, file);
  }
  return found;
};

const plan = ({ books, skipped }, out) => {
  const existing = existingImports(out);
  const source = new Map();
  for (const book of books) addMatch(source, book.id, book.label);

  const fresh = [];
  const known = [];
  for (const book of books) {
    const matches = existing.get(book.id) ?? [];
    if (source.get(book.id).length > 1)
      skipped.push(`${book.label}: ambiguous identity; multiple CSV rows share it`);
    else if (matches.length > 1)
      skipped.push(`${book.label}: ambiguous identity; ${matches.length} imported notes match`);
    else if (matches.length === 1) known.push(book);
    else fresh.push(book);
  }
  return { fresh, known, names: planNames(fresh, out) };
};

// Serialise apply runs to the same library before checking for existing imports and planning names.
const withImportLock = (out, run) => {
  fs.mkdirSync(out, { recursive: true });
  const lock = path.join(out, '.colophon-storygraph-import');
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`an import lock exists at ${lock}; remove it only if no import is running`, {
        cause: error,
      });
    throw error;
  }
  try {
    run(lock);
  } finally {
    fs.rmdirSync(lock);
  }
};

const runImport = (input, file, out, headings, lock) => {
  const apply = Boolean(lock);
  const { fresh, known, names } = plan(input, out);
  console.log(`StoryGraph import${apply ? '' : ' (dry run: nothing is written)'}`);
  console.log(`  file:   ${file} (${input.rows} rows)`);
  console.log(`  folder: ${out}`);
  console.log(`To create: ${fresh.length}`);
  for (const book of fresh) {
    const details = [
      book.status,
      book.started && `started ${book.started}`,
      book.finished && `finished ${book.finished}`,
      book.history.length > 0 && `${book.history.length} earlier read(s)`,
    ].filter(Boolean);
    console.log(`  ${names.get(book.id)} (${details.join(', ')})`);
    for (const warning of book.warnings) console.log(`warning: ${book.label}: ${warning}`);
  }
  console.log(`Skipped, already imported: ${known.length}`);
  for (const reason of input.skipped) console.log(`Skipped: ${reason}`);
  if (!apply) {
    console.log(fresh.length ? 'Dry run. Add --apply to write the notes.' : 'Nothing to write.');
    return;
  }

  let written = 0;
  const staged = path.join(lock, 'note.tmp');
  for (const book of fresh) {
    const fileName = names.get(book.id);
    const target = path.join(out, fileName);
    try {
      const note = renderNote(book, headings, book.provenance);
      // Publish only the complete file. The hard link fails if the destination already exists.
      fs.writeFileSync(staged, note, { flag: 'wx' });
      fs.linkSync(staged, target);
      written++;
    } catch (error) {
      console.error(`error: ${fileName}: ${error.message}`);
      process.exitCode = 1;
    } finally {
      fs.rmSync(staged, { force: true });
    }
  }
  console.log(`Wrote ${written} note(s).`);
};

const main = () => {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        apply: { type: 'boolean' },
        config: { type: 'string' },
        help: { type: 'boolean' },
        language: { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (error) {
    return fail(`${error.message}\n\n${USAGE}`, 2);
  }
  const { positionals, values: options } = args;
  if (options.help) return console.log(USAGE);
  if (positionals.length !== 1 || !options.out)
    return fail(`give one StoryGraph export file and --out <folder>\n\n${USAGE}`, 2);

  const [file] = positionals;
  const context = loadImportSettings(options, path.dirname(fileURLToPath(import.meta.url)));
  const headings = loadHeadings(options, context);
  const out = outputFolder(options);
  try {
    const input = convert(parseCsv(fs.readFileSync(file, 'utf8')), context.catalog);
    const run = (lock) => runImport(input, file, out, headings, lock);
    if (options.apply) withImportLock(out, run);
    else run();
  } catch (error) {
    return fail(error instanceof CsvError ? `${file}: ${error.message}` : error.message);
  }
};

main();
