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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  readJson,
  renderNote as renderBookNote,
  walkMarkdown,
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

// ---- Goodreads values -------------------------------------------------------------------------

export const REQUIRED_COLUMNS = ['Book Id', 'Title', 'Author', 'Exclusive Shelf'];

// Exclusive Shelf -> kind of status.
const SHELF_KINDS = { read: 'finished', 'currently-reading': 'in_progress', 'to-read': 'planned' };

// Binding -> format key, compared without case. Anything else sets no format and is reported.
export const BINDINGS = {
  hardcover: ['Hardcover'],
  paperback: ['Paperback', 'Mass Market Paperback'],
  ebook: ['Kindle Edition', 'ebook', 'e-book', 'Nook', 'Kindle'],
  audiobook: ['Audiobook', 'Audible Audio', 'Audio CD', 'Audio Cassette', 'Audio', 'Audible'],
};
const BINDING_LOOKUP = new Map(
  Object.entries(BINDINGS).flatMap(([format, names]) =>
    names.map((n) => [n.toLowerCase(), format]),
  ),
);

const positiveInt = (value) =>
  /^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Goodreads stores reviews as light HTML. Line breaks are kept, other tags are dropped.
export const reviewText = (html) =>
  html
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>\n]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
      if (name[0] === '#') {
        const code =
          name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ---- Conversion -------------------------------------------------------------------------------

// settings: { statusKeys(kind) -> keys, formats: Set, categories: Set }
// options: { reviews, privateNotes, categoryMap, statusMap, headings: { notes, quotes } }
export const convert = (records, settings, options = {}) => {
  const report = {
    rows: 0,
    invalid: [], // { row, reason }
    unknownShelf: new Map(), // exclusive shelf -> count (rows skipped)
    unknownBinding: new Map(), // Binding -> count (no format set)
    unmappedShelves: new Map(), // Bookshelves entry -> count (not written)
    formatNotInConfig: new Map(),
    rereads: [], // { title, count }
    finishedWithoutDate: [],
    editionYear: 0,
    warnings: [],
  };
  const [header, ...data] = records;
  if (!header) throw new CsvError('the file is empty');
  const column = new Map(header.map((name, i) => [name.trim(), i]));
  const missing = REQUIRED_COLUMNS.filter((name) => !column.has(name));
  if (missing.length) {
    throw new CsvError(
      `this does not look like a Goodreads export: missing column(s) ${missing.map((n) => `"${n}"`).join(', ')}`,
    );
  }
  const categoryMap = options.categoryMap ?? {};
  const statusMap = options.statusMap ?? {};
  const books = [];
  const seenIds = new Set();

  data.forEach((record, index) => {
    const rowNumber = index + 2; // the header is row 1
    report.rows++;
    const get = (name) => (column.has(name) ? (record[column.get(name)] ?? '') : '');
    if (record.length !== header.length) {
      report.invalid.push({
        row: rowNumber,
        reason: `has ${record.length} fields, the header has ${header.length}`,
      });
      return;
    }
    const id = get('Book Id')
      .trim()
      .replace(/^="?|"$/g, '');
    const title = get('Title').replace(/\s+/g, ' ').trim();
    if (!/^\d+$/.test(id))
      return report.invalid.push({ row: rowNumber, reason: 'no valid Book Id' });
    if (!title) return report.invalid.push({ row: rowNumber, reason: 'no title' });
    if (seenIds.has(id))
      return report.invalid.push({ row: rowNumber, reason: `Book Id ${id} appears twice` });
    seenIds.add(id);

    // Status comes from the exclusive shelf: three built-in shelves, or a shelf you map yourself.
    const shelf = get('Exclusive Shelf').trim();
    let status = null;
    let kind = SHELF_KINDS[shelf] ?? null;
    if (kind) status = settings.statusKeys(kind)[0];
    else if (Object.hasOwn(statusMap, shelf)) {
      status = statusMap[shelf];
      kind = settings.kindOf(status);
    }
    if (!status || !kind) {
      report.unknownShelf.set(
        shelf || '(empty)',
        (report.unknownShelf.get(shelf || '(empty)') ?? 0) + 1,
      );
      return;
    }

    const authors = [
      ...new Set(
        [get('Author'), ...get('Additional Authors').split(',')]
          .map((a) => a.replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      ),
    ];
    if (!authors.length) report.warnings.push(`row ${rowNumber} (${title}): no author`);

    const book = { id, title, authors, status, kind, row: rowNumber };

    const rating = Number(get('My Rating').trim() || 0);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) book.rating = rating;
    else if (!(rating === 0))
      report.warnings.push(`row ${rowNumber} (${title}): rating "${get('My Rating')}" ignored`);

    const binding = get('Binding').trim();
    if (binding) {
      const format = BINDING_LOOKUP.get(binding.toLowerCase());
      if (!format)
        report.unknownBinding.set(binding, (report.unknownBinding.get(binding) ?? 0) + 1);
      else if (!settings.formats.has(format)) {
        report.formatNotInConfig.set(format, (report.formatNotInConfig.get(format) ?? 0) + 1);
      } else book.format = format;
    }

    const pages = positiveInt(get('Number of Pages'));
    if (pages) book.pages = pages;
    // The original year says when the work appeared (1854 for Walden); "Year Published" is the year of
    // the edition that was shelved. The edition year is used only when the original year is missing.
    const original = positiveInt(get('Original Publication Year'));
    const edition = positiveInt(get('Year Published'));
    if (original) book.year = original;
    else if (edition) {
      book.year = edition;
      report.editionYear++;
    }

    const added = cleanDate(get('Date Added'));
    if (added) book.dateAdded = added;
    else if (get('Date Added').trim())
      report.warnings.push(
        `row ${rowNumber} (${title}): Date Added "${get('Date Added')}" ignored`,
      );
    const read = cleanDate(get('Date Read'));
    if (kind === 'finished') {
      if (read) book.finished = read;
      else report.finishedWithoutDate.push(title);
    } else if (get('Date Read').trim() && !read) {
      report.warnings.push(`row ${rowNumber} (${title}): Date Read "${get('Date Read')}" ignored`);
    }

    const isbn = cleanIsbn(get('ISBN'));
    const isbn13 = cleanIsbn(get('ISBN13'));
    if (isbn) book.isbn = isbn;
    if (isbn13) book.isbn13 = isbn13;

    // Bookshelves become categories only through the map file.
    const categories = [];
    for (const name of get('Bookshelves')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (name === shelf || Object.hasOwn(SHELF_KINDS, name)) continue;
      if (Object.hasOwn(categoryMap, name)) {
        if (!categories.includes(categoryMap[name])) categories.push(categoryMap[name]);
      } else report.unmappedShelves.set(name, (report.unmappedShelves.get(name) ?? 0) + 1);
    }
    if (categories.length) book.categories = categories;

    // Earlier reads have no dates in the export, so no reread_count and no history are created:
    // Colophon checks that the count matches the lines of the Reading history section.
    const readCount = Number(get('Read Count').trim() || 0);
    if (readCount > 1) report.rereads.push({ title, count: readCount });

    if (options.reviews && get('My Review').trim()) book.review = reviewText(get('My Review'));
    if (options.privateNotes && get('Private Notes').trim())
      book.privateNotes = reviewText(get('Private Notes'));
    books.push(book);
  });
  return { books, report };
};

export const renderNote = (book, headings) =>
  renderBookNote(book, headings, { goodreads_id: book.id });

// ---- Files ------------------------------------------------------------------------------------

// Goodreads ids of notes that are already in the folder (read from their properties only).
export const existingImports = (dir) => {
  const found = new Map();
  for (const file of walkMarkdown(dir)) {
    const head = fs.readFileSync(file, 'utf8').slice(0, 8192);
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    const id = front && /^goodreads_id:\s*["']?(\d+)["']?\s*$/m.exec(front[1]);
    if (id) found.set(id[1], file);
  }
  return found;
};

// ---- Command line -----------------------------------------------------------------------------

const list = (map, limit = 10) => {
  const entries = [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = entries.slice(0, limit).map(([name, n]) => `"${name}" (${n})`);
  return shown.join(', ') + (entries.length > limit ? `, and ${entries.length - limit} more` : '');
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

  const context = loadImportSettings(options, path.dirname(fileURLToPath(import.meta.url)));
  const { catalog } = context;
  const mapFile = options.map ? readJson(options.map, 'the map file') : {};
  for (const key of Object.keys(mapFile))
    if (!['categories', 'statuses'].includes(key))
      fail(`${options.map}: unknown part "${key}"; use "categories" and "statuses"`);
  for (const [shelf, target] of Object.entries(mapFile.categories ?? {})) {
    if (!catalog.has('category', target))
      fail(
        `${options.map}: shelf "${shelf}" maps to category "${target}", which is not in your config`,
      );
  }
  for (const [shelf, target] of Object.entries(mapFile.statuses ?? {})) {
    if (!catalog.has('status', target))
      fail(
        `${options.map}: shelf "${shelf}" maps to status "${target}", which is not in your config`,
      );
  }

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
  let result;
  try {
    result = convert(
      records,
      {
        statusKeys: (kind) => catalog.keysOfKind(kind),
        kindOf: catalog.kindOf,
        formats: new Set(catalog.formats.map((f) => f.key)),
      },
      {
        reviews: options.reviews,
        privateNotes: options['private-notes'],
        categoryMap: mapFile.categories,
        statusMap: mapFile.statuses,
      },
    );
  } catch (error) {
    if (error instanceof CsvError) return fail(`${positional[0]}: ${error.message}`);
    throw error;
  }
  const { books, report } = result;

  // Idempotence: a book that is already in the folder (by Goodreads id) is skipped, or replaced with --overwrite.
  const existing = existingImports(out);
  const fresh = books.filter((b) => !existing.has(b.id));
  const known = books.filter((b) => existing.has(b.id));
  const names = planNames(fresh, out);
  const writes = [
    ...fresh.map((b) => ({ book: b, file: path.join(out, names.get(b.id)), mode: 'create' })),
    ...(options.overwrite
      ? known.map((b) => ({ book: b, file: existing.get(b.id), mode: 'overwrite' }))
      : []),
  ];

  console.log(`Goodreads import${options.apply ? '' : ' (dry run: nothing is written)'}`);
  console.log(`  file:    ${positional[0]} (${report.rows} row${report.rows === 1 ? '' : 's'})`);
  console.log(`  folder:  ${out}${fs.existsSync(out) ? '' : ' (will be created)'}`);
  console.log('');
  console.log(`${options.apply ? 'Created' : 'To create'}: ${fresh.length}`);
  if (options.overwrite)
    console.log(`${options.apply ? 'Replaced' : 'To replace'}: ${known.length}`);
  else if (known.length)
    console.log(`Skipped, already imported: ${known.length} (use --overwrite to replace them)`);
  const skipped = [...report.unknownShelf.values()].reduce((s, n) => s + n, 0);
  if (skipped) {
    console.log(
      `Skipped, unknown exclusive shelf: ${skipped}: ${list(report.unknownShelf)}. Map them with "statuses" in a --map file.`,
    );
  }
  if (report.invalid.length) {
    console.log(`Skipped, invalid rows: ${report.invalid.length}`);
    for (const { row, reason } of report.invalid.slice(0, 10))
      console.log(`  row ${row}: ${reason}`);
  }
  if (report.unknownBinding.size)
    console.log(`Format not set, unrecognised Binding: ${list(report.unknownBinding)}`);
  if (report.formatNotInConfig.size)
    console.log(`Format not set, not in your config: ${list(report.formatNotInConfig)}`);
  if (report.unmappedShelves.size)
    console.log(`Shelves not written, no category mapping: ${list(report.unmappedShelves)}`);
  if (report.rereads.length) {
    console.log(
      `Read more than once: ${report.rereads.length} book(s). Goodreads does not export the dates of earlier reads, so no reread_count and no Reading history were created; add them with "Read again" if you want them.`,
    );
  }
  if (report.finishedWithoutDate.length) {
    console.log(
      `Finished without a Date Read, so no finished date was set: ${report.finishedWithoutDate.length}. Colophon wants one; add it in the note.`,
    );
  }
  if (report.editionYear)
    console.log(
      `publication_year taken from "Year Published" (the edition), no original year: ${report.editionYear}`,
    );
  for (const warning of report.warnings.slice(0, 20)) console.log(`warning: ${warning}`);
  if (report.warnings.length > 20) console.log(`warning: and ${report.warnings.length - 20} more`);

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
