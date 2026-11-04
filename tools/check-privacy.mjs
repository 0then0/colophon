// Fails when a tracked-looking text file contains personal data of the kinds that must never be
// published: absolute home-folder paths, email addresses, and markers from private libraries.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, read, rel, report, walk } from './common.mjs';

const SKIP_DIRS = ['node_modules', '.git', '.venv', '.obsidian', '.ruff_cache', '__pycache__'];
const SKIP_FILES = new Set(['package-lock.json', 'check-privacy.mjs']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i;

const EMAIL_ALLOWED = /^(noreply@github\.com|[\w.+-]+@(users\.noreply\.github\.com|example\.(com|org|net)))$/i;
const rules = [
  { name: 'macOS home path', pattern: /\/Users\/(?!<|\.\.\.)[A-Za-z0-9._-]+/g },
  { name: 'Linux home path', pattern: /\/home\/(?!runner\b|<)[A-Za-z0-9._-]+/g },
  { name: 'Windows home path', pattern: /[A-Za-z]:\\Users\\[^\\\s]+/g },
  { name: 'openreads marker', pattern: /openreads/gi },
  { name: 'personal sync folder', pattern: /Sync\/Obsidian|~\/Desktop\//g },
];

const errors = [];
for (const file of walk(ROOT, SKIP_DIRS)) {
  if (BINARY.test(file) || SKIP_FILES.has(path.basename(file)) || fs.statSync(file).size > 2_000_000) continue;
  const text = read(file);
  for (const rule of rules) {
    for (const m of text.matchAll(rule.pattern)) errors.push(`${rel(file)}: ${rule.name}: ${m[0]}`);
  }
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    // "@scope/package" and similar are not addresses; require a plausible domain.
    if (!EMAIL_ALLOWED.test(m[0])) errors.push(`${rel(file)}: email address: ${m[0]}`);
  }
}
report('privacy scan', errors);
