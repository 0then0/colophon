// Colophon import page. Use it in a note:  await dv.view("Colophon/import")
//
// Bootstrap: see Colophon/book/view.js. Errors here are the only English text outside the locale files.
//
// The page only draws. The file is parsed and planned by Colophon/storygraph.js or
// Colophon/goodreads.js and the notes are created by Colophon/import/engine.js. Dataview runs this script again whenever the vault changes
// (also while notes are being created), so nothing here starts an import on its own and the state
// lives outside the script: the session of this block and the run shared by all import pages.
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
const { t, label, number, date, joinList, collator, catalog } = colophon;

await colophon.injectStyle('colophon-import-style', 'import/view.css');
colophon.showProblems(dv.container);

const engine = await colophon.loadImport();
const { shared, LIMITS, SERVICES } = engine;
const PAGE = 50; // rows of a list shown at first and added by "Show more"

// One session per block. Dataview keeps the container when it redraws, so the session is found
// again; it is closed when the note or the pane goes away.
const views = (shared.views ??= new WeakMap());
let entry = views.get(dv.container);
if (!entry) {
  const container = dv.container;
  const created = {
    detach: null,
    shown: {},
    open: new Set(),
    // The service the reader chose (none at first) and the options of each service.
    chosen: null,
    options: { goodreads: { reviews: false, privateNotes: false, statuses: {}, categories: {} } },
    session: engine.createSession({
      finished: (result) => {
        if (typeof Notice !== 'function') return;
        new Notice(
          t('import.notice', {
            source: result.service,
            created: result.created.length,
            total: result.total,
          }),
          8000,
        );
      },
    }),
  };
  views.set(container, created);
  dv.component.register(() => {
    created.detach?.();
    created.session.close();
    views.delete(container);
  });
  entry = created;
}
const { session } = entry;
// The listeners of the previous drawing of this block.
entry.detach?.();

// Two drawings can overlap when Dataview redraws while this script is still loading: one page stays.
for (const stale of Array.from(dv.container.children))
  if (stale.classList.contains('ci')) stale.remove();
const root = dv.container.createDiv({ cls: 'ci' });
// A click inside the page must not make Live Preview open the code block.
root.addEventListener('mousedown', (e) => e.stopPropagation());

const button = (parent, text, id, onClick) => {
  const el = parent.createEl('button', { text, attr: { type: 'button', 'data-ci': id } });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return el;
};
// Warnings and skipped rows of Goodreads have messages of their own; errors are shared.
const message = (group, { code, kind, ...details }, service) => {
  const params = { ...details };
  if (params.date) params.date = date(params.date);
  // A year is not a quantity: no group separator.
  if (params.year) params.year = String(params.year);
  if (params.limit && code === 'tooLarge') params.limit = params.limit / 1024 / 1024;
  const prefix = service === 'goodreads' && group !== 'error' ? 'goodreads.' : '';
  return t(`import.${group}.${prefix}${code}`, params);
};
// A long list is cut; the total is always stated and the rest can be opened step by step.
const limited = (parent, items, key, drawItem) => {
  const list = parent.createEl('ul', { cls: `ci-list ci-${key}` });
  const shown = Math.min(items.length, entry.shown[key] ?? PAGE);
  for (const item of items.slice(0, shown)) drawItem(list.createEl('li'), item);
  if (shown < items.length) {
    const more = parent.createDiv({ cls: 'ci-more' });
    more.createSpan({ text: t('import.shown', { shown, total: items.length }) });
    button(more, t('import.showMore'), `more-${key}`, () => {
      entry.shown[key] = shown + PAGE * 4;
      redraw();
    });
  }
};

// ---- Static part ---------------------------------------------------------------------------------

const live = root.createDiv({ cls: 'ci-live' });
root.createEl('p', { cls: 'ci-intro', text: t('import.intro') });

// The service is chosen explicitly: the file picker waits for it.
const sources = root.createEl('fieldset', { cls: 'ci-sources' });
sources.createEl('legend', { text: t('import.source') });
const radioName = `ci-source-${Math.random().toString(36).slice(2)}`;
const radios = Object.entries(SERVICES).map(([service, { label: name }]) => {
  const option = sources.createEl('label', { cls: 'ci-source' });
  const radio = option.createEl('input', {
    attr: { type: 'radio', name: radioName, value: service, 'data-ci': `source-${service}` },
  });
  option.createSpan({ text: name });
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    entry.chosen = service;
    entry.shown = {};
    session.configure({ service, options: entry.options[service] ?? {} });
  });
  return radio;
});

const picker = root.createEl('label', { cls: 'ci-pick' });
const pickerText = picker.createSpan({ cls: 'ci-pick-text' });
const fileInput = picker.createEl('input', {
  cls: 'ci-file',
  attr: {
    type: 'file',
    accept: '.csv,text/csv,text/comma-separated-values',
    'data-ci': 'file',
  },
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  // Emptied so that the same file can be chosen again after it was exported anew.
  fileInput.value = '';
  if (!file) return;
  entry.shown = {};
  session.load({ name: file.name, size: file.size, read: () => file.text() });
});
root.createEl('p', {
  cls: 'ci-hint',
  text: t('import.limits', {
    size: LIMITS.fileBytes / 1024 / 1024,
    rows: LIMITS.rows,
    field: LIMITS.fieldLength,
  }),
});
const settings = root.createDiv({ cls: 'ci-settings' });
const body = root.createDiv({ cls: 'ci-body' });

// ---- The run and its result (shared by every import page) ----------------------------------------

let progressText = null;
let progressBar = null;
const progressLabel = (run) =>
  run.phase === 'checking'
    ? t('import.checking')
    : t('import.progress', { done: run.done, total: run.total });

const drawRun = (run) => {
  const box = live.createDiv({ cls: 'ci-panel ci-run' });
  box.createDiv({ cls: 'ci-panel-title', text: t('import.runTitle', { file: run.file }) });
  progressText = box.createDiv({
    cls: 'ci-progress-text',
    text: progressLabel(run),
    attr: { role: 'status', 'aria-live': 'polite' },
  });
  progressBar = box.createEl('progress', {
    attr: {
      max: String(run.total || 1),
      value: String(run.done),
      'aria-label': t('import.runTitle', { file: run.file }),
    },
  });
  const stop = button(box, t(run.stopping ? 'import.stopping' : 'import.stop'), 'stop', () =>
    engine.stop(),
  );
  stop.disabled = run.stopping || run.phase === 'checking';
};

const drawResult = (result) => {
  const box = live.createDiv({ cls: 'ci-panel ci-result', attr: { role: 'status' } });
  box.createDiv({ cls: 'ci-panel-title', text: t('import.result.title', { file: result.file }) });
  if (result.error) {
    box.createEl('p', {
      cls: 'ci-error',
      text: t('import.result.error', { message: result.error }),
    });
  }
  if (result.stopped) box.createEl('p', { text: t('import.result.stopped') });
  const group = (key, items, text = (name) => name) => {
    if (!items.length) return;
    const details = box.createEl('details');
    details.open = entry.open.has(key);
    details.addEventListener('toggle', () =>
      details.open ? entry.open.add(key) : entry.open.delete(key),
    );
    details.createEl('summary', { text: t(key, { count: items.length }) });
    limited(details, items, key, (li, item) => li.setText(text(item)));
  };
  box.createEl('p', {
    cls: 'ci-result-main',
    text: t('import.result.summary', { created: result.created.length, total: result.total }),
  });
  group('import.result.created', result.created);
  group('import.result.existing', result.existing);
  group('import.result.conflicts', result.conflicts);
  group('import.result.failed', result.failed, (item) =>
    t(item.partial ? 'import.result.partialItem' : 'import.result.failedItem', item),
  );
  if (result.notAttempted) {
    box.createEl('p', { text: t('import.result.notAttempted', { count: result.notAttempted }) });
  }
  if (result.created.length < result.total) box.createEl('p', { text: t('import.result.rerun') });
  button(box, t('import.result.dismiss'), 'dismiss', () => engine.dismiss());
};

// ---- Goodreads settings ---------------------------------------------------------------------------
// The options are kept by the page and handed to the session; every change builds a new preview.

const setOptions = (change) => {
  const options = { ...entry.options.goodreads, ...change };
  entry.options.goodreads = options;
  session.configure({ service: 'goodreads', options });
};

const checkbox = (parent, text, id, checked, onChange) => {
  const row = parent.createEl('label', { cls: 'ci-check' });
  const box = row.createEl('input', { attr: { type: 'checkbox', 'data-ci': id } });
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  row.createSpan({ text });
  return box;
};

// One select per shelf. A value that is no longer in config.json stays visible until it is changed.
const shelfList = (parent, shelves, part, group, noneText, disabled) => {
  const mapping = entry.options.goodreads[part];
  const items = [...shelves].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  const values = catalog[part];
  limited(parent, items, `shelves-${part}`, (li, [name, count]) => {
    li.addClass('ci-shelf');
    const id = `${part}-${items.findIndex(([other]) => other === name)}`;
    const caption = li.createEl('label', {
      text: t('import.goodreads.shelf', { name, count }),
      attr: { for: `${radioName}-${id}` },
    });
    caption.addClass('ci-shelf-name');
    const select = li.createEl('select', {
      cls: 'dropdown',
      attr: { id: `${radioName}-${id}`, 'data-ci': id },
    });
    select.createEl('option', { text: noneText, attr: { value: '' } });
    for (const entryOf of values)
      select.createEl('option', { text: entryOf.label, attr: { value: entryOf.key } });
    const current = Object.hasOwn(mapping, name) ? mapping[name] : '';
    if (current && !values.some((v) => v.key === current))
      select.createEl('option', { text: label(group, current), attr: { value: current } });
    select.value = current;
    select.disabled = disabled;
    select.addEventListener('change', () => {
      const next = { ...entry.options.goodreads[part] };
      if (select.value) next[name] = select.value;
      else delete next[name];
      setOptions({ [part]: next });
    });
  });
};

const drawSettings = (disabled) => {
  settings.empty();
  if (entry.chosen !== 'goodreads') return;
  const options = entry.options.goodreads;
  const box = settings.createDiv({ cls: 'ci-panel ci-options' });
  box.createDiv({ cls: 'ci-panel-title', text: t('import.goodreads.settings') });
  const texts = [
    checkbox(box, t('import.goodreads.reviews'), 'reviews', options.reviews, (on) =>
      setOptions({ reviews: on }),
    ),
    checkbox(box, t('import.goodreads.privateNotes'), 'private-notes', options.privateNotes, (on) =>
      setOptions({ privateNotes: on }),
    ),
  ];
  for (const box of texts) box.disabled = disabled;
  box.createEl('p', { cls: 'ci-hint', text: t('import.goodreads.textHint') });

  const shelves = session.shelves;
  if (!shelves) {
    box.createEl('p', { cls: 'ci-hint', text: t('import.goodreads.shelvesLater') });
    return;
  }
  box.createEl('h4', { text: t('import.goodreads.statusTitle') });
  box.createEl('p', { cls: 'ci-hint', text: t('import.goodreads.statusHint') });
  if (shelves.exclusive.size)
    shelfList(
      box,
      shelves.exclusive,
      'statuses',
      'status',
      t('import.goodreads.statusNone'),
      disabled,
    );
  box.createEl('h4', { text: t('import.goodreads.categoryTitle') });
  box.createEl('p', {
    cls: 'ci-hint',
    text: t(
      shelves.other.size ? 'import.goodreads.categoryHint' : 'import.goodreads.noCategoryShelves',
    ),
  });
  if (shelves.other.size)
    shelfList(
      box,
      shelves.other,
      'categories',
      'category',
      t('import.goodreads.categoryNone'),
      disabled,
    );
};

// ---- The preview of this page ---------------------------------------------------------------------

const drawBook = (li, book, plan) => {
  li.createDiv({
    cls: 'ci-book-title',
    text: t('stats.titleByAuthors', { title: book.title, authors: joinList(book.authors) }),
  });
  const status = label('status', book.status);
  li.createDiv({
    cls: 'ci-book-meta',
    text: book.rating ? t('panel.metaRated', { status, rating: book.rating }) : status,
  });
  li.createDiv({ cls: 'ci-book-file', text: t('import.note', { name: plan.names.get(book.id) }) });
  const current =
    book.started && book.finished
      ? t('import.read.current', { start: date(book.started), end: date(book.finished) })
      : book.finished
        ? t('import.read.finished', { date: date(book.finished) })
        : book.started
          ? t('import.read.started', { date: date(book.started) })
          : null;
  if (current) li.createDiv({ cls: 'ci-book-read', text: current });
  if (book.history.length) {
    const reads = book.history.map(({ startedOn, finishedOn }) =>
      startedOn
        ? t('import.read.interval', { start: date(startedOn), end: date(finishedOn) })
        : t('import.read.endOnly', { end: date(finishedOn) }),
    );
    li.createDiv({
      cls: 'ci-book-read',
      text: t('import.read.earlier', { list: joinList(reads) }),
    });
  }
  if (book.categories?.length) {
    li.createDiv({
      cls: 'ci-book-read',
      text: t('import.categories', {
        list: joinList(book.categories.map((key) => label('category', key))),
      }),
    });
  }
  const added = [book.review && 'My Review', book.privateNotes && 'Private Notes'].filter(Boolean);
  if (added.length) {
    li.createDiv({
      cls: 'ci-book-read',
      text: t('import.goodreads.added', { list: joinList(added) }),
    });
  }
  if (book.warnings.length) {
    const warnings = li.createEl('ul', { cls: 'ci-warnings' });
    for (const warning of book.warnings)
      warnings.createEl('li', { text: message('warning', warning, plan.service) });
  }
};

// Where an already imported book is now: the notes of the library that carry its identity.
const notesOf = (plan) => {
  const paths = new Map();
  for (const [path, ids] of plan.found.identities)
    for (const id of ids) paths.set(id, [...(paths.get(id) ?? []), path]);
  return paths;
};

const drawPreview = (plan) => {
  if (session.stale) {
    body.createEl('p', { cls: 'ci-stale', text: t('import.stale'), attr: { role: 'alert' } });
  }
  const facts = body.createEl('dl', { cls: 'ci-facts' });
  const fact = (name, value) => {
    facts.createEl('dt', { text: name });
    facts.createEl('dd', { text: value });
  };
  fact(t('import.source'), plan.label);
  fact(t('import.file'), session.file.name);
  fact(t('import.library'), plan.library);
  fact(t('import.rows'), number(plan.rows));

  const ambiguous = plan.skipped.filter((row) => row.kind === 'ambiguous').length;
  // Goodreads rows have one id each, so no row can be ambiguous.
  const ambiguity = plan.service !== 'goodreads';
  const counts = body.createDiv({ cls: ambiguity ? 'ci-counts' : 'ci-counts is-three' });
  const count = (value, caption) => {
    const tile = counts.createDiv({ cls: 'ci-count' });
    tile.createEl('b', { text: number(value) });
    tile.createSpan({ text: caption });
  };
  count(plan.fresh.length, t('import.count.fresh'));
  count(plan.known.length, t('import.count.known'));
  if (ambiguity) count(ambiguous, t('import.count.ambiguous'));
  count(plan.skipped.length - ambiguous, t('import.count.invalid'));

  if (plan.fresh.length) {
    body.createEl('h3', { text: t('import.freshTitle') });
    limited(body, plan.fresh, 'books', (li, book) => drawBook(li, book, plan));
  }
  if (plan.skipped.length) {
    body.createEl('h3', { text: t('import.skippedTitle') });
    limited(body, plan.skipped, 'skipped', (li, row) => {
      li.createDiv({
        cls: 'ci-row',
        text:
          row.title === undefined
            ? t('import.row', { row: row.row })
            : t('import.rowTitled', { row: row.row, title: row.title }),
      });
      li.createDiv({ text: message('skip', row, plan.service) });
    });
  }
  if (plan.known.length) {
    body.createEl('h3', { text: t('import.knownTitle') });
    const paths = notesOf(plan);
    limited(body, plan.known, 'known', (li, book) => {
      li.createDiv({
        cls: 'ci-book-title',
        text: t('stats.titleByAuthors', { title: book.title, authors: joinList(book.authors) }),
      });
      for (const path of paths.get(book.id) ?? [])
        li.createDiv({ cls: 'ci-book-file', text: t('import.knownNote', { path }) });
    });
  }
  if (plan.service === 'goodreads')
    body.createEl('p', { cls: 'ci-hint', text: t('import.goodreads.about') });

  body.createEl('p', { cls: 'ci-hint', text: t('import.safety') });
  body.createEl('p', { cls: 'ci-hint', text: t('import.sync') });
  if (!plan.fresh.length) body.createEl('p', { cls: 'ci-empty', text: t('import.nothing') });
  if (shared.run) body.createEl('p', { cls: 'ci-hint', text: t('import.busy') });
  const actions = body.createDiv({ cls: 'ci-actions' });
  if (plan.fresh.length) {
    const confirm = button(
      actions,
      t('import.confirm', { count: plan.fresh.length }),
      'confirm',
      () => session.confirm(),
    );
    confirm.addClass('mod-cta');
    confirm.disabled = !!shared.run;
  }
  button(actions, t('import.close'), 'close', () => session.clear()).disabled =
    shared.run?.session === session;
};

// ---- Drawing --------------------------------------------------------------------------------------

let shape = null;
function redraw() {
  shape = null;
  draw();
}
function draw() {
  const run = shared.run;
  const next = [session.state, session.plan && 1, session.stale, run?.phase, run?.stopping];
  const key = JSON.stringify(next);
  // Between two notes only the numbers change: leave the page and the focus as they are.
  if (key === shape && run && session.plan === draw.plan && shared.last === draw.last) {
    progressText.setText(progressLabel(run));
    progressBar.value = run.done;
    return;
  }
  shape = key;
  draw.plan = session.plan;
  draw.last = shared.last;
  const focused = root.contains(root.ownerDocument.activeElement)
    ? root.ownerDocument.activeElement.getAttribute('data-ci')
    : null;

  live.empty();
  body.empty();
  const service = entry.chosen ? SERVICES[entry.chosen] : null;
  for (const radio of radios) {
    radio.checked = radio.value === entry.chosen;
    radio.disabled = !!run;
  }
  pickerText.setText(
    service ? t('import.choose', { source: service.label }) : t('import.chooseSource'),
  );
  fileInput.disabled = !!run || !service;
  picker.toggleClass('is-disabled', !!run || !service);
  drawSettings(!!run);
  if (run) drawRun(run);
  else if (shared.last) drawResult(shared.last);

  if (session.state === 'reading') {
    body.createEl('p', { cls: 'ci-status', text: t('import.reading'), attr: { role: 'status' } });
  } else if (session.state === 'error') {
    body.createEl('p', {
      cls: 'ci-error',
      text: message('error', { code: session.error.code, ...session.error.details }, null),
      attr: { role: 'alert' },
    });
  } else if (session.state === 'preview') {
    drawPreview(session.plan);
  }
  if (focused) root.querySelector(`[data-ci="${focused}"]:not(:disabled)`)?.focus();
}

draw();
const off = [session.subscribe(redraw), engine.subscribe(draw)];
entry.detach = () => off.forEach((stop) => stop());
