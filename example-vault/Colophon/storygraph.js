// Colophon StoryGraph import: the pure part, shared by the command-line importer and the import page.
//
// Like model.js this file is a function body, not a module: it takes no arguments and returns the
// API object at the end. It must not touch Node, Dataview, Obsidian or the DOM. Both runtimes
// evaluate it with `new Function(source)()`, so a CSV gives the same plan and the same notes in both.
//
// Problems are reported as data ({ code, ...details }), never as sentences: the command line prints
// its own English text and the import page uses the locale files.

// Checked before any conversion, in both runtimes. The file size is in bytes, a field in UTF-16
// code units. A title is cut to 180 bytes for the file name anyway, so the field limit only stops
// cells that no real export has.
const LIMITS = { fileBytes: 10 * 1024 * 1024, rows: 20000, fieldLength: 10000 };

const utf8 = new TextEncoder();
const utf8Length = (text) => utf8.encode(text).length;

// ---- CSV (RFC 4180) ---------------------------------------------------------------------------

class CsvError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

// Returns an array of records (arrays of strings). Handles a BOM, CRLF, LF and CR line ends, quoted
// fields with "" escapes and line breaks inside quotes, and a missing final line break.
// options.maxRecords stops the parser as soon as the file has more records than that.
const parseCsv = (input, { maxRecords = Infinity } = {}) => {
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
    // Blank lines are not records.
    if (!(row.length === 1 && row[0] === '')) {
      if (rows.length >= maxRecords) throw new CsvError('tooManyRows', { limit: maxRecords - 1 });
      rows.push(row);
    }
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
  if (quoted) throw new CsvError('unclosedQuote');
  if (started || field !== '' || row.length) endRow();
  return rows;
};

// 2019/03/24 (or 2019-03-24) -> 2019-03-24; null for anything that is not a real date.
const cleanDate = (value) => {
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
const cleanIsbn = (value) => {
  const bare = value.trim().replace(/^="?/, '').replace(/"$/, '').replace(/[-\s]/g, '');
  return /^(\d{9}[\dXx]|\d{13})$/.test(bare) ? bare.toUpperCase() : null;
};

// ---- Notes ------------------------------------------------------------------------------------

// Imported text must not become structure that Colophon or Dataview act on: a code fence could be a
// dataviewjs block that runs, "## Reading history" is parsed by the statistics, and a line starting
// with ">" would be offered as a quote. Such lines get a backslash, so they stay plain text.
const neutralize = (text) =>
  text
    .split('\n')
    .map((line) => (/^\s{0,3}(#|>|```|~~~)/.test(line) ? line.replace(/^(\s*)/, '$1\\') : line))
    .join('\n');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_BYTES = 180; // file systems allow 255; the suffixes below and ".md" need room
const MAX_FILE_BYTES = 255;

const safeFileName = (title) => {
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
  // The longest run of whole characters that fits.
  let bytes = 0;
  let kept = '';
  for (const letter of name) {
    bytes += utf8Length(letter);
    if (bytes > MAX_NAME_BYTES) break;
    kept += letter;
  }
  name = kept.replace(/[. ]+$/, '');
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
const renderNote = (book, headings, ids) => {
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

// Plans a file name for every book: the title, then "Title (Author)", then "Title (id)". Names in
// `taken` (file names without ".md"), or that another new note takes, are never reused, with or
// without case.
const planNames = (books, takenNames) => {
  const taken = new Set(Array.from(takenNames, nameKey));
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
      (c) => utf8Length(`${c}.md`) <= MAX_FILE_BYTES && !taken.has(nameKey(c)),
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

// ---- SHA-256 ----------------------------------------------------------------------------------
// The fingerprint of a row without a usable ID is the SHA-256 of its UTF-8 JSON text. The digest is
// computed here, not by the runtime, so Node and Obsidian (desktop and mobile) agree bit for bit.

// prettier-ignore
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

const sha256Hex = (text) => {
  const bytes = utf8.encode(text);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);
  // prettier-ignore
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, last] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (last +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          SHA256_K[i] +
          w[i]) |
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      last = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += last;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, '0')).join('');
};

// ---- Reading sessions -------------------------------------------------------------------------

// StoryGraph separates sessions with commas and joins their dates with a hyphen. Partial dates
// also appear in exports, but Colophon needs a day. Bare dates in Dates Read are finish dates.
const DATE_PART = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{4}(?:/\d{1,2}){0,2})`;
const RANGE = new RegExp(`^(${DATE_PART})?\\s*-\\s*(${DATE_PART})?$`);
const FULL_DATE = /^(?:\d{4}\/\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})$/;
const preciseDate = (value) => (value && FULL_DATE.test(value) ? cleanDate(value) : null);
const partialDate = (value) => {
  const parts = /^(\d{4})(?:\/(\d{1,2}))?$/.exec(value ?? '');
  if (!parts) return null;
  const [, year, month] = parts;
  if (!month) return year;
  return cleanDate(`${year}/${month}/1`)?.slice(0, 7) ?? null;
};

const parseStoryGraphReadings = (row, kind) => {
  const warnings = [];
  const completed = [];
  const openStarts = [];
  const partialFinishes = [];
  const datesRead = (row['Dates Read'] ?? '').trim();
  for (const session of datesRead
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const range = RANGE.exec(session);
    const start = range?.[1];
    const end = range ? range[2] : session;
    const startedOn = preciseDate(start);
    const finishedOn = preciseDate(end);
    const prefix = partialDate(end);
    if (start && !startedOn) warnings.push({ code: 'sessionStartOmitted', session });
    if (finishedOn) {
      if (startedOn && startedOn > finishedOn) {
        warnings.push({ code: 'sessionReversed', session });
      } else {
        completed.push({ startedOn, finishedOn });
      }
    } else if (startedOn && !end && kind === 'in_progress') {
      openStarts.push(startedOn);
    } else if (prefix) {
      partialFinishes.push({ prefix, session });
    } else {
      warnings.push({ code: 'sessionOmitted', session });
    }
  }
  completed.sort((a, b) => a.finishedOn.localeCompare(b.finishedOn));

  const rawLast = (row['Last Date Read'] ?? '').trim();
  const last = preciseDate(rawLast);
  if (rawLast && !last) warnings.push({ code: 'lastDateOmitted', value: rawLast });

  // An abandoned attempt can have dates without being a completed reading. Only keep
  // intervals within the completed history corroborated by Last Date Read.
  if (kind === 'abandoned') {
    const unconfirmed = completed.findIndex(({ finishedOn }) => !last || finishedOn > last);
    if (unconfirmed >= 0) {
      completed.splice(unconfirmed);
      warnings.push({ code: 'abandonedUnconfirmed' });
    }
  }

  const latest = completed.at(-1)?.finishedOn;
  const matchingPartial = last
    ? partialFinishes.findIndex(({ prefix }) => last.startsWith(`${prefix}-`))
    : -1;
  const laterPartial = (day) =>
    kind !== 'abandoned' && partialFinishes.some(({ prefix }) => prefix > day);
  if (last) {
    if (laterPartial(last)) {
      warnings.push({ code: 'lastDatePredates', date: last });
    } else if (last !== latest) {
      const canFillMissing =
        matchingPartial >= 0 || (!latest && !partialFinishes.length) || kind === 'abandoned';
      if (canFillMissing && (!latest || last > latest)) {
        completed.push({ startedOn: null, finishedOn: last });
        if (matchingPartial >= 0) partialFinishes.splice(matchingPartial, 1);
      } else {
        warnings.push({ code: 'lastDateDisagrees', date: last });
      }
    }
  }
  for (const { session } of partialFinishes) warnings.push({ code: 'sessionOmitted', session });

  const rawCount = (row['Read Count'] ?? '').trim();
  const count = Number(rawCount);
  if (rawCount && (!/^\d+$/.test(rawCount) || !Number.isSafeInteger(count))) {
    warnings.push({ code: 'readCountInvalid', value: rawCount });
  } else if (rawCount && count > completed.length) {
    warnings.push({ code: 'readCountMore', count, dated: completed.length });
  } else if (rawCount && count < completed.length) {
    warnings.push({ code: 'readCountFewer', count, dated: completed.length });
  }
  if (new Set(completed.map(({ finishedOn }) => finishedOn)).size < completed.length) {
    warnings.push({ code: 'sameDayFinishes' });
  }

  let startedOn = null;
  let finishedOn = null;
  if (kind === 'finished') {
    const current = completed.at(-1);
    if (current && !laterPartial(current.finishedOn)) {
      ({ startedOn, finishedOn } = completed.pop());
    } else warnings.push({ code: 'noConfirmedFinish' });
  } else if (openStarts.length) {
    const previousFinish = completed.at(-1)?.finishedOn;
    if (openStarts.length === 1 && (!previousFinish || openStarts[0] >= previousFinish)) {
      startedOn = openStarts[0];
    } else {
      warnings.push({ code: 'noSingleStart' });
    }
  }

  return { startedOn, finishedOn, history: completed, warnings };
};

// ---- StoryGraph rows --------------------------------------------------------------------------

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
const REQUIRED_COLUMNS = ['Title', 'Authors', 'ISBN/UID', 'Read Status'];

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
  const hash = sha256Hex(JSON.stringify(cells)).slice(0, 32);
  return { ...(raw ? { storygraph_uid: raw } : {}), storygraph_row: hash };
};

const normalizeText = (value) => value.replace(/\s+/g, ' ').trim();

// records: the result of parseCsv; catalog: model.catalog(...) of the vault's settings.
// Returns the books that can be imported and the rows that cannot (`skipped`, kind "invalid").
const convert = (records, catalog) => {
  const [headers, ...rows] = records;
  if (!headers) throw new CsvError('empty');
  const keys = headers.map((header) => header.trim());
  if (new Set(keys).size !== keys.length) throw new CsvError('duplicateColumns');
  const missing = REQUIRED_COLUMNS.filter((key) => !keys.includes(key));
  if (missing.length) throw new CsvError('missingColumns', { columns: missing.join(', ') });

  const books = [];
  const skipped = [];
  const skip = (code, row, details) => skipped.push({ kind: 'invalid', code, row, ...details });
  rows.forEach((cells, index) => {
    const number = index + 2;
    if (cells.length !== keys.length) {
      skip('fieldCount', number, { fields: cells.length, expected: keys.length });
      return;
    }
    if (cells.some((cell) => cell.length > LIMITS.fieldLength)) {
      skip('fieldTooLong', number, { limit: LIMITS.fieldLength });
      return;
    }

    const row = Object.fromEntries(keys.map((key, i) => [key, cells[i]]));
    const title = normalizeText(row.Title);
    const authors = [...new Set(row.Authors.split(',').map(normalizeText).filter(Boolean))];
    if (!title || !authors.length) {
      skip(title ? 'missingAuthors' : 'missingTitle', number);
      return;
    }

    const readStatus = row['Read Status'].trim();
    const kind = STATUS_KINDS.get(readStatus);
    const status = catalog.keysOfKind(kind)[0];
    if (!status) {
      skip('noStatus', number, { title, value: readStatus });
      return;
    }

    const { startedOn, finishedOn, history, warnings } = parseStoryGraphReadings(row, kind);
    if (readStatus === 'paused') warnings.push({ code: 'pausedAsInProgress' });
    const ids = identifiers(row);
    const { isbn, isbn13, ...provenance } = ids;
    if (!ids.storygraph_id)
      warnings.push({ code: ids.storygraph_uid ? 'idUnrecognised' : 'idMissing' });
    const book = {
      id: ids.storygraph_id ?? `row-${ids.storygraph_row}`,
      row: number,
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
        warnings.push({ code: 'ratingOmitted', value: ratingText });
      }
    }
    const formatText = row.Format?.trim();
    if (formatText) {
      const format = FORMATS.get(formatText.toLowerCase());
      if (catalog.has('format', format)) book.format = format;
      else warnings.push({ code: 'formatOmitted', value: formatText });
    }
    const added = row['Date Added']?.trim();
    if (added) {
      book.dateAdded = cleanDate(added);
      if (!book.dateAdded) warnings.push({ code: 'dateAddedOmitted', value: added });
    }
    books.push(book);
  });
  return { books, skipped, rows: rows.length };
};

// ---- Identities and the plan ------------------------------------------------------------------

// The import identities written in the properties of a note: "<storygraph_id>" and "row-<hash>".
const noteIdentities = (text) => {
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!front) return [];
  // The importer writes ASCII IDs as quoted YAML strings; also accept plain scalars
  // and single quotes, including inline comments added by hand.
  const id = /^storygraph_id:[ \t]*(["']?)([A-Z0-9]+)\1(?:[ \t]+#.*)?[ \t]*$/m.exec(front)?.[2];
  const row = /^storygraph_row:[ \t]*(["']?)([a-f0-9]{32})\1(?:[ \t]+#.*)?[ \t]*$/m.exec(
    front,
  )?.[2];
  return [...(id ? [id] : []), ...(row ? [`row-${row}`] : [])];
};

// input:      the result of convert
// existing:   Map of identity -> the notes of the library that carry it (any non-empty list)
// takenNames: names (without ".md") that exist in the library folder itself
// Returns the books to create with their file names, the books that are already imported and every
// skipped row: the invalid ones first, then those whose identity is ambiguous.
const plan = (input, existing, takenNames) => {
  const source = new Map();
  for (const book of input.books) source.set(book.id, (source.get(book.id) ?? 0) + 1);

  const fresh = [];
  const known = [];
  const skipped = [...input.skipped];
  for (const book of input.books) {
    const matches = existing.get(book.id)?.length ?? 0;
    const ambiguous = (code, details) =>
      skipped.push({ kind: 'ambiguous', code, row: book.row, title: book.title, ...details });
    if (source.get(book.id) > 1) ambiguous('ambiguousRows');
    else if (matches > 1) ambiguous('ambiguousNotes', { count: matches });
    else if (matches === 1) known.push(book);
    else fresh.push(book);
  }
  return { fresh, known, skipped, names: planNames(fresh, takenNames), rows: input.rows };
};

// Every code that can appear in a warning, a skipped row or a CsvError.
const CODES = {
  warning: [
    'sessionStartOmitted',
    'sessionReversed',
    'sessionOmitted',
    'lastDateOmitted',
    'abandonedUnconfirmed',
    'lastDatePredates',
    'lastDateDisagrees',
    'readCountInvalid',
    'readCountMore',
    'readCountFewer',
    'sameDayFinishes',
    'noConfirmedFinish',
    'noSingleStart',
    'pausedAsInProgress',
    'idUnrecognised',
    'idMissing',
    'ratingOmitted',
    'formatOmitted',
    'dateAddedOmitted',
  ],
  skip: [
    'fieldCount',
    'fieldTooLong',
    'missingTitle',
    'missingAuthors',
    'noStatus',
    'ambiguousRows',
    'ambiguousNotes',
  ],
  error: [
    'tooLarge',
    'tooManyRows',
    'unclosedQuote',
    'empty',
    'duplicateColumns',
    'missingColumns',
  ],
};

return {
  LIMITS,
  CODES,
  CsvError,
  parseCsv,
  cleanDate,
  cleanIsbn,
  neutralize,
  safeFileName,
  nameKey,
  utf8Length,
  renderNote,
  planNames,
  sha256Hex,
  parseStoryGraphReadings,
  convert,
  noteIdentities,
  plan,
};
