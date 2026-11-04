import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { COLOPHON, loadLocale, model, parseStrictJson, read } from '../lib/common.mjs';

const shipped = parseStrictJson(read(path.join(COLOPHON, 'config.json')), 'config.json');
const en = loadLocale('en');
const codes = (raw) => model.resolve(raw).problems.map((p) => `${p.code}:${p.path}`);
const keys = (list) => list.map((e) => e.key);

test('the shipped config.json has no problems and keeps the built-in lists', () => {
  const settings = model.resolve(shipped);
  assert.deepEqual(settings.problems, []);
  assert.equal(settings.language, 'auto');
  assert.deepEqual(keys(settings.statuses), ['planned', 'in_progress', 'finished', 'abandoned']);
  assert.deepEqual(keys(settings.formats), ['audiobook', 'ebook', 'hardcover', 'paperback']);
  assert.equal(settings.categories.length, 15);
});

test('a config without the new sections works as before', () => {
  const settings = model.resolve({ language: 'de', paths: { covers: '/Img/' } });
  assert.deepEqual(settings.problems, []);
  assert.equal(settings.language, 'de');
  assert.deepEqual(settings.paths, {
    library: 'Books/Library',
    notes: 'Books/Notes',
    covers: 'Img',
  });
  assert.equal(settings.statuses.length, 4);
  assert.deepEqual(model.resolve({}).problems, []);
});

test('fiction and non-fiction are not topics, other categories are', () => {
  const catalog = model.catalog(model.resolve({}), 'en', (key) => en[key]);
  assert.equal(catalog.isTopic('fiction'), false);
  assert.equal(catalog.isTopic('non-fiction'), false);
  assert.equal(catalog.isTopic('philosophy'), true);
  assert.equal(catalog.isTopic('unknown'), false);
});

test('custom values: strings, objects, kinds and topic flags', () => {
  const settings = model.resolve({
    statuses: [
      'planned',
      'in_progress',
      { key: 'on_hold', kind: 'in_progress', labels: { en: 'On hold', ru: 'Отложена' } },
      'finished',
      { key: 'abandoned' },
    ],
    formats: ['paperback', { key: 'comics', labels: { en: 'Comics' } }],
    categories: ['fiction', { key: 'memoir', topic: true }, { key: 'reference', topic: false }],
  });
  assert.deepEqual(settings.problems, []);
  const catalog = model.catalog(settings, 'en', (key) => en[key]);
  assert.equal(catalog.kindOf('on_hold'), 'in_progress');
  assert.deepEqual(catalog.keysOfKind('in_progress'), ['in_progress', 'on_hold']);
  assert.equal(catalog.kindOf('missing'), null);
  assert.deepEqual(keys(catalog.formats), ['paperback', 'comics']);
  assert.equal(catalog.isTopic('memoir'), true);
  assert.equal(catalog.isTopic('reference'), false);
  assert.equal(catalog.has('format', 'ebook'), false);
});

test('labels: own language, base language, shipped translation, own English, key', () => {
  const settings = model.resolve({
    statuses: [
      { key: 'planned', labels: { en: 'Backlog' } },
      'in_progress',
      {
        key: 'on_hold',
        kind: 'in_progress',
        labels: { en: 'On hold', ru: 'Отложена', pt: 'Em pausa' },
      },
      'finished',
      'abandoned',
    ],
    formats: [{ key: 'zine' }],
  });
  assert.deepEqual(settings.problems, []);
  const label = (locale, group, value) => {
    const messages =
      locale === 'ru' ? loadLocale('ru') : { ...en, ...(locale === 'de' ? loadLocale('de') : {}) };
    return model.catalog(settings, locale, (key) => messages[key]).label(group, value);
  };
  assert.equal(label('ru', 'status', 'on_hold'), 'Отложена');
  assert.equal(label('pt-BR', 'status', 'on_hold'), 'Em pausa');
  assert.equal(label('de', 'status', 'on_hold'), 'On hold');
  // The English label of a built-in value replaces the shipped English text only.
  assert.equal(label('en', 'status', 'planned'), 'Backlog');
  assert.equal(label('ru', 'status', 'planned'), loadLocale('ru')['status.planned']);
  assert.equal(label('en', 'format', 'zine'), 'zine');
  // A value that is not in the settings is shown as it is, or with its shipped translation.
  assert.equal(label('en', 'format', 'vinyl'), 'vinyl');
  assert.equal(label('en', 'category', 'fantasy'), 'Fantasy');
});

const invalid = [
  ['root is not an object', [], ['notObject:config.json']],
  ['top-level typo', { format: [] }, ['unknownField:format']],
  ['underscore names are allowed for notes', { _comment: 'x', $schema: 'y' }, []],
  ['language is not text', { language: 5 }, ['notString:language']],
  ['paths is not an object', { paths: [] }, ['notObject:paths']],
  ['unknown path', { paths: { shelf: 'x' } }, ['unknownField:paths.shelf']],
  ['empty path', { paths: { library: '//' } }, ['empty:paths.library']],
  ['formats is not a list', { formats: 'ebook' }, ['notArray:formats']],
  ['item is a number', { formats: [5] }, ['badItem:formats[0]']],
  ['object without key', { formats: [{ labels: {} }] }, ['empty:formats[0].key']],
  ['key is not text', { formats: [{ key: 5 }] }, ['notString:formats[0].key']],
  ['empty key', { formats: [''] }, ['empty:formats[0]']],
  ['key with a space', { formats: ['a b'] }, ['badKey:formats[0]']],
  ['key with uppercase', { categories: ['Memoir'] }, ['badKey:categories[0]']],
  ['key with a comma', { categories: ['a,b'] }, ['badKey:categories[0]']],
  ['key with a quote', { categories: ['a"b'] }, ['badKey:categories[0]']],
  ['key starting with a dash', { formats: ['-a'] }, ['badKey:formats[0]']],
  ['key that is too long', { formats: ['a'.repeat(65)] }, ['badKey:formats[0]']],
  ['duplicate key', { formats: ['ebook', { key: 'ebook' }] }, ['duplicateKey:formats[1].key']],
  ['typo in an item', { formats: [{ key: 'a', lable: {} }] }, ['unknownField:formats[0].lable']],
  [
    'kind on a format',
    { formats: [{ key: 'a', kind: 'finished' }] },
    ['unknownField:formats[0].kind'],
  ],
  [
    'topic on a format',
    { formats: [{ key: 'a', topic: true }] },
    ['unknownField:formats[0].topic'],
  ],
  ['labels is a list', { formats: [{ key: 'a', labels: [] }] }, ['notObject:formats[0].labels']],
  [
    'label is a number',
    { formats: [{ key: 'a', labels: { en: 1 } }] },
    ['notString:formats[0].labels.en'],
  ],
  [
    'label is empty',
    { formats: [{ key: 'a', labels: { en: ' ' } }] },
    ['empty:formats[0].labels.en'],
  ],
  [
    'label with a quote',
    { formats: [{ key: 'a', labels: { en: 'My "a"' } }] },
    ['labelChars:formats[0].labels.en'],
  ],
  [
    'label language is wrong',
    { formats: [{ key: 'a', labels: { 'e n': 'x' } }] },
    ['badLabelTag:formats[0].labels.e n'],
  ],
  [
    'topic is not a boolean',
    { categories: [{ key: 'a', topic: 'no' }] },
    ['notBoolean:categories[0].topic'],
  ],
];
for (const [name, raw, expected] of invalid) {
  test(`invalid config: ${name}`, () => assert.deepEqual(codes(raw), expected));
}

const all = ['planned', 'in_progress', 'finished', 'abandoned'];
test('invalid statuses', () => {
  assert.deepEqual(codes({ statuses: [...all, { key: 'x' }] }), ['missingKind:statuses[4]']);
  assert.deepEqual(codes({ statuses: [...all, { key: 'x', kind: 'done' }] }), [
    'badKind:statuses[4].kind',
  ]);
  assert.deepEqual(codes({ statuses: [...all, { key: 'x', kind: 7 }] }), [
    'badKind:statuses[4].kind',
  ]);
  assert.deepEqual(
    codes({
      statuses: [{ key: 'planned', kind: 'finished' }, 'in_progress', 'finished', 'abandoned'],
    }),
    ['builtinKind:statuses[0].kind'],
  );
  assert.deepEqual(codes({ statuses: ['planned', 'finished', 'abandoned'] }), [
    'missingBuiltin:statuses',
  ]);
  assert.deepEqual(codes({ statuses: [{ key: 'planned', kind: 'planned' }, ...all.slice(1)] }), []);
});

test('a list with a problem falls back to the defaults as a whole, other lists are kept', () => {
  const settings = model.resolve({ formats: ['a b', 'zine'], categories: ['memoir'] });
  assert.deepEqual(keys(settings.formats), ['audiobook', 'ebook', 'hardcover', 'paperback']);
  assert.deepEqual(keys(settings.categories), ['memoir']);
  assert.equal(settings.problems.length, 1);
});

test('every problem code has a message in en.json', () => {
  const sample = model.resolve({
    format: 1,
    formats: [5, 'a b', 'ebook', 'ebook'],
    statuses: [{ key: 'x' }],
  });
  for (const problem of sample.problems) {
    const { key } = model.problemMessage(problem);
    assert.equal(typeof en[key], 'string', key);
  }
  const used = new Set(
    read(path.join(COLOPHON, 'model.js'))
      .match(/code: '(\w+)'/g)
      ?.map((m) => /'(\w+)'/.exec(m)[1]),
  );
  for (const code of used)
    assert.equal(typeof en[`config.error.${code}`], 'string', `config.error.${code}`);
});

test('toUtcDate accepts strings, dates and Luxon-like objects', () => {
  const expected = Date.UTC(2026, 2, 15);
  assert.equal(model.toUtcDate('2026-03-15').getTime(), expected);
  assert.equal(model.toUtcDate({ year: 2026, month: 3, day: 15 }).getTime(), expected);
  assert.equal(model.toUtcDate(new Date(expected)).getTime(), expected);
  assert.equal(model.toUtcDate('March'), null);
  assert.equal(model.toUtcDate(null), null);
});

test('readingDays: signed whole days, null for missing or invalid dates', () => {
  assert.equal(model.readingDays('2026-02-20', '2026-03-15'), 23);
  assert.equal(model.readingDays('2026-03-15', '2026-03-15'), 0);
  assert.equal(model.readingDays('2026-03-15', '2026-03-14'), -1);
  assert.equal(model.readingDays('2026-03-28', '2026-03-30'), 2); // across the spring DST change
  assert.equal(model.readingDays('2025-12-31', '2026-01-01'), 1);
  assert.equal(
    model.readingDays({ year: 2024, month: 2, day: 28 }, { year: 2024, month: 3, day: 1 }),
    2,
  );
  assert.equal(model.readingDays(null, '2026-03-15'), null);
  assert.equal(model.readingDays('2026-03-15', undefined), null);
  assert.equal(model.readingDays('soon', '2026-03-15'), null);
});
