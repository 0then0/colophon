import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { COLOPHON, ROOT } from '../lib/common.mjs';

const installer = path.join(ROOT, 'tools', 'user', 'install.mjs');
const run = (...args) => spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8' });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-install-'));
const cleanup = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

// A vault as Obsidian leaves it: a .obsidian folder with settings of its own and one note.
const makeVault = (dir) => {
  fs.mkdirSync(path.join(dir, '.obsidian', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.obsidian', 'app.json'), '{"theme":"obsidian"}');
  fs.writeFileSync(path.join(dir, '.obsidian', 'community-plugins.json'), '[]');
  fs.writeFileSync(path.join(dir, 'My note.md'), 'hello\n');
  return dir;
};

// Every file and folder with its content hash (and mtime for files).
const snapshot = (dir, base = dir, out = {}) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      out[rel + '/'] = 'dir';
      snapshot(full, base, out);
    } else {
      out[rel] =
        `${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')} ${fs.statSync(full).mtimeMs}`;
    }
  }
  return out;
};
const only = (snap, prefix) =>
  Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(prefix)));

test('without --apply nothing is changed and the plan is printed', () => {
  const vault = makeVault(tmp());
  try {
    const before = snapshot(vault);
    const result = run(vault);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /plan only/);
    assert.match(result.stdout, /Plan only\. Add --apply/);
    assert.deepEqual(snapshot(vault), before);
  } finally {
    cleanup(vault);
  }
});

test('--apply installs the product, config, template, base and statistics note', () => {
  const vault = makeVault(tmp());
  try {
    const obsidian = only(snapshot(vault), '.obsidian');
    const result = run(vault, '--apply', '--language', 'de');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next steps in Obsidian/);
    assert.match(result.stdout, /Enable JavaScript Queries/);
    assert.match(result.stdout, /Template folder to "Templates"/);

    // The product folder is a copy of the source, except config.json.
    for (const file of [
      'lib.js',
      'model.js',
      'book/view.js',
      'book/view.css',
      'statistics/view.js',
      'locales/de.json',
    ]) {
      assert.deepEqual(
        fs.readFileSync(path.join(vault, 'Colophon', file)),
        fs.readFileSync(path.join(COLOPHON, file)),
        file,
      );
    }
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(vault, 'Colophon', 'config.json'), 'utf8')),
      {
        language: 'de',
        paths: { library: 'Books/Library', notes: 'Books/Notes', covers: 'Books/covers' },
      },
    );
    const localized = (name) => fs.readFileSync(path.join(COLOPHON, 'localized', name));
    assert.deepEqual(
      fs.readFileSync(path.join(vault, 'Templates', 'Book.md')),
      localized('Book.de.md'),
    );
    assert.deepEqual(
      fs.readFileSync(path.join(vault, 'Books', 'Library.base')),
      localized('Library.de.base'),
    );
    assert.deepEqual(
      fs.readFileSync(path.join(vault, 'Books', 'Statistics.md')),
      localized('Statistics.de.md'),
    );
    for (const dir of ['Books/Library', 'Books/Notes', 'Books/covers']) {
      assert.ok(fs.statSync(path.join(vault, dir)).isDirectory(), dir);
    }
    assert.equal(fs.readFileSync(path.join(vault, 'My note.md'), 'utf8'), 'hello\n');
    // .obsidian is exactly as it was.
    assert.deepEqual(only(snapshot(vault), '.obsidian'), obsidian);
  } finally {
    cleanup(vault);
  }
});

test('custom folders and the default config for an untouched run', () => {
  const vault = makeVault(tmp());
  try {
    const result = run(
      vault,
      '--apply',
      '--library',
      'Reading\\Books/',
      '--notes',
      'Reading/Series',
      '--covers',
      'Reading/img',
      '--templates',
      'Tpl',
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(vault, 'Colophon', 'config.json'), 'utf8')),
      {
        language: 'auto',
        paths: { library: 'Reading/Books', notes: 'Reading/Series', covers: 'Reading/img' },
      },
    );
    assert.ok(fs.existsSync(path.join(vault, 'Tpl', 'Book.md')));
    assert.ok(fs.existsSync(path.join(vault, 'Reading', 'Library.base')));
    assert.ok(fs.existsSync(path.join(vault, 'Reading', 'Statistics.md')));
    assert.match(result.stdout, /Template folder to "Tpl"/);
    assert.ok(!fs.existsSync(path.join(vault, 'Templates')));
  } finally {
    cleanup(vault);
  }
});

test('running --apply again changes nothing', () => {
  const vault = makeVault(tmp());
  try {
    assert.equal(run(vault, '--apply').status, 0);
    const before = snapshot(vault);
    const again = run(vault, '--apply');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Nothing to do/);
    assert.deepEqual(snapshot(vault), before); // content and modification times
    const plan = run(vault);
    assert.equal(plan.status, 0);
    assert.match(plan.stdout, /Everything is already installed/);
  } finally {
    cleanup(vault);
  }
});

test('a changed file is a conflict: nothing is written, --force overwrites only what differs', () => {
  const vault = makeVault(tmp());
  try {
    assert.equal(run(vault, '--apply').status, 0);
    const lib = path.join(vault, 'Colophon', 'lib.js');
    const config = path.join(vault, 'Colophon', 'config.json');
    fs.writeFileSync(lib, '// my edit\n');
    fs.writeFileSync(config, '{"language":"ru"}\n');
    fs.rmSync(path.join(vault, 'Books', 'Library.base'));
    const before = snapshot(vault);

    for (const args of [[vault], [vault, '--apply']]) {
      const result = run(...args);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /DIFFERS\s+Colophon\/lib\.js/);
      assert.match(result.stderr, /Nothing was written/);
    }
    assert.deepEqual(
      snapshot(vault),
      before,
      'a conflict leaves the vault untouched, even the missing file',
    );

    const forced = run(vault, '--apply', '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.deepEqual(fs.readFileSync(lib), fs.readFileSync(path.join(COLOPHON, 'lib.js')));
    assert.ok(fs.existsSync(path.join(vault, 'Books', 'Library.base')));
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')).language, 'auto');
  } finally {
    cleanup(vault);
  }
});

test('a file named Colophon, or a link, blocks the install', () => {
  const vault = makeVault(tmp());
  try {
    fs.writeFileSync(path.join(vault, 'Colophon'), 'not a folder');
    const before = snapshot(vault);
    const result = run(vault, '--apply', '--force');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /BLOCKED/);
    assert.deepEqual(snapshot(vault), before);
  } finally {
    cleanup(vault);
  }
  if (process.platform === 'win32') return;
  const linked = makeVault(tmp());
  const elsewhere = tmp();
  try {
    fs.symlinkSync(elsewhere, path.join(linked, 'Colophon'));
    const result = run(linked, '--apply', '--force');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /symbolic link/);
    assert.deepEqual(fs.readdirSync(elsewhere), []);
  } finally {
    cleanup(linked, elsewhere);
  }
});

test('--summaries adds the Summary template and Summaries.base; without it they are not installed', () => {
  const vault = makeVault(tmp());
  try {
    assert.equal(run(vault, '--apply', '--language', 'ru').status, 0);
    assert.ok(!fs.existsSync(path.join(vault, 'Templates', 'Summary.md')));
    assert.ok(!fs.existsSync(path.join(vault, 'Books', 'Summaries.base')));
    const result = run(vault, '--apply', '--language', 'ru', '--summaries');
    assert.equal(result.status, 0, result.stderr);
    const localized = (name) => fs.readFileSync(path.join(COLOPHON, 'localized', name));
    assert.deepEqual(
      fs.readFileSync(path.join(vault, 'Templates', 'Summary.md')),
      localized('Summary.ru.md'),
    );
    assert.deepEqual(
      fs.readFileSync(path.join(vault, 'Books', 'Summaries.base')),
      localized('Summaries.ru.base'),
    );
  } finally {
    cleanup(vault);
  }
});

test('--skip-* leave the matching files out and the checklist follows', () => {
  const vault = makeVault(tmp());
  try {
    const result = run(vault, '--apply', '--skip-template', '--skip-base', '--skip-statistics');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(vault, 'Colophon', 'lib.js')));
    assert.ok(!fs.existsSync(path.join(vault, 'Templates')));
    assert.ok(!fs.existsSync(path.join(vault, 'Books', 'Library.base')));
    assert.ok(!fs.existsSync(path.join(vault, 'Books', 'Statistics.md')));
    assert.doesNotMatch(result.stdout, /Templates"/);
  } finally {
    cleanup(vault);
  }
});

test('a folder without .obsidian is refused, and --no-vault-check never creates .obsidian', () => {
  const dir = tmp();
  try {
    const refused = run(dir, '--apply');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /no \.obsidian folder/);
    assert.deepEqual(fs.readdirSync(dir), []);

    const forced = run(dir, '--apply', '--no-vault-check');
    assert.equal(forced.status, 0, forced.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'Colophon', 'lib.js')));
    assert.ok(!fs.existsSync(path.join(dir, '.obsidian')));
  } finally {
    cleanup(dir);
  }
});

test('bad arguments get clear errors and change nothing', () => {
  const vault = makeVault(tmp());
  try {
    const before = snapshot(vault);
    const cases = [
      [[path.join(vault, 'missing'), '--apply'], 1, /does not exist/],
      [[path.join(vault, 'My note.md'), '--apply'], 1, /is not a folder/],
      [[vault, '--language', 'xx'], 2, /not available/],
      [[vault, '--library', '../outside'], 2, /inside the vault/],
      [[vault, '--library', '.obsidian/books'], 2, /hidden folders/],
      [[vault, '--covers', '/abs/path'], 2, /relative/],
      [[vault, '--covers', 'C:\\covers'], 2, /relative/],
      [[vault, '--notes'], 2, /needs a value/],
      [[vault, '--bogus'], 2, /unknown option/],
      [[], 2, /exactly one vault/],
    ];
    for (const [args, status, pattern] of cases) {
      const result = run(...args);
      assert.equal(result.status, status, `${args.join(' ')}: ${result.stderr}`);
      assert.match(result.stderr, pattern);
    }
    assert.deepEqual(snapshot(vault), before);
    assert.equal(
      run(vault, '--language', 'pt_br').status,
      0,
      'language codes are matched like Obsidian does',
    );
    assert.equal(run('--help').status, 0);
  } finally {
    cleanup(vault);
  }
});

test('the source folder cannot be the target', () => {
  const result = run(path.join(ROOT, 'example-vault', 'Colophon'), '--no-vault-check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /same folder/);
});
