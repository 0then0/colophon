// Colophon model: pure logic shared by lib.js (inside Obsidian) and the Node tools.
//
// Like lib.js this file is a function body, not a module: it takes no arguments and returns the
// API object at the end. It must not touch Dataview, Obsidian or the DOM. lib.js evaluates it
// with `new Function(source)()`, and the repository tools and their tests do exactly the same,
// so there is one copy of this logic.

// Stable property values are stored in notes and never translated; only labels are.
// A status has a kind, and the kind (not the key) drives the behaviour: dates, queue,
// statistics, "Read again", Library views.
const KINDS = ['planned', 'in_progress', 'finished', 'abandoned'];
const HISTORY_HEADING = '## Reading history';

const DEFAULT_LANGUAGE = 'auto';
const DEFAULT_PATHS = { library: 'Books/Library', notes: 'Books/Notes', covers: 'Books/covers' };
const BUILTIN = {
  statuses: KINDS,
  formats: ['audiobook', 'ebook', 'hardcover', 'paperback'],
  categories: [
    'fiction',
    'non-fiction',
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
  ],
};
// Categories that describe a kind of book, not a subject; they are left out of topic statistics.
const NON_TOPICS = ['fiction', 'non-fiction'];
// List name in config.json -> group of the locale keys ("status.planned").
const GROUPS = { statuses: 'status', formats: 'format', categories: 'category' };
const ITEM_FIELDS = {
  statuses: ['key', 'labels', 'kind'],
  formats: ['key', 'labels'],
  categories: ['key', 'labels', 'topic'],
};
const TOP_LEVEL = ['language', 'paths', 'statuses', 'formats', 'categories'];
const KEY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const MAX_KEY_LENGTH = 64;

const trimSlashes = (s) => String(s).replace(/^\/+|\/+$/g, '');
const normalizeTag = (tag) => String(tag).replace(/_/g, '-').toLowerCase();
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- Settings ------------------------------------------------------------------------------

const defaultEntries = (list) =>
  BUILTIN[list].map((key) => ({
    key,
    labels: {},
    builtin: true,
    ...(list === 'statuses' ? { kind: key } : {}),
    ...(list === 'categories' ? { topic: !NON_TOPICS.includes(key) } : {}),
  }));

// Reads one list of config.json. Problems are pushed to `problems` as { code, path, value?, other? };
// the caller turns them into messages (locale keys "config.error.<code>"). A list with any problem
// is replaced by the default list as a whole, so behaviour never depends on a half-read list.
const parseList = (list, raw, problems) => {
  if (!Array.isArray(raw)) {
    problems.push({ code: 'notArray', path: list });
    return defaultEntries(list);
  }
  const before = problems.length;
  const defaults = new Set(BUILTIN[list]);
  const entries = [];
  const seen = new Map();
  raw.forEach((item, index) => {
    const path = `${list}[${index}]`;
    const object = typeof item === 'string' ? { key: item } : item;
    if (!isPlainObject(object)) {
      problems.push({ code: 'badItem', path });
      return;
    }
    for (const field of Object.keys(object)) {
      if (!ITEM_FIELDS[list].includes(field)) {
        problems.push({ code: 'unknownField', path: `${path}.${field}` });
      }
    }
    const keyPath = typeof item === 'string' ? path : `${path}.key`;
    const key = object.key;
    if (typeof key !== 'string') {
      problems.push({ code: key === undefined ? 'empty' : 'notString', path: keyPath });
      return;
    }
    if (key === '') {
      problems.push({ code: 'empty', path: keyPath });
      return;
    }
    if (
      key.length > MAX_KEY_LENGTH ||
      !KEY_PATTERN.test(key) ||
      key !== key.toLocaleLowerCase('en')
    ) {
      problems.push({ code: 'badKey', path: keyPath, value: key });
      return;
    }
    if (seen.has(key)) {
      problems.push({ code: 'duplicateKey', path: keyPath, value: key, other: seen.get(key) });
      return;
    }
    seen.set(key, keyPath);

    const entry = { key, labels: {}, builtin: defaults.has(key) };
    if (object.labels !== undefined) {
      if (!isPlainObject(object.labels)) {
        problems.push({ code: 'notObject', path: `${path}.labels` });
      } else {
        for (const [tag, text] of Object.entries(object.labels)) {
          const labelPath = `${path}.labels.${tag}`;
          try {
            Intl.getCanonicalLocales(tag);
          } catch {
            problems.push({ code: 'badLabelTag', path: labelPath, value: tag });
            continue;
          }
          if (typeof text !== 'string') problems.push({ code: 'notString', path: labelPath });
          else if (!text.trim()) problems.push({ code: 'empty', path: labelPath });
          // Library bases write labels inside double-quoted expressions.
          else if (/["\\]/.test(text)) problems.push({ code: 'labelChars', path: labelPath });
          else entry.labels[tag] = text.trim();
        }
      }
    }
    if (list === 'statuses') {
      const kindPath = `${path}.kind`;
      if (object.kind === undefined) {
        if (entry.builtin) entry.kind = key;
        else problems.push({ code: 'missingKind', path });
      } else if (typeof object.kind !== 'string' || !KINDS.includes(object.kind)) {
        problems.push({ code: 'badKind', path: kindPath, value: String(object.kind) });
      } else if (entry.builtin && object.kind !== key) {
        problems.push({ code: 'builtinKind', path: kindPath, value: key });
      } else {
        entry.kind = object.kind;
      }
    }
    if (list === 'categories') {
      if (object.topic === undefined) entry.topic = !NON_TOPICS.includes(key);
      else if (typeof object.topic !== 'boolean') {
        problems.push({ code: 'notBoolean', path: `${path}.topic` });
      } else entry.topic = object.topic;
    }
    entries.push(entry);
  });
  if (list === 'statuses') {
    for (const key of KINDS) {
      if (!seen.has(key)) problems.push({ code: 'missingBuiltin', path: list, value: key });
    }
  }
  return problems.length > before ? defaultEntries(list) : entries;
};

// Turns the parsed content of config.json into settings. Never throws: whatever is invalid is
// reported in `problems` and replaced by its default value, so a page can still be drawn.
const resolve = (raw) => {
  const problems = [];
  let user = raw;
  if (!isPlainObject(user)) {
    problems.push({ code: 'notObject', path: 'config.json' });
    user = {};
  }
  for (const name of Object.keys(user)) {
    // "$schema" and "_comment" style names are allowed for the user's own notes.
    if (!TOP_LEVEL.includes(name) && !/^[$_]/.test(name)) {
      problems.push({ code: 'unknownField', path: name });
    }
  }

  let language = DEFAULT_LANGUAGE;
  if (user.language !== undefined) {
    if (typeof user.language === 'string') language = user.language;
    else problems.push({ code: 'notString', path: 'language' });
  }

  const paths = { ...DEFAULT_PATHS };
  if (user.paths !== undefined) {
    if (!isPlainObject(user.paths)) {
      problems.push({ code: 'notObject', path: 'paths' });
    } else {
      for (const [name, value] of Object.entries(user.paths)) {
        const path = `paths.${name}`;
        if (!(name in DEFAULT_PATHS)) problems.push({ code: 'unknownField', path });
        else if (typeof value !== 'string') problems.push({ code: 'notString', path });
        else if (!trimSlashes(value)) problems.push({ code: 'empty', path });
        else paths[name] = trimSlashes(value);
      }
    }
  }

  const lists = {};
  for (const list of Object.keys(GROUPS)) {
    lists[list] =
      user[list] === undefined ? defaultEntries(list) : parseList(list, user[list], problems);
  }
  return { language, paths, ...lists, problems };
};

// Message key and parameters of a problem; the caller has the translation function.
const problemMessage = (problem) => ({
  key: `config.error.${problem.code}`,
  params: {
    path: problem.path,
    value: problem.value === undefined ? '' : problem.value,
    other: problem.other === undefined ? '' : problem.other,
  },
});

// ---- Labels --------------------------------------------------------------------------------

// Label of a value for a language. Order: the label the user wrote for that language (or its base
// language), the translation shipped with Colophon, the user's English label, the key itself.
// `lookup(messageKey)` returns a translation or undefined.
const labelOf = (entry, group, locale, lookup) => {
  const own = Object.entries(entry.labels).map(([tag, text]) => [normalizeTag(tag), text]);
  const pick = (tag) => own.find(([name]) => name === tag)?.[1];
  const wanted = normalizeTag(locale);
  return (
    pick(wanted) ??
    pick(wanted.split('-')[0]) ??
    lookup(`${group}.${entry.key}`) ??
    pick('en') ??
    entry.key
  );
};

// The lists of settings with labels for one language, plus lookups used by the views, the
// Library generator and the checks.
const catalog = (settings, locale, lookup) => {
  const build = (list) =>
    settings[list].map((entry) => ({
      ...entry,
      label: labelOf(entry, GROUPS[list], locale, lookup),
    }));
  const statuses = build('statuses');
  const formats = build('formats');
  const categories = build('categories');
  const maps = {
    status: new Map(statuses.map((e) => [e.key, e])),
    format: new Map(formats.map((e) => [e.key, e])),
    category: new Map(categories.map((e) => [e.key, e])),
  };
  return {
    statuses,
    formats,
    categories,
    kindOf: (status) => maps.status.get(status)?.kind ?? null,
    keysOfKind: (kind) => statuses.filter((e) => e.kind === kind).map((e) => e.key),
    isTopic: (category) => maps.category.get(category)?.topic === true,
    has: (group, value) => maps[group].has(value),
    // A value that is not in the settings keeps its shipped translation, or is shown as it is.
    label: (group, value) => {
      const entry = maps[group]?.get(value);
      if (entry) return entry.label;
      const message = lookup(`${group}.${value}`);
      return message ?? String(value ?? '');
    },
  };
};

// ---- Dates ---------------------------------------------------------------------------------

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

// Whole days from `started` to `finished` (any form toUtcDate accepts), or null when either date is
// missing or not a date. The result is signed: 0 is a read that began and ended on the same day,
// a negative number means the dates are the wrong way round. Callers decide what to show; the
// book header and the statistics both use this one function.
const readingDays = (started, finished) => {
  const from = toUtcDate(started);
  const to = toUtcDate(finished);
  return from && to ? Math.round((to - from) / 864e5) : null;
};

return {
  KINDS,
  HISTORY_HEADING,
  BUILTIN,
  DEFAULT_PATHS,
  normalizeTag,
  trimSlashes,
  resolve,
  problemMessage,
  labelOf,
  catalog,
  toUtcDate,
  readingDays,
};
