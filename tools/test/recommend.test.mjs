import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { COLOPHON, read } from '../lib/common.mjs';

const rec = new Function(read(path.join(COLOPHON, 'recommend.js')))();
const isTopic = (c) => c !== 'fiction' && c !== 'non-fiction';
const TODAY = '2026-11-04';

let n = 0;
const book = (over = {}) => ({
  id: `b${++n}`,
  title: `Book ${n}`,
  authors: [],
  categories: [],
  kind: 'planned',
  rating: null,
  series: null,
  seriesIndex: null,
  queue: null,
  pages: null,
  formats: [],
  dateAdded: null,
  snoozedUntil: null,
  links: [],
  ...over,
});
const read5 = (over) => book({ kind: 'finished', rating: 5, ...over });
// Low ratings by others bring the overall average down, so that liked authors stand out.
const filler = () => Array.from({ length: 4 }, () => read5({ authors: ['Filler'], rating: 2 }));
const ids = (list) => list.map((x) => x.book.id);

test('a planned book is suggested for an author you rated well, with the reason', () => {
  const good = Array.from({ length: 3 }, () => read5({ authors: ['Ann'] }));
  const other = read5({ authors: ['Zed'], rating: 3 });
  const planned = book({ authors: ['Ann'] });
  const { candidates } = rec.analyze([...good, other, planned], TODAY, isTopic);
  assert.deepEqual(ids(candidates), [planned.id]);
  assert.deepEqual(candidates[0].reasons[0], { code: 'author', author: 'Ann', avg: 5, count: 3 });
});

test('an average is smoothed: three five-star books rank above a single five-star book', () => {
  const lone = [read5({ authors: ['Lone'] })];
  const trio = Array.from({ length: 3 }, () => read5({ authors: ['Trio'] }));
  const a = book({ authors: ['Lone'] });
  const b = book({ authors: ['Trio'] });
  const { candidates } = rec.analyze([...lone, ...trio, ...filler(), a, b], TODAY, isTopic);
  const score = (x) => candidates.find((c) => c.book === x)?.score ?? -Infinity;
  assert.ok(score(b) > score(a), `${score(b)} should be above ${score(a)}`);
});

test('an abandoned book without a rating counts against its author', () => {
  const liked = Array.from({ length: 3 }, () => read5({ authors: ['Mixed'] }));
  const dropped = book({ authors: ['Mixed'], kind: 'abandoned' });
  const planned = book({ authors: ['Mixed'] });
  const base = rec.analyze([...liked, ...filler(), planned], TODAY, isTopic).candidates[0].score;
  const withDrop = rec.analyze([...liked, ...filler(), dropped, planned], TODAY, isTopic)
    .candidates[0].score;
  assert.ok(withDrop < base);
});

test('queued, snoozed and in-progress books are not suggested; a snooze ends on its date', () => {
  const good = Array.from({ length: 3 }, () => read5({ authors: ['Ann'] }));
  const queued = book({ authors: ['Ann'], queue: 1 });
  const snoozed = book({ authors: ['Ann'], snoozedUntil: '2027-01-01' });
  const expired = book({ authors: ['Ann'], snoozedUntil: '2026-11-04' });
  const reading = book({ authors: ['Ann'], kind: 'in_progress' });
  const { candidates } = rec.analyze(
    [...good, ...filler(), queued, snoozed, expired, reading],
    TODAY,
    isTopic,
  );
  assert.deepEqual(ids(candidates), [expired.id]);
});

test('series: continue a liked series; skip one with a dropped book; keep the order', () => {
  const s1 = read5({ series: 'Liked', seriesIndex: 1 });
  const s2 = book({ series: 'Liked', seriesIndex: 2 });
  const s3 = book({ series: 'Liked', seriesIndex: 3 });
  const d1 = read5({ series: 'Dropped', seriesIndex: 1 });
  const d2 = book({ kind: 'abandoned', series: 'Dropped', seriesIndex: 2 });
  const d3 = book({ series: 'Dropped', seriesIndex: 3 });
  const bad1 = read5({ series: 'Disliked', seriesIndex: 1, rating: 1 });
  const bad2 = book({ series: 'Disliked', seriesIndex: 2 });
  const filler = read5({ rating: 3 });
  const { seriesPicks, candidates } = rec.analyze(
    [s1, s2, s3, d1, d2, d3, bad1, bad2, filler],
    TODAY,
    isTopic,
  );
  assert.deepEqual(
    seriesPicks.map((x) => x.book.id),
    [s2.id],
  );
  assert.deepEqual(seriesPicks[0].rating, { value: seriesPicks[0].rating.value, avg: 5, count: 1 });
  const all = ids(candidates);
  for (const hidden of [s3, d3, bad2]) assert.ok(!all.includes(hidden.id), hidden.title);
});

test('a link to a book you rated 4 or more, in either direction, is a reason', () => {
  const liked = read5({ title: 'Linked Read' });
  const weak = read5({ title: 'Weak', rating: 3 });
  const outgoing = book({ links: [liked.id] });
  const incoming = book();
  liked.links.push(incoming.id);
  const toWeak = book({ links: [weak.id] });
  const { candidates } = rec.analyze([liked, weak, outgoing, incoming, toWeak], TODAY, isTopic);
  assert.deepEqual(new Set(ids(candidates)), new Set([outgoing.id, incoming.id]));
  assert.deepEqual(candidates[0].reasons[0], {
    code: 'link',
    title: 'Linked Read',
    rating: 5,
    more: 0,
  });
});

test('waiting for three years or more adds a reason, a shorter wait only a small bonus', () => {
  const good = Array.from({ length: 3 }, () => read5({ authors: ['Ann'] }));
  const old = book({ authors: ['Ann'], dateAdded: '2022-11-01' });
  const recent = book({ authors: ['Ann'], dateAdded: '2025-11-01' });
  const { candidates } = rec.analyze([...good, ...filler(), old, recent], TODAY, isTopic);
  const of = (b) => candidates.find((c) => c.book === b);
  assert.deepEqual(of(old).reasons.at(-1), { code: 'waited', years: 4 });
  assert.ok(!of(recent).reasons.some((r) => r.code === 'waited'));
  assert.ok(of(old).score > of(recent).score);
});

// A library with many candidates, to test the choice of six.
const library = () => {
  n = 0;
  const books = [];
  for (let a = 0; a < 8; a++) {
    for (let i = 0; i < 2; i++) {
      books.push(
        read5({ authors: [`Fic ${a}`], categories: ['fiction', a % 2 ? 'fantasy' : 'classics'] }),
      );
      books.push(
        read5({
          authors: [`Non ${a}`],
          categories: ['non-fiction', a % 2 ? 'science' : 'history'],
        }),
      );
    }
    books.push(
      book({
        authors: [`Fic ${a}`],
        categories: ['fiction', a % 2 ? 'fantasy' : 'classics'],
        pages: a === 0 ? 200 : 400,
      }),
    );
    books.push(book({ authors: [`Fic ${a}`], categories: ['fiction'], pages: 350 }));
    books.push(
      book({
        authors: [`Non ${a}`],
        categories: ['non-fiction', a % 2 ? 'science' : 'history'],
        formats: a === 1 ? ['audiobook'] : [],
      }),
    );
  }
  return [...books, ...filler()];
};

test('the list has three fiction and three non-fiction books, one author each, at most two per topic', () => {
  const { candidates } = rec.analyze(library(), TODAY, isTopic);
  const picks = rec.choose(candidates, 'all', '2026-11', isTopic);
  assert.equal(picks.length, 6);
  const authors = picks.flatMap((x) => x.book.authors);
  assert.equal(new Set(authors).size, authors.length);
  assert.equal(picks.filter((x) => rec.FILTERS.fiction(x.book)).length, 3);
  assert.equal(picks.filter((x) => rec.FILTERS.nonfiction(x.book)).length, 3);
  assert.equal(picks.filter((x) => x.monthly).length, 2);
  const topics = {};
  for (const x of picks)
    for (const c of x.book.categories.filter(isTopic)) topics[c] = (topics[c] || 0) + 1;
  assert.ok(Object.values(topics).every((count) => count <= 2));
});

test('the monthly picks stay the same within a month and change between months', () => {
  const { candidates } = rec.analyze(library(), TODAY, isTopic);
  const month = (key) =>
    rec
      .choose(candidates, 'all', key, isTopic)
      .filter((x) => x.monthly)
      .map((x) => x.book.id);
  assert.deepEqual(month('2026-11'), month('2026-11'));
  const seen = new Set(
    ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04'].map((k) => month(k).join()),
  );
  assert.ok(seen.size > 1, 'the rotation does something');
  // The best books are the same every month; only the monthly places rotate.
  const fixed = (key) =>
    rec
      .choose(candidates, 'all', key, isTopic)
      .filter((x) => !x.monthly)
      .map((x) => x.book.id);
  assert.deepEqual(fixed('2026-11'), fixed('2027-05'));
});

test('filters: only matching books, and a filter is offered only if something matches', () => {
  const { candidates } = rec.analyze(library(), TODAY, isTopic);
  const short = rec.choose(candidates, 'short', '2026-11', isTopic);
  assert.ok(short.length > 0 && short.every((x) => x.book.pages <= 300));
  const audio = rec.choose(candidates, 'audio', '2026-11', isTopic);
  assert.ok(audio.length > 0 && audio.every((x) => x.book.formats.includes('audiobook')));
  const none = candidates.filter((x) => rec.FILTERS.audio(x.book) && rec.FILTERS.short(x.book));
  assert.equal(rec.choose(none, 'short', '2026-11', isTopic).length <= none.length, true);
  assert.deepEqual(rec.choose([], 'all', '2026-11', isTopic), []);
});

test('the result does not depend on the order of the books', () => {
  const books = library();
  const forward = rec.choose(
    rec.analyze(books, TODAY, isTopic).candidates,
    'all',
    '2026-11',
    isTopic,
  );
  const backward = rec.choose(
    rec.analyze([...books].reverse(), TODAY, isTopic).candidates,
    'all',
    '2026-11',
    isTopic,
  );
  assert.deepEqual(ids(forward).sort(), ids(backward).sort());
});
