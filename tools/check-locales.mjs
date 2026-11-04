// Checks that every locale has the same keys as en.json, compatible plural forms and the same
// placeholders, and that the code and the README agree with the locale files.
import fs from 'node:fs';
import path from 'node:path';
import { COLOPHON, ROOT, loadLocales, placeholders, read, rel, report, variants, walk } from './common.mjs';

const errors = [];
const locales = loadLocales();
const en = locales.en;
if (!en) {
  console.error('error: example-vault/Colophon/locales/en.json is missing');
  process.exit(1);
}
const enKeys = Object.keys(en);

// Plural categories a language needs for whole numbers and for the decimals the UI can show.
const requiredForms = (code) => {
  const rules = new Intl.PluralRules(code);
  const forms = new Set();
  for (let n = 0; n <= 200; n++) forms.add(rules.select(n));
  for (const n of [0.5, 1.5, 12.5]) forms.add(rules.select(n));
  forms.add('other');
  return forms;
};

for (const [code, messages] of Object.entries(locales)) {
  try {
    new Intl.Locale(code);
  } catch {
    errors.push(`${code}: not a valid BCP 47 language tag`);
    continue;
  }
  const keys = Object.keys(messages);
  for (const key of enKeys) if (!(key in messages)) errors.push(`${code}: missing key "${key}"`);
  for (const key of keys) if (!(key in en)) errors.push(`${code}: unknown key "${key}"`);

  const allowedForms = new Set(new Intl.PluralRules(code).resolvedOptions().pluralCategories);
  const needed = requiredForms(code);

  for (const key of enKeys) {
    const message = messages[key];
    if (message === undefined) continue;
    const base = en[key];
    const where = `${code}: "${key}"`;
    if (typeof base !== typeof message) {
      errors.push(`${where}: must be ${typeof base === 'string' ? 'a string' : 'a plural object'} like in en`);
      continue;
    }
    if (typeof message === 'object') {
      for (const form of Object.keys(message)) {
        if (!allowedForms.has(form)) errors.push(`${where}: "${form}" is not a plural form of ${code}`);
      }
      for (const form of needed) {
        if (!(form in message)) errors.push(`${where}: missing plural form "${form}"`);
      }
    }
    for (const text of variants(message)) {
      if (typeof text !== 'string' || text.trim() === '') {
        errors.push(`${where}: empty or non-string value`);
        continue;
      }
      if (/[{}]/.test(text.replace(/\{\w+\}/g, ''))) errors.push(`${where}: stray brace in "${text}"`);
    }
    // Placeholders: every variant may use only placeholders of en, and together they use all of them.
    const expected = new Set(variants(base).flatMap((t) => [...placeholders(t)]));
    const used = new Set();
    for (const text of variants(message)) {
      for (const name of placeholders(text)) {
        used.add(name);
        if (!expected.has(name)) errors.push(`${where}: unknown placeholder {${name}}`);
      }
    }
    for (const name of expected) if (!used.has(name)) errors.push(`${where}: placeholder {${name}} is never used`);
    // Plural messages: {count} drives the form, so it must stay in at least one variant per form set.
    if (typeof message === 'object') {
      for (const [form, text] of Object.entries(message)) {
        if (expected.has('count') && !placeholders(text).has('count') && form !== 'one') {
          errors.push(`${where}: form "${form}" lacks {count}`);
        }
      }
    }
  }

  // The Bases generator puts these labels inside expressions in double quotes.
  for (const key of keys.filter((k) => /^(status|format|category)\./.test(k))) {
    if (/["\\]/.test(messages[key])) errors.push(`${code}: "${key}" must not contain quotes or backslashes`);
  }
}

// Code and locale files must agree: no unknown keys in code, no dead keys in en.json.
const files = walk(COLOPHON).filter((f) => f.endsWith('.js'));
const namespaces = new Set(enKeys.map((k) => k.split('.')[0]));
const literal = /'([a-z]+(?:\.[A-Za-z_-]+)+)'/g;
const referenced = new Set();
for (const file of files) {
  const source = read(file);
  for (const m of source.matchAll(literal)) {
    if (!namespaces.has(m[1].split('.')[0])) continue;
    referenced.add(m[1]);
    if (!(m[1] in en)) errors.push(`${rel(file)}: uses unknown key "${m[1]}"`);
  }
  // Interface text belongs in locale files: no non-ASCII letters in code outside comments.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const stray = code.match(/\p{L}/gu)?.filter((c) => c.charCodeAt(0) > 127);
  if (stray?.length) errors.push(`${rel(file)}: non-ASCII letters in code (${[...new Set(stray)].join('')})`);
}
// Keys built from a group and a stable value, or used by the generator, are not literal in code.
const dynamic = /^(status|format|category|base|template)\.|^language\.name$/;
for (const key of enKeys) {
  if (!referenced.has(key) && !dynamic.test(key)) errors.push(`en.json: key "${key}" is not used by any script`);
}

// README: the language badge must match the number of locale files.
const readme = path.join(ROOT, 'README.md');
if (fs.existsSync(readme)) {
  const count = Object.keys(locales).length;
  const badge = /img\.shields\.io\/badge\/languages-(\d+)-/.exec(read(readme));
  if (!badge) errors.push('README.md: languages badge not found');
  else if (Number(badge[1]) !== count) errors.push(`README.md: languages badge says ${badge[1]}, there are ${count} locales`);
  for (const [code, messages] of Object.entries(locales)) {
    if (!read(readme).includes(messages['language.name'])) {
      errors.push(`README.md: language list does not mention ${messages['language.name']} (${code})`);
    }
  }
}

report(`locales (${Object.keys(locales).join(', ')}; ${enKeys.length} keys)`, errors);
