// Shared parts of the local CSV importers. No npm dependencies.
import fs from 'node:fs';
import path from 'node:path';

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

// Also handles the spreadsheet wrapper used in Goodreads exports.
export const cleanIsbn = (value) => {
  const bare = value.trim().replace(/^="?/, '').replace(/"$/, '').replace(/[-\s]/g, '');
  return /^(\d{9}[\dXx]|\d{13})$/.test(bare) ? bare.toUpperCase() : null;
};

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

const yamlString = (s) => JSON.stringify(s);
// Config keys such as "null" or "1e3" must remain strings in the note.
const yamlKeyValue = (key) =>
  /^(?:[0-9]|(?:true|false|null)$)/i.test(key) ? yamlString(key) : key;

// The text of a note: the same layout as the book template, with imported text under the notes heading.
export const renderNote = (book, headings, ids) => {
  const lines = ['---', 'type: book', `title: ${yamlString(book.title)}`];
  if (book.authors.length)
    lines.push('author:', ...book.authors.map((a) => `  - ${yamlString(a)}`));
  lines.push(`status: ${yamlKeyValue(book.status)}`);
  if (book.format) lines.push(`format: ${book.format}`);
  if (book.categories) lines.push('category:', ...book.categories.map((c) => `  - ${c}`));
  if (book.rating) lines.push(`rating: ${book.rating}`);
  if (book.pages) lines.push(`pages: ${book.pages}`);
  if (book.year) lines.push(`publication_year: ${book.year}`);
  if (book.started) lines.push(`started: ${book.started}`);
  if (book.finished) lines.push(`finished: ${book.finished}`);
  if (book.dateAdded) lines.push(`date_added: ${book.dateAdded}`);
  if (book.isbn) lines.push(`isbn: ${yamlString(book.isbn)}`);
  if (book.isbn13) lines.push(`isbn13: ${yamlString(book.isbn13)}`);
  for (const [key, value] of Object.entries(ids)) lines.push(`${key}: ${yamlString(value)}`);
  if (book.history?.length) lines.push(`reread_count: ${book.history.length}`);
  lines.push('cssclasses:', '  - book-page', '---', '');
  lines.push('```dataviewjs', 'await dv.view("Colophon/book")', '```', '');
  lines.push(`## ${headings.notes}`, '');
  for (const text of [book.review, book.privateNotes]) if (text) lines.push(neutralize(text), '');
  lines.push(`## ${headings.quotes}`, '');
  if (book.history?.length) {
    lines.push(
      '## Reading history',
      '',
      ...book.history.map(({ startedOn, finishedOn }) => `- ${startedOn ?? '?'} → ${finishedOn}`),
      '',
    );
  }
  return lines.join('\n');
};

export const walkMarkdown = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walkMarkdown(full);
        return entry.name.toLowerCase().endsWith('.md') ? [full] : [];
      })
    : [];

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
    let name = candidates.find(
      (c) => Buffer.byteLength(`${c}.md`) <= 255 && !taken.has(nameKey(c)),
    );
    for (let n = 2; !name; n++) {
      const numbered = `${base} (${book.id}) ${n}`;
      if (!taken.has(nameKey(numbered))) name = numbered;
    }
    taken.add(nameKey(name));
    names.set(book.id, `${name}.md`);
  }
  return names;
};

export const fail = (message, code = 1) => {
  console.error(`error: ${message}`);
  process.exit(code);
};

export const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`${what} ${file} could not be read: ${error.message}`);
  }
};

export const loadImportSettings = (options, here) => {
  // Settings: the product folder next to the script, or in a clone of the repository.
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

  return { product, model, settings, catalog, english };
};

export const loadHeadings = (options, { product, model, settings, english }) => {
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

  return headings;
};

export const outputFolder = (options) => {
  const out = path.resolve(options.out);
  if (out.split(path.sep).includes('.obsidian')) fail('--out must not be inside .obsidian');
  if (fs.existsSync(out) && !fs.statSync(out).isDirectory()) fail(`${out} is not a folder`);

  return out;
};
