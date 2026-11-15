// Colophon Goodreads import: the pure part, shared by the command-line importer and the import page.
//
// A function body like storygraph.js, called with one argument: `core`, the evaluated
// Colophon/storygraph.js, whose CSV parser, date and ISBN cleaning, file names and note text are
// reused here. It must not touch Node, Dataview, Obsidian or the DOM. Both runtimes evaluate it with
// `new Function('core', source)(core)`, so a CSV gives the same plan and the same notes in both.
//
// Problems are reported as data ({ code, ...details }), never as sentences: the command line prints
// its own English text and the import page uses the locale files.
const { CsvError, cleanDate, cleanIsbn } = core;

// ---- Goodreads values -------------------------------------------------------------------------

const REQUIRED_COLUMNS = ['Book Id', 'Title', 'Author', 'Exclusive Shelf'];

// Exclusive Shelf -> kind of status.
const SHELF_KINDS = { read: 'finished', 'currently-reading': 'in_progress', 'to-read': 'planned' };

// Binding -> format key, compared without case. Anything else sets no format and is reported.
const BINDINGS = {
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

// The columns the conversion reads. The field length limit applies to these only; the review and
// the private notes count only when they are imported.
const READ_COLUMNS = [
  ...REQUIRED_COLUMNS,
  'Additional Authors',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Binding',
  'Number of Pages',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Bookshelves',
  'Read Count',
];

const positiveInt = (value) =>
  /^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Goodreads stores reviews as light HTML. Line breaks are kept, other tags are dropped.
const reviewText = (html) =>
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

// ---- Settings ---------------------------------------------------------------------------------

// What the conversion needs of model.catalog(...).
const settingsOf = (catalog) => ({
  statusKeys: (kind) => catalog.keysOfKind(kind),
  kindOf: catalog.kindOf,
  formats: new Set(catalog.formats.map((f) => f.key)),
});

// map: { categories: { shelf: category }, statuses: { shelf: status } }, both parts optional.
// Returns the problems in the order the command line reports them; an empty list means usable.
const checkMap = (map, catalog) => {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [{ code: 'notObject' }];
  const problems = [];
  for (const part of Object.keys(map))
    if (!['categories', 'statuses'].includes(part)) problems.push({ code: 'unknownPart', part });
  for (const [group, part] of [
    ['category', 'categories'],
    ['status', 'statuses'],
  ]) {
    for (const [shelf, value] of Object.entries(map[part] ?? {}))
      if (!catalog.has(group, value)) problems.push({ code: group, shelf, value });
  }
  return problems;
};

// ---- Conversion -------------------------------------------------------------------------------

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

// records: the result of parseCsv; settings: settingsOf(catalog).
// options: { reviews, privateNotes, categoryMap, statusMap, maxFieldLength }
// Returns the books that can be imported (each with its warnings), the rows that cannot
// (`skipped`, kind "invalid"), the shelves of the file (`shelves`, for the shelf settings) and the
// shelves that were not written (`unmapped`).
const convert = (records, settings, options = {}) => {
  const [header, ...data] = records;
  if (!header) throw new CsvError('empty');
  const column = new Map(header.map((name, i) => [name.trim(), i]));
  const missing = REQUIRED_COLUMNS.filter((name) => !column.has(name));
  if (missing.length) throw new CsvError('notGoodreads', { columns: missing.join(', '), missing });
  const categoryMap = options.categoryMap ?? {};
  const statusMap = options.statusMap ?? {};
  const checked = [
    ...READ_COLUMNS,
    ...(options.reviews ? ['My Review'] : []),
    ...(options.privateNotes ? ['Private Notes'] : []),
  ].filter((name) => column.has(name));
  const books = [];
  const skipped = [];
  const exclusive = new Map(); // custom exclusive shelf -> rows
  const shelves = new Map(); // Bookshelves entry -> rows
  const unmapped = new Map(); // Bookshelves entry -> times it was not written
  const seenIds = new Set();
  const skip = (code, row, details) => skipped.push({ kind: 'invalid', code, row, ...details });

  data.forEach((record, index) => {
    const row = index + 2; // the header is row 1
    const get = (name) => (column.has(name) ? (record[column.get(name)] ?? '') : '');
    if (record.length !== header.length) {
      skip('fieldCount', row, { fields: record.length, expected: header.length });
      return;
    }
    const long = checked.find((name) => get(name).length > (options.maxFieldLength ?? Infinity));
    if (long) {
      skip('fieldTooLong', row, { column: long, limit: options.maxFieldLength });
      return;
    }
    const id = get('Book Id')
      .trim()
      .replace(/^="?|"$/g, '');
    const title = get('Title').replace(/\s+/g, ' ').trim();
    if (!/^\d+$/.test(id)) return skip('invalidId', row);
    if (!title) return skip('missingTitle', row);
    if (seenIds.has(id)) return skip('duplicateId', row, { title, id });
    seenIds.add(id);

    // Shelves of the file, whatever happens to the row below, so that every one can be mapped.
    const shelf = get('Exclusive Shelf').trim();
    const others = get('Bookshelves')
      .split(',')
      .map((s) => s.trim())
      .filter((name) => name && name !== shelf && !Object.hasOwn(SHELF_KINDS, name));
    if (shelf && !Object.hasOwn(SHELF_KINDS, shelf)) count(exclusive, shelf);
    for (const name of new Set(others)) count(shelves, name);

    // Status comes from the exclusive shelf: three built-in shelves, or a shelf you map yourself.
    let status = null;
    let kind = SHELF_KINDS[shelf] ?? null;
    if (kind) status = settings.statusKeys(kind)[0];
    else if (Object.hasOwn(statusMap, shelf)) {
      status = statusMap[shelf];
      kind = settings.kindOf(status);
    }
    if (!status || !kind) return skip('noStatus', row, { title, value: shelf });

    const warnings = [];
    const authors = [
      ...new Set(
        [get('Author'), ...get('Additional Authors').split(',')]
          .map((a) => a.replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      ),
    ];
    if (!authors.length) warnings.push({ code: 'noAuthor' });

    const book = {
      id,
      title,
      authors,
      status,
      kind,
      row,
      history: [],
      warnings,
      provenance: { goodreads_id: id },
    };

    const rating = Number(get('My Rating').trim() || 0);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) book.rating = rating;
    else if (!(rating === 0)) warnings.push({ code: 'ratingOmitted', value: get('My Rating') });

    const binding = get('Binding').trim();
    if (binding) {
      const format = BINDING_LOOKUP.get(binding.toLowerCase());
      if (!format) warnings.push({ code: 'formatUnknown', value: binding });
      else if (!settings.formats.has(format))
        warnings.push({ code: 'formatNotInConfig', value: format });
      else book.format = format;
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
      warnings.push({ code: 'editionYear', year: edition });
    }

    const added = cleanDate(get('Date Added'));
    if (added) book.dateAdded = added;
    else if (get('Date Added').trim())
      warnings.push({ code: 'dateAddedOmitted', value: get('Date Added') });
    const read = cleanDate(get('Date Read'));
    if (kind === 'finished') {
      if (read) book.finished = read;
      else if (get('Date Read').trim())
        warnings.push({ code: 'finishDateOmitted', value: get('Date Read') });
      else warnings.push({ code: 'noFinishDate' });
    } else if (get('Date Read').trim() && !read) {
      warnings.push({ code: 'dateReadOmitted', value: get('Date Read') });
    }

    const isbn = cleanIsbn(get('ISBN'));
    const isbn13 = cleanIsbn(get('ISBN13'));
    if (isbn) book.isbn = isbn;
    if (isbn13) book.isbn13 = isbn13;

    // Bookshelves become categories only through the map.
    const categories = [];
    for (const name of others) {
      if (Object.hasOwn(categoryMap, name)) {
        if (!categories.includes(categoryMap[name])) categories.push(categoryMap[name]);
      } else count(unmapped, name);
    }
    if (categories.length) book.categories = categories;

    // Earlier reads have no dates in the export, so no reread_count and no history are created:
    // Colophon checks that the count matches the lines of the Reading history section.
    const readCount = Number(get('Read Count').trim() || 0);
    if (readCount > 1) warnings.push({ code: 'rereadsUndated', count: readCount });

    if (options.reviews && get('My Review').trim()) book.review = reviewText(get('My Review'));
    if (options.privateNotes && get('Private Notes').trim())
      book.privateNotes = reviewText(get('Private Notes'));
    books.push(book);
  });
  return { books, skipped, rows: data.length, shelves: { exclusive, other: shelves }, unmapped };
};

// ---- Identities and the plan ------------------------------------------------------------------

// The Goodreads id written in the properties of a note, as a list (empty or one id).
const noteIdentities = (text) => {
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!front) return [];
  // The importer writes the id as a quoted YAML string; also accept a plain number and single
  // quotes, including an inline comment added by hand.
  const id = /^goodreads_id:[ \t]*(["']?)(\d+)\1(?:[ \t]+#.*)?[ \t]*$/m.exec(front)?.[2];
  return id ? [id] : [];
};

// input:      the result of convert
// existing:   Map of Goodreads id -> the notes of the library that carry it (any non-empty list)
// takenNames: names (without ".md") that exist in the library folder itself
// A book whose id is in any note of the library is already imported; nothing else is compared.
const plan = (input, existing, takenNames) => {
  const fresh = [];
  const known = [];
  for (const book of input.books) (existing.get(book.id)?.length ? known : fresh).push(book);
  return {
    fresh,
    known,
    skipped: [...input.skipped],
    names: core.planNames(fresh, takenNames),
    rows: input.rows,
  };
};

// Every code that can appear in a warning or a skipped row.
const CODES = {
  warning: [
    'noAuthor',
    'ratingOmitted',
    'formatUnknown',
    'formatNotInConfig',
    'editionYear',
    'dateAddedOmitted',
    'finishDateOmitted',
    'noFinishDate',
    'dateReadOmitted',
    'rereadsUndated',
  ],
  skip: ['fieldCount', 'fieldTooLong', 'invalidId', 'missingTitle', 'duplicateId', 'noStatus'],
};

return {
  REQUIRED_COLUMNS,
  SHELF_KINDS,
  BINDINGS,
  CODES,
  reviewText,
  settingsOf,
  checkMap,
  convert,
  noteIdentities,
  plan,
};
