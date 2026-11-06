import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { COLOPHON, ROOT, loadLocale, loadSettings, model, read } from '../lib/common.mjs';
import { frontmatterOf, historyCount, validateBookNote } from '../lib/note-validation.mjs';

const script = path.join(ROOT, 'tools', 'user', 'import-storygraph.mjs');

// Column order and empty optional fields follow BookWyrm's public StoryGraph fixture.
const HEADER = [
  'Title',
  'Authors',
  'Contributors',
  'ISBN/UID',
  'Format',
  'Read Status',
  'Date Added',
  'Last Date Read',
  'Dates Read',
  'Read Count',
  'Moods',
  'Pace',
  'Character- or Plot-Driven?',
  'Strong Character Development?',
  'Loveable Characters?',
  'Diverse Characters?',
  'Flawed Characters?',
  'Star Rating',
  'Review',
  'Content Warnings',
  'Content Warning Description',
  'Tags',
  'Owned?',
];

const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const setup = (t, rows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-storygraph-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const csv = path.join(dir, 'storygraph.csv');
  const out = path.join(dir, 'vault', 'Books', 'Library');
  const body = rows.map((row) => HEADER.map((name) => quote(row[name] ?? '')).join(','));
  fs.writeFileSync(csv, [HEADER.join(','), ...body, ''].join('\r\n'));
  return {
    out,
    run: (...args) => {
      const result = spawnSync(process.execPath, [script, csv, '--out', out, ...args], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      return result.stdout;
    },
  };
};

const notes = (out) =>
  fs.readdirSync(out).map((name) => {
    const file = path.join(out, name);
    const text = read(file);
    return { file, text, data: frontmatterOf(text) };
  });

const { settings } = loadSettings();
const english = loadLocale('en');
const catalog = model.catalog(settings, 'en', (key) => english[key]);
const validate = ({ data, text }) =>
  validateBookNote({
    data,
    text,
    catalog,
    coversFolder: settings.paths.covers,
    coverExists: () => false,
  });

// The actual Dataview view and its library run against these small Obsidian API stand-ins.
class Element {
  children = [];
  listeners = {};

  constructor(tag, options = {}) {
    this.tag = tag;
    this.options = options;
  }

  createEl(tag, options) {
    const child = new Element(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options) {
    return this.createEl('div', options);
  }

  createSpan(options) {
    return this.createEl('span', options);
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  setAttr() {}
  appendText() {}
  toggle() {}

  empty() {
    this.children = [];
  }

  find(cls) {
    if (this.options.cls === cls) return this;
    for (const child of this.children) {
      const found = child.find(cls);
      if (found) return found;
    }
  }
}

const dvDate = (iso) => {
  const date = new Date(iso);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    toMillis: () => date.getTime(),
    toFormat: () => iso,
  };
};

const statistics = async (bookNotes) => {
  const pages = bookNotes.map(({ file, data }) => ({
    ...data,
    file: { path: file },
    started: data.started && dvDate(data.started),
    finished: data.finished && dvDate(data.finished),
  }));
  const readColophon = (file) => read(path.join(COLOPHON, file.replace(/^Colophon\//, '')));
  const container = new Element('div');
  const dv = {
    container,
    app: {
      metadataCache: {
        getFirstLinkpathDest: (file) => ({ path: file, parent: { path: 'Colophon' } }),
      },
      vault: {
        adapter: {
          read: readColophon,
          list: () => ({ files: ['Colophon/locales/en.json'] }),
        },
        read: (file) => readColophon(file.path),
        getMarkdownFiles: () => [],
      },
    },
    date: () => dvDate('2025-01-01'),
    pages: () => ({ where: (predicate) => ({ array: () => pages.filter(predicate) }) }),
    io: { load: (file) => read(file) },
    fileLink: (file) => file,
    table() {},
  };
  await vm.runInNewContext(`(async () => {\n${readColophon('statistics/view.js')}\n})()`, {
    dv,
    window: {},
    document: { getElementById: () => ({}) },
  });
  return container;
};

test('two completed reads appear once each in the annual statistics', async (t) => {
  const { out, run } = setup(t, [
    {
      Title: 'Through the Looking-Glass',
      Authors: 'Lewis Carroll, John Tenniel',
      'ISBN/UID': '9780141439761',
      'Read Status': 'read',
      'Last Date Read': '2023/02/03',
      'Dates Read': '2023/01/04-2023/02/03, 2021/11/12-2021/12/23',
      'Read Count': '2',
      'Star Rating': '4.5',
    },
  ]);
  run('--apply');
  const bookNotes = notes(out);
  assert.equal(bookNotes.length, 1);
  const [{ data, text }] = bookNotes;
  assert.deepEqual(validate(bookNotes[0]), []);
  assert.equal(data.type, 'book');
  assert.equal(data.title, 'Through the Looking-Glass');
  assert.deepEqual(data.author, ['Lewis Carroll', 'John Tenniel']);
  assert.equal(data.isbn13, '9780141439761');
  assert.equal(data.rating, 4.5);
  assert.equal(data.status, 'finished');
  assert.equal(data.started, '2023-01-04');
  assert.equal(data.finished, '2023-02-03');
  assert.equal(data.reread_count, 1);
  assert.equal(historyCount(text), 1);
  assert.match(text, /^## Reading history\n\n- 2021-11-12 → 2021-12-23$/m);

  const view = await statistics(bookNotes);
  const selector = view.find('rb-head').children.find(({ tag }) => tag === 'select');
  assert.deepEqual(
    selector.children.map((option) => option.options.text),
    ['2025', '2023', '2021'],
  );
  for (const year of ['2021', '2023']) {
    selector.value = year;
    selector.listeners.change();
    const [reads] = view.find('rb-summary').children;
    assert.equal(reads.children[0].options.text, '1', year);
    assert.deepEqual(
      view.find('rb-wall').children.map((button) => button.children[0].options.text),
      [data.title],
      year,
    );
  }
});

test('keeps confirmed dates for open and end-only reads and reports missing or incompatible data', (t) => {
  const { out, run } = setup(t, [
    {
      Title: 'Reading again',
      Authors: 'Jane Austen',
      'Read Status': 'currently-reading',
      'Last Date Read': '2022/08/09',
      'Dates Read': '2022/07/08-2022/08/09, 2024/01/02-',
      'Read Count': '1',
    },
    {
      Title: 'End only',
      Authors: 'Tim Hwang',
      'ISBN/UID': '0374538654',
      'Read Status': 'read',
      'Last Date Read': '2024/02/29',
      'Read Count': '1',
      'Star Rating': '4.75',
    },
    {
      Title: 'Count only',
      Authors: 'Jane Austen',
      'Read Status': 'read',
      'Read Count': '3',
    },
    {
      Title: 'Ambiguous date',
      Authors: 'Jane Austen',
      'Read Status': 'read',
      'Dates Read': '03/04/2024',
      'Last Date Read': '03/04/2024',
      'Read Count': '1',
    },
    {
      Title: 'Conflicting dates',
      Authors: 'Jane Austen',
      'Read Status': 'read',
      'Dates Read': '2023/01/04-2023/02/03',
      'Last Date Read': '2022/01/02',
      'Read Count': '1',
    },
    {
      Title: 'Stopped reading',
      Authors: 'Jane Austen',
      'Read Status': 'did-not-finish',
    },
  ]);
  const report = run('--apply');
  assert.match(report, /Read Count/i);
  assert.match(report, /03\/04\/2024/);
  assert.match(report, /2022\/01\/02|2022-01-02/);
  assert.match(report, /4\.75/);
  const byTitle = new Map(notes(out).map((note) => [note.data.title, note]));
  assert.equal(byTitle.size, 6);
  const reading = byTitle.get('Reading again');
  assert.deepEqual(validate(reading), []);
  assert.equal(reading.data.status, 'in_progress');
  assert.equal(reading.data.started, '2024-01-02');
  assert.equal(reading.data.finished, undefined);
  assert.equal(reading.data.reread_count, 1);
  assert.equal(historyCount(reading.text), 1);
  assert.match(reading.text, /^- 2022-07-08 → 2022-08-09$/m);
  const endOnly = byTitle.get('End only');
  assert.deepEqual(validate(endOnly), []);
  assert.equal(endOnly.data.isbn, '0374538654');
  assert.equal(endOnly.data.started, undefined);
  assert.equal(endOnly.data.finished, '2024-02-29');
  assert.equal(endOnly.data.rating, undefined);
  for (const title of ['Count only', 'Ambiguous date']) {
    const note = byTitle.get(title);
    assert.equal(note.data.status, 'finished');
    assert.equal(note.data.started, undefined);
    assert.equal(note.data.finished, undefined);
    assert.equal(note.data.reread_count, undefined);
    assert.equal(historyCount(note.text), 0);
    assert.deepEqual(validate(note), ['a finished book needs a finished date']);
  }
  const conflicting = byTitle.get('Conflicting dates');
  assert.deepEqual(validate(conflicting), []);
  assert.equal(conflicting.data.finished, '2023-02-03');
  assert.equal(historyCount(conflicting.text), 0);
  assert.equal(byTitle.get('Stopped reading').data.status, 'abandoned');
});

test('preview writes nothing and a repeated apply preserves separate editions and manual edits', (t) => {
  const edition = {
    Title: 'Walden',
    Authors: 'Henry David Thoreau',
    'Read Status': 'to-read',
  };
  const { out, run } = setup(t, [
    { ...edition, 'ISBN/UID': '9780143039433' },
    { ...edition, 'ISBN/UID': '0143039431' },
    { ...edition, 'ISBN/UID': 'B003WEAI4E' },
    { ...edition, 'Date Added': '2021/10/11', Format: 'digital' },
    { ...edition, 'Date Added': '2021/10/12', Format: 'audio' },
  ]);
  assert.match(run(), /To create: 5/i);
  assert.ok(!fs.existsSync(out));

  fs.mkdirSync(out, { recursive: true });
  const existing = path.join(out, 'Walden.md');
  const manual = '---\ntype: book\ntitle: Walden\nisbn13: "9780143039433"\n---\n\nMy own note.\n';
  fs.writeFileSync(existing, manual);
  run('--apply');
  const imported = notes(out).filter(({ file }) => file !== existing);
  assert.equal(imported.length, 5);
  assert.deepEqual(
    imported
      .map(({ data }) => data.isbn13 ?? data.isbn)
      .filter(Boolean)
      .sort(),
    ['0143039431', '9780143039433'],
  );
  assert.deepEqual(imported.map(({ data }) => data.storygraph_uid).filter(Boolean), ['B003WEAI4E']);
  for (const note of imported) {
    assert.deepEqual(validate(note), []);
    assert.equal(note.data.status, 'planned');
  }
  assert.equal(read(existing), manual);

  const note = imported.find(({ data }) => data.isbn13);
  const renamed = path.join(out, 'Renamed by the reader.md');
  fs.renameSync(note.file, renamed);
  fs.writeFileSync(
    renamed,
    note.text.replace(/^storygraph_id: (.+)$/m, 'storygraph_id: $1 # imported edition') +
      '\nMy personal reading plan.\n',
  );
  const before = notes(out);
  assert.match(run('--apply'), /Skipped, already imported: 5/i);
  assert.deepEqual(notes(out), before);
});

test('a partial latest finish constrains the exact fallback and keeps older reads in history', (t) => {
  const book = {
    Authors: 'Jane Austen',
    'Read Status': 'read',
    'Dates Read': '2020/01/01, 2024/05',
    'Read Count': '2',
  };
  const { out, run } = setup(t, [
    { ...book, Title: 'Conflicting month', 'Last Date Read': '2023/06/01' },
    { ...book, Title: 'Matching month', 'Last Date Read': '2024/05/20' },
  ]);
  const report = run('--apply');
  assert.match(report, /2023-06-01.*predates.*omitted/);
  const [conflict, match] = notes(out);
  assert.equal(conflict.data.finished, undefined);
  assert.equal(match.data.finished, '2024-05-20');
  for (const note of [conflict, match]) {
    assert.equal(note.data.reread_count, 1);
    assert.match(note.text, /^- \? → 2020-01-01$/m);
  }
});

test('ambiguous matches against existing imported notes are reported without writes', (t) => {
  const { out, run } = setup(t, [
    {
      Title: 'Walden',
      Authors: 'Henry David Thoreau',
      'Read Status': 'to-read',
      'ISBN/UID': '9780143039433',
    },
  ]);
  run('--apply');
  const [imported] = notes(out);
  const copy = path.join(out, 'Walden copy.md');
  fs.copyFileSync(imported.file, copy);
  fs.appendFileSync(copy, '\nAn edit to the copy.\n');
  const before = notes(out);
  const report = run('--apply');
  assert.match(report, /ambiguous|multiple.*match/i);
  assert.match(report, /Wrote 0 note\(s\)/i);
  assert.deepEqual(notes(out), before);
});
