import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { COLOPHON, model, read } from '../lib/common.mjs';

const core = new Function(read(path.join(COLOPHON, 'storygraph.js')))();
const { createPlanner, csv } = new Function(
  read(path.join(COLOPHON, 'export-storygraph', 'engine.js')),
)();
const config = model.resolve({
  statuses: [...model.KINDS, { key: 'on_hold', kind: 'in_progress' }],
});
const { kindOf } = model.catalog(config, 'en', () => null);
const plan = createPlanner({ kindOf, ...core });
const book = (props = {}, history = []) =>
  plan({
    path: 'Books/Library/Example.md',
    name: 'Example',
    props: Object.freeze({
      title: 'Example book',
      author: 'A. Reader',
      status: 'planned',
      date_added: '2024-01-01',
      ...props,
    }),
    history,
  });
const codes = ({ messages }) => messages.map(({ key }) => key);

test('writes the official header and keeps ISBNs, rating, Unicode and multiline text as data', () => {
  const title = 'Книга, "цитата"\n第二行';
  const author = 'Ana "Luz", Jr.';
  const row = book({
    title,
    author: Object.freeze([author, '佐藤 美咲']),
    isbn: '0141439513',
    rating: 4.5,
    status: 'finished',
    finished: '2024-01-02',
  });
  const text = csv([row]);
  const header =
    'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';
  assert.ok(text.startsWith(`${header}\r\n`));
  assert.ok(text.endsWith('\r\n'));
  const [columns, cells] = core.parseCsv(text);
  assert.equal(cells.length, columns.length);
  const record = Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  assert.equal(record.Title, title);
  assert.equal(record.Author, author);
  assert.equal(record['Additional Authors'], '佐藤 美咲');
  assert.equal(record.ISBN, '0141439513');
  assert.equal(record.ISBN13, '9780141439518');
  assert.equal(record['My Rating'], '4.5');
  assert.equal(record['Date Added'], '2024/01/01');
  assert.equal(record['Date Read'], '2024/01/02');
  assert.equal(record['Exclusive Shelf'], 'read');
  assert.equal(record['Read Count'], '1');
  assert.equal(record['Private Notes'], '');
  assert.equal(record['My Review'], '');
});

test('uses the latest confirmed finish date from the history section and lists omitted dates', () => {
  const history = model.parseReadingHistory(
    [
      '## Notes',
      '- ? → 2099-01-01',
      '## Reading history',
      '- ? → 2022-05-06',
      '- 2023-01-01 -> 2023-01-02',
      '- 2025-02-01 → 2025-02-02',
      '- ? → ?',
      '- ? → 2025-02-31',
      '- 2025-12-25 → 2025-12-24',
      '## Quotes',
      '- ? → 2099-02-02',
    ].join('\r\n'),
  );
  const row = book({ status: 'finished', finished: '2024-02-01', reread_count: 6 }, history);
  assert.equal(row.cells['Date Read'], '2025/02/02');
  assert.equal(row.cells['Read Count'], '1');
  assert.ok(codes(row).includes('export.incompleteHistory'));
  assert.deepEqual(
    row.messages.find((message) => message.key === 'export.omittedDates').params.dates,
    ['2024/02/01', '2023/01/02', '2022/05/06'],
  );
  assert.ok(codes(row).includes('export.historyDate'));
  assert.equal(core.parseCsv(csv([row])).length, 2);
});

test('only exports dates from the real reading history, even with Markdown examples', () => {
  const history = model.parseReadingHistory(
    [
      '---',
      '## Reading history', // A YAML comment.
      '---',
      '## Notes',
      '````markdown',
      '## Reading history',
      '- ? → 2099-01-01',
      '```',
      '- ? → 2099-01-02',
      '````',
      '<!--',
      '## Reading history',
      '- ? → 2099-01-03',
      '-->',
      '## Reading history',
      '- ? → 2023-01-02',
      '~~~markdown',
      '## Quotes',
      '- ? → 2099-01-04',
      '~~~',
      '- ? → 2024-01-02',
      '## Quotes',
      '- ? → 2099-01-05',
    ].join('\r\n'),
  );
  const row = book({ status: 'finished', finished: '2024-01-01', reread_count: 2 }, history);
  assert.equal(row.cells['Date Read'], '2024/01/02');
  assert.deepEqual(row.messages.find(({ key }) => key === 'export.omittedDates').params.dates, [
    '2024/01/01',
    '2023/01/02',
  ]);
  assert.ok(!codes(row).includes('export.incompleteHistory'));
});

test('a current reread or an abandoned attempt never uses an older finish date as its own', () => {
  const history = [{ started: '?', finished: '2023-05-06' }];
  for (const [status, shelf] of [
    ['on_hold', 'currently-reading'],
    ['abandoned', 'did-not-finish'],
  ]) {
    const row = book({ status, rating: 4.5, started: '2025-01-01', reread_count: 1 }, history);
    assert.equal(row.cells['Exclusive Shelf'], shelf);
    assert.equal(row.cells['Date Read'], '');
    assert.equal(row.cells['Read Count'], '0');
    assert.equal(row.cells['My Rating'], '0');
    assert.deepEqual(
      row.messages.find((message) => message.key === 'export.omittedDates').params.dates,
      ['2023/05/06'],
    );
    assert.ok(codes(row).includes('export.unreadRating'));
    if (status === 'on_hold') {
      assert.deepEqual(
        row.messages.find((message) => message.key === 'export.customStatus').params,
        { status, shelf },
      );
    }
  }
});

test('skips books missing required data and keeps a finished book without its optional date', () => {
  const missing = book({ author: [], status: 'unknown', date_added: undefined });
  assert.equal(missing.cells, null);
  assert.deepEqual(codes(missing), ['export.noAuthor', 'export.unknownStatus', 'export.noAdded']);
  const invalid = book({ date_added: '2024-02-31' });
  assert.equal(invalid.cells, null);
  assert.deepEqual(codes(invalid), ['export.invalidAdded']);
  const row = book({
    status: 'finished',
    rating: 4.25,
    started: '2024-03-15',
    finished: '2024-03-13',
  });
  assert.equal(row.cells['Exclusive Shelf'], 'read');
  assert.equal(row.cells['Date Read'], '');
  assert.equal(row.cells['Read Count'], '1');
  assert.equal(row.cells['My Rating'], '0');
  assert.ok(codes(row).includes('export.noFinished'));
  assert.ok(codes(row).includes('export.invalidFinished'));
  assert.ok(codes(row).includes('export.invalidRating'));
  const planned = book();
  assert.equal(planned.cells['Exclusive Shelf'], 'to-read');
  assert.equal(planned.cells['Read Count'], '0');
});

test('omits a conflicting or invalid ISBN without guessing an identifier', () => {
  const conflict = book({ isbn: '0141439513', isbn13: '9780374602642' });
  assert.equal(conflict.cells.ISBN, '');
  assert.equal(conflict.cells.ISBN13, '9780374602642');
  assert.ok(codes(conflict).includes('export.conflictingIsbn'));
  const invalid = book({ isbn: 141439513, isbn13: '9780374602643' });
  assert.equal(invalid.cells.ISBN, '');
  assert.equal(invalid.cells.ISBN13, '');
  assert.deepEqual(codes(invalid), ['export.invalidIsbn', 'export.invalidIsbn', 'export.noIsbn']);
});

test('reports malformed YAML properties without aborting the rest of the export', () => {
  const invalid = { toString: 'finished' };
  const skipped = book({ status: invalid, date_added: invalid });
  assert.equal(skipped.cells, null);
  assert.deepEqual(codes(skipped), ['export.unknownStatus', 'export.invalidAdded']);
  assert.equal(skipped.messages[0].params.status, '{"toString":"finished"}');

  const row = book({
    status: 'finished',
    rating: invalid,
    isbn: invalid,
    finished: invalid,
    reread_count: invalid,
  });
  assert.equal(row.cells['My Rating'], '0');
  assert.equal(row.cells['ISBN13'], '');
  assert.equal(row.cells['Date Read'], '');
  assert.deepEqual(codes(row), [
    'export.invalidRating',
    'export.invalidIsbn',
    'export.noIsbn',
    'export.invalidFinished',
    'export.noFinished',
  ]);
  assert.equal(core.parseCsv(csv([row, book()])).length, 3);
});

test('skips formula-like cells without altering safe matching text', () => {
  for (const value of [
    '=2+2',
    '@title',
    '  -Book',
    '+Book',
    '\tBook',
    '\rBook',
    '\nBook',
    '  ＝2+2',
  ]) {
    const row = book({ author: ['A. Reader', value] });
    assert.equal(row.cells, null, JSON.stringify(value));
    assert.deepEqual(codes(row), ['export.formula']);
    assert.deepEqual(row.messages[0].params.columns, ['Additional Authors']);
  }
  const title = 'Safe book, "=2+2"';
  const records = core.parseCsv(csv([book({ title })]));
  assert.equal(records.length, 2);
  assert.equal(records[1][1], title);
});
