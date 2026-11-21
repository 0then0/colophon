// These headings and their order come from StoryGraph's Bulk Import Template.
const HEADERS = [
  'Book Id',
  'Title',
  'Author',
  'Author l-f',
  'Additional Authors',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Average Rating',
  'Publisher',
  'Binding',
  'Number of Pages',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Bookshelves',
  'Bookshelves with positions',
  'Exclusive Shelf',
  'My Review',
  'Spoiler',
  'Private Notes',
  'Read Count',
  'Owned Copies',
];
const SHELVES = new Map([
  ['planned', 'to-read'],
  ['in_progress', 'currently-reading'],
  ['finished', 'read'],
  ['abandoned', 'did-not-finish'],
]);

const hasValue = (value) => value != null && (typeof value !== 'string' || value.trim() !== '');
const hasText = (value) => typeof value === 'string' && hasValue(value);
const csvDate = (date) => (date ? date.replaceAll('-', '/') : '');

// Invalid YAML values still need to appear in warnings. Objects may have their own toString key.
const displayValue = (value) => {
  if (value == null || typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Array.isArray(value) ? '[...]' : '{...}';
  }
};

// Skip a row rather than adding an apostrophe or tab to a title or author that must match.
// Quoting protects cell boundaries but does not stop spreadsheet formula evaluation.
const formulaPrefix = /^[\t\r\n]|^\s*[=+\-@\uff1d\uff0b\uff0d\uff20]/u;

const createPlanner = ({ kindOf, cleanDate, validatedIsbn, toIsbn13 }) => {
  const dateOf = (value) => (hasText(value) ? cleanDate(value) : null);
  const finishOf = (started, finished) => {
    const from = dateOf(started);
    const to = dateOf(finished);
    return to && (!from || to >= from) ? to : null;
  };

  return ({ path, name, props, history }) => {
    const messages = [];
    const add = (key, params) => messages.push({ key, params });
    const title = hasText(props.title) ? props.title : name;
    const authorValues = Array.isArray(props.author) ? props.author : [props.author];
    const [author, ...others] = authorValues.filter(hasText);
    const additional = others.join(', ');
    const kind = kindOf(props.status);
    const shelf = SHELVES.get(kind);
    const added = dateOf(props.date_added);

    if (!author) add('export.noAuthor');
    if (!hasValue(props.status)) add('export.noStatus');
    else if (!shelf) add('export.unknownStatus', { status: displayValue(props.status) });
    if (!hasValue(props.date_added)) add('export.noAdded');
    else if (!added) add('export.invalidAdded', { value: displayValue(props.date_added) });
    const textFields = { Title: title, Author: author, 'Additional Authors': additional };
    const riskyColumns = Object.keys(textFields).filter((field) =>
      formulaPrefix.test(textFields[field]),
    );
    if (riskyColumns.length) add('export.formula', { columns: riskyColumns });
    if (messages.length) return { path, title, messages, cells: null };

    if (title !== props.title) add('export.titleFromNote');
    if (authorValues.some((value) => !hasText(value))) add('export.authorOmitted');
    if (others.some((value) => value.includes(','))) add('export.authorComma');
    if (props.status !== kind) add('export.customStatus', { status: props.status, shelf });

    const isFinished = kind === 'finished';
    const rating = props.rating;
    const validRating =
      typeof rating === 'number' && rating >= 0.5 && rating <= 5 && Number.isInteger(rating * 2);
    const score = isFinished && validRating ? rating : 0;
    if (hasValue(rating) && rating !== 0 && !score)
      add(isFinished ? 'export.invalidRating' : 'export.unreadRating', {
        value: displayValue(rating),
      });

    const isbns = [];
    for (const field of ['isbn13', 'isbn']) {
      const value = props[field];
      if (!hasValue(value)) continue;
      const isbn =
        typeof value === 'number' || typeof value === 'string'
          ? validatedIsbn(String(value))
          : null;
      if (isbn) isbns.push(isbn);
      else add('export.invalidIsbn', { field, value: displayValue(value) });
    }
    const isbn13 = isbns.length ? toIsbn13(isbns[0]) : '';
    const isbn10 = isbns.find((isbn) => isbn.length === 10 && toIsbn13(isbn) === isbn13) ?? '';
    if (isbns.some((isbn) => toIsbn13(isbn) !== isbn13))
      add('export.conflictingIsbn', { isbn: isbn13 });
    if (!isbn13) add('export.noIsbn');

    const current = finishOf(props.started, props.finished);
    if (hasValue(props.finished) && !current)
      add('export.invalidFinished', { value: displayValue(props.finished) });
    const historical = (history ?? [])
      .map(({ started, finished }) => finishOf(started, finished))
      .filter(Boolean);
    const count = props.reread_count;
    const expectedHistory =
      typeof count === 'number' || typeof count === 'string' ? Number(count) || 0 : 0;
    if (history === null || historical.length < Math.max(history?.length ?? 0, expectedHistory))
      add('export.incompleteHistory');
    const dates = [...new Set([current, ...historical].filter(Boolean))].sort().reverse();
    const finished = isFinished ? dates[0] : null;
    if (isFinished && !finished) add('export.noFinished');
    if (finished && finished !== current) add('export.historyDate', { date: csvDate(finished) });
    const omitted = dates.filter((date) => date !== finished).map(csvDate);
    if (omitted.length) add('export.omittedDates', { dates: omitted });

    const cells = {
      ...textFields,
      ISBN: isbn10,
      ISBN13: isbn13,
      'My Rating': String(score),
      'Date Read': csvDate(finished),
      'Date Added': csvDate(added),
      'Exclusive Shelf': shelf,
      'Read Count': isFinished ? '1' : '0',
    };
    return { path, title, messages, cells };
  };
};

const csv = (rows) => {
  const quote = (value) => `"${value.replaceAll('"', '""')}"`;
  const records = rows.map(({ cells }) =>
    HEADERS.map((column) => quote(cells[column] ?? '')).join(','),
  );
  return [HEADERS.join(','), ...records, ''].join('\r\n');
};

return { createPlanner, csv };
