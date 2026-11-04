import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { ROOT, loadLocale, loadSettings, model } from '../lib/common.mjs';
import {
  CsvError,
  cleanDate,
  cleanIsbn,
  neutralize,
  parseCsv,
  reviewText,
  safeFileName,
} from '../user/import-goodreads.mjs';
import { frontmatterOf, historyCount, validateBookNote } from '../lib/note-validation.mjs';

const script = path.join(ROOT, 'tools', 'user', 'import-goodreads.mjs');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-import-'));

// ---- A synthetic export: public domain books, invented ids, written for these tests -----------

const HEADER = [
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
const row = (o) => HEADER.map((name) => o[name] ?? '');
const quote = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const toCsv = (rows, eol = '\r\n') =>
  `\uFEFF${[HEADER, ...rows].map((r) => r.map(quote).join(',')).join(eol)}${eol}`;

const REVIEW = [
  'Loved it.<br/><br/>Second paragraph &amp; more.',
  '## Reading history',
  '- 2020-01-01 → 2020-02-02',
  '```dataviewjs',
  'dv.paragraph("hello")',
  '```',
  '> not a quote',
].join('\n');

const ROWS = [
  row({
    'Book Id': '1001',
    Title: 'Walden',
    Author: 'Henry David Thoreau',
    ISBN: '="0143039431"',
    ISBN13: '="9780143039433"',
    'My Rating': '5',
    Binding: 'Hardcover',
    'Number of Pages': '352',
    'Year Published': '2004',
    'Original Publication Year': '1854',
    'Date Read': '2023/05/14',
    'Date Added': '2022/01/03',
    Bookshelves: 'philosophy, classics, favorites',
    'Exclusive Shelf': 'read',
    'My Review': REVIEW,
    'Private Notes': 'my private line',
    'Read Count': '2',
  }),
  row({
    'Book Id': '1002',
    Title: 'Pride and Prejudice',
    Author: 'Jane Austen',
    ISBN: '=""',
    ISBN13: '=""',
    'My Rating': '0',
    Binding: 'Mass Market Paperback',
    'Date Added': '2023/11/30',
    Bookshelves: 'to-read, classics',
    'Exclusive Shelf': 'to-read',
    'Read Count': '0',
  }),
  row({
    'Book Id': '1003',
    Title: 'Dracula',
    Author: 'Bram Stoker',
    'Additional Authors': 'First Helper, Second Helper, Bram Stoker',
    'My Rating': '4',
    Binding: 'Kindle Edition',
    'Year Published': '2010',
    'Date Added': '2024/02/29',
    'Exclusive Shelf': 'currently-reading',
    Bookshelves: 'currently-reading, horror',
  }),
  row({
    'Book Id': '1004',
    Title: 'Moby-Dick: or, The "Whale"',
    Author: 'Herman Melville',
    Binding: 'Audible Audio',
    'Date Read': '1999/12/31',
    'Date Added': '2000/01/01',
    'Exclusive Shelf': 'read',
    'My Rating': '3',
  }),
  // Same title as 1001 with another case, and the same title twice more: names must not collide.
  row({
    'Book Id': '1005',
    Title: 'WALDEN',
    Author: 'Someone Else',
    'Exclusive Shelf': 'to-read',
    'Date Added': '2024/03/01',
  }),
  row({
    'Book Id': '1006',
    Title: 'walden',
    Author: 'Someone Else',
    'Exclusive Shelf': 'to-read',
    'Date Added': '2024/03/02',
  }),
  row({
    'Book Id': '1007',
    Title: 'Война и мир',
    Author: 'Leo Tolstoy',
    'Exclusive Shelf': 'to-read',
    Binding: 'Board Book',
  }),
  row({
    'Book Id': '1008',
    Title: 'Война и мир'.normalize('NFD'),
    Author: 'Leo Tolstoy',
    'Exclusive Shelf': 'to-read',
  }),
  row({ 'Book Id': '1009', Title: 'CON', Author: 'Lewis Carroll', 'Exclusive Shelf': 'to-read' }),
  row({
    'Book Id': '1010',
    Title: `${'Very long title '.repeat(30)}`,
    Author: 'Lewis Carroll',
    'Exclusive Shelf': 'to-read',
  }),
  row({
    'Book Id': '1011',
    Title: 'Hello...',
    Author: 'Lewis Carroll',
    'Exclusive Shelf': 'to-read',
  }),
  row({
    'Book Id': '1012',
    Title: 'A/B\\C: D*E?',
    Author: 'Lewis Carroll',
    'Exclusive Shelf': 'to-read',
  }),
  row({
    'Book Id': '1013',
    Title: 'Read without a date',
    Author: 'Lewis Carroll',
    'Exclusive Shelf': 'read',
    'Date Read': '',
  }),
  row({
    'Book Id': '1014',
    Title: 'Unfinished by choice',
    Author: 'Lewis Carroll',
    'Exclusive Shelf': 'dnf',
  }),
  row({
    'Book Id': '1015',
    Title: 'Bad dates',
    Author: 'Lewis Carroll',
    'Exclusive Shelf': 'read',
    'Date Read': '2023/02/30',
    'Date Added': '31/12/2020',
  }),
];
const CSV = toCsv(ROWS);

const setup = () => {
  const dir = tmp();
  const csv = path.join(dir, 'goodreads_library_export.csv');
  fs.writeFileSync(csv, CSV);
  return { dir, csv, out: path.join(dir, 'vault', 'Books', 'Library') };
};
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const notes = (out) =>
  Object.fromEntries(
    fs
      .readdirSync(out)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]),
  );

// ---- CSV parser -------------------------------------------------------------------------------

test('parseCsv follows RFC 4180: BOM, quotes, line breaks in cells, all line endings', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","line1\r\nline2"\r\n"say ""hi""",\r\n'), [
    ['a', 'b'],
    ['x, y', 'line1\r\nline2'],
    ['say "hi"', ''],
  ]);
  assert.deepEqual(
    parseCsv('a,b\nc,d'),
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
    'no final line break',
  );
  assert.deepEqual(parseCsv('a\rb\r'), [['a'], ['b']], 'CR only');
  assert.deepEqual(parseCsv('a,"",c\n'), [['a', '', 'c']], 'an empty quoted cell');
  assert.deepEqual(
    parseCsv('a,b\n\n\nc,d\n'),
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
    'blank lines are not records',
  );
  assert.deepEqual(parseCsv(',\n'), [['', '']], 'two empty cells');
  assert.deepEqual(parseCsv(''), []);
  assert.throws(() => parseCsv('a,"open\nb'), CsvError);
});

test('Goodreads value helpers', () => {
  assert.equal(cleanIsbn('="0143039431"'), '0143039431');
  assert.equal(cleanIsbn('="978-0-14-303943-3"'), '9780143039433');
  assert.equal(cleanIsbn('="080442957x"'), '080442957X');
  assert.equal(cleanIsbn('=""'), null);
  assert.equal(cleanIsbn('12345'), null);
  assert.equal(cleanDate('2019/03/24'), '2019-03-24');
  assert.equal(cleanDate('2019/3/4'), '2019-03-04');
  assert.equal(cleanDate('2023/02/30'), null);
  assert.equal(cleanDate('24/03/2019'), null);
  assert.equal(cleanDate(''), null);
  assert.equal(reviewText('a<br/>b &amp; c &#169; &lt;i&gt;<i>x</i>'), 'a\nb & c © <i>x');
  assert.equal(reviewText('<p>one</p><p>two</p>'), 'one\n\ntwo');
  assert.equal(
    neutralize('ok\n## h\n  ```js\n> q\n~~~\n#hash'),
    'ok\n\\## h\n  \\```js\n\\> q\n\\~~~\n\\#hash',
  );
});

test('safeFileName: forbidden characters, reserved names, dots, length, Unicode form', () => {
  assert.equal(safeFileName('Moby-Dick: or, The "Whale"'), 'Moby-Dick - or, The Whale');
  assert.equal(safeFileName('A/B\\C: D*E?'), 'A B C - DE');
  assert.equal(safeFileName('Hello...'), 'Hello');
  assert.equal(safeFileName('.hidden'), 'hidden');
  assert.equal(safeFileName('CON'), 'CON_');
  assert.equal(safeFileName('a [b] #c ^d'), 'a b c d');
  assert.equal(safeFileName('???'), 'Untitled');
  assert.equal(safeFileName('Война и мир'.normalize('NFD')), 'Война и мир'.normalize('NFC'));
  const long = safeFileName('Ж'.repeat(300));
  assert.ok(Buffer.byteLength(long) <= 180);
  assert.equal(safeFileName('x'.repeat(300)).length, 180);
  assert.ok(!/[\\/:*?"<>|]/.test(safeFileName('a\u0000b\tc')));
});

// ---- The importer -----------------------------------------------------------------------------

test('dry run: a report and nothing written, not even the folder', () => {
  const { dir, csv, out } = setup();
  try {
    const result = run(csv, '--out', out);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dry run: nothing is written/);
    assert.match(result.stdout, /To create: 14/);
    assert.match(result.stdout, /\(will be created\)/);
    assert.match(result.stdout, /unknown exclusive shelf: 1: "dnf"/);
    assert.match(result.stdout, /unrecognised Binding: "Board Book" \(1\)/);
    assert.match(
      result.stdout,
      /Shelves not written, no category mapping: "classics" \(2\), "favorites" \(1\), "horror" \(1\), "philosophy" \(1\)/,
    );
    assert.match(result.stdout, /Read more than once: 1 book/);
    assert.match(result.stdout, /Finished without a Date Read.*: 2/);
    assert.match(result.stdout, /Dry run\. Add --apply/);
    assert.ok(!fs.existsSync(path.join(dir, 'vault')));
  } finally {
    cleanup(dir);
  }
});

test('apply writes valid Colophon notes with the mapped values', () => {
  const { dir, csv, out } = setup();
  try {
    const map = path.join(dir, 'map.json');
    fs.writeFileSync(
      map,
      JSON.stringify({
        categories: { philosophy: 'philosophy', classics: 'classics' },
        statuses: { dnf: 'abandoned' },
      }),
    );
    const result = run(csv, '--out', out, '--apply', '--map', map);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created: 15/); // the dnf row too, through the map file
    const files = notes(out);
    assert.equal(Object.keys(files).length, 15);

    const { settings } = loadSettings();
    const english = loadLocale('en');
    const catalog = model.catalog(settings, 'en', (key) => english[key]);
    const withoutDate = new Set(['Read without a date.md', 'Bad dates.md']);
    for (const [name, text] of Object.entries(files)) {
      const data = frontmatterOf(text);
      const problems = validateBookNote({
        data,
        text,
        catalog,
        coversFolder: settings.paths.covers,
        coverExists: () => false,
      })
        // Goodreads has no finish date for these two; the importer reports them instead of inventing one.
        .filter((p) => !(withoutDate.has(name) && p === 'a finished book needs a finished date'));
      assert.deepEqual(problems, [], name);
      assert.equal(data.reread_count, undefined, 'no reread_count without history lines');
      assert.equal(historyCount(text), 0);
      assert.equal(typeof data.goodreads_id, 'string');
    }

    const walden = frontmatterOf(files['Walden.md']);
    assert.deepEqual(walden, {
      type: 'book',
      title: 'Walden',
      author: ['Henry David Thoreau'],
      status: 'finished',
      format: 'hardcover',
      category: ['philosophy', 'classics'], // "favorites" has no mapping and is not written
      rating: 5,
      pages: 352,
      publication_year: 1854, // the original year, not the edition's 2004
      finished: '2023-05-14',
      date_added: '2022-01-03',
      isbn: '0143039431', // the leading zero survives
      isbn13: '9780143039433',
      goodreads_id: '1001',
      cssclasses: ['book-page'],
    });
    const planned = frontmatterOf(files['Pride and Prejudice.md']);
    assert.equal(planned.status, 'planned');
    assert.equal(planned.rating, undefined, 'rating 0 means no rating');
    assert.equal(planned.format, 'paperback');
    assert.equal(planned.isbn, undefined);
    const reading = frontmatterOf(files['Dracula.md']);
    assert.equal(reading.status, 'in_progress');
    assert.equal(reading.format, 'ebook');
    assert.equal(
      reading.publication_year,
      2010,
      'the edition year only when there is no original year',
    );
    assert.deepEqual(reading.author, ['Bram Stoker', 'First Helper', 'Second Helper']);
    assert.equal(frontmatterOf(files['Moby-Dick - or, The Whale.md']).format, 'audiobook');
    assert.equal(
      frontmatterOf(files['Moby-Dick - or, The Whale.md']).title,
      'Moby-Dick: or, The "Whale"',
    );
    assert.equal(frontmatterOf(files['Unfinished by choice.md']).status, 'abandoned');
    assert.equal(frontmatterOf(files['Bad dates.md']).finished, undefined);
    assert.equal(frontmatterOf(files['Bad dates.md']).date_added, undefined);

    // Without the flags the review and the private notes stay out of the notes.
    assert.ok(!files['Walden.md'].includes('Loved it'));
    assert.ok(!files['Walden.md'].includes('my private line'));
  } finally {
    cleanup(dir);
  }
});

test('names: collisions without regard to case, Unicode forms, reserved and long names', () => {
  const { dir, csv, out } = setup();
  try {
    assert.equal(run(csv, '--out', out, '--apply').status, 0);
    const names = Object.keys(notes(out));
    assert.ok(names.includes('Walden.md'));
    assert.ok(names.includes('WALDEN (Someone Else).md'));
    assert.ok(names.includes('walden (1006).md'), names.join('\n'));
    assert.ok(names.includes('Война и мир.md'));
    assert.ok(
      names.includes(`Война и мир (Leo Tolstoy).md`.normalize('NFC')),
      'the NFD title does not collide with the NFC one',
    );
    assert.ok(names.includes('CON_.md'));
    assert.ok(names.includes('Hello.md'));
    assert.ok(names.includes('A B C - DE.md'));
    assert.ok(names.every((n) => Buffer.byteLength(n) <= 255));
    assert.equal(new Set(names.map((n) => n.normalize('NFC').toLowerCase())).size, names.length);
    // The title inside the note is the original one, only the file name is changed.
    assert.equal(frontmatterOf(fs.readFileSync(path.join(out, 'CON_.md'), 'utf8')).title, 'CON');
  } finally {
    cleanup(dir);
  }
});

test('a note of the same name that is not an import is never overwritten', () => {
  const { dir, csv, out } = setup();
  try {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'walden.md'), 'my own note\n'); // case differs from "Walden"
    assert.equal(run(csv, '--out', out, '--apply').status, 0);
    assert.equal(fs.readFileSync(path.join(out, 'walden.md'), 'utf8'), 'my own note\n');
    const own = fs.readdirSync(out).filter((f) => f.toLowerCase() === 'walden.md');
    assert.equal(own.length, 1, 'a case-insensitive file system could not hold both');
    assert.ok(fs.readdirSync(out).includes('Walden (Henry David Thoreau).md'));
  } finally {
    cleanup(dir);
  }
});

test('a second run is idempotent; --overwrite replaces imported notes only when asked', () => {
  const { dir, csv, out } = setup();
  try {
    assert.equal(run(csv, '--out', out, '--apply').status, 0);
    const before = notes(out);
    const mtimes = Object.fromEntries(
      Object.keys(before).map((f) => [f, fs.statSync(path.join(out, f)).mtimeMs]),
    );

    for (const args of [[], ['--apply']]) {
      const again = run(csv, '--out', out, ...args);
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /To create: 0|Created: 0/);
      assert.match(again.stdout, /Skipped, already imported: 14/);
    }
    assert.deepEqual(notes(out), before);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(before).map((f) => [f, fs.statSync(path.join(out, f)).mtimeMs]),
      ),
      mtimes,
    );

    // The user edits a note, then imports a newer export that has more books.
    fs.appendFileSync(path.join(out, 'Walden.md'), '\nMy own thought.\n');
    const more = toCsv([
      ...ROWS,
      row({
        'Book Id': '2001',
        Title: 'Alice in Wonderland',
        Author: 'Lewis Carroll',
        'Exclusive Shelf': 'to-read',
      }),
    ]);
    fs.writeFileSync(csv, more);
    assert.equal(run(csv, '--out', out, '--apply').status, 0);
    assert.ok(fs.readFileSync(path.join(out, 'Walden.md'), 'utf8').includes('My own thought.'));
    assert.ok(fs.existsSync(path.join(out, 'Alice in Wonderland.md')));
    assert.equal(fs.readdirSync(out).length, Object.keys(before).length + 1);

    const dry = run(csv, '--out', out, '--overwrite');
    assert.match(dry.stdout, /To replace: 15/);
    assert.ok(
      fs.readFileSync(path.join(out, 'Walden.md'), 'utf8').includes('My own thought.'),
      'a dry run changes nothing',
    );
    assert.equal(run(csv, '--out', out, '--overwrite', '--apply').status, 0);
    assert.ok(!fs.readFileSync(path.join(out, 'Walden.md'), 'utf8').includes('My own thought.'));
  } finally {
    cleanup(dir);
  }
});

test('an import also recognises notes in sub-folders and renamed notes by their Goodreads id', () => {
  const { dir, csv, out } = setup();
  try {
    assert.equal(run(csv, '--out', out, '--apply').status, 0);
    fs.mkdirSync(path.join(out, 'Read'));
    fs.renameSync(path.join(out, 'Walden.md'), path.join(out, 'Read', 'My Walden.md'));
    const again = run(csv, '--out', out, '--apply');
    assert.match(again.stdout, /Created: 0/);
    assert.ok(!fs.existsSync(path.join(out, 'Walden.md')));
  } finally {
    cleanup(dir);
  }
});

test('--reviews and --private-notes put text under the notes heading, as plain text', () => {
  const { dir, csv, out } = setup();
  try {
    assert.equal(
      run(csv, '--out', out, '--apply', '--reviews', '--private-notes', '--language', 'de').status,
      0,
    );
    const text = fs.readFileSync(path.join(out, 'Walden.md'), 'utf8');
    const german = loadLocale('de');
    assert.match(
      text,
      new RegExp(`## ${german['template.notes']}\\n\\nLoved it\\.\\n\\nSecond paragraph & more\\.`),
    );
    assert.ok(text.includes('my private line'));
    assert.ok(text.indexOf('Loved it') < text.indexOf('my private line'));
    assert.ok(text.indexOf(`## ${german['template.quotes']}`) > text.indexOf('my private line'));
    // Nothing in the review turns into structure: one code block (the book view), no history, no quote.
    assert.equal((text.match(/^```/gm) ?? []).length, 2);
    assert.ok(text.includes('```dataviewjs\nawait dv.view("Colophon/book")\n```'));
    assert.ok(text.includes('\\```dataviewjs'));
    assert.ok(!/^## Reading history/m.test(text));
    assert.ok(!/^>/m.test(text));
    assert.equal(historyCount(text), 0);
    const data = frontmatterOf(text);
    assert.equal(data.reread_count, undefined);
  } finally {
    cleanup(dir);
  }
});

test('your own formats, categories and statuses are used', () => {
  const { dir, csv, out } = setup();
  try {
    const config = path.join(dir, 'config.json');
    fs.writeFileSync(
      config,
      JSON.stringify({
        statuses: [
          'planned',
          { key: 'reading', kind: 'in_progress' },
          { key: 'in_progress', kind: 'in_progress' },
          'finished',
          'abandoned',
        ],
        formats: ['paperback', 'ebook'],
        categories: ['classics'],
      }),
    );
    const map = path.join(dir, 'map.json');
    fs.writeFileSync(map, JSON.stringify({ categories: { classics: 'classics' } }));
    const result = run(csv, '--out', out, '--apply', '--config', config, '--map', map);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Format not set, not in your config: "hardcover" \(1\), "audiobook" \(1\)|Format not set, not in your config: "audiobook" \(1\), "hardcover" \(1\)/,
    );
    const files = notes(out);
    assert.equal(frontmatterOf(files['Walden.md']).format, undefined);
    assert.deepEqual(frontmatterOf(files['Walden.md']).category, ['classics']);
    assert.equal(frontmatterOf(files['Pride and Prejudice.md']).format, 'paperback');
    // The first status of the kind is used.
    assert.equal(frontmatterOf(files['Dracula.md']).status, 'reading');
  } finally {
    cleanup(dir);
  }
});

test('bad input gives clear errors and writes nothing', () => {
  const { dir, csv, out } = setup();
  try {
    const bad = path.join(dir, 'bad.csv');
    fs.writeFileSync(bad, 'Name,Value\r\nx,y\r\n');
    const notGoodreads = run(bad, '--out', out, '--apply');
    assert.equal(notGoodreads.status, 1);
    assert.match(
      notGoodreads.stderr,
      /does not look like a Goodreads export: missing column\(s\) "Book Id"/,
    );
    fs.writeFileSync(bad, `${HEADER.join(',')}\r\n1,"open title\r\n`);
    assert.match(run(bad, '--out', out).stderr, /inside a quoted field/);
    assert.match(run(path.join(dir, 'missing.csv'), '--out', out).stderr, /does not exist/);
    assert.equal(run(csv).status, 2);
    assert.match(run(csv, '--out', path.join(dir, '.obsidian', 'x')).stderr, /\.obsidian/);
    const map = path.join(dir, 'map.json');
    fs.writeFileSync(map, JSON.stringify({ categories: { a: 'no-such-category' } }));
    assert.match(run(csv, '--out', out, '--map', map).stderr, /not in your config/);
    fs.writeFileSync(map, JSON.stringify({ shelves: {} }));
    assert.match(run(csv, '--out', out, '--map', map).stderr, /unknown part/);
    fs.writeFileSync(path.join(dir, 'bad-config.json'), JSON.stringify({ formats: ['a b'] }));
    assert.match(
      run(csv, '--out', out, '--config', path.join(dir, 'bad-config.json')).stderr,
      /not a valid key/,
    );
    assert.match(run(csv, '--out', out, '--language', 'xx').stderr, /not available/);
    assert.ok(!fs.existsSync(path.join(dir, 'vault')));
  } finally {
    cleanup(dir);
  }
});

test('rows with the wrong number of fields or no id are reported, not imported', () => {
  const { dir, out } = setup();
  try {
    const csv = path.join(dir, 'odd.csv');
    const good = row({
      'Book Id': '5',
      Title: 'Fine',
      Author: 'A. Writer',
      'Exclusive Shelf': 'to-read',
    });
    fs.writeFileSync(
      csv,
      `${toCsv([good, row({ 'Book Id': 'abc', Title: 'No id', Author: 'X', 'Exclusive Shelf': 'read' }), good]).trimEnd()}\r\nshort,row\r\n`,
    );
    const result = run(csv, '--out', out);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /To create: 1/);
    assert.match(result.stdout, /Skipped, invalid rows: 3/);
    assert.match(result.stdout, /row 3: no valid Book Id/);
    assert.match(result.stdout, /row 4: Book Id 5 appears twice/);
    assert.match(result.stdout, /row 5: has 2 fields/);
  } finally {
    cleanup(dir);
  }
});

test('YAML in notes survives awkward titles and authors', () => {
  const { dir, out } = setup();
  try {
    const csv = path.join(dir, 'awkward.csv');
    const titles = [
      'Yes: no # maybe',
      'It\'s "quoted"',
      '- dash',
      '[bracket]',
      'null',
      'true',
      '123',
      'a\\b',
      '{x: 1}',
      'Tab\there',
    ];
    fs.writeFileSync(
      csv,
      toCsv(
        titles.map((title, i) =>
          row({
            'Book Id': String(100 + i),
            Title: title,
            Author: `Au: ${title}`,
            'Exclusive Shelf': 'to-read',
          }),
        ),
      ),
    );
    assert.equal(run(csv, '--out', out, '--apply').status, 0);
    const found = Object.values(notes(out)).map((text) => frontmatterOf(text));
    assert.deepEqual(
      found.map((d) => d.title).sort(),
      titles.map((t) => t.replace(/\s+/g, ' ')).sort(),
    );
    for (const d of found) assert.equal(typeof d.title, 'string');
    assert.equal(YAML.parse('x: ' + JSON.stringify('a')).x, 'a');
  } finally {
    cleanup(dir);
  }
});
