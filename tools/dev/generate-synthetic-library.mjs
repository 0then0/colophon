// Writes a deterministic synthetic library for performance and layout checks. All names are
// invented from syllables; nothing is taken from a real library. The output must go to a folder
// outside the repository.
//
//   node tools/dev/generate-synthetic-library.mjs <N> --out <folder> [--seed <number>]
//
// <folder> gets Books/Library/synthetic/*.md (N book notes, valid for Colophon) and
// Books/Notes/ (a few series notes). Copy the folder over a copy of example-vault.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/common.mjs';

const args = process.argv.slice(2);
const count = Number(args[0]);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (!Number.isInteger(count) || count < 1 || !opt('--out')) {
  console.error(
    'usage: node tools/dev/generate-synthetic-library.mjs <N> --out <folder> [--seed <number>]',
  );
  process.exit(2);
}
const out = path.resolve(opt('--out'));
if (out === ROOT || out.startsWith(ROOT + path.sep)) {
  console.error('error: --out must be outside the repository');
  process.exit(2);
}

// mulberry32: a small seeded generator, so the same seed gives the same library on every machine.
let state = Number(opt('--seed') ?? 1) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[int(0, list.length - 1)];
const chance = (p) => random() < p;

const SYLLABLES = [
  'ka',
  'lo',
  'mi',
  'ren',
  'tal',
  'vor',
  'sen',
  'dra',
  'bel',
  'fin',
  'gar',
  'hu',
  'jo',
  'nel',
  'pa',
  'qui',
  'sol',
  'tur',
  'wen',
  'zy',
];
const word = (min = 2, max = 3) => {
  const w = Array.from({ length: int(min, max) }, () => pick(SYLLABLES)).join('');
  return w[0].toUpperCase() + w.slice(1);
};
const FORMATS = ['audiobook', 'ebook', 'hardcover', 'paperback'];
const CATEGORIES = [
  'fiction',
  'non-fiction',
  'fantasy',
  'science-fiction',
  'classics',
  'detective',
  'philosophy',
  'it',
  'psychology',
  'productivity',
  'business',
  'science',
  'health',
  'history',
  'biography',
];
const date = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
const randomDate = (from, to) =>
  addDays(
    date(from, 1, 1),
    int(0, Math.round((Date.parse(date(to, 12, 28)) - Date.parse(date(from, 1, 1))) / 864e5)),
  );

const authors = Array.from(
  { length: Math.max(5, Math.round(count / 5)) },
  () => `${word(1, 2)} ${word(2, 3)}`,
);
const seriesNames = Array.from(
  { length: Math.max(1, Math.round(count / 25)) },
  () => `The ${word()} Cycle`,
);
const used = new Set();
const unique = (title) => {
  let name = title;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${title} ${n}`;
  used.add(name.toLowerCase());
  return name;
};

const dir = path.join(out, 'Books', 'Library', 'synthetic');
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(out, 'Books', 'Notes'), { recursive: true });
const seriesCounter = new Map();
const q = (s) => JSON.stringify(s);

for (let i = 0; i < count; i++) {
  const title = unique(`${word()} ${pick(['of', 'and', 'in'])} ${word()}`);
  const roll = random();
  const status =
    roll < 0.62 ? 'finished' : roll < 0.72 ? 'in_progress' : roll < 0.92 ? 'planned' : 'abandoned';
  const fm = ['---', 'type: book', `title: ${q(title)}`, 'author:'];
  const authorList = Array.from(
    new Set(Array.from({ length: chance(0.12) ? 2 : 1 }, () => pick(authors))),
  );
  fm.push(...authorList.map((a) => `  - ${q(a)}`), `status: ${status}`);
  if (chance(0.9)) fm.push(`format: ${pick(FORMATS)}`);
  const cats = Array.from(new Set(Array.from({ length: int(1, 3) }, () => pick(CATEGORIES))));
  fm.push('category:', ...cats.map((c) => `  - ${c}`));
  if (chance(0.15)) {
    const series = pick(seriesNames);
    const index = (seriesCounter.get(series) ?? 0) + 1;
    seriesCounter.set(series, index);
    fm.push(`series: ${q(series)}`, `series_index: ${index}`);
  }
  if (status === 'planned' && chance(0.15)) fm.push(`queue: ${int(1, 30)}`);
  const added = randomDate(2010, 2026);
  let started;
  let finished;
  if (status === 'finished' || status === 'abandoned' || status === 'in_progress') {
    started = randomDate(2012, 2026);
    if (status === 'finished') finished = addDays(started, int(0, 90));
  }
  if (status === 'finished' && chance(0.85)) fm.push(`rating: ${int(1, 10) / 2}`);
  fm.push(`pages: ${int(80, 1100)}`, `publication_year: ${int(1850, 2025)}`);
  if (started) fm.push(`started: ${started}`);
  if (finished) fm.push(`finished: ${finished}`);
  fm.push(`date_added: ${added}`);
  // Rereads: every history line is a past read, and reread_count matches the lines.
  const history = [];
  if (status === 'finished' && chance(0.1)) {
    for (let r = int(1, 3); r > 0; r--) {
      const from = randomDate(2012, 2024);
      history.push(`- ${from} → ${addDays(from, int(1, 60))}`);
    }
    fm.push(`reread_count: ${history.length}`);
  }
  fm.push(
    'cssclasses:',
    '  - book-page',
    '---',
    '',
    '```dataviewjs',
    'await dv.view("Colophon/book")',
    '```',
    '',
    '## Notes',
    '',
    '## Quotes',
    '',
  );
  if (chance(0.3)) {
    fm.push(
      `> ${word()} ${word()} ${pick(['walked', 'waited', 'wondered'])} ${word()} ${word()} and ${word()} ${word()}, as the story says.`,
      '',
    );
  }
  if (history.length) fm.push('## Reading history', '', ...history, '');
  fs.writeFileSync(path.join(dir, `${title}.md`), fm.join('\n'));
}
for (const series of [...seriesCounter.keys()].slice(0, 5)) {
  fs.writeFileSync(
    path.join(out, 'Books', 'Notes', `${series}.md`),
    `---\nseries: ${q(series)}\n---\n\nA synthetic series note.\n`,
  );
}
console.log(`${count} notes in ${dir}`);
