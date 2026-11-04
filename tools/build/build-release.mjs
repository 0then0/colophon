// Builds the release archive: dist/colophon-<version>.zip (and a .sha256 file next to it).
//
//   node tools/build/build-release.mjs [--out <folder>]
//
// The archive holds the installer, the Goodreads importer, the documentation, the licence, the changelog and the Colophon
// folder, all under one top-level folder colophon-<version>/. It is reproducible: files are sorted,
// timestamps and permissions are fixed, nothing is compressed, so the same sources give the same
// bytes on any machine. No dependencies; the zip format is written by hand.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COLOPHON, ROOT, read } from '../lib/common.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(ROOT, 'dist'));

const version = JSON.parse(read(path.join(ROOT, 'package.json'))).version;
const top = `colophon-${version}`;

// ---- Files ------------------------------------------------------------------------------------

const files = []; // { name, data, mode }
const add = (name, data, mode = 0o644) => files.push({ name: `${top}/${name}`, data, mode });

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === '.DS_Store') return [];
    return entry.isDirectory() ? walk(full) : [full];
  });

add('install.mjs', fs.readFileSync(path.join(ROOT, 'tools', 'user', 'install.mjs')), 0o755);
add(
  'import-goodreads.mjs',
  fs.readFileSync(path.join(ROOT, 'tools', 'user', 'import-goodreads.mjs')),
  0o755,
);
add('INSTALL.md', fs.readFileSync(path.join(ROOT, 'docs', 'INSTALL.md')));
add('LICENSE', fs.readFileSync(path.join(ROOT, 'LICENSE')));
add('CHANGELOG.md', fs.readFileSync(path.join(ROOT, 'CHANGELOG.md')));
for (const file of walk(COLOPHON)) {
  add(`Colophon/${path.relative(COLOPHON, file).split(path.sep).join('/')}`, fs.readFileSync(file));
}
files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// ---- Zip (method 0, "stored") -----------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the earliest date a zip can hold
const UTF8_NAMES = 0x0800;

const chunks = [];
const central = [];
let offset = 0;
const push = (buffer) => {
  chunks.push(buffer);
  offset += buffer.length;
};
for (const file of files) {
  const name = Buffer.from(file.name, 'utf8');
  const crc = crc32(file.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(10, 4); // version needed
  local.writeUInt16LE(UTF8_NAMES, 6);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(file.data.length, 18);
  local.writeUInt32LE(file.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const start = offset;
  push(local);
  push(name);
  push(file.data);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, so the permissions below are honoured
  entry.writeUInt16LE(10, 6);
  entry.writeUInt16LE(UTF8_NAMES, 8);
  entry.writeUInt16LE(0, 10);
  entry.writeUInt16LE(DOS_TIME, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(file.data.length, 20);
  entry.writeUInt32LE(file.data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(((0o100000 | file.mode) << 16) >>> 0, 38); // external attributes
  entry.writeUInt32LE(start, 42);
  central.push(entry, name);
}
const centralStart = offset;
for (const part of central) push(part);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(offset - centralStart, 12);
end.writeUInt32LE(centralStart, 16);
push(end);

const zip = Buffer.concat(chunks);
const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
fs.mkdirSync(outDir, { recursive: true });
const archive = path.join(outDir, `${top}.zip`);
fs.writeFileSync(archive, zip);
fs.writeFileSync(`${archive}.sha256`, `${sha256}  ${top}.zip\n`);
console.log(
  `${path.relative(process.cwd(), archive) || archive}: ${files.length} files, ${zip.length} bytes`,
);
console.log(`sha256 ${sha256}`);
