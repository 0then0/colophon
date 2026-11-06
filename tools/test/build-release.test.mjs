import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { COLOPHON, ROOT, read } from '../lib/common.mjs';

const version = JSON.parse(read(path.join(ROOT, 'package.json'))).version;
const top = `colophon-${version}`;
const build = (out) => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'tools', 'build', 'build-release.mjs'), '--out', out],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return path.join(out, `${top}.zip`);
};

// Reads a zip written with method 0 (stored), through its central directory.
const unzip = (file, into) => {
  const zip = fs.readFileSync(file);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const mode = zip.readUInt32LE(p + 38) >>> 16;
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    assert.equal(method, 0);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    const target = path.join(into, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    entries.push({ name, mode });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

test('the release archive is reproducible and holds the installer, its docs and the product', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-rel-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'colophon-rel-b-'));
  try {
    const first = fs.readFileSync(build(a));
    const second = fs.readFileSync(build(b));
    assert.deepEqual(first, second, 'same sources, same bytes');
    assert.match(
      fs.readFileSync(path.join(a, `${top}.zip.sha256`), 'utf8'),
      /^[0-9a-f]{64} {2}colophon-/,
    );

    const entries = unzip(path.join(a, `${top}.zip`), path.join(a, 'x'));
    const names = entries.map((e) => e.name);
    assert.deepEqual(names, [...names].sort(), 'sorted');
    for (const name of [
      'install.mjs',
      'import-goodreads.mjs',
      'import-storygraph.mjs',
      'import-library.mjs',
      'storygraph-readings.mjs',
      'INSTALL.md',
      'LICENSE',
      'CHANGELOG.md',
      'Colophon/lib.js',
      'Colophon/model.js',
      'Colophon/config.json',
      'Colophon/localized/Library.en.base',
    ]) {
      assert.ok(names.includes(`${top}/${name}`), name);
    }
    assert.ok(names.every((n) => n.startsWith(`${top}/`)));
    assert.ok(
      !names.some((n) => /\.(png|jpg)$|\.obsidian|node_modules|\.DS_Store/.test(n)),
      'no covers, no Obsidian settings',
    );
    assert.equal(entries.find((e) => e.name.endsWith('/install.mjs')).mode & 0o777, 0o755);
    assert.equal(entries.find((e) => e.name.endsWith('/lib.js')).mode & 0o777, 0o644);

    // Every Colophon file in the archive is the file in the repository.
    for (const name of names.filter((n) => n.includes('/Colophon/'))) {
      const rel = name.slice(`${top}/Colophon/`.length);
      assert.deepEqual(
        fs.readFileSync(path.join(a, 'x', ...name.split('/'))),
        fs.readFileSync(path.join(COLOPHON, rel)),
        rel,
      );
    }
    // The system unzip agrees that the archive is well formed (skipped where there is no unzip).
    const check = spawnSync('unzip', ['-tq', path.join(a, `${top}.zip`)], { encoding: 'utf8' });
    if (!check.error) assert.equal(check.status, 0, check.stdout + check.stderr);

    // The installer from the unpacked archive works on a clean vault, with no npm install.
    const vault = path.join(a, 'vault');
    fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
    const install = spawnSync(
      process.execPath,
      [path.join(a, 'x', top, 'install.mjs'), vault, '--apply', '--language', 'fr'],
      { encoding: 'utf8' },
    );
    assert.equal(install.status, 0, install.stderr);
    assert.ok(fs.existsSync(path.join(vault, 'Colophon', 'lib.js')));
    assert.ok(fs.existsSync(path.join(vault, 'Books', 'Library.base')));
    assert.deepEqual(fs.readdirSync(path.join(vault, '.obsidian')), []);

    for (const name of ['import-goodreads.mjs', 'import-storygraph.mjs']) {
      const result = spawnSync(process.execPath, [path.join(a, 'x', top, name), '--help'], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
