// Colophon shared library.
//
// This file is a function body, not a module: the view scripts read it, wrap it in an
// AsyncFunction and call it as (dv, root). It returns the API object at the end of the file.
//   dv   the Dataview inline API of the calling view
//   root vault path of the folder that contains this file
const app = dv.app;

// The pure part (settings, kinds, labels) lives in model.js so that the Node tools run the same code.
const model = new Function(await app.vault.adapter.read(`${root}/model.js`))();
const { HISTORY_HEADING, normalizeTag, toUtcDate, readingDays } = model;

// The recommendation logic is only needed by the statistics page, so it is loaded on request.
const loadRecommend = async () =>
  new Function(await app.vault.adapter.read(`${root}/recommend.js`))();

// The StoryGraph import (shared with the command-line importer) is only needed by the import page.
const loadImport = async () => {
  const read = (file) => app.vault.adapter.read(`${root}/${file}`);
  const core = new Function(await read('storygraph.js'))();
  return new Function(await read('import/engine.js'))().create({
    vault: app.vault,
    model,
    core,
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

// Styles go to document.head: a long note can be virtualised and the block leaves the DOM,
// while hiding the inline title and Properties must not flicker because of that.
const injectStyle = async (id, relativePath) => {
  const css = await app.vault.adapter.read(`${root}/${relativePath}`);
  let style = document.getElementById(id);
  if (!style) style = document.head.createEl('style', { attr: { id } });
  if (style.textContent !== css) style.textContent = css;
};

// State that has to survive Dataview re-rendering the block (open panel, form draft, ...).
window.colophonState = window.colophonState || {};

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
  injectStyle,
  state: window.colophonState,
  catalog,
  statuses: catalog.statuses,
  formats: catalog.formats,
  categories: catalog.categories,
  kindOf: catalog.kindOf,
  keysOfKind: catalog.keysOfKind,
  isTopic: catalog.isTopic,
  showProblems,
  readingDays,
  loadRecommend,
  loadImport,
  HISTORY_HEADING,
};
