// Colophon import page. Use it in a note:  await dv.view("Colophon/import")
//
// Bootstrap: see Colophon/book/view.js. Errors here are the only English text outside the locale files.
//
// The page only draws. The file is parsed and planned by Colophon/storygraph.js and the notes are
// created by Colophon/import/engine.js. Dataview runs this script again whenever the vault changes
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
const { t, label, number, date, joinList } = colophon;

await colophon.injectStyle('colophon-import-style', 'import/view.css');
colophon.showProblems(dv.container);

const engine = await colophon.loadImport();
const { shared, LIMITS } = engine;
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
    session: engine.createSession({
      finished: (result) => {
        if (typeof Notice !== 'function') return;
        new Notice(
          t('import.notice', { created: result.created.length, total: result.total }),
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
const message = (group, { code, kind, ...details }) => {
  const params = { ...details };
  if (params.date) params.date = date(params.date);
  if (params.limit && code === 'tooLarge') params.limit = params.limit / 1024 / 1024;
  return t(`import.${group}.${code}`, params);
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
const picker = root.createEl('label', { cls: 'ci-pick' });
picker.createSpan({ cls: 'ci-pick-text', text: t('import.choose') });
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
  if (book.warnings.length) {
    const warnings = li.createEl('ul', { cls: 'ci-warnings' });
    for (const warning of book.warnings)
      warnings.createEl('li', { text: message('warning', warning) });
  }
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
  fact(t('import.file'), session.file.name);
  fact(t('import.library'), plan.library);
  fact(t('import.rows'), number(plan.rows));

  const ambiguous = plan.skipped.filter((row) => row.kind === 'ambiguous').length;
  const counts = body.createDiv({ cls: 'ci-counts' });
  const count = (value, caption) => {
    const tile = counts.createDiv({ cls: 'ci-count' });
    tile.createEl('b', { text: number(value) });
    tile.createSpan({ text: caption });
  };
  count(plan.fresh.length, t('import.count.fresh'));
  count(plan.known.length, t('import.count.known'));
  count(ambiguous, t('import.count.ambiguous'));
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
      li.createDiv({ text: message('skip', row) });
    });
  }

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
  fileInput.disabled = !!run;
  picker.toggleClass('is-disabled', !!run);
  if (run) drawRun(run);
  else if (shared.last) drawResult(shared.last);

  if (session.state === 'reading') {
    body.createEl('p', { cls: 'ci-status', text: t('import.reading'), attr: { role: 'status' } });
  } else if (session.state === 'error') {
    body.createEl('p', {
      cls: 'ci-error',
      text: message('error', { code: session.error.code, ...session.error.details }),
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
