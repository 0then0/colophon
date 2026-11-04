// Colophon shared library.
//
// This file is a function body, not a module: the view scripts read it, wrap it in an
// AsyncFunction and call it as (dv, root). It returns the API object at the end of the file.
//   dv   the Dataview inline API of the calling view
//   root vault path of the folder that contains this file
const app = dv.app;

const DEFAULT_CONFIG = {
  language: 'auto',
  paths: { library: 'Books/Library', notes: 'Books/Notes', covers: 'Books/covers' },
};

// Stable property values. They are stored in notes and never translated; only labels are.
const STATUSES = ['planned', 'in_progress', 'finished', 'abandoned'];
const FORMATS = ['audiobook', 'ebook', 'hardcover', 'paperback'];
const TOPICS = [
  'fantasy',
  'science-fiction',
  'classics',
  'detective',
  'philosophy',
  'it',
  'psychology',
  'productivity',
  'business',
  'science',
  'health',
  'history',
  'biography',
];
const CATEGORIES = ['fiction', 'non-fiction', ...TOPICS];
const HISTORY_HEADING = '## Reading history';

const trimSlashes = (s) => String(s).replace(/^\/+|\/+$/g, '');

const readJson = async (path) => JSON.parse(await app.vault.adapter.read(path));

// ---- Settings -----------------------------------------------------------------------------

const loadConfig = async () => {
  const user = await readJson(`${root}/config.json`);
  const config = {
    language: typeof user.language === 'string' ? user.language : DEFAULT_CONFIG.language,
    paths: { ...DEFAULT_CONFIG.paths, ...(user.paths || {}) },
  };
  for (const key of Object.keys(config.paths)) config.paths[key] = trimSlashes(config.paths[key]);
  return config;
};

// ---- Language -----------------------------------------------------------------------------

const normalizeTag = (tag) => String(tag).replace(/_/g, '-').toLowerCase();

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
const messages = locale === 'en' ? english : { ...english, ...(await readJson(`${root}/locales/${locale}.json`)) };

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

// Accepts a Luxon DateTime (Dataview), a Date, or a "YYYY-MM-DD" string.
const toUtcDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.year === 'number' && typeof value.month === 'number') {
    return new Date(Date.UTC(value.year, value.month - 1, value.day));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : null;
};
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

// Label for a stable property value. Unknown values are shown as they are.
const label = (group, value) => (messages[`${group}.${value}`] ? t(`${group}.${value}`) : String(value ?? ''));

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
  STATUSES,
  FORMATS,
  TOPICS,
  CATEGORIES,
  HISTORY_HEADING,
};
