// Colophon statistics page. Use it in a note:  await dv.view("Colophon/statistics")
//
// Bootstrap: see Colophon/book/view.js. Errors here are the only English text outside the locale files.
const COLOPHON = 'Colophon';
const libFile = dv.app.metadataCache.getFirstLinkpathDest(`${COLOPHON}/lib.js`, dv.currentFilePath);
if (!libFile) {
  dv.paragraph(`Colophon: ${COLOPHON}/lib.js was not found in the vault.`);
  return;
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const colophon = await new AsyncFunction('dv', 'root', await dv.app.vault.read(libFile))(
  dv,
  libFile.parent.path,
);
const { app, t, label, number, date, period, state, paths, list, collator } = colophon;
const { coverFile, joinList, monthNames, kindOf, isTopic } = colophon;
// The behaviour of a status comes from its kind, so custom statuses count like the built-in ones.
const is = (p, kind) => kindOf(p.status) === kind;

await colophon.injectStyle('colophon-statistics-style', 'statistics/view.css');
colophon.showProblems(dv.container);

const dt = (v) => (v && v.year ? v : null);
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const NONE = '–';
const fmt = (x, digits = 1) => (x == null ? NONE : number(x, { maximumFractionDigits: digits }));
const nameOf = (p) => String(p.title || p.file.name);
const authorsOf = (p) => list(p.author).map(String);
const ratingOf = (p) => (typeof p.rating === 'number' && p.rating > 0 ? p.rating : null);
const coverSrc = (p) => {
  const file = coverFile(p);
  return file ? app.vault.getResourcePath(file) : null;
};
// A click opens the book; mousedown must not expand the code block in Live Preview.
const bookButton = (parent, cls, p, title) => {
  const el = parent.createEl('button', {
    cls,
    attr: { type: 'button', title: title || nameOf(p) },
  });
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    app.workspace.openLinkText(p.file.path, '', e.metaKey || e.ctrlKey ? 'tab' : false);
  });
  return el;
};

// ---- Clickable numbers -------------------------------------------------------------------------
// A click on a number opens the list of its books under it; one list is open at a time. After
// Dataview redraws the block, the list that was open is opened again (state.drill).
const drills = {};
let drillOpen = null;
const closeDrill = (forget = true) => {
  if (!drillOpen) return;
  drillOpen.panel.remove();
  drillOpen.els.forEach((el) => el.removeClass('is-active'));
  drillOpen = null;
  if (forget) state.drill = null;
};
const isoOfDate = (v) => (dt(v) ? v.toFormat('yyyy-MM-dd') : '');
const openDrill = (id) => {
  const d = drills[id];
  if (!d) return;
  closeDrill(false);
  const items = (typeof d.items === 'function' ? d.items() : d.items).map((x) =>
    x.p ? x : { p: x },
  );
  const when = (x) => x.date || isoOfDate(x.p.finished);
  const sorted = d.sorted
    ? items
    : [...items].sort(
        (a, b) => when(b).localeCompare(when(a)) || collator.compare(nameOf(a.p), nameOf(b.p)),
      );
  // The panel is not in the document yet; Obsidian adds createDiv and friends to every element.
  const panel = document.createElement('div');
  panel.addClass('rb-drill');
  const head = panel.createDiv({ cls: 'rb-drill-head' });
  head.createSpan({ text: t('drill.head', { title: d.title, count: sorted.length }) });
  const close = head.createEl('button', { text: t('drill.collapse'), attr: { type: 'button' } });
  close.addEventListener('mousedown', (e) => e.stopPropagation());
  close.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDrill();
  });
  const body = panel.createDiv({ cls: 'rb-drill-items' });
  for (const x of sorted) {
    const b = bookButton(body, 'rb-drill-item', x.p);
    const src = coverSrc(x.p);
    if (src) b.createEl('img', { attr: { src, alt: '', loading: 'lazy' } });
    else b.createDiv({ cls: 'rb-nocover' });
    const text = b.createDiv();
    const authors = authorsOf(x.p);
    text.createSpan({
      cls: 'rb-name',
      text: authors.length
        ? t('stats.titleByAuthors', { title: nameOf(x.p), authors: joinList(authors) })
        : nameOf(x.p),
    });
    const status = label('status', x.p.status);
    const bits = [
      ratingOf(x.p) ? t('panel.metaRated', { status, rating: ratingOf(x.p) }) : status,
      when(x) ? date(when(x)) : null,
    ].filter(Boolean);
    text.createSpan({ cls: 'rb-sub', text: bits.join(' · ') });
  }
  d.anchor.after(panel);
  d.els.forEach((el) => el.addClass('is-active'));
  drillOpen = { id, panel, els: d.els };
  state.drill = id;
};
const toggleDrill = (id) => (drillOpen && drillOpen.id === id ? closeDrill() : openDrill(id));
// els: the elements that open the list (the first one is reachable with the keyboard).
// options: { id, title, items, anchor, sorted }
const drill = (els, options) => {
  const all = Array.isArray(els) ? els : [els];
  drills[options.id] = { ...options, els: all };
  for (const el of all) {
    el.setAttr('data-drill', options.id);
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (String(window.getSelection())) return; // a text selection is not a click
      toggleDrill(options.id);
    });
  }
  all[0].setAttr('role', 'button');
  all[0].setAttr('tabindex', '0');
  all[0].addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    toggleDrill(options.id);
  });
};
const capitalize = (text) => text.charAt(0).toLocaleUpperCase(colophon.locale) + text.slice(1);

const books = colophon.books().array();

// Rereads: the dates of earlier reads are listed in the Reading history section of the note.
const HISTORY_LINE = /^- \S+\s*(?:→|->|—|–|-)\s*(\d{4}-\d{2}-\d{2})\s*$/gm;
const readDates = async (p) => {
  const dates = new Set();
  const main = is(p, 'finished') ? dt(p.finished) : null;
  const last = main ? main.toFormat('yyyy-MM-dd') : null;
  if (last) dates.add(last);
  if (p.reread_count > 0) {
    const text = await dv.io.load(p.file.path);
    for (const m of (text || '').matchAll(HISTORY_LINE)) dates.add(m[1]);
  }
  return { dates, last };
};
const events = [];
for (const p of books) {
  const { dates, last } = await readDates(p);
  // The pages property describes the latest read, so pages are counted for that read only.
  for (const s of dates) {
    events.push({ p, date: s, year: +s.slice(0, 4), month: +s.slice(5, 7), last: s === last });
  }
}

const count = (kind) => books.filter((p) => is(p, kind)).length;
const rated = books.filter((p) => ratingOf(p));
const paged = books.filter((p) => is(p, 'finished') && typeof p.pages === 'number');
const now = dv.date('today').year;

// ---- Overview ----------------------------------------------------------------------------

const root = dv.container.createDiv({ cls: 'rb' });
const top = root.createDiv({ cls: 'rb-top' });

const nowBox = top.createDiv({ cls: 'rb-section' });
nowBox.createDiv({ cls: 'rb-title', text: t('stats.readingNow') });
const reading = books
  .filter((p) => is(p, 'in_progress'))
  .sort((a, b) => (dt(b.started)?.toMillis() || 0) - (dt(a.started)?.toMillis() || 0));
const nowList = nowBox.createDiv({ cls: 'rb-now' });
if (!reading.length) nowList.createDiv({ cls: 'rb-empty', text: t('stats.nothingReading') });
for (const p of reading) {
  const card = bookButton(nowList, 'rb-card', p);
  const src = coverSrc(p);
  if (src) card.createEl('img', { attr: { src, alt: '' } });
  else card.createDiv({ cls: 'rb-nocover' });
  const text = card.createDiv();
  text.createSpan({ cls: 'rb-name', text: nameOf(p) });
  text.createSpan({ cls: 'rb-sub', text: joinList(authorsOf(p)) });
}

const QUEUE_SHOWN = 7;
const queueBox = top.createDiv({ cls: 'rb-section' });
queueBox.createDiv({ cls: 'rb-title', text: t('stats.queue') });
const queued = books.filter((p) => typeof p.queue === 'number').sort((a, b) => a.queue - b.queue);
if (!queued.length) queueBox.createDiv({ cls: 'rb-empty', text: t('stats.queueEmpty') });
const queueList = queueBox.createEl('ol', { cls: 'rb-list' });
queued.slice(0, QUEUE_SHOWN).forEach((p, i) => {
  const li = queueList.createEl('li');
  li.createEl('b', { text: number(i + 1) });
  const b = bookButton(li, 'rb-link', p);
  b.createSpan({ cls: 'rb-name', text: nameOf(p) });
  b.createSpan({ cls: 'rb-sub', text: joinList(authorsOf(p)) });
});
if (queued.length > QUEUE_SHOWN) {
  queueBox.createDiv({
    cls: 'rb-empty',
    text: t('stats.queueMore', {
      count: queued.length - QUEUE_SHOWN,
      view: t('base.view.queue'),
    }),
  });
}

// Quote of the day, taken from your own notes. The Obsidian cache is walked; only the chosen file is read.
const quoteFiles = app.vault
  .getMarkdownFiles()
  .filter((f) => f.path.startsWith(paths.library + '/'))
  // Only book notes: summaries and other notes kept in the library folder are not quoted.
  .filter((f) => app.metadataCache.getFileCache(f)?.frontmatter?.type === 'book')
  .filter((f) =>
    (app.metadataCache.getFileCache(f)?.sections || []).some((s) => s.type === 'blockquote'),
  )
  .sort((a, b) => a.path.localeCompare(b.path));
const day = Math.floor(dv.date('today').toMillis() / 864e5);
for (let i = 0; i < 12 && quoteFiles.length; i++) {
  const file = quoteFiles[(day + i * 37) % quoteFiles.length];
  const cache = app.metadataCache.getFileCache(file);
  const blocks = cache.sections.filter((s) => s.type === 'blockquote');
  const block = blocks[day % blocks.length];
  const text = (await app.vault.cachedRead(file))
    .slice(block.position.start.offset, block.position.end.offset)
    .replace(/^>\s?/gm, '')
    .trim();
  if (text.length < 30 || text.length > 420 || text.startsWith('[!')) continue;
  const quote = root.createDiv({ cls: 'rb-quote' });
  quote.createEl('p', { text });
  const source = dv.page(file.path);
  if (source) {
    const authors = authorsOf(source);
    bookButton(quote, 'rb-link', source).createSpan({
      cls: 'rb-sub',
      text: authors.length
        ? t('stats.quoteSource', { title: nameOf(source), authors: joinList(authors) })
        : nameOf(source),
    });
  }
  break;
}

const kpis = root.createDiv({ cls: 'rb-kpis' });
const kpi = (value, caption, hint, items) => {
  const el = kpis.createDiv({ cls: 'rb-kpi' });
  if (items) drill(el, { id: 'kpi:' + caption, title: capitalize(caption), items, anchor: kpis });
  el.createEl('b', { text: value });
  el.createEl('span', { text: caption });
  if (hint) el.createEl('i', { text: hint });
};
const finishedCount = count('finished');
kpi(
  fmt(finishedCount, 0),
  t('stats.kpi.finished'),
  t('stats.kpi.ofBooks', { count: books.length }),
  books.filter((p) => is(p, 'finished')),
);
kpi(
  fmt(count('in_progress'), 0),
  t('stats.kpi.reading'),
  null,
  books.filter((p) => is(p, 'in_progress')),
);
kpi(
  fmt(count('planned'), 0),
  t('stats.kpi.planned'),
  null,
  books.filter((p) => is(p, 'planned')),
);
kpi(
  fmt(count('abandoned'), 0),
  t('stats.kpi.abandoned'),
  null,
  books.filter((p) => is(p, 'abandoned')),
);
kpi(
  fmt(avg(rated.map((p) => p.rating)), 2),
  t('stats.kpi.avgRating'),
  t('stats.kpi.rated', { count: rated.length }),
  rated,
);
kpi(
  fmt(
    paged.reduce((s, p) => s + p.pages, 0),
    0,
  ),
  t('stats.kpi.pagesRead'),
  t('stats.kpi.pagesKnown', { count: finishedCount, known: paged.length }),
  paged,
);

// ---- Year ----------------------------------------------------------------------------------

const box = root.createDiv({ cls: 'rb-year' });
const head = box.createDiv({ cls: 'rb-head' });
const select = head.createEl('select');
const years = [...new Set([now, ...events.map((e) => e.year)])].sort((a, b) => b - a);
for (const y of years) select.createEl('option', { text: String(y), value: String(y) });
const summary = head.createDiv({ cls: 'rb-summary' });
const chart = box.createDiv({ cls: 'rb-months' });
const yearCats = box.createDiv({ cls: 'rb-cats' });
const wall = box.createDiv({ cls: 'rb-wall' });
const MONTHS_SHORT = monthNames('short');
// The narrow month name is one character in most languages. Where the language has no such name
// (Japanese gives "12月"), the month number is shown so that twelve labels fit a narrow column.
const MONTHS_NARROW = monthNames('narrow').map((n, i) =>
  Array.from(n).length > 1 ? number(i + 1) : n,
);

function drawYear(y) {
  if (drillOpen && drillOpen.id.startsWith('year:')) closeDrill();
  for (const id of Object.keys(drills)) if (id.startsWith('year:')) delete drills[id];
  const ev = events.filter((e) => e.year === y);
  const uniq = [...new Set(ev.map((e) => e.p))];
  const r = uniq.map(ratingOf).filter((x) => x !== null);
  const pg = ev
    .filter((e) => e.last)
    .map((e) => e.p.pages)
    .filter((x) => typeof x === 'number');
  summary.empty();
  const stat = (caption, value) => {
    const s = summary.createEl('span');
    s.appendText(caption + ' ');
    s.createEl('strong', { text: value });
  };
  stat(t('stats.year.books'), number(ev.length));
  stat(
    t('stats.year.pages'),
    pg.length
      ? t('stats.year.pagesValue', {
          pages: pg.reduce((s, x) => s + x, 0),
          known: pg.length,
          total: ev.length,
        })
      : NONE,
  );
  stat(t('stats.year.avgRating'), fmt(avg(r), 2));
  chart.empty();
  const perMonth = MONTHS_SHORT.map((_, i) => ev.filter((e) => e.month === i + 1));
  const max = Math.max(1, ...perMonth.map((c) => c.length));
  perMonth.forEach((c, i) => {
    const titles = c.map((e) => nameOf(e.p)).join('\n');
    const tip = t('stats.year.monthTitle', { period: period(y, i + 1), count: c.length });
    const m = chart.createDiv({
      cls: 'rb-m',
      attr: { title: tip + (titles ? '\n' + titles : '') },
    });
    m.createEl('em', { text: c.length ? number(c.length) : '' });
    m.createDiv({
      attr: { style: `height:${c.length ? Math.max(4, (c.length / max) * 84) : 0}px` },
    });
    const name = m.createEl('span');
    name.createSpan({ cls: 'rb-mn-short', text: MONTHS_SHORT[i] });
    name.createSpan({ cls: 'rb-mn-narrow', text: MONTHS_NARROW[i] });
    if (c.length) {
      drill(m, {
        id: `year:${y}:month:${i}`,
        title: period(y, i + 1),
        items: c.map((e) => ({ p: e.p, date: e.date })),
        anchor: chart,
      });
    }
  });
  const cats = {};
  for (const p of uniq)
    for (const c of list(p.category)) if (isTopic(c)) cats[c] = (cats[c] || 0) + 1;
  const topCats = Object.entries(cats)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  // The line is built from the list parts, so that each category can be clicked.
  yearCats.empty();
  if (topCats.length) {
    const names = topCats.map(([c, n]) =>
      t('stats.year.categoryCount', { category: label('category', c), count: n }),
    );
    const template = t('stats.year.topCategories', { list: '\u0000' });
    const [before, after] = template.split('\u0000');
    yearCats.appendText(before);
    let index = 0;
    for (const part of colophon.listParts(names)) {
      if (part.type === 'literal') {
        yearCats.appendText(part.value);
        continue;
      }
      const [c] = topCats[index++];
      const el = yearCats.createSpan({ cls: 'rb-cat', text: part.value });
      drill(el, {
        id: `year:${y}:cat:${c}`,
        title: t('drill.categoryYear', { category: label('category', c), year: String(y) }),
        items: ev
          .filter((e) => list(e.p.category).map(String).includes(c))
          .map((e) => ({ p: e.p, date: e.date })),
        anchor: yearCats,
      });
    }
    yearCats.appendText(after);
  }
  // Covers of the year, newest first. A reread book shows up in every year it was read.
  wall.empty();
  const sorted = [...ev].sort(
    (a, b) => b.date.localeCompare(a.date) || collator.compare(nameOf(a.p), nameOf(b.p)),
  );
  for (const e of sorted) {
    const rate = ratingOf(e.p);
    const tip = rate
      ? t('stats.year.wallTitleRated', { title: nameOf(e.p), rating: rate })
      : nameOf(e.p);
    const item = bookButton(wall, 'rb-w', e.p, tip);
    const src = coverSrc(e.p);
    if (src) item.createEl('img', { attr: { src, alt: '', loading: 'lazy' } });
    else item.createSpan({ text: nameOf(e.p) });
  }
}
// The block is redrawn when the vault changes; the chosen year must not reset.
select.value = String(years.includes(state.statsYear) ? state.statsYear : now);
select.addEventListener('change', () => {
  state.statsYear = +select.value;
  drawYear(+select.value);
});
drawYear(+select.value);

// ---- What to read next ----------------------------------------------------------------------
// Only your own plans are suggested, scored by your own ratings; the reason is shown next to the book.
// The scoring is in recommend.js (plain data in, plain data out). Recomputed at every opening.

const recommend = await colophon.loadRecommend();
const SNOOZE_MONTHS = 3;
const todayIso = dv.date('today').toFormat('yyyy-MM-dd');
const monthKey = todayIso.slice(0, 7);
const isoOf = (v) => (v == null ? '' : String(v).slice(0, 10));
const records = books.map((p) => ({
  id: p.file.path,
  title: nameOf(p),
  authors: authorsOf(p),
  categories: list(p.category).map(String),
  kind: kindOf(p.status),
  rating: ratingOf(p),
  series: p.series ? String(p.series) : null,
  seriesIndex: typeof p.series_index === 'number' ? p.series_index : null,
  queue: typeof p.queue === 'number' ? p.queue : null,
  pages: typeof p.pages === 'number' ? p.pages : null,
  formats: list(p.format).map(String),
  dateAdded: isoOf(p.date_added) || null,
  snoozedUntil: isoOf(p.snoozed_until) || null,
  links: list(p.file.outlinks).map((l) => l.path),
}));
const pageById = new Map(books.map((p) => [p.file.path, p]));
const analysis = recommend.analyze(records, todayIso, isTopic);
let { seriesPicks, candidates } = analysis;
let queueEnd = Math.max(0, ...queued.map((p) => p.queue));

const FILTER_LABELS = {
  all: t('rec.filter.all'),
  fiction: t('rec.filter.fiction'),
  nonfiction: t('rec.filter.nonfiction'),
  short: t('rec.filter.short'),
  audio: t('rec.filter.audio'),
};
const reasonText = (r) => {
  if (r.code === 'link') {
    const params = { title: r.title, rating: r.rating, count: r.more };
    return r.more > 0 ? t('rec.reason.linkMore', params) : t('rec.reason.link', params);
  }
  if (r.code === 'author') {
    return t('stats.reason.author', { author: r.author, avg: fmt(r.avg, 1), count: r.count });
  }
  if (r.code === 'category') {
    return t('stats.reason.category', {
      category: label('category', r.category),
      avg: fmt(r.avg, 1),
    });
  }
  return t('rec.reason.waited', { count: r.years });
};

const recBox = root.createDiv({ cls: 'rb-section rb-next rb-rec' });
const seriesBox = recBox.createDiv({ cls: 'rb-section' });
const pickBox = recBox.createDiv();

// Writes a property; the card disappears at once, without waiting for Dataview to refresh.
const setProps = async (book, change, done, errorBox) => {
  const file = app.vault.getAbstractFileByPath(book.id);
  try {
    await app.fileManager.processFrontMatter(file, change);
    done();
  } catch (error) {
    errorBox.setText(t('error.saveFailed', { message: error.message }));
  }
};
const hide = (book) => {
  candidates = candidates.filter((x) => x.book !== book);
  seriesPicks = seriesPicks.filter((x) => x.book !== book);
  renderRec();
};
const addActions = (li, book) => {
  const box = li.createDiv({ cls: 'rb-rec-actions' });
  const message = li.createDiv({ cls: 'rb-sub rb-rec-error' });
  const action = (text, title, run) => {
    const b = box.createEl('button', { text, attr: { type: 'button', title } });
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
    });
  };
  action(t('queue.add'), t('rec.queueTitle'), () => {
    const place = queueEnd + 1;
    setProps(
      book,
      (fm) => {
        fm.queue = place;
      },
      () => {
        queueEnd = place;
        hide(book);
      },
      message,
    );
  });
  action(t('rec.snooze'), t('rec.snoozeTitle', { count: SNOOZE_MONTHS }), () => {
    const until = dv.date('today').plus({ months: SNOOZE_MONTHS }).toFormat('yyyy-MM-dd');
    setProps(
      book,
      (fm) => {
        fm.snoozed_until = until;
      },
      () => hide(book),
      message,
    );
  });
};
const addRow = (parent, book, sub) => {
  const page = pageById.get(book.id);
  const li = parent.createEl('li');
  const b = bookButton(li, 'rb-link', page);
  const authors = authorsOf(page);
  b.createSpan({
    cls: 'rb-name',
    text: authors.length
      ? t('stats.titleByAuthors', { title: nameOf(page), authors: joinList(authors) })
      : nameOf(page),
  });
  b.createSpan({ cls: 'rb-sub', text: sub });
  addActions(li, book);
};

function renderRec() {
  seriesBox.empty();
  const series = seriesPicks.slice(0, 4);
  seriesBox.toggle(series.length > 0);
  if (series.length) {
    seriesBox.createDiv({ cls: 'rb-title', text: t('stats.continueSeries') });
    const ul = seriesBox.createEl('ul', { cls: 'rb-list' });
    for (const { book, rating } of series) {
      addRow(
        ul,
        book,
        t('rec.reason.series', {
          series: book.series,
          avg: fmt(rating.avg, 1),
          count: rating.count,
        }),
      );
    }
  }
  pickBox.empty();
  // With no candidates there is nothing to filter: only the series block (if any) is shown.
  recBox.toggle(candidates.length > 0 || series.length > 0);
  if (!candidates.length) return;
  pickBox.createDiv({ cls: 'rb-title', text: t('stats.next') });
  // The fiction filters rest on the category key "fiction"; without it "non-fiction" would be "all".
  const fictionFilters = colophon.catalog.has('category', 'fiction');
  const offered = (key) => fictionFilters || (key !== 'fiction' && key !== 'nonfiction');
  const active =
    recommend.FILTERS[state.recFilter] && offered(state.recFilter) ? state.recFilter : 'all';
  const chips = pickBox.createDiv({ cls: 'rb-chips' });
  for (const [key, test] of Object.entries(recommend.FILTERS)) {
    // A filter is shown only when some book matches it.
    if (!offered(key)) continue;
    if (key !== 'all' && key !== active && !candidates.some((x) => test(x.book))) continue;
    const b = chips.createEl('button', {
      cls: 'rb-chip' + (key === active ? ' is-active' : ''),
      text: FILTER_LABELS[key],
      attr: { type: 'button' },
    });
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.recFilter = key;
      renderRec();
    });
  }
  const picks = recommend.choose(candidates, active, monthKey, isTopic);
  if (!picks.length) {
    pickBox.createDiv({ cls: 'rb-empty', text: t('rec.noMatches') });
    return;
  }
  const ul = pickBox.createEl('ul', { cls: 'rb-list' });
  for (const x of picks) {
    const bits = [x.monthly ? t('rec.monthly') : null, ...x.reasons.map(reasonText)];
    addRow(ul, x.book, bits.filter(Boolean).join(' · '));
  }
}
renderRec();

// ---- In detail -----------------------------------------------------------------------------

const link = (p) => dv.fileLink(p.file.path, false, nameOf(p));
const finished = books.filter((p) => is(p, 'finished'));
const detail = dv.container;

// Horizontal bars: one scale per block, the value is written at the right.
function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const wrap = detail.createDiv({ cls: 'rb-bars' });
  for (const r of rows) {
    const name = wrap.createDiv({ cls: 'rb-bar-label', text: r.label, attr: { title: r.label } });
    const track = wrap.createDiv({ cls: 'rb-bar-track' });
    track.createDiv({
      attr: {
        style: `width:${Math.max(r.value ? 1 : 0, (r.value / max) * 100)}%`,
        title: `${r.label}: ${r.note || number(r.value)}`,
      },
    });
    const note = wrap.createDiv({ cls: 'rb-bar-note', text: r.note || number(r.value) });
    if (r.items) {
      drill([name, track, note], {
        id: `${r.group}:${r.label}`,
        title: r.title || r.label,
        items: r.items,
        sorted: r.sorted,
        anchor: note,
      });
    }
  }
}
const heading = (level, key) => detail.createEl(`h${level}`, { text: t(key) });
const paragraph = (text) => detail.createEl('p', { text });
const table = (headers, rows) => dv.table(headers, rows);

heading(2, 'stats.detail.title');

heading(3, 'stats.detail.byYear');
const byYear = {};
for (const e of events) (byYear[e.year] = byYear[e.year] || []).push(e);
bars(
  Object.keys(byYear)
    .sort()
    .map((y) => ({
      group: 'years',
      label: y,
      value: byYear[y].length,
      title: t('drill.readIn', { year: y }),
      items: byYear[y].map((e) => ({ p: e.p, date: e.date })),
    })),
);

heading(3, 'stats.detail.ratings');
const byRating = {};
for (const p of books) if (ratingOf(p)) byRating[p.rating] = (byRating[p.rating] || 0) + 1;
bars(
  Object.keys(byRating)
    .map(Number)
    .sort((a, b) => b - a)
    .map((r) => ({
      group: 'rating',
      label: number(r),
      value: byRating[r],
      title: t('drill.rating', { rating: r }),
      items: books.filter((p) => p.rating === r),
    })),
);

heading(3, 'stats.detail.formats');
const formats = [...new Set(books.map((p) => p.format).filter(Boolean))];
bars(
  formats
    .map((f) => {
      const all = books.filter((p) => p.format === f).length;
      const done = finished.filter((p) => p.format === f).length;
      return {
        group: 'format',
        label: label('format', f),
        items: books.filter((p) => p.format === f),
        value: all,
        note: t('stats.detail.formatNote', { count: all, done }),
      };
    })
    .sort((a, b) => b.value - a.value),
);

heading(3, 'stats.detail.categories');
bars(
  colophon.categories
    .map(({ key }) => {
      const items = finished.filter((p) => list(p.category).map(String).includes(key));
      const ratings = items.map(ratingOf).filter((r) => r !== null);
      return {
        group: 'category',
        label: label('category', key),
        title: t('drill.categoryFinished', { category: label('category', key) }),
        items,
        value: items.length,
        note: ratings.length
          ? t('stats.detail.categoryNoteRated', { count: items.length, avg: fmt(avg(ratings), 1) })
          : number(items.length),
      };
    })
    .filter((r) => r.value)
    .sort((a, b) => b.value - a.value),
);

heading(3, 'stats.detail.series');
const cycles = {};
for (const p of books) if (p.series) (cycles[p.series] = cycles[p.series] || []).push(p);
bars(
  Object.entries(cycles)
    .map(([name, items]) => {
      const done = items.filter((p) => is(p, 'finished')).length;
      const order = [...items].sort(
        (a, b) =>
          (typeof a.series_index === 'number' ? a.series_index : Infinity) -
            (typeof b.series_index === 'number' ? b.series_index : Infinity) ||
          collator.compare(nameOf(a), nameOf(b)),
      );
      return {
        group: 'series',
        label: name,
        items: order,
        sorted: true,
        value: done,
        note: t('stats.detail.seriesNote', { done, total: items.length }),
      };
    })
    .sort((a, b) => b.value - a.value || collator.compare(a.label, b.label)),
);

heading(3, 'stats.detail.authors');
const byAuthor = {};
for (const p of finished) for (const a of authorsOf(p)) byAuthor[a] = (byAuthor[a] || 0) + 1;
bars(
  Object.entries(byAuthor)
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .slice(0, 15)
    .map(([name, value]) => {
      const own = books.filter((p) => authorsOf(p).includes(name));
      return {
        group: 'author',
        label: name,
        value,
        note: t('stats.detail.authorNote', { done: value, total: own.length }),
        items: own,
      };
    }),
);

heading(3, 'stats.detail.duration');
const timed = finished
  .filter((p) => dt(p.started) && dt(p.finished))
  .map((p) => ({ p, days: colophon.readingDays(p.started, p.finished) }));
const valid = timed
  .filter((x) => x.days > 0)
  .sort((a, b) => a.days - b.days || collator.compare(nameOf(a.p), nameOf(b.p)));
const excluded = timed.length - valid.length;
if (valid.length) {
  const mean = valid.reduce((s, x) => s + x.days, 0) / valid.length;
  const mid = valid.length >> 1;
  const median = valid.length % 2 ? valid[mid].days : (valid[mid - 1].days + valid[mid].days) / 2;
  // Rounded first: the plural form must follow the number that is shown.
  paragraph(t('stats.detail.durationMean', { count: Math.round(mean * 10) / 10 }));
  paragraph(t('stats.detail.durationMedian', { count: median }));
  paragraph(t('stats.detail.durationCounted', { count: valid.length }));
  if (excluded) paragraph(t('stats.detail.durationExcluded', { count: excluded }));
  const row = (x) => [
    link(x.p),
    number(x.days),
    x.p.format ? label('format', list(x.p.format)[0]) : '',
  ];
  const headers = [
    t('stats.detail.colBook'),
    t('stats.detail.colDays'),
    t('stats.detail.colFormat'),
  ];
  heading(4, 'stats.detail.fastest');
  table(headers, valid.slice(0, 7).map(row));
  heading(4, 'stats.detail.slowest');
  table(headers, valid.slice(-7).reverse().map(row));
} else {
  paragraph(t('stats.detail.durationNone'));
}

heading(3, 'stats.detail.rereads');
const rereads = books.filter((p) => p.reread_count > 0);
if (rereads.length) {
  paragraph(
    t('stats.detail.rereadsSummary', {
      total: rereads.reduce((s, p) => s + Number(p.reread_count), 0),
      books: rereads.length,
    }),
  );
  table(
    [t('stats.detail.colBook'), t('stats.detail.colRereads'), t('stats.detail.colLastRead')],
    rereads.map((p) => [link(p), number(Number(p.reread_count)), date(p.finished)]),
  );
} else {
  paragraph(t('stats.detail.rereadsNone'));
}

// Redrawn by Dataview: open the list that was open before.
if (state.drill) openDrill(state.drill);
