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

// ---- CSV (RFC 4180) ---------------------------------------------------------------------------

export class CsvError extends Error {}

// Returns an array of records (arrays of strings). Handles a BOM, CRLF, LF and CR line ends, quoted
// fields with "" escapes and line breaks inside quotes, and a missing final line break.
export const parseCsv = (input) => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false; // the current field has begun (so an empty quoted field is not "nothing")
  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && !started) {
      quoted = true;
      started = true;
    } else if (c === ',') endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
      started = true;
    }
  }
  if (quoted) throw new CsvError('the file ends inside a quoted field (a quote is not closed)');
  if (started || field !== '' || row.length) endRow();
  // Blank lines are not records.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
};

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

// Goodreads writes ISBNs as ="0143039431" so that spreadsheets keep leading zeros.
export const cleanIsbn = (value) => {
  const bare = value.trim().replace(/^="?/, '').replace(/"$/, '').replace(/[-\s]/g, '');
  return /^(\d{9}[\dXx]|\d{13})$/.test(bare) ? bare.toUpperCase() : null;
};

// 2019/03/24 (or 2019-03-24) -> 2019-03-24; null for anything that is not a real date.
export const cleanDate = (value) => {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

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

// Imported text must not become structure that Colophon or Dataview act on: a code fence could be a
// dataviewjs block that runs, "## Reading history" is parsed by the statistics, and a line starting
// with ">" would be offered as a quote. Such lines get a backslash, so they stay plain text.
export const neutralize = (text) =>
  text
    .split('\n')
    .map((line) => (/^\s{0,3}(#|>|```|~~~)/.test(line) ? line.replace(/^(\s*)/, '$1\\') : line))
    .join('\n');

// ---- File names -------------------------------------------------------------------------------

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_BYTES = 180; // file systems allow 255; the suffixes below and ".md" need room

export const safeFileName = (title) => {
  let name = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/:/g, ' -')
    .replace(/[\\/]/g, ' ')
    .replace(/[*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ - -/g, ' -')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  const letters = Array.from(name);
  while (Buffer.byteLength(letters.join('')) > MAX_NAME_BYTES) letters.pop();
  name = letters.join('').replace(/[. ]+$/, '');
  if (!name) name = 'Untitled';
  if (RESERVED.test(name)) name += '_';
  return name;
};
// Names are equal when a case-insensitive, normalization-insensitive file system treats them as equal.
const nameKey = (name) => name.normalize('NFC').toLowerCase();

// ---- Conversion -------------------------------------------------------------------------------

const yamlString = (s) => JSON.stringify(s);

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

// The text of a note: the same layout as the book template, with imported text under the notes heading.
export const renderNote = (book, headings) => {
  const lines = ['---', 'type: book', `title: ${yamlString(book.title)}`];
  if (book.authors.length)
    lines.push('author:', ...book.authors.map((a) => `  - ${yamlString(a)}`));
  lines.push(`status: ${book.status}`);
  if (book.format) lines.push(`format: ${book.format}`);
  if (book.categories) lines.push('category:', ...book.categories.map((c) => `  - ${c}`));
  if (book.rating) lines.push(`rating: ${book.rating}`);
  if (book.pages) lines.push(`pages: ${book.pages}`);
  if (book.year) lines.push(`publication_year: ${book.year}`);
  if (book.finished) lines.push(`finished: ${book.finished}`);
  if (book.dateAdded) lines.push(`date_added: ${book.dateAdded}`);
  if (book.isbn) lines.push(`isbn: ${yamlString(book.isbn)}`);
  if (book.isbn13) lines.push(`isbn13: ${yamlString(book.isbn13)}`);
  lines.push(`goodreads_id: ${yamlString(book.id)}`, 'cssclasses:', '  - book-page', '---', '');
  lines.push('```dataviewjs', 'await dv.view("Colophon/book")', '```', '');
  lines.push(`## ${headings.notes}`, '');
  for (const text of [book.review, book.privateNotes]) if (text) lines.push(neutralize(text), '');
  lines.push(`## ${headings.quotes}`, '');
  return lines.join('\n');
};

// ---- Files ------------------------------------------------------------------------------------

const walkMarkdown = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walkMarkdown(full);
        return entry.name.toLowerCase().endsWith('.md') ? [full] : [];
      })
    : [];

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

// Plans a file name for every book: the title, then "Title (Author)", then "Title (id)". Names that
// exist in the folder, or that another new note takes, are never reused, with or without case.
export const planNames = (books, dir) => {
  const taken = new Set(
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.toLowerCase().endsWith('.md'))
          .map((f) => nameKey(f.slice(0, -3)))
      : [],
  );
  const names = new Map();
  for (const book of books) {
    const base = safeFileName(book.title);
    const author = safeFileName(book.authors[0] ?? '');
    const candidates = [
      base,
      ...(book.authors.length ? [`${base} (${author})`] : []),
      `${base} (${book.id})`,
    ];
    let name = candidates.find((c) => !taken.has(nameKey(c)));
    for (let n = 2; !name; n++) {
      const numbered = `${base} (${book.id}) ${n}`;
      if (!taken.has(nameKey(numbered))) name = numbered;
    }
    taken.add(nameKey(name));
    names.set(book.id, `${name}.md`);
  }
  return names;
};

// ---- Command line -----------------------------------------------------------------------------

const fail = (message, code = 1) => {
  console.error(`error: ${message}`);
  process.exit(code);
};

const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`${what} ${file} could not be read: ${error.message}`);
  }
};

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

  // Settings: the product folder next to the script, or in a clone of the repository.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const product = [
    path.join(here, 'Colophon'),
    path.join(here, '..', '..', 'example-vault', 'Colophon'),
  ].find((d) => fs.existsSync(path.join(d, 'model.js')));
  if (!product) fail('the Colophon folder was not found next to this script');
  const model = new Function(fs.readFileSync(path.join(product, 'model.js'), 'utf8'))();
  const settings = model.resolve(
    readJson(options.config ?? path.join(product, 'config.json'), 'the config'),
  );
  const english = readJson(path.join(product, 'locales', 'en.json'), 'the locale');
  if (settings.problems.length) {
    for (const problem of settings.problems) {
      const { key, params } = model.problemMessage(problem);
      console.error(
        `error: config: ${english[key].replace(/\{(\w+)\}/g, (m, n) => params[n] ?? m)}`,
      );
    }
    process.exit(1);
  }
  const catalog = model.catalog(settings, 'en', (key) => english[key]);

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

  const wanted = options.language ?? (settings.language === 'auto' ? 'en' : settings.language);
  const code = fs
    .readdirSync(path.join(product, 'locales'))
    .map((f) => f.slice(0, -5))
    .find((c) => model.normalizeTag(c) === model.normalizeTag(wanted));
  if (!code) fail(`language "${wanted}" is not available`, 2);
  const messages = {
    ...english,
    ...readJson(path.join(product, 'locales', `${code}.json`), 'the locale'),
  };
  const headings = { notes: messages['template.notes'], quotes: messages['template.quotes'] };

  const out = path.resolve(options.out);
  if (out.split(path.sep).includes('.obsidian')) fail('--out must not be inside .obsidian');
  if (fs.existsSync(out) && !fs.statSync(out).isDirectory()) fail(`${out} is not a folder`);

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
