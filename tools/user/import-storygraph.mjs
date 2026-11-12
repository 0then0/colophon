#!/usr/bin/env node
// Local StoryGraph CSV import. Node 20 or newer, no npm dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CsvError,
  core,
  fail,
  loadHeadings,
  loadImportSettings,
  outputFolder,
  parseCsv,
  renderNote,
  takenNames,
  walkMarkdown,
  withCsvMessages,
} from './import-library.mjs';

const USAGE = `Usage: node import-storygraph.mjs <export.csv> --out <folder> [options]

Shows the import plan without writing anything. Add --apply to create notes.
Use the Colophon library folder as --out. Existing notes are never overwritten.

Options:
  --out <folder>       Colophon library folder (required)
  --apply              create notes (default: report only)
  --config <file>      your vault's Colophon/config.json (default: bundled config)
  --language <code>    language of the note headings (default: config language, or en)
  --help               show this text`;

// The conversion, the identities and the plan are in Colophon/storygraph.js, shared with the import
// page in Obsidian. It reports problems as codes; this is their English text.
const quote = JSON.stringify;
const WARNINGS = {
  sessionStartOmitted: ({ session }) =>
    `Dates Read ${quote(session)}: start without an unambiguous day omitted`,
  sessionReversed: ({ session }) =>
    `Dates Read ${quote(session)}: interval ends before it starts and was omitted`,
  sessionOmitted: ({ session }) =>
    `Dates Read ${quote(session)}: session without an unambiguous finish day omitted`,
  lastDateOmitted: ({ value }) =>
    `Last Date Read ${quote(value)}: no unambiguous finish day, omitted`,
  abandonedUnconfirmed: () =>
    'Dates Read intervals without a corresponding confirmed completion were omitted for the abandoned book',
  lastDatePredates: ({ date }) =>
    `Last Date Read (${date}) predates a Dates Read finish and was omitted`,
  lastDateDisagrees: ({ date }) =>
    `Last Date Read (${date}) disagrees with Dates Read and was omitted`,
  readCountInvalid: ({ value }) => `Read Count ${quote(value)} is not a valid count`,
  readCountMore: ({ count, dated }) =>
    `Read Count is ${count}, but only ${dated} reading(s) have confirmed finish dates. Undated readings were omitted`,
  readCountFewer: ({ count, dated }) =>
    `Read Count is ${count}, but ${dated} dated readings were found. The dated readings were kept`,
  sameDayFinishes: () =>
    'Multiple readings ended on the same day. Colophon statistics count that day once',
  noConfirmedFinish: () => 'Read status has no confirmed finish date',
  noSingleStart: () =>
    'Dates Read does not identify a single current start after the last completed reading',
  pausedAsInProgress: () => 'Read Status paused imported as in progress',
  idUnrecognised: () => 'unrecognised ISBN/UID; repeat imports match the exact CSV row',
  idMissing: () => 'missing ISBN/UID; repeat imports match the exact CSV row',
  ratingOmitted: ({ value }) =>
    `Star Rating ${quote(value)} omitted; Colophon uses half-star steps`,
  formatOmitted: ({ value }) => `Format ${quote(value)} omitted; no matching Colophon format`,
  dateAddedOmitted: ({ value }) => `Date Added ${quote(value)} omitted; no exact date`,
};
const SKIPS = {
  fieldCount: ({ fields, expected }) => `has ${fields} fields, the header has ${expected}`,
  fieldTooLong: ({ limit }) => `has a field longer than ${limit} characters`,
  missingTitle: () => 'missing title',
  missingAuthors: () => 'missing authors',
  noStatus: ({ value }) => `no Colophon status for Read Status ${quote(value)}`,
  ambiguousRows: () => 'ambiguous identity; multiple CSV rows share it',
  ambiguousNotes: ({ count }) => `ambiguous identity; ${count} imported notes match`,
};
const label = ({ row, title }) =>
  title === undefined ? `row ${row}` : `row ${row} (${quote(title)})`;

const existingImports = (out) => {
  const found = new Map();
  for (const file of walkMarkdown(out)) {
    for (const id of core.noteIdentities(fs.readFileSync(file, 'utf8'))) {
      if (!found.has(id)) found.set(id, []);
      found.get(id).push(file);
    }
  }
  return found;
};

// Serialise apply runs to the same library before checking for existing imports and planning names.
const withImportLock = (out, run) => {
  fs.mkdirSync(out, { recursive: true });
  const lock = path.join(out, '.colophon-storygraph-import');
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`an import lock exists at ${lock}; remove it only if no import is running`, {
        cause: error,
      });
    throw error;
  }
  try {
    run(lock);
  } finally {
    fs.rmdirSync(lock);
  }
};

const runImport = (input, file, out, headings, lock) => {
  const apply = Boolean(lock);
  const { fresh, known, skipped, names } = core.plan(input, existingImports(out), takenNames(out));
  console.log(`StoryGraph import${apply ? '' : ' (dry run: nothing is written)'}`);
  console.log(`  file:   ${file} (${input.rows} rows)`);
  console.log(`  folder: ${out}`);
  console.log(`To create: ${fresh.length}`);
  for (const book of fresh) {
    const details = [
      book.status,
      book.started && `started ${book.started}`,
      book.finished && `finished ${book.finished}`,
      book.history.length > 0 && `${book.history.length} earlier read(s)`,
    ].filter(Boolean);
    console.log(`  ${names.get(book.id)} (${details.join(', ')})`);
    for (const warning of book.warnings)
      console.log(`warning: ${label(book)}: ${WARNINGS[warning.code](warning)}`);
  }
  console.log(`Skipped, already imported: ${known.length}`);
  for (const row of skipped) console.log(`Skipped: ${label(row)}: ${SKIPS[row.code](row)}`);
  if (!apply) {
    console.log(fresh.length ? 'Dry run. Add --apply to write the notes.' : 'Nothing to write.');
    return;
  }

  let written = 0;
  const staged = path.join(lock, 'note.tmp');
  for (const book of fresh) {
    const fileName = names.get(book.id);
    const target = path.join(out, fileName);
    try {
      const note = renderNote(book, headings, book.provenance);
      // Publish only the complete file. The hard link fails if the destination already exists.
      fs.writeFileSync(staged, note, { flag: 'wx' });
      fs.linkSync(staged, target);
      written++;
    } catch (error) {
      console.error(`error: ${fileName}: ${error.message}`);
      process.exitCode = 1;
    } finally {
      fs.rmSync(staged, { force: true });
    }
  }
  console.log(`Wrote ${written} note(s).`);
};

const main = () => {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        apply: { type: 'boolean' },
        config: { type: 'string' },
        help: { type: 'boolean' },
        language: { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (error) {
    return fail(`${error.message}\n\n${USAGE}`, 2);
  }
  const { positionals, values: options } = args;
  if (options.help) return console.log(USAGE);
  if (positionals.length !== 1 || !options.out)
    return fail(`give one StoryGraph export file and --out <folder>\n\n${USAGE}`, 2);

  const [file] = positionals;
  const context = loadImportSettings(options);
  const headings = loadHeadings(options, context);
  const out = outputFolder(options);
  try {
    // The limits are the ones of the import page (Colophon/storygraph.js).
    const { LIMITS } = core;
    if (fs.statSync(file).size > LIMITS.fileBytes)
      withCsvMessages(() => {
        throw new CsvError('tooLarge', { limit: LIMITS.fileBytes });
      });
    const records = parseCsv(fs.readFileSync(file, 'utf8'), { maxRecords: LIMITS.rows + 1 });
    const input = withCsvMessages(() => core.convert(records, context.catalog));
    const run = (lock) => runImport(input, file, out, headings, lock);
    if (options.apply) withImportLock(out, run);
    else run();
  } catch (error) {
    return fail(error instanceof CsvError ? `${file}: ${error.message}` : error.message);
  }
};

main();
