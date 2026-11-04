import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, loadLocale, loadSettings, model } from '../lib/common.mjs';
import { frontmatterOf, validateBookNote } from '../lib/note-validation.mjs';

const generate = (out, ...extra) =>
  spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'tools', 'dev', 'generate-synthetic-library.mjs'),
      '300',
      '--out',
      out,
      ...extra,
    ],
    { encoding: 'utf8' },
  );
const read = (out) => {
  const dir = path.join(out, 'Books', 'Library', 'synthetic');
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .sort()
      .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
  );
};

test('the synthetic library is deterministic for a seed and every note is valid', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-syn-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-syn-'));
  const c = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-syn-'));
  try {
    assert.equal(generate(a, '--seed', '7').status, 0);
    assert.equal(generate(b, '--seed', '7').status, 0);
    assert.equal(generate(c, '--seed', '8').status, 0);
    assert.deepEqual(read(a), read(b));
    assert.notDeepEqual(Object.keys(read(a)), Object.keys(read(c)));
    const notes = read(a);
    assert.equal(Object.keys(notes).length, 300);
    const { settings } = loadSettings();
    const english = loadLocale('en');
    const catalog = model.catalog(settings, 'en', (key) => english[key]);
    const statuses = new Set();
    for (const [name, text] of Object.entries(notes)) {
      const data = frontmatterOf(text);
      statuses.add(data.status);
      assert.deepEqual(
        validateBookNote({
          data,
          text,
          catalog,
          coversFolder: settings.paths.covers,
          coverExists: () => true,
        }),
        [],
        name,
      );
    }
    assert.equal(statuses.size, 4);
  } finally {
    for (const d of [a, b, c]) fs.rmSync(d, { recursive: true, force: true });
  }
});
