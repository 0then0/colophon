// Shared parts of the local CSV importers. No npm dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The pure logic (CSV, file names, note text, the StoryGraph conversion) is Colophon/storygraph.js,
// the same file the import page runs inside Obsidian. It is a function body, like model.js.
const here = path.dirname(fileURLToPath(import.meta.url));
// The product folder next to the scripts (release archive), or in a clone of the repository.
export const productFolder = () =>
  [path.join(here, 'Colophon'), path.join(here, '..', '..', 'example-vault', 'Colophon')].find(
    (dir) =>
      fs.existsSync(path.join(dir, 'model.js')) && fs.existsSync(path.join(dir, 'storygraph.js')),
  );
const product = productFolder();
if (!product) {
  console.error('error: the Colophon folder was not found next to this script');
  process.exit(1);
}
export const core = new Function(fs.readFileSync(path.join(product, 'storygraph.js'), 'utf8'))();

export const { CsvError, cleanDate, cleanIsbn, neutralize, safeFileName, renderNote } = core;

// The core reports problems as codes; the command line prints English.
const CSV_ERRORS = {
  tooLarge: ({ limit }) => `the file is larger than ${limit / 1024 / 1024} MB`,
  tooManyRows: ({ limit }) => `the file has more than ${limit} rows`,
  unclosedQuote: () => 'the file ends inside a quoted field (a quote is not closed)',
  empty: () => 'the file is empty',
  duplicateColumns: () => 'duplicate column names',
  missingColumns: ({ columns }) =>
    `this does not look like a StoryGraph export: missing column(s) ${columns}`,
};
export const withCsvMessages = (run) => {
  try {
    return run();
  } catch (error) {
    if (error instanceof CsvError && CSV_ERRORS[error.code])
      error.message = CSV_ERRORS[error.code](error.details);
    throw error;
  }
};

// ---- CSV (RFC 4180) ---------------------------------------------------------------------------

// Returns an array of records (arrays of strings). Handles a BOM, CRLF, LF and CR line ends, quoted
// fields with "" escapes and line breaks inside quotes, and a missing final line break.
export const parseCsv = (input, options) => withCsvMessages(() => core.parseCsv(input, options));

// ---- File names -------------------------------------------------------------------------------

export const walkMarkdown = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walkMarkdown(full);
        return entry.name.toLowerCase().endsWith('.md') ? [full] : [];
      })
    : [];

// Plans a file name for every book: the title, then "Title (Author)", then "Title (id)". Names that
// exist in the folder, or that another new note takes, are never reused, with or without case.
export const planNames = (books, dir) => core.planNames(books, takenNames(dir));
export const takenNames = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.md'))
        .map((f) => f.slice(0, -3))
    : [];

export const fail = (message, code = 1) => {
  console.error(`error: ${message}`);
  process.exit(code);
};

export const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`${what} ${file} could not be read: ${error.message}`);
  }
};

export const loadImportSettings = (options) => {
  const model = new Function(fs.readFileSync(path.join(product, 'model.js'), 'utf8'))();
  const settings = model.resolve(
    readJson(options.config ?? path.join(product, 'config.json'), 'the config'),
  );
  const english = readJson(path.join(product, 'locales', 'en.json'), 'the locale');
  if (settings.problems.length) {
    for (const problem of settings.problems) {
      const { key, params } = model.problemMessage(problem);
      console.error(
        `error: config: ${english[key].replace(/\{(\w+)\}/g, (m, n) => params[n] ?? m)}`,
      );
    }
    process.exit(1);
  }
  const catalog = model.catalog(settings, 'en', (key) => english[key]);

  return { product, model, settings, catalog, english };
};

export const loadHeadings = (options, { product, model, settings, english }) => {
  const wanted = options.language ?? (settings.language === 'auto' ? 'en' : settings.language);
  const code = fs
    .readdirSync(path.join(product, 'locales'))
    .map((f) => f.slice(0, -5))
    .find((c) => model.normalizeTag(c) === model.normalizeTag(wanted));
  if (!code) fail(`language "${wanted}" is not available`, 2);
  const messages = {
    ...english,
    ...readJson(path.join(product, 'locales', `${code}.json`), 'the locale'),
  };
  const headings = { notes: messages['template.notes'], quotes: messages['template.quotes'] };

  return headings;
};

export const outputFolder = (options) => {
  const out = path.resolve(options.out);
  if (out.split(path.sep).includes('.obsidian')) fail('--out must not be inside .obsidian');
  if (fs.existsSync(out) && !fs.statSync(out).isDirectory()) fail(`${out} is not a folder`);

  return out;
};
