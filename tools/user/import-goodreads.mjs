#!/usr/bin/env node
// Imports a Goodreads export (My Books, Export, a .csv file) as Colophon book notes.
// No dependencies, no network, no covers. Node 20 or newer.
//
//   node import-goodreads.mjs <export.csv> --out <folder>            dry run: report only
//   node import-goodreads.mjs <export.csv> --out <folder> --apply    write the notes
//
// Try it on a COPY of your vault first. Notes are only created, never overwritten, unless you pass
// --overwrite, which replaces a previously imported note as a whole (your own text in it included).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CsvError,
  fail,
  goodreads,
  loadHeadings,
  loadImportSettings,
  outputFolder,
  parseCsv,
  readJson,
  renderNote as renderBookNote,
  takenNames,
  walkMarkdown,
  withCsvMessages,
} from './import-library.mjs';

export {
  CsvError,
  cleanDate,
  cleanIsbn,
  neutralize,
  parseCsv,
  planNames,
  safeFileName,
} from './import-library.mjs';

const USAGE = `Usage: node import-goodreads.mjs <export.csv> --out <folder> [options]

Reads a Goodreads export and creates one Colophon note per book in <folder> (your library folder).
Without --apply it only prints a report and writes nothing. Run it on a copy of your vault first.

Options:
  --out <folder>        folder for the notes (required; created with --apply if missing)
  --apply               write the notes (default: report only)
  --overwrite           replace notes that were imported earlier (whole file; use on a copy)
  --config <file>       Colophon/config.json with your statuses, formats and categories
                        (default: the one next to this script)
  --map <file>          JSON file mapping Goodreads shelves to your values (see below)
  --language <code>     language of the note headings (default: the language in config.json, or en)
  --reviews             put "My Review" under the notes heading
  --private-notes       put "Private Notes" under the notes heading
  --help                show this text

Map file, all parts optional:
  { "categories": { "sci-fi": "science-fiction" }, "statuses": { "dnf": "abandoned" } }
  categories: a Goodreads shelf (Bookshelves column) -> a category key of your config
  statuses:   a custom exclusive shelf -> a status key of your config
Shelves without a mapping are listed in the report and are not written to the notes.

A book is recognised by its Goodreads "Book Id" (property goodreads_id), so running the import again
creates nothing new.`;

// ---- Goodreads values and conversion ---------------------------------------------------------
// The conversion, the identities and the plan are in Colophon/goodreads.js, shared with the import
// page in Obsidian. It reports problems as codes; the report below is their English text.

export const { REQUIRED_COLUMNS, BINDINGS, reviewText, convert } = goodreads;

export const renderNote = (book, headings) => renderBookNote(book, headings, book.provenance);

// ---- Files ------------------------------------------------------------------------------------

// Goodreads id -> the notes in the folder and its sub-folders that carry it (read from their properties).
export const existingImports = (dir) => {
  const found = new Map();
  for (const file of walkMarkdown(dir)) {
    for (const id of goodreads.noteIdentities(fs.readFileSync(file, 'utf8')))
      found.set(id, [...(found.get(id) ?? []), file]);
  }
  return found;
};

// ---- Command line -----------------------------------------------------------------------------

const list = (map, limit = 10) => {
  const entries = [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = entries.slice(0, limit).map(([name, n]) => `"${name}" (${n})`);
  return shown.join(', ') + (entries.length > limit ? `, and ${entries.length - limit} more` : '');
};

const MAP_PROBLEMS = {
  notObject: () => 'must be a JSON object with "categories" and "statuses"',
  unknownPart: ({ part }) => `unknown part "${part}"; use "categories" and "statuses"`,
  category: ({ shelf, value }) =>
    `shelf "${shelf}" maps to category "${value}", which is not in your config`,
  status: ({ shelf, value }) =>
    `shelf "${shelf}" maps to status "${value}", which is not in your config`,
};
const SKIPS = {
  fieldCount: ({ fields, expected }) => `has ${fields} fields, the header has ${expected}`,
  fieldTooLong: ({ column, limit }) => `"${column}" is longer than ${limit} characters`,
  invalidId: () => 'no valid Book Id',
  missingTitle: () => 'no title',
  duplicateId: ({ id }) => `Book Id ${id} appears twice`,
};
// Warnings printed one by one; the other codes are counted in the lines above them.
const WARNINGS = {
  noAuthor: () => 'no author',
  ratingOmitted: ({ value }) => `rating "${value}" ignored`,
  dateAddedOmitted: ({ value }) => `Date Added "${value}" ignored`,
  dateReadOmitted: ({ value }) => `Date Read "${value}" ignored`,
};

const main = () => {
  const argv = process.argv.slice(2);
  const flags = new Set(['apply', 'overwrite', 'reviews', 'private-notes', 'help']);
  const values = new Set(['out', 'config', 'map', 'language']);
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) positional.push(arg);
    else if (flags.has(arg.slice(2))) options[arg.slice(2)] = true;
    else if (values.has(arg.slice(2))) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`, 2);
      options[arg.slice(2)] = value;
    } else fail(`unknown option ${arg}\n\n${USAGE}`, 2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (positional.length !== 1) fail(`give exactly one Goodreads export file\n\n${USAGE}`, 2);
  if (!options.out) fail(`--out <folder> is required\n\n${USAGE}`, 2);

  const context = loadImportSettings(options);
  const { catalog } = context;
  const mapFile = options.map ? readJson(options.map, 'the map file') : {};
  const [problem] = goodreads.checkMap(mapFile, catalog);
  if (problem) fail(`${options.map}: ${MAP_PROBLEMS[problem.code](problem)}`);

  const headings = loadHeadings(options, context);
  const out = outputFolder(options);

  let records;
  try {
    records = parseCsv(fs.readFileSync(positional[0], 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fail(`${positional[0]} does not exist`);
    if (error instanceof CsvError) return fail(`${positional[0]}: ${error.message}`);
    throw error;
  }
  let input;
  try {
    input = withCsvMessages(() =>
      convert(records, goodreads.settingsOf(catalog), {
        reviews: options.reviews,
        privateNotes: options['private-notes'],
        categoryMap: mapFile.categories,
        statusMap: mapFile.statuses,
      }),
    );
  } catch (error) {
    if (error instanceof CsvError) return fail(`${positional[0]}: ${error.message}`);
    throw error;
  }

  // Idempotence: a book that is already in the folder (by Goodreads id) is skipped, or replaced with --overwrite.
  const existing = existingImports(out);
  const { fresh, known, skipped, names } = goodreads.plan(input, existing, takenNames(out));
  const writes = [
    ...fresh.map((b) => ({ book: b, file: path.join(out, names.get(b.id)), mode: 'create' })),
    ...(options.overwrite
      ? known.map((b) => ({ book: b, file: existing.get(b.id).at(-1), mode: 'overwrite' }))
      : []),
  ];

  // The report groups the codes of the conversion as earlier versions printed them.
  const books = input.books;
  const warningsOf = (code) =>
    books.flatMap((book) => book.warnings.filter((w) => w.code === code).map((w) => [book, w]));
  const tally = (pairs) => {
    const map = new Map();
    for (const [, { value }] of pairs) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  };
  const unknownShelf = new Map();
  for (const { value } of skipped.filter((s) => s.code === 'noStatus'))
    unknownShelf.set(value || '(empty)', (unknownShelf.get(value || '(empty)') ?? 0) + 1);
  const invalid = skipped.filter((s) => s.code !== 'noStatus');
  const unknownBinding = tally(warningsOf('formatUnknown'));
  const formatNotInConfig = tally(warningsOf('formatNotInConfig'));
  const rereads = warningsOf('rereadsUndated');
  const finishedWithoutDate = [...warningsOf('noFinishDate'), ...warningsOf('finishDateOmitted')];
  const editionYear = warningsOf('editionYear').length;
  const warnings = books.flatMap((book) =>
    book.warnings
      .filter((w) => Object.hasOwn(WARNINGS, w.code))
      .map((w) => `row ${book.row} (${book.title}): ${WARNINGS[w.code](w)}`),
  );

  console.log(`Goodreads import${options.apply ? '' : ' (dry run: nothing is written)'}`);
  console.log(`  file:    ${positional[0]} (${input.rows} row${input.rows === 1 ? '' : 's'})`);
  console.log(`  folder:  ${out}${fs.existsSync(out) ? '' : ' (will be created)'}`);
  console.log('');
  console.log(`${options.apply ? 'Created' : 'To create'}: ${fresh.length}`);
  if (options.overwrite)
    console.log(`${options.apply ? 'Replaced' : 'To replace'}: ${known.length}`);
  else if (known.length)
    console.log(`Skipped, already imported: ${known.length} (use --overwrite to replace them)`);
  const unknownCount = [...unknownShelf.values()].reduce((s, n) => s + n, 0);
  if (unknownCount) {
    console.log(
      `Skipped, unknown exclusive shelf: ${unknownCount}: ${list(unknownShelf)}. Map them with "statuses" in a --map file.`,
    );
  }
  if (invalid.length) {
    console.log(`Skipped, invalid rows: ${invalid.length}`);
    for (const row of invalid.slice(0, 10))
      console.log(`  row ${row.row}: ${SKIPS[row.code](row)}`);
  }
  if (unknownBinding.size)
    console.log(`Format not set, unrecognised Binding: ${list(unknownBinding)}`);
  if (formatNotInConfig.size)
    console.log(`Format not set, not in your config: ${list(formatNotInConfig)}`);
  if (input.unmapped.size)
    console.log(`Shelves not written, no category mapping: ${list(input.unmapped)}`);
  if (rereads.length) {
    console.log(
      `Read more than once: ${rereads.length} book(s). Goodreads does not export the dates of earlier reads, so no reread_count and no Reading history were created; add them with "Read again" if you want them.`,
    );
  }
  if (finishedWithoutDate.length) {
    console.log(
      `Finished without a Date Read, so no finished date was set: ${finishedWithoutDate.length}. Colophon wants one; add it in the note.`,
    );
  }
  if (editionYear)
    console.log(
      `publication_year taken from "Year Published" (the edition), no original year: ${editionYear}`,
    );
  for (const warning of warnings.slice(0, 20)) console.log(`warning: ${warning}`);
  if (warnings.length > 20) console.log(`warning: and ${warnings.length - 20} more`);

  if (!options.apply) {
    console.log('');
    console.log(writes.length ? 'Dry run. Add --apply to write the notes.' : 'Nothing to write.');
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  let written = 0;
  for (const { book, file, mode } of writes) {
    try {
      // "wx" fails if the file appeared since the plan was made, so a new note never replaces anything.
      fs.writeFileSync(file, renderNote(book, headings), { flag: mode === 'create' ? 'wx' : 'w' });
      written++;
    } catch (error) {
      console.error(`error: ${path.basename(file)}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log('');
  console.log(`Wrote ${written} note(s).`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
