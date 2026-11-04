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
const { coverFile, joinList, monthNames, TOPICS, CATEGORIES } = colophon;

await colophon.injectStyle('colophon-statistics-style', 'statistics/view.css');

const dt = (v) => (v && v.year ? v : null);
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const NONE = '–';
const fmt = (x, digits = 1) =>
  x == null ? NONE : number(x, { maximumFractionDigits: digits });
const nameOf = (p) => String(p.title || p.file.name);
const authorsOf = (p) => list(p.author).map(String);
const ratingOf = (p) => (typeof p.rating === 'number' && p.rating > 0 ? p.rating : null);
const coverSrc = (p) => {
  const file = coverFile(p);
  return file ? app.vault.getResourcePath(file) : null;
};
const isTopic = (c) => TOPICS.includes(c);
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

const books = colophon.books().array();

// Rereads: the dates of earlier reads are listed in the Reading history section of the note.
const HISTORY_LINE = /^- \S+\s*(?:→|->|—|–|-)\s*(\d{4}-\d{2}-\d{2})\s*$/gm;
const readDates = async (p) => {
  const dates = new Set();
  const main = p.status === 'finished' ? dt(p.finished) : null;
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

const count = (s) => books.filter((p) => p.status === s).length;
const rated = books.filter((p) => ratingOf(p));
const paged = books.filter((p) => p.status === 'finished' && typeof p.pages === 'number');
const now = dv.date('today').year;

// ---- Overview ----------------------------------------------------------------------------

const root = dv.container.createDiv({ cls: 'rb' });
const top = root.createDiv({ cls: 'rb-top' });

const nowBox = top.createDiv({ cls: 'rb-section' });
nowBox.createDiv({ cls: 'rb-title', text: t('stats.readingNow') });
const reading = books
  .filter((p) => p.status === 'in_progress')
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
const kpi = (value, caption, hint) => {
  const el = kpis.createDiv({ cls: 'rb-kpi' });
  el.createEl('b', { text: value });
  el.createEl('span', { text: caption });
  if (hint) el.createEl('i', { text: hint });
};
const finishedCount = count('finished');
kpi(fmt(finishedCount, 0), t('stats.kpi.finished'), t('stats.kpi.ofBooks', { count: books.length }));
kpi(fmt(count('in_progress'), 0), t('stats.kpi.reading'));
kpi(fmt(count('planned'), 0), t('stats.kpi.planned'));
kpi(fmt(count('abandoned'), 0), t('stats.kpi.abandoned'));
kpi(
  fmt(avg(rated.map((p) => p.rating)), 2),
  t('stats.kpi.avgRating'),
  t('stats.kpi.rated', { count: rated.length }),
);
kpi(
  fmt(
    paged.reduce((s, p) => s + p.pages, 0),
    0,
  ),
  t('stats.kpi.pagesRead'),
  t('stats.kpi.pagesKnown', { count: finishedCount, known: paged.length }),
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
const MONTHS_NARROW = monthNames('narrow');

function drawYear(y) {
  const ev = events.filter((e) => e.year === y);
  const uniq = [...new Set(ev.map((e) => e.p))];
  const r = uniq.map(ratingOf).filter((x) => x !== null);
  const pg = ev.filter((e) => e.last).map((e) => e.p.pages).filter((x) => typeof x === 'number');
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
    const m = chart.createDiv({ cls: 'rb-m', attr: { title: tip + (titles ? '\n' + titles : '') } });
    m.createEl('em', { text: c.length ? number(c.length) : '' });
    m.createDiv({ attr: { style: `height:${c.length ? Math.max(4, (c.length / max) * 84) : 0}px` } });
    const name = m.createEl('span');
    name.createSpan({ cls: 'rb-mn-short', text: MONTHS_SHORT[i] });
    name.createSpan({ cls: 'rb-mn-narrow', text: MONTHS_NARROW[i] });
  });
  const cats = {};
  for (const p of uniq) for (const c of list(p.category)) if (isTopic(c)) cats[c] = (cats[c] || 0) + 1;
  const topCats = Object.entries(cats)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  yearCats.setText(
    topCats.length
      ? t('stats.year.topCategories', {
          list: joinList(
            topCats.map(([c, n]) => t('stats.year.categoryCount', { category: label('category', c), count: n })),
          ),
        })
      : '',
  );
  // Covers of the year, newest first. A reread book shows up in every year it was read.
  wall.empty();
  const sorted = [...ev].sort(
    (a, b) => b.date.localeCompare(a.date) || collator.compare(nameOf(a.p), nameOf(b.p)),
  );
  for (const e of sorted) {
    const rate = ratingOf(e.p);
    const tip = rate ? t('stats.year.wallTitleRated', { title: nameOf(e.p), rating: rate }) : nameOf(e.p);
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

const finishedRated = books.filter((p) => p.status === 'finished' && ratingOf(p));
const globalAvg = avg(finishedRated.map(ratingOf)) || 0;
const averageBy = (pick) => {
  const groups = {};
  for (const p of finishedRated) {
    for (const key of pick(p)) (groups[key] = groups[key] || []).push(ratingOf(p));
  }
  return groups;
};
const byAuthorRating = averageBy(authorsOf);
const byCategoryRating = averageBy((p) => list(p.category).map(String).filter(isTopic));
const seriesBooks = {};
for (const p of books) if (p.series) (seriesBooks[p.series] = seriesBooks[p.series] || []).push(p);
const position = (p) => (typeof p.series_index === 'number' ? p.series_index : Infinity);
const earlierPlanned = (p) =>
  (seriesBooks[p.series] || []).some((o) => o.status === 'planned' && position(o) < position(p));
const nextInSeries = (p) => {
  const all = seriesBooks[p.series] || [];
  if (p.status !== 'planned' || !all.some((x) => x.status === 'finished')) return false;
  return !earlierPlanned(p);
};
const picks = books
  .filter((p) => p.status === 'planned' && typeof p.queue !== 'number')
  .map((p) => {
    let score = 0;
    const reasons = [];
    if (p.series && nextInSeries(p)) {
      score += 100;
      reasons.push(t('stats.reason.nextInSeries', { series: String(p.series) }));
    }
    let author = null;
    for (const a of authorsOf(p)) {
      const ratings = byAuthorRating[a];
      if (ratings && avg(ratings) >= globalAvg && (!author || avg(ratings) > avg(author.ratings))) {
        author = { a, ratings };
      }
    }
    if (author) {
      score += (avg(author.ratings) - globalAvg) * 10 + Math.min(author.ratings.length, 5) * 2;
      reasons.push(
        t('stats.reason.author', {
          author: author.a,
          avg: fmt(avg(author.ratings), 1),
          count: author.ratings.length,
        }),
      );
    }
    let category = null;
    for (const c of list(p.category).map(String).filter(isTopic)) {
      const ratings = byCategoryRating[c];
      if (ratings && ratings.length >= 5 && avg(ratings) > globalAvg) {
        if (!category || avg(ratings) > avg(category.ratings)) category = { c, ratings };
      }
    }
    if (category) {
      score += (avg(category.ratings) - globalAvg) * 5;
      reasons.push(
        t('stats.reason.category', {
          category: label('category', category.c),
          avg: fmt(avg(category.ratings), 1),
        }),
      );
    }
    return { p, score, reasons };
  })
  .filter((x) => x.score > 0)
  // A series is read in order, and one author must not fill the whole list.
  .filter((x) => !earlierPlanned(x.p))
  .sort((a, b) => b.score - a.score || collator.compare(nameOf(a.p), nameOf(b.p)))
  .filter((x, i, all) => !all.slice(0, i).some((o) => authorsOf(o.p).some((a) => authorsOf(x.p).includes(a))))
  .slice(0, 6);
if (picks.length) {
  const recBox = root.createDiv({ cls: 'rb-section rb-next' });
  recBox.createDiv({ cls: 'rb-title', text: t('stats.next') });
  const recList = recBox.createEl('ul', { cls: 'rb-list' });
  for (const { p, reasons } of picks) {
    const b = bookButton(recList.createEl('li'), 'rb-link', p);
    const authors = authorsOf(p);
    b.createSpan({
      cls: 'rb-name',
      text: authors.length ? t('stats.titleByAuthors', { title: nameOf(p), authors: joinList(authors) }) : nameOf(p),
    });
    b.createSpan({ cls: 'rb-sub', text: reasons.join(' · ') });
  }
}

// ---- In detail -----------------------------------------------------------------------------

const link = (p) => dv.fileLink(p.file.path, false, nameOf(p));
const finished = books.filter((p) => p.status === 'finished');
const detail = dv.container;

// Horizontal bars: one scale per block, the value is written at the right.
function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const wrap = detail.createDiv({ cls: 'rb-bars' });
  for (const r of rows) {
    wrap.createDiv({ cls: 'rb-bar-label', text: r.label, attr: { title: r.label } });
    const track = wrap.createDiv({ cls: 'rb-bar-track' });
    track.createDiv({
      attr: {
        style: `width:${Math.max(r.value ? 1 : 0, (r.value / max) * 100)}%`,
        title: `${r.label}: ${r.note || number(r.value)}`,
      },
    });
    wrap.createDiv({ cls: 'rb-bar-note', text: r.note || number(r.value) });
  }
}
const heading = (level, key) => detail.createEl(`h${level}`, { text: t(key) });
const paragraph = (text) => detail.createEl('p', { text });
const table = (headers, rows) => dv.table(headers, rows);

heading(2, 'stats.detail.title');

heading(3, 'stats.detail.byYear');
const byYear = {};
for (const e of events) byYear[e.year] = (byYear[e.year] || 0) + 1;
bars(
  Object.keys(byYear)
    .sort()
    .map((y) => ({ label: y, value: byYear[y] })),
);

heading(3, 'stats.detail.ratings');
const byRating = {};
for (const p of books) if (ratingOf(p)) byRating[p.rating] = (byRating[p.rating] || 0) + 1;
bars(
  Object.keys(byRating)
    .map(Number)
    .sort((a, b) => b - a)
    .map((r) => ({ label: number(r), value: byRating[r] })),
);

heading(3, 'stats.detail.formats');
const formats = [...new Set(books.map((p) => p.format).filter(Boolean))];
bars(
  formats
    .map((f) => {
      const all = books.filter((p) => p.format === f).length;
      const done = finished.filter((p) => p.format === f).length;
      return { label: label('format', f), value: all, note: t('stats.detail.formatNote', { count: all, done }) };
    })
    .sort((a, b) => b.value - a.value),
);

heading(3, 'stats.detail.categories');
bars(
  CATEGORIES.map((key) => {
    const items = finished.filter((p) => list(p.category).map(String).includes(key));
    const ratings = items.map(ratingOf).filter((r) => r !== null);
    return {
      label: label('category', key),
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
      const done = items.filter((p) => p.status === 'finished').length;
      return { label: name, value: done, note: t('stats.detail.seriesNote', { done, total: items.length }) };
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
    .map(([name, value]) => ({ label: name, value })),
);

heading(3, 'stats.detail.duration');
const timed = finished
  .filter((p) => dt(p.started) && dt(p.finished))
  .map((p) => ({ p, days: Math.round(p.finished.diff(p.started, 'days').days) }));
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
  const row = (x) => [link(x.p), number(x.days), x.p.format ? label('format', list(x.p.format)[0]) : ''];
  const headers = [t('stats.detail.colBook'), t('stats.detail.colDays'), t('stats.detail.colFormat')];
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
