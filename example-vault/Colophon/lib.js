// Colophon shared library.
//
// This file is a function body, not a module: the view scripts read it, wrap it in an
// AsyncFunction and call it as (dv, root). It returns the API object at the end of the file.
//   dv   the Dataview inline API of the calling view
//   root vault path of the folder that contains this file
const app = dv.app;

// The pure part (settings, kinds, labels) lives in model.js so that the Node tools run the same code.
const model = new Function(await app.vault.adapter.read(`${root}/model.js`))();
const { HISTORY_HEADING, normalizeTag, toUtcDate, readingDays, readingHistorySection } = model;

// The recommendation logic is only needed by the statistics page, so it is loaded on request.
const loadRecommend = async () =>
  new Function(await app.vault.adapter.read(`${root}/recommend.js`))();

const readCode = (file) => app.vault.adapter.read(`${root}/${file}`);
const loadStoryGraph = async () => new Function(await readCode('storygraph.js'))();

// The StoryGraph and Goodreads imports (shared with the command-line importers) are only needed here.
const loadImport = async () => {
  const core = await loadStoryGraph();
  const goodreads = new Function('core', await readCode('goodreads.js'))(core);
  return new Function(await readCode('import/engine.js'))().create({
    vault: app.vault,
    model,
    core,
    goodreads,
    root,
    registry: window.colophonState,
  });
};

const readJson = async (path) => JSON.parse(await app.vault.adapter.read(path));

// ---- Settings -----------------------------------------------------------------------------

// Reads config.json. A broken file or a wrong value never stops the page: the affected part falls
// back to its default and the problem is listed in config.problems (shown by showProblems).
const loadConfig = async () => {
  let user;
  const failures = [];
  try {
    user = await readJson(`${root}/config.json`);
  } catch (error) {
    const code = error instanceof SyntaxError ? 'invalidJson' : 'readFailed';
    failures.push({ code, path: 'config.json', value: error.message });
  }
  const config = model.resolve(user);
  if (failures.length) config.problems = failures;
  return config;
};

// ---- Language -----------------------------------------------------------------------------

// Obsidian keeps its interface language in localStorage ("language"; empty means English).
// moment follows the same setting and is the fallback.
const obsidianLanguage = () =>
  window.localStorage?.getItem('language') ||
  window.moment?.locale?.() ||
  window.navigator?.language ||
  'en';

const pickLocale = (requested, available) => {
  const wanted = normalizeTag(requested);
  const exact = available.find((code) => normalizeTag(code) === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0];
  return available.find((code) => normalizeTag(code).split('-')[0] === base) || 'en';
};

const listLocales = async () => {
  const listing = await app.vault.adapter.list(`${root}/locales`);
  return listing.files
    .map((path) => path.split('/').pop())
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
};

const config = await loadConfig();
const available = await listLocales();
const requested = config.language === 'auto' ? obsidianLanguage() : config.language;
const locale = pickLocale(requested, available);
const english = await readJson(`${root}/locales/en.json`);
const messages =
  locale === 'en' ? english : { ...english, ...(await readJson(`${root}/locales/${locale}.json`)) };

// ---- Formatting (everything goes through Intl) -------------------------------------------------

const pluralRules = new Intl.PluralRules(locale);
const numberFormat = new Intl.NumberFormat(locale);
const collator = new Intl.Collator(locale);
const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
const periodFormat = new Intl.DateTimeFormat(locale, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const listFormat = new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' });

const number = (value, options) =>
  options ? new Intl.NumberFormat(locale, options).format(value) : numberFormat.format(value);

const date = (value) => {
  const d = toUtcDate(value);
  return d ? dateFormat.format(d) : value ? String(value) : '';
};
const period = (year, month) => periodFormat.format(new Date(Date.UTC(year, month - 1, 1)));
const monthNames = (style) =>
  Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(
      new Date(Date.UTC(2021, i, 1)),
    ),
  );

const joinList = (items) => listFormat.format(items.map(String));
// Same list, split into elements and the separators between them.
const listParts = (items) => listFormat.formatToParts(items.map(String));

// ---- Translation ---------------------------------------------------------------------------

const warned = new Set();
// t(key, params): picks the plural form by params.count, then fills {name} placeholders.
// Numbers are formatted with Intl.NumberFormat; pass a string for custom formatting.
const t = (key, params = {}) => {
  let message = messages[key];
  if (message === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[Colophon] Missing translation key: ${key}`);
    }
    return key;
  }
  if (typeof message === 'object') {
    const count = Number(params.count);
    const form = Number.isFinite(count) ? pluralRules.select(count) : 'other';
    message = message[form] ?? message.other;
  }
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!(name in params)) return placeholder;
    const value = params[name];
    return typeof value === 'number' ? numberFormat.format(value) : String(value);
  });
};

// Statuses, formats and categories from config.json with their labels in the current language.
const catalog = model.catalog(config, locale, (key) => messages[key]);
// Label for a stable property value. Unknown values are shown as they are.
const label = catalog.label;

// Problems found in config.json, as a callout at the top of a page.
const showProblems = (container) => {
  if (!config.problems.length) return;
  const box = container.createDiv({ cls: 'callout', attr: { 'data-callout': 'warning' } });
  box
    .createDiv({ cls: 'callout-title' })
    .createDiv({ cls: 'callout-title-inner', text: t('config.errorTitle') });
  const items = box.createDiv({ cls: 'callout-content' }).createEl('ul');
  for (const problem of config.problems) {
    const { key, params } = model.problemMessage(problem);
    items.createEl('li', { text: t(key, params) });
  }
};

// ---- Vault helpers -------------------------------------------------------------------------

const list = (x) => (x == null ? [] : Array.isArray(x) ? x : x.array ? x.array() : [x]);

const stripLink = (raw) =>
  String(raw)
    .replace(/^!?\[\[|\]\]$/g, '')
    .split('|')[0];

const coverFile = (page) => {
  const c = page.cover;
  const path = c && c.path ? c.path : typeof c === 'string' ? stripLink(c) : null;
  return path ? app.metadataCache.getFirstLinkpathDest(path, page.file.path) : null;
};

const books = () => dv.pages().where((p) => p.type === 'book');

const readHistory = async (page) => {
  const count = page.reread_count;
  if (!((typeof count === 'number' || typeof count === 'string') && count > 0)) return [];
  const text = await dv.io.load(page.file.path);
  return text == null ? null : model.parseReadingHistory(text);
};

const linkToLibraryNote = (container, name, text) => {
  const path = [...config.paths.library.split('/').slice(0, -1), name].join('/');
  if (!app.vault.getAbstractFileByPath(path)) return;
  const link = container.createEl('a', { cls: 'internal-link', text, attr: { href: path } });
  link.addEventListener('mousedown', (event) => event.stopPropagation());
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    app.workspace.openLinkText(path, '', event.metaKey || event.ctrlKey ? 'tab' : false);
  });
};

// Styles go to document.head: a long note can be virtualised and the block leaves the DOM,
// while hiding the inline title and Properties must not flicker because of that.
const injectStyle = async (id, relativePath) => {
  const css = await app.vault.adapter.read(`${root}/${relativePath}`);
  let style = document.getElementById(id);
  if (!style) style = document.head.createEl('style', { attr: { id } });
  if (style.textContent !== css) style.textContent = css;
};

// State that has to survive Dataview re-rendering the block (open panel, form draft, ...).
const state = (window.colophonState ??= {});
const queueState = (state.readingQueue ??= { moving: false, views: new Map() });
const { queuePosition } = model;

const readOnly = Symbol();
const readQueuePosition = async (file) => {
  let position = null;
  try {
    await app.fileManager.processFrontMatter(file, (properties) => {
      position = queuePosition(properties);
      // The callback reads current Properties. Throw before Obsidian serializes or writes YAML.
      throw readOnly;
    });
  } catch (error) {
    if (error !== readOnly) throw error;
  }
  return position;
};

const snapshotQueue = async (before) => {
  const files = new Map();
  const entries = [];
  const queuedPaths = new Set(before?.entries.map((entry) => entry.path));
  for (const file of app.vault.getMarkdownFiles()) {
    const { path, stat } = file;
    if (app.metadataCache.isUserIgnored?.(path)) continue;
    const version = `${stat.mtime}:${stat.size}`;
    files.set(path, version);
    let queue = queuePosition(app.metadataCache.getFileCache(file)?.frontmatter);
    // The cache can lag. Check queued notes and any new or changed file that could enter the queue.
    if (before && (queue !== null || queuedPaths.has(path) || before.files.get(path) !== version)) {
      queue = await readQueuePosition(file);
    }
    if (queue !== null) entries.push({ path, file, queue, created: stat.ctime });
  }
  return { files, entries: entries.sort(model.compareQueue) };
};

// An append must read the tail after any move ahead of it has finished writing.
const writeQueue = (write) => {
  const pending = (queueState.pending ?? Promise.resolve()).then(write);
  queueState.pending = pending.catch(() => {});
  return pending;
};

const appendQueue = (file) =>
  writeQueue(async () => {
    const snapshot = await snapshotQueue(queueState.snapshot ?? (await snapshotQueue()));
    queueState.snapshot = snapshot;
    // The new entry may reach the metadata cache after the next operation starts.
    snapshot.files.delete(file.path);
    let place = (snapshot.entries.at(-1)?.queue ?? 0) + 1;
    try {
      await app.fileManager.processFrontMatter(file, (properties) => {
        const existing = queuePosition(properties);
        if (properties.type !== 'book' || catalog.kindOf(properties.status) !== 'planned') {
          place = null;
          throw readOnly;
        }
        if (existing !== null) {
          place = existing;
          throw readOnly;
        }
        properties.queue = place;
      });
    } catch (error) {
      if (error !== readOnly) throw error;
    }
    return place;
  });

return {
  app,
  config,
  paths: config.paths,
  locale,
  t,
  label,
  number,
  date,
  period,
  monthNames,
  joinList,
  listParts,
  collator,
  list,
  stripLink,
  coverFile,
  books,
  readHistory,
  readingHistorySection,
  linkToLibraryNote,
  injectStyle,
  state,
  catalog,
  statuses: catalog.statuses,
  formats: catalog.formats,
  categories: catalog.categories,
  kindOf: catalog.kindOf,
  keysOfKind: catalog.keysOfKind,
  isTopic: catalog.isTopic,
  showProblems,
  isPageNumber: model.isPageNumber,
  readingPageError: model.readingPageError,
  sameReading: model.sameReading,
  archiveReading: model.archiveReading,
  queuePosition,
  queueState,
  snapshotQueue,
  writeQueue,
  appendQueue,
  planQueueMove: model.planQueueMove,
  readingDays,
  loadRecommend,
  loadImport,
  loadStoryGraph,
  HISTORY_HEADING,
};
