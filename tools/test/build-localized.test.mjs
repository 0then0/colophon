import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { ROOT } from '../lib/common.mjs';

const script = path.join(ROOT, 'tools', 'build', 'build-localized.mjs');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

const workdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-build-'));

const custom = {
  statuses: [
    'planned',
    'in_progress',
    { key: 'on_hold', kind: 'in_progress', labels: { en: 'On hold', ru: 'Отложена' } },
    'finished',
    'abandoned',
  ],
  formats: ['paperback', { key: 'comics', labels: { en: 'Comics', ru: 'Комиксы' } }],
  categories: ['fiction', { key: 'memoir', labels: { en: 'Memoir' } }, 'philosophy'],
};

test('--config generates a Library base from custom statuses, formats and categories', () => {
  const dir = workdir();
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(custom));
    const out = path.join(dir, 'out');
    const result = run('--config', path.join(dir, 'config.json'), '--out', out);
    assert.equal(result.status, 0, result.stderr);

    const en = YAML.parse(fs.readFileSync(path.join(out, 'Library.en.base'), 'utf8'));
    const reading = en.views.find((v) => v.name === 'Reading');
    assert.deepEqual(reading.filters, { or: ['status == "in_progress"', 'status == "on_hold"'] });
    assert.deepEqual(en.views.find((v) => v.name === 'Finished').filters, {
      and: ['status == "finished"'],
    });
    assert.match(en.formulas.status_label, /if\(note\.status == "on_hold", "On hold"/);
    assert.match(
      en.formulas.format_label,
      /if\(note\.format == "comics", "Comics", note\.format\)/,
    );
    assert.ok(!en.formulas.format_label.includes('ebook'));
    const names = en.views.map((v) => v.name);
    assert.ok(names.includes('Memoir'));
    assert.ok(!names.includes('Audiobooks'), 'no audiobook format, no Audiobooks view');
    assert.ok(!names.includes('Fantasy'));
    // Featured categories come first, your own after them.
    assert.ok(names.indexOf('Philosophy') < names.indexOf('Memoir'));

    const ru = fs.readFileSync(path.join(out, 'Library.ru.base'), 'utf8');
    assert.match(ru, /"Отложена"/);
    assert.match(ru, /"Комиксы"/);
    // The English label is the fallback in a language without its own label.
    assert.match(fs.readFileSync(path.join(out, 'Library.de.base'), 'utf8'), /"On hold"/);

    // A prequel (series number 0) is shown by name in the Series view.
    assert.match(en.formulas.series_number, /if\(note\.series_index == 0, "Prequel"/);
    assert.ok(en.views.find((v) => v.name === 'Series').order.includes('formula.series_number'));

    // The Summaries base lists type "summary" notes by topic; fiction and non-fiction are not topics.
    const summaries = YAML.parse(fs.readFileSync(path.join(out, 'Summaries.en.base'), 'utf8'));
    assert.deepEqual(summaries.filters, { and: ['type == "summary"'] });
    assert.match(summaries.formulas.topics, /value == "memoir"/);
    assert.match(summaries.formulas.topics, /"Memoir"/);
    assert.ok(!summaries.formulas.topics.includes('value == "fiction"'));
    assert.deepEqual(
      summaries.views.map((v) => v.name),
      ['Summaries', 'By topic'],
    );
    const summaryTemplate = fs.readFileSync(path.join(out, 'Summary.en.md'), 'utf8');
    assert.match(summaryTemplate, /^type: "\{\{date:\[summary\]\}\}"$/m);

    const template = fs.readFileSync(path.join(out, 'Book.en.md'), 'utf8');
    assert.match(template, /^status: planned$/m);
    assert.ok(fs.existsSync(path.join(out, 'Statistics.en.md')));

    // --check agrees with what was just written.
    const check = run('--check', '--config', path.join(dir, 'config.json'), '--out', out);
    assert.equal(check.status, 0, check.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the template takes its default status from the first planned status', () => {
  const dir = workdir();
  try {
    const config = {
      ...custom,
      statuses: [
        { key: 'wishlist', kind: 'planned' },
        'planned',
        'in_progress',
        'finished',
        'abandoned',
      ],
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const out = path.join(dir, 'out');
    assert.equal(run('--config', path.join(dir, 'config.json'), '--out', out).status, 0);
    assert.match(fs.readFileSync(path.join(out, 'Book.en.md'), 'utf8'), /^status: wishlist$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid config stops the generator with readable messages', () => {
  const dir = workdir();
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ formats: ['a b', 'x', 'x'] }));
    const result = run('--config', file, '--out', path.join(dir, 'out'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /formats\[0\]: “a b” is not a valid key/);
    assert.match(result.stderr, /the key “x” is already used at formats\[1\]/);
    assert.ok(!fs.existsSync(path.join(dir, 'out')));

    fs.writeFileSync(file, '{"formats": [], "formats": []}');
    assert.equal(run('--config', file, '--out', path.join(dir, 'out')).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--config without --out refuses to touch the repository files', () => {
  const result = run('--config', 'whatever.json');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--out/);
});
