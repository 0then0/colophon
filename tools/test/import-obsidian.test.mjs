// The StoryGraph import as it runs inside Obsidian: Colophon/storygraph.js (shared with the command
// line) and Colophon/import/engine.js against a stand-in vault. The stand-in exists for what a real
// vault cannot be asked to do on demand: fail a write, change between two steps, lose a race.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { COLOPHON, ROOT, loadLocale, loadSettings, model, read } from '../lib/common.mjs';
import { frontmatterOf, historyCount, validateBookNote } from '../lib/note-validation.mjs';

const script = path.join(ROOT, 'tools', 'user', 'import-storygraph.mjs');
const core = new Function(read(path.join(COLOPHON, 'storygraph.js')))();
const engineSource = read(path.join(COLOPHON, 'import', 'engine.js'));
const LIBRARY = 'Books/Library';

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
const csvOf = (rows) =>
  [
    HEADER.join(','),
    ...rows.map((row) =>
      typeof row === 'string' ? row : HEADER.map((name) => quote(row[name] ?? '')).join(','),
    ),
    '',
  ].join('\r\n');
const planned = (title, id, more = {}) => ({
  Title: title,
  Authors: 'Jane Austen',
  'ISBN/UID': id,
  'Read Status': 'to-read',
  ...more,
});

// ---- Stand-in vault ---------------------------------------------------------------------------
// Files are a Map of vault path -> text. The Colophon folder is served from the repository, with
// config.json replaceable. `faults.create(path, text)` runs inside vault.create, after the check
// that the path is free, and decides what the write does.
const makeVault = (notes = {}, config = null) => {
  const files = new Map(Object.entries(notes));
  const listeners = new Set();
  const emit = (event, ...args) => {
    for (const listener of [...listeners]) if (listener.event === event) listener.run(...args);
  };
  const product = (file) =>
    file === 'Colophon/config.json' && config !== null
      ? config
      : read(path.join(COLOPHON, file.slice('Colophon/'.length)));
  const isFolder = (target) => [...files.keys()].some((file) => file.startsWith(`${target}/`));
  const folders = new Set();
  const vault = {
    files,
    listeners,
    faults: {},
    creates: [],
    adapter: {
      read: async (file) => {
        if (file.startsWith('Colophon/')) return product(file);
        if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
        return files.get(file);
      },
      exists: async (target) => files.has(target) || folders.has(target) || isFolder(target),
      stat: async (target) =>
        files.has(target)
          ? { type: 'file' }
          : folders.has(target) || isFolder(target)
            ? { type: 'folder' }
            : null,
      list: async (folder) => {
        if (folder === 'Colophon/locales')
          return {
            files: fs
              .readdirSync(path.join(COLOPHON, 'locales'))
              .map((name) => `${folder}/${name}`),
            folders: [],
          };
        const inside = [...files.keys()].filter((file) => file.startsWith(`${folder}/`));
        const direct = (file) => !file.slice(folder.length + 1).includes('/');
        return {
          files: inside.filter(direct),
          folders: [
            ...new Set(
              inside
                .filter((file) => !direct(file))
                .map((file) => `${folder}/${file.slice(folder.length + 1).split('/')[0]}`),
            ),
          ],
        };
      },
    },
    async create(file, text) {
      vault.creates.push(file);
      if (files.has(file)) throw new Error('File already exists.');
      const fault = await vault.faults.create?.(file, text);
      // Looked at again: a fault may have put another file there, as a lost race would.
      if (files.has(file)) throw new Error('File already exists.');
      if (fault?.write !== undefined) files.set(file, fault.write);
      if (fault?.error) throw new Error(fault.error);
      files.set(file, text);
      emit('create', { path: file });
    },
    async createFolder(folder) {
      folders.add(folder);
    },
    on(event, run) {
      const ref = { event, run };
      listeners.add(ref);
      return ref;
    },
    offref(ref) {
      listeners.delete(ref);
    },
    // A change made by someone else that Obsidian has noticed (an edit, sync, another tool).
    external(file, text) {
      const existed = files.has(file);
      files.set(file, text);
      emit(existed ? 'modify' : 'create', { path: file });
    },
    rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
      emit('rename', { path: to }, from);
    },
  };
  return vault;
};

const makeEngine = (vault, registry = {}) =>
  new Function(engineSource)().create({ vault, model, core, root: 'Colophon', registry });
const source = (text, name = 'storygraph.csv') => ({
  name,
  size: Buffer.byteLength(text),
  read: async () => text,
});
const preview = async (engine, text) => {
  const session = engine.createSession();
  await session.load(source(text));
  assert.equal(session.state, 'preview', JSON.stringify(session.error));
  return session;
};
const library = (vault) =>
  Object.fromEntries([...vault.files].filter(([file]) => file.startsWith(`${LIBRARY}/`)).sort());

const { settings } = loadSettings();
const english = loadLocale('en');
const catalog = model.catalog(settings, 'en', (key) => english[key]);
const problems = (text) =>
  validateBookNote({
    data: frontmatterOf(text),
    text,
    catalog,
    coversFolder: settings.paths.covers,
    coverExists: () => false,
  });

// ---- Shared logic -----------------------------------------------------------------------------

test('the fallback identity is the same SHA-256 as before, in any runtime', () => {
  for (const text of [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(1000),
    'Война и мир 😀 é́',
    JSON.stringify([['Title', '\ud83d lone']]),
    crypto.randomBytes(3000).toString('latin1'),
  ]) {
    assert.equal(core.sha256Hex(text), crypto.createHash('sha256').update(text).digest('hex'));
  }

  // The recipe of the 0.3.0 importer: all cells sorted by column name, JSON, 32 hex digits.
  const row = { ...planned('Walden', ''), Authors: 'Henry David Thoreau', Format: 'digital' };
  row['Date Added'] = '2021/10/11';
  const cells = HEADER.toSorted().map((name) => [name, row[name] ?? '']);
  const expected = crypto.createHash('sha256').update(JSON.stringify(cells)).digest('hex');
  const { books } = core.convert(core.parseCsv(csvOf([row])), catalog);
  assert.equal(books[0].id, `row-${expected.slice(0, 32)}`);
  // The value 0.3.0 wrote for this row; it must never change.
  assert.equal(books[0].id, 'row-4f500eb649f1a31d5d7832e5679c7d71');
  assert.equal(books[0].provenance.storygraph_row, '4f500eb649f1a31d5d7832e5679c7d71');
});

test('every code of the shared logic has an interface message', () => {
  for (const [group, codes] of Object.entries(core.CODES)) {
    for (const code of codes) assert.ok(english[`import.${group}.${code}`], `${group}.${code}`);
  }
  const used = new Set(Object.entries(core.CODES).flatMap(([g, codes]) => codes.map((c) => g + c)));
  for (const key of Object.keys(english)) {
    const [, group, code] = /^import\.(warning|skip)\.(.+)$/.exec(key) ?? [];
    if (group) assert.ok(used.has(group + code), `${key} is not a code`);
  }
});

// Editions, rereads, uncertain dates, repeated rows and text that looks like structure.
const RICH = [
  {
    Title: 'Through the Looking-Glass',
    Authors: 'Lewis Carroll, John Tenniel',
    'ISBN/UID': '9780141439761',
    'Read Status': 'read',
    'Last Date Read': '2023/02/03',
    'Dates Read': '2023/01/04-2023/02/03, 2021/11/12-2021/12/23',
    'Read Count': '2',
    'Star Rating': '4.5',
    Format: 'paperback',
  },
  {
    Title: 'Reading again',
    Authors: 'Jane Austen',
    'Read Status': 'currently-reading',
    'Last Date Read': '2022/08/09',
    'Dates Read': '2022/07/08-2022/08/09, 2024/01/02-',
  },
  {
    Title: 'Ambiguous date',
    Authors: 'Jane Austen',
    'Read Status': 'read',
    'Dates Read': '03/04/2024, 2024/05',
    'Last Date Read': '03/04/2024',
    'Read Count': '3',
    'Star Rating': '4.75',
  },
  'short,row',
  planned('Walden', '9780143039433'),
  planned('Walden', '0143039431'),
  planned('Walden', 'B003WEAI4E'),
  planned('Walden', '', { Format: 'digital' }),
  planned('walden', '123456789X'),
  planned('Twice', '9780141439518'),
  planned('Twice', '9780141439518'),
  planned('', '9780000000002'),
  planned('Odd status', '', { 'Read Status': 'owned' }),
  {
    Title: '```dataviewjs\nawait dv.view("evil")\n```',
    Authors: '---\ntype: book, "quoted": [x] #tag',
    'Read Status': 'read',
    'Dates Read': '2022/04/04, 2022/04/04, 2019/1/5-2019/2/7',
    Review: '## Reading history\n- 2000-01-01 → 2000-01-02',
  },
  planned('null', '', { Authors: 'true: yes' }),
];
const EXISTING = {
  // A note of the reader with the same title and ISBN, but no import identity.
  [`${LIBRARY}/Walden.md`]:
    '---\ntype: book\ntitle: Walden\nisbn13: "9780143039433"\n---\n\nMy own note.\n',
  // An earlier import, renamed, moved to a sub-folder and edited by hand.
  [`${LIBRARY}/Shelf/Renamed.md`]:
    '---\ntype: book\nstorygraph_id: B003WEAI4E # the Kindle one\n---\n\nMy thoughts.\n',
};

test('the import page and the command line plan and write the same notes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-obsidian-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = csvOf(RICH);
  const csv = path.join(dir, 'storygraph.csv');
  fs.writeFileSync(csv, text);
  for (const [file, content] of Object.entries(EXISTING)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  const out = path.join(dir, LIBRARY);
  const cli = spawnSync(process.execPath, [script, csv, '--out', out, '--apply'], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);

  const vault = makeVault(EXISTING);
  const engine = makeEngine(vault);
  const session = await preview(engine, text);
  const { plan } = session;
  // The preview created nothing, not even a folder or a helper file.
  assert.deepEqual(library(vault), EXISTING);
  assert.deepEqual(vault.creates, []);

  assert.equal(Number(/To create: (\d+)/.exec(cli.stdout)[1]), plan.fresh.length);
  assert.equal(Number(/already imported: (\d+)/.exec(cli.stdout)[1]), plan.known.length);
  assert.equal(cli.stdout.match(/^Skipped: /gm).length, plan.skipped.length);
  assert.equal(
    cli.stdout.match(/^warning: /gm).length,
    plan.fresh.flatMap((b) => b.warnings).length,
  );
  assert.deepEqual(
    plan.skipped.map(({ kind, code, row }) => `${row} ${kind} ${code}`),
    [
      '5 invalid fieldCount',
      '13 invalid missingTitle',
      '14 invalid noStatus',
      '11 ambiguous ambiguousRows',
      '12 ambiguous ambiguousRows',
    ],
  );

  assert.equal(await session.confirm(), 'done');
  const fromCli = {};
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else fromCli[path.relative(dir, full).split(path.sep).join('/')] = read(full);
    }
  };
  walk(out);
  assert.deepEqual(library(vault), Object.fromEntries(Object.entries(fromCli).sort()));
  assert.equal(engine.shared.last.created.length, plan.fresh.length);

  // Same title, different identities: three editions and a title that differs only by case.
  const names = Object.keys(library(vault)).map((file) => file.slice(LIBRARY.length + 1));
  for (const name of [
    'Walden (Jane Austen).md',
    'Walden (0143039431).md',
    'Walden (row-' +
      plan.fresh.find((b) => b.format === 'ebook').provenance.storygraph_row +
      ').md',
    'walden (123456789X).md',
  ]) {
    assert.ok(names.includes(name), name);
  }
  const byId = (id) =>
    frontmatterOf(Object.values(library(vault)).find((note) => note.includes(`"${id}"`)));
  assert.equal(byId('0143039431').isbn, '0143039431');
  assert.equal(byId('9780143039433').isbn13, '9780143039433');
  assert.deepEqual(vault.files.get(`${LIBRARY}/Walden.md`), EXISTING[`${LIBRARY}/Walden.md`]);

  // Reading history: the latest read in the properties, the earlier one in the section.
  const glass = vault.files.get(`${LIBRARY}/Through the Looking-Glass.md`);
  assert.deepEqual(problems(glass), []);
  assert.equal(frontmatterOf(glass).finished, '2023-02-03');
  assert.equal(historyCount(glass), 1);
  const again = frontmatterOf(vault.files.get(`${LIBRARY}/Reading again.md`));
  assert.deepEqual(
    [again.started, again.finished, again.reread_count],
    ['2024-01-02', undefined, 1],
  );
  const unsure = plan.fresh.find((book) => book.title === 'Ambiguous date');
  assert.deepEqual([unsure.started, unsure.finished, unsure.rating], [null, null, undefined]);
  assert.deepEqual(
    unsure.warnings.map((warning) => warning.code),
    [
      'sessionOmitted',
      'lastDateOmitted',
      'sessionOmitted',
      'readCountMore',
      'noConfirmedFinish',
      'idMissing',
      'ratingOmitted',
    ],
  );

  // Text from the file stays text: one view block, valid properties, no forged history.
  const evil = Object.values(library(vault)).find((note) => note.includes('evil'));
  assert.deepEqual(problems(evil), []);
  const data = frontmatterOf(evil);
  assert.equal(data.title, '```dataviewjs await dv.view("evil") ```');
  assert.deepEqual(data.author, ['--- type: book', '"quoted": [x] #tag']);
  assert.equal(evil.match(/^```dataviewjs/gm).length, 1);
  assert.equal(historyCount(evil), 2);
  assert.doesNotMatch(evil, /2000-01-01/);
  assert.equal(frontmatterOf(vault.files.get(`${LIBRARY}/null.md`)).title, 'null');
});

test('a second import creates nothing, also after a rename and manual edits', async () => {
  const text = csvOf(RICH);
  const vault = makeVault(EXISTING);
  assert.equal(await (await preview(makeEngine(vault), text)).confirm(), 'done');

  const from = `${LIBRARY}/Through the Looking-Glass.md`;
  vault.rename(from, `${LIBRARY}/Shelf/Alice, part two.md`);
  const edited = vault.files
    .get(`${LIBRARY}/Shelf/Alice, part two.md`)
    .replace(/^storygraph_id: (.+)$/m, 'storygraph_id: $1 # my edition')
    .replace('rating: 4.5', 'rating: 2');
  vault.files.set(`${LIBRARY}/Shelf/Alice, part two.md`, `${edited}\nMy reading diary.\n`);
  const before = library(vault);

  // A new engine and registry: what Obsidian has after a restart. Nothing is remembered.
  const engine = makeEngine(vault, {});
  const session = await preview(engine, text);
  assert.equal(session.plan.fresh.length, 0);
  assert.equal(session.plan.known.length, 10);
  assert.equal(await session.confirm(), 'idle');
  assert.deepEqual(library(vault), before);
  assert.equal(vault.creates.length, 9);
});
// ---- Between the preview and the run ----------------------------------------------------------

const THREE = [
  planned('Emma', '9780141439587'),
  planned('Persuasion', '9780141439686'),
  planned('Sanditon', '9780141439792'),
];

test('a change of the library, the settings or the file asks for a new confirmation', async () => {
  const text = csvOf(THREE);
  const vault = makeVault({ [`${LIBRARY}/Mine.md`]: 'mine\n' });
  const engine = makeEngine(vault);
  const session = await preview(engine, text);
  assert.equal(session.plan.fresh.length, 3);

  // Sync brings a note that is one of the books, and Obsidian has not said so: no event, and the
  // metadata cache knows nothing. Only the files tell.
  vault.files.set(`${LIBRARY}/From my phone.md`, '---\nstorygraph_id: "9780141439686"\n---\n');
  assert.equal(await session.confirm(), 'stale');
  assert.equal(session.stale, true);
  assert.deepEqual(vault.creates, []);
  assert.equal(engine.shared.run, null);
  assert.deepEqual(
    session.plan.fresh.map((book) => book.title),
    ['Emma', 'Sanditon'],
  );

  // A name of the plan is taken by an unrelated note: the plan changes again.
  vault.files.set(`${LIBRARY}/emma.md`, 'not a book\n');
  assert.equal(await session.confirm(), 'stale');
  assert.equal(session.plan.names.get('9780141439587'), 'Emma (Jane Austen).md');
  assert.deepEqual(vault.creates, []);

  assert.equal(await session.confirm(), 'done');
  assert.deepEqual(engine.shared.last.created, ['Emma (Jane Austen).md', 'Sanditon.md']);
  assert.equal(vault.files.get(`${LIBRARY}/emma.md`), 'not a book\n');
  assert.equal(vault.files.get(`${LIBRARY}/Mine.md`), 'mine\n');
});

test('new settings or a new file content also invalidate the preview', async () => {
  let text = csvOf(THREE);
  let config = null;
  const vault = makeVault();
  const served = vault.adapter.read;
  vault.adapter.read = async (file) =>
    file === 'Colophon/config.json' && config ? config : served(file);
  const engine = makeEngine(vault);
  const session = engine.createSession();
  await session.load({ name: 'storygraph.csv', size: 1, read: async () => text });

  config = JSON.stringify({ language: 'de', paths: { library: 'Lesen/Regal' } });
  assert.equal(await session.confirm(), 'stale');
  assert.equal(session.plan.library, 'Lesen/Regal');
  assert.equal(session.plan.headings.notes, loadLocale('de')['template.notes']);

  text = csvOf(THREE.slice(1));
  assert.equal(await session.confirm(), 'stale');
  assert.equal(session.plan.fresh.length, 2);
  assert.deepEqual(vault.creates, []);

  config = '{ broken';
  assert.equal(await session.confirm(), 'error');
  assert.equal(session.error.code, 'config');
  assert.deepEqual(vault.creates, []);
  assert.equal(engine.shared.run, null);
});

test('a name taken or a book imported at the last moment is its own outcome', async () => {
  const text = csvOf(THREE);
  const vault = makeVault();
  const engine = makeEngine(vault);
  const session = await preview(engine, text);
  vault.faults.create = (file) => {
    if (file.endsWith('/Emma.md')) {
      // Obsidian reports both: another note with the name of the next book, and the third book
      // itself, imported elsewhere under another name.
      vault.external(`${LIBRARY}/persuasion.md`, 'someone else\n');
      vault.external(`${LIBRARY}/Other.md`, '---\nstorygraph_id: "9780141439792"\n---\n');
    }
  };
  assert.equal(await session.confirm(), 'done');
  const { last } = engine.shared;
  assert.deepEqual(last.created, ['Emma.md']);
  assert.deepEqual(last.conflicts, ['Persuasion.md']);
  assert.deepEqual(last.existing, ['Sanditon.md']);
  assert.deepEqual(vault.creates, [`${LIBRARY}/Emma.md`]);
  assert.equal(vault.files.get(`${LIBRARY}/persuasion.md`), 'someone else\n');

  // The file appears between the last look and the write, unannounced: vault.create refuses.
  const racing = makeVault();
  const second = makeEngine(racing);
  const raced = await preview(second, text);
  racing.faults.create = (file) => {
    if (file.endsWith('/Persuasion.md')) racing.files.set(file, 'won the race\n');
  };
  assert.equal(await raced.confirm(), 'done');
  assert.deepEqual(second.shared.last.conflicts, ['Persuasion.md']);
  assert.deepEqual(second.shared.last.created, ['Emma.md', 'Sanditon.md']);
  assert.equal(racing.files.get(`${LIBRARY}/Persuasion.md`), 'won the race\n');

  // The next import gives that book another name instead of touching the file.
  const again = await preview(second, text);
  assert.equal(again.plan.names.get('9780141439686'), 'Persuasion (Jane Austen).md');
  assert.equal(racing.listeners.size, 0);
});

test('two import pages: one run at a time, and the second plan is checked again', async () => {
  const vault = makeVault();
  const registry = {};
  // Each page loads its own engine; the registry is what they share.
  const first = await preview(makeEngine(vault, registry), csvOf(THREE));
  const other = makeEngine(vault, registry);
  const second = await preview(other, csvOf([...THREE.slice(1), planned('Lady Susan', '')]));

  let release;
  vault.faults.create = (file) =>
    file.endsWith('/Emma.md') ? new Promise((resolve) => (release = resolve)) : undefined;
  const running = first.confirm();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(await second.confirm(), 'busy');
  assert.equal(await first.confirm(), 'busy');
  assert.equal(other.shared.run.session, first);
  release();
  assert.equal(await running, 'done');
  assert.equal(other.shared.last.created.length, 3);

  // The second page saw two of these books as new. It may not write that plan any more.
  assert.equal(await second.confirm(), 'stale');
  assert.deepEqual(
    second.plan.fresh.map((book) => book.title),
    ['Lady Susan'],
  );
  assert.equal(await second.confirm(), 'done');
  assert.equal(Object.keys(library(vault)).length, 4);
  assert.equal(new Set(vault.creates).size, vault.creates.length);

  // Both at the same moment: the lock is taken before anything is awaited.
  const third = await preview(makeEngine(makeVault(), registry), csvOf(THREE));
  const fourth = await preview(makeEngine(makeVault(), registry), csvOf(THREE));
  assert.deepEqual((await Promise.all([third.confirm(), fourth.confirm()])).sort(), [
    'busy',
    'done',
  ]);
});

// ---- Errors, stopping and running again -------------------------------------------------------

const FIVE = [
  ...THREE,
  planned('Lady Susan', '9780141439471'),
  planned('The Watsons', '9780141439570'),
];

test('errors and a stop leave exact results, and the next import finishes the job', async () => {
  const text = csvOf(FIVE);
  const mine = { [`${LIBRARY}/Mine.md`]: 'mine\n' };
  const vault = makeVault(mine);
  const engine = makeEngine(vault);
  const session = await preview(engine, text);
  const closed = [];
  session.subscribe(() => closed.push(session.state));
  vault.faults.create = (file, note) => {
    // Refused before anything was written.
    if (file.endsWith('/Emma.md')) return { error: 'EACCES: permission denied' };
    // Written in full, and then the call fails.
    if (file.endsWith('/Persuasion.md')) return { write: note, error: 'EIO after write' };
    // Cut off in the properties, before the identity.
    if (file.endsWith('/Sanditon.md')) return { write: note.slice(0, 30), error: 'ENOSPC' };
    // The reader stops the run while the fourth note is being created.
    if (file.endsWith('/Lady Susan.md')) engine.stop();
  };
  assert.equal(await session.confirm(), 'done');
  const { last } = engine.shared;
  assert.deepEqual(last.created, ['Persuasion.md', 'Lady Susan.md']);
  assert.deepEqual(last.failed, [
    { name: 'Emma.md', message: 'EACCES: permission denied', partial: false },
    { name: 'Sanditon.md', message: 'ENOSPC', partial: true },
  ]);
  assert.deepEqual([last.total, last.notAttempted, last.stopped], [5, 1, true]);
  // One outcome per book, and nothing was removed to undo the run.
  assert.equal(last.created.length + last.failed.length + last.notAttempted, last.total);
  const partial = vault.files.get(`${LIBRARY}/Sanditon.md`);
  assert.equal(partial.length, 30);
  assert.equal(engine.shared.run, null);
  assert.equal(vault.listeners.size, 0);

  // The page shows what is left right after the run: the file is read and planned again.
  vault.faults = {};
  assert.equal(session.state, 'preview');
  assert.deepEqual(
    session.plan.fresh.map((book) => session.plan.names.get(book.id)),
    ['Emma.md', 'Sanditon (Jane Austen).md', 'The Watsons.md'],
  );
  assert.equal(session.plan.known.length, 2);
  assert.equal(await session.confirm(), 'done');
  assert.equal(engine.shared.last.created.length, 3);

  const notes = library(vault);
  assert.equal(notes[`${LIBRARY}/Mine.md`], 'mine\n');
  assert.equal(notes[`${LIBRARY}/Sanditon.md`], partial);
  const identities = Object.values(notes).flatMap((note) => core.noteIdentities(note));
  assert.deepEqual(identities.toSorted(), FIVE.map((row) => row['ISBN/UID']).toSorted());
  for (const [file, note] of Object.entries(notes)) {
    if (core.noteIdentities(note).length) assert.deepEqual(problems(note), [], file);
  }
  // No path was written twice, and a third import has nothing to do.
  const writes = vault.creates.filter((file) => !/Emma\.md$|Sanditon\.md$/.test(file));
  assert.equal(new Set(writes).size, writes.length);
  assert.equal((await preview(engine, text)).plan.fresh.length, 0);
});

test('a library folder that cannot be created ends the run without notes', async () => {
  const vault = makeVault();
  vault.createFolder = async () => {
    throw new Error('EROFS: read-only file system');
  };
  const engine = makeEngine(vault);
  const session = await preview(engine, csvOf(THREE));
  vault.create = async () => assert.fail('nothing may be written');
  assert.equal(await session.confirm(), 'done');
  const { last } = engine.shared;
  assert.match(last.error, /EROFS/);
  assert.deepEqual([last.created.length, last.notAttempted], [0, 3]);
});

test('closing the page frees the preview; a run that started still ends with a result', async () => {
  const vault = makeVault();
  const engine = makeEngine(vault);
  const idle = await preview(engine, csvOf(THREE));
  let calls = 0;
  idle.subscribe(() => calls++);
  idle.close();
  assert.deepEqual([idle.state, idle.plan, idle.file], ['idle', null, null]);
  assert.equal(await idle.confirm(), 'idle');
  await idle.load(source(csvOf(THREE)));
  assert.deepEqual([idle.state, calls], ['idle', 0]);

  const finished = [];
  const session = engine.createSession({ finished: (result) => finished.push(result) });
  await session.load(source(csvOf(THREE)));
  vault.faults.create = (file) => {
    if (file.endsWith('/Emma.md')) session.close();
  };
  assert.equal(await session.confirm(), 'done');
  assert.equal(engine.shared.last.created.length, 3);
  assert.equal(finished[0], engine.shared.last);
  assert.deepEqual([session.state, session.plan, vault.listeners.size], ['idle', null, 0]);
  engine.dismiss();
  assert.equal(engine.shared.last, null);
});

// ---- Limits -----------------------------------------------------------------------------------

test('the limits of file size, rows and field length hold in both runtimes', async (t) => {
  const { LIMITS } = core;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-limits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = (text) => {
    const csv = path.join(dir, 'storygraph.csv');
    fs.writeFileSync(csv, text);
    return spawnSync(process.execPath, [script, csv, '--out', path.join(dir, 'out')], {
      encoding: 'utf8',
    });
  };
  const engine = makeEngine(makeVault());
  const errorOf = async (given) => {
    const session = engine.createSession();
    await session.load(given);
    assert.equal(session.state, 'error');
    return session.error;
  };

  // Too large: refused by its size, before the file is read.
  const large = { name: 'big.csv', size: LIMITS.fileBytes + 1, read: () => assert.fail('read') };
  assert.deepEqual(await errorOf(large), {
    code: 'tooLarge',
    details: { limit: LIMITS.fileBytes },
  });
  const largeCli = cli(`${HEADER.join(',')}\n${'x'.repeat(LIMITS.fileBytes)}`);
  assert.equal(largeCli.status, 1);
  assert.match(largeCli.stderr, /larger than 10 MB/);

  // Too many rows: the parser stops there.
  const line = HEADER.map((name) => (name === 'Read Status' ? 'to-read' : 'x')).join(',');
  const many = `${HEADER.join(',')}\n${`${line}\n`.repeat(LIMITS.rows + 1)}`;
  assert.deepEqual(await errorOf(source(many)), {
    code: 'tooManyRows',
    details: { limit: LIMITS.rows },
  });
  const manyCli = cli(many);
  assert.equal(manyCli.status, 1);
  assert.match(manyCli.stderr, /more than 20000 rows/);
  assert.equal(
    core.parseCsv(many.slice(0, -line.length - 1), { maxRecords: LIMITS.rows + 1 }).length,
    LIMITS.rows + 1,
  );

  // A field that is too long skips its row only.
  const long = csvOf([
    planned('Emma', '9780141439587', { Review: 'x'.repeat(LIMITS.fieldLength + 1) }),
    planned('Persuasion', '9780141439686', { Review: 'x'.repeat(LIMITS.fieldLength) }),
  ]);
  const session = await preview(engine, long);
  assert.deepEqual(session.plan.skipped, [
    { kind: 'invalid', code: 'fieldTooLong', row: 2, limit: LIMITS.fieldLength },
  ]);
  assert.deepEqual(
    session.plan.fresh.map((book) => book.title),
    ['Persuasion'],
  );
  assert.match(cli(long).stdout, /Skipped: row 2: has a field longer than 10000 characters/);

  // Files that are not an export are errors of the file, with nothing planned.
  assert.equal((await errorOf(source(''))).code, 'empty');
  assert.equal((await errorOf(source('Title,Authors\nA,B\n'))).code, 'missingColumns');
  assert.equal((await errorOf(source('Title,"Authors\nA,B\n'))).code, 'unclosedQuote');
  const unreadable = {
    name: 'gone.csv',
    size: 10,
    read: async () => Promise.reject(new Error('NotReadableError')),
  };
  assert.equal((await errorOf(unreadable)).code, 'unreadable');
});

test('the import runtime uses no Node, Electron or file system API', () => {
  for (const file of ['storygraph.js', 'import/engine.js', 'import/view.js']) {
    const code = read(path.join(COLOPHON, file)).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(
      code,
      /\brequire\s*\(|\bprocess\.|\bBuffer\b|\belectron\b|node:|getBasePath|getFullPath|\bfs\./,
      file,
    );
  }
});
