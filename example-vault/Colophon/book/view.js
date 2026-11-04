// Colophon book page header. Use it in a book note:  await dv.view("Colophon/book")
//
// Bootstrap: Dataview runs this file without module support, so the shared library is read
// and evaluated by hand. Errors here are the only English text outside the locale files.
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
const { app, t, label, number, date, state, paths } = colophon;
const { list, coverFile, joinList, listParts, collator, HISTORY_HEADING, kindOf } = colophon;

const page = dv.current();
if (!page) return;

await colophon.injectStyle('colophon-book-style', 'book/view.css');
colophon.showProblems(dv.container);

const title = page.title || page.file.name;
const COVERS = paths.covers + '/';

const root = dv.container.createDiv({ cls: 'book-detail' });

const placeholder = (parent) => {
  const el = parent.createDiv({ cls: 'book-detail__cover-empty' });
  el.createSpan({ text: Array.from(title)[0] || '?' });
};
const coverBox = root.createDiv({ cls: 'book-detail__cover' });
const file = coverFile(page);
if (file) {
  const img = coverBox.createEl('img', {
    attr: { src: app.vault.getResourcePath(file), alt: t('book.coverAlt', { title }) },
  });
  img.addEventListener('error', () => {
    img.remove();
    placeholder(coverBox);
  });
} else {
  placeholder(coverBox);
}

const info = root.createDiv({ cls: 'book-detail__info' });
info.createEl('div', {
  cls: 'book-detail__title',
  text: title,
  attr: { role: 'heading', 'aria-level': '1' },
});
if (page.subtitle) info.createDiv({ cls: 'book-detail__subtitle', text: String(page.subtitle) });
const authors = list(page.author).map(String);
const authorButtons = [];
if (authors.length) {
  const box = info.createDiv({ cls: 'book-detail__author' });
  let index = 0;
  // Separators come from Intl.ListFormat, so they follow the language ("A, B and C").
  for (const part of listParts(authors)) {
    if (part.type === 'literal') {
      box.appendText(part.value);
      continue;
    }
    const name = authors[index++];
    authorButtons.push([
      name,
      box.createEl('button', {
        cls: 'book-detail__author-link',
        text: name,
        attr: { type: 'button' },
      }),
    ]);
  }
}

const meta = info.createEl('dl', { cls: 'book-detail__meta' });
const row = (name, value) => {
  meta.createEl('dt', { text: name });
  return meta.createEl('dd', value == null ? {} : { text: String(value) });
};

const rating = typeof page.rating === 'number' && page.rating > 0 ? page.rating : null;
const ratingBox =
  rating !== null || kindOf(page.status) !== 'planned' ? row(t('meta.rating')) : null;
const statusBox = page.status ? row(t('meta.status')) : null;
const seriesName = page.series ? String(page.series) : null;
const seriesBox = seriesName ? row(t('meta.series')) : null;
if (page.format) row(t('meta.format'), label('format', page.format));
const categories = list(page.category).map(String);
if (categories.length) {
  row(t('meta.category'), joinList(categories.map((c) => label('category', c))));
}
const translators = list(page.translator).map(String);
if (translators.length) row(t('meta.translator'), joinList(translators));
if (typeof page.pages === 'number') {
  row(t('meta.length'), t('meta.pages', { count: page.pages }));
}
if (page.publication_year) row(t('meta.year'), page.publication_year);
if (page.started) row(t('meta.started'), date(page.started));
if (page.finished) row(t('meta.finished'), date(page.finished));
// Days of the current read, by the same rule as the statistics (colophon.readingDays).
// Finished: started to finished; same-day reads are named, not shown as "0 days". In progress: started to today.
// A missing or negative interval shows nothing. Earlier reads stay in the Reading history section.
const spanText = (days) =>
  days === 0 ? t('meta.sameDay') : t('meta.readingDays', { count: days });
if (kindOf(page.status) === 'finished') {
  const days = colophon.readingDays(page.started, page.finished);
  if (days !== null && days >= 0) row(t('meta.readingTime'), spanText(days));
} else if (kindOf(page.status) === 'in_progress') {
  const days = colophon.readingDays(page.started, dv.date('today'));
  if (days !== null && days >= 0) {
    row(
      t('meta.readingSoFar'),
      days === 0 ? t('meta.startedToday') : t('meta.readingDays', { count: days }),
    );
  }
}

const links = info.createDiv({ cls: 'book-detail__links' });
const edit = links.createEl('button', {
  cls: 'book-detail__edit',
  text: t('edit.open'),
  attr: { type: 'button' },
});
const isolate = (el) =>
  ['mousedown', 'keydown', 'keyup', 'keypress', 'beforeinput', 'paste', 'cut', 'copy'].forEach(
    (n) => el.addEventListener(n, (e) => e.stopPropagation()),
  );
isolate(edit);

// Books of an author or a series are collected only on click, so opening a note does not
// walk the whole collection.
const panelButtons = {};
const closePanel = () => {
  root.querySelector('.book-detail__books')?.remove();
  Object.values(panelButtons).forEach((b) => b.removeClass('is-active'));
  state.panel = null;
};
const openPage = (p, e) =>
  app.workspace.openLinkText(p.file.path, page.file.path, e.metaKey || e.ctrlKey ? 'tab' : false);
const showPanel = (id) => {
  closePanel();
  state.panel = { path: page.file.path, id };
  panelButtons[id].addClass('is-active');
  const isSeries = id.startsWith('series:');
  const name = id.slice(id.indexOf(':') + 1);
  const nameOf = (p) => String(p.title || p.file.name);
  const stamp = (p) => {
    const f = p.finished || p.started;
    return f && f.toMillis ? f.toMillis() : 0;
  };
  const pages = dv
    .pages()
    .where(
      (p) =>
        p.type === 'book' &&
        (isSeries ? String(p.series) === name : list(p.author).map(String).includes(name)),
    )
    .array();
  const position = (p) => (typeof p.series_index === 'number' ? p.series_index : Infinity);
  const books = pages.sort(
    isSeries
      ? (a, b) => position(a) - position(b) || collator.compare(nameOf(a), nameOf(b))
      : (a, b) => stamp(b) - stamp(a) || collator.compare(nameOf(a), nameOf(b)),
  );
  const panel = root.createDiv({ cls: 'book-detail__books' });
  isolate(panel);
  const head = panel.createDiv({ cls: 'book-detail__books-head' });
  if (isSeries) {
    const done = books.filter((p) => kindOf(p.status) === 'finished').length;
    head.appendText(t('panel.seriesHead', { name, count: books.length, done }));
    const note = dv
      .pages(`"${paths.notes}"`)
      .where((p) => String(p.series) === name)
      .array()[0];
    if (note) {
      head
        .createEl('button', {
          cls: 'book-detail__edit',
          text: t('panel.seriesNote'),
          attr: { type: 'button' },
        })
        .addEventListener('click', (e) => openPage(note, e));
    }
  } else {
    head.appendText(t('panel.authorHead', { name, count: books.length }));
  }
  const grid = panel.createDiv({ cls: 'book-detail__books-grid' });
  for (const p of books) {
    const isCurrent = p.file.path === page.file.path;
    const item = grid.createEl('button', {
      cls: 'book-detail__book' + (isCurrent ? ' is-current' : ''),
      attr: { type: 'button' },
    });
    const cover = coverFile(p);
    if (cover) {
      item.createEl('img', {
        attr: { src: app.vault.getResourcePath(cover), alt: '', loading: 'lazy' },
      });
    } else {
      item.createDiv({ cls: 'book-detail__book-empty' });
    }
    const text = item.createDiv({ cls: 'book-detail__book-text' });
    const itemTitle =
      isSeries && typeof p.series_index === 'number'
        ? t('panel.seriesItem', { index: p.series_index, title: nameOf(p) })
        : nameOf(p);
    text.createDiv({ cls: 'book-detail__book-title', text: itemTitle });
    const status = label('status', p.status);
    text.createDiv({
      cls: 'book-detail__book-meta',
      text:
        typeof p.rating === 'number' && p.rating > 0
          ? t('panel.metaRated', { status, rating: p.rating })
          : status,
    });
    if (!isCurrent) {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
        openPage(p, e);
      });
    }
  }
};
for (const [name, button] of authorButtons) panelButtons['author:' + name] = button;
if (seriesBox) {
  const text =
    typeof page.series_index === 'number'
      ? t('series.labelIndexed', { series: seriesName, index: page.series_index })
      : seriesName;
  panelButtons['series:' + seriesName] = seriesBox.createEl('button', {
    cls: 'book-detail__author-link',
    text,
    attr: { type: 'button' },
  });
}
for (const [id, button] of Object.entries(panelButtons)) {
  isolate(button);
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (button.hasClass('is-active')) closePanel();
    else showPanel(id);
  });
}
const openedPanel = state.panel;
if (openedPanel && openedPanel.path === page.file.path && panelButtons[openedPanel.id]) {
  showPanel(openedPanel.id);
}

// Edit form. Writes only the changed fields through processFrontMatter; YAML stays the source of truth.
const noteFile = app.vault.getAbstractFileByPath(page.file.path);

const setProps = (changes) =>
  app.fileManager.processFrontMatter(noteFile, (data) => {
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete data[key];
      else data[key] = value;
    }
  });
const currentProps = () => app.metadataCache.getFileCache(noteFile)?.frontmatter || {};
const today = () => dv.date('today').toFormat('yyyy-MM-dd');
const saveFailed = (err) => t('error.saveFailed', { message: err.message });

// Queue: what to read next. The position is stored in the "queue" property.
if (kindOf(page.status) === 'planned') {
  const button = links.createEl('button', { cls: 'book-detail__edit', attr: { type: 'button' } });
  let place = typeof page.queue === 'number' ? page.queue : null;
  const paint = () => button.setText(place ? t('queue.remove', { place }) : t('queue.add'));
  paint();
  isolate(button);
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (place) {
      place = null;
      paint();
      await setProps({ queue: null });
      return;
    }
    const taken = dv
      .pages()
      .where((p) => p.type === 'book' && typeof p.queue === 'number')
      .array()
      .map((p) => p.queue);
    place = Math.max(0, ...taken) + 1;
    paint();
    await setProps({ queue: place });
  });
}

// Read again: the finished read moves to the Reading history section, which statistics read.
if (kindOf(page.status) === 'finished') {
  const button = links.createEl('button', {
    cls: 'book-detail__edit',
    text: t('reread.button'),
    attr: { type: 'button' },
  });
  isolate(button);
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    links.querySelector('.book-detail__prompt')?.remove();
    const ask = links.createDiv({ cls: 'book-detail__prompt' });
    isolate(ask);
    ask.createSpan({ text: t('reread.confirm') });
    const yes = ask.createEl('button', { text: t('common.yes'), attr: { type: 'button' } });
    ask
      .createEl('button', { text: t('common.no'), attr: { type: 'button' } })
      .addEventListener('click', () => ask.remove());
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const fm = currentProps();
      const line = `- ${fm.started || '?'} → ${fm.finished || '?'}`;
      try {
        // The history section is a data format, not interface text, so it is not translated.
        const score =
          typeof fm.rating === 'number' && fm.rating > 0 ? `  - rating: ${fm.rating}` : null;
        await app.vault.process(noteFile, (text) => {
          const lines = text.split('\n');
          const head = lines.findIndex((l) => l.trim() === HISTORY_HEADING);
          if (head < 0) {
            return (
              text.replace(/\s*$/, '') +
              `\n\n${HISTORY_HEADING}\n\n${line}\n${score ? score + '\n' : ''}`
            );
          }
          let stop = head + 1;
          while (stop < lines.length && !lines[stop].startsWith('#')) stop++;
          // This read may already be listed in the history: extend that line instead of duplicating it.
          const known = fm.finished
            ? lines.findIndex(
                (l, i) =>
                  i > head && i < stop && l.startsWith('- ') && l.includes(`→ ${fm.finished}`),
              )
            : -1;
          if (known >= 0) {
            if (score) lines.splice(known + 1, 0, score);
            return lines.join('\n');
          }
          let end = head + 1;
          for (let i = head + 1; i < stop; i++) if (/^\s*- /.test(lines[i])) end = i + 1;
          lines.splice(end, 0, line, ...(score ? [score] : []));
          return lines.join('\n');
        });
        await setProps({
          status: colophon.keysOfKind('in_progress')[0],
          started: today(),
          finished: null,
          reread_count: (Number(fm.reread_count) || 0) + 1,
        });
      } catch (err) {
        yes.disabled = false;
        ask.setText(saveFailed(err));
      }
    });
  });
}

// Rating by clicking the stars: steps of 0.5, clicking the same rating again clears it.
if (ratingBox) {
  let current = rating;
  const stars = ratingBox.createSpan({
    cls: 'book-detail__stars is-editable',
    attr: { title: t('rating.hint') },
  });
  const fill = stars.createSpan({ cls: 'book-detail__stars-fill' });
  const ratingLabel = ratingBox.createSpan({ cls: 'book-detail__rating' });
  isolate(stars);
  const paint = (value) => {
    fill.style.width = `${(Math.max(0, Math.min(5, value || 0)) / 5) * 100}%`;
    ratingLabel.setText(
      value === null ? t('rating.none') : t('rating.outOfFive', { rating: value }),
    );
    ratingLabel.toggleClass('book-detail__muted', value === null);
  };
  const valueAt = (e) => {
    const box = stars.getBoundingClientRect();
    return Math.max(0.5, Math.min(5, Math.ceil(((e.clientX - box.left) / box.width) * 10) / 2));
  };
  paint(current);
  stars.addEventListener('mousemove', (e) => paint(valueAt(e)));
  stars.addEventListener('mouseleave', () => paint(current));
  stars.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const clicked = valueAt(e);
    const next = clicked === current ? null : clicked;
    const previous = current;
    current = next;
    paint(next);
    try {
      await setProps({ rating: next });
    } catch (err) {
      current = previous;
      paint(previous);
      ratingLabel.setText(saveFailed(err));
    }
  });
}

// Status from a list. If the new status has no date yet, offer to set today's date.
if (statusBox) {
  // Which date a status asks for is decided by its kind, so custom statuses behave like built-in ones.
  const DATE_FOR = {
    in_progress: ['started', 'prompt.setStarted'],
    finished: ['finished', 'prompt.setFinished'],
  };
  const dateFor = (status) => DATE_FOR[kindOf(status)];
  const select = statusBox.createEl('select', { cls: 'dropdown book-detail__status' });
  for (const { key, label: text } of colophon.statuses) {
    select.createEl('option', { value: key, text });
  }
  if (!colophon.statuses.some((s) => s.key === page.status)) {
    select.createEl('option', { value: page.status, text: page.status });
  }
  select.value = page.status;
  isolate(select);
  const prompt = statusBox.createDiv({ cls: 'book-detail__prompt' });
  isolate(prompt);
  const askDate = (status) => {
    prompt.empty();
    state.prompt = null;
    const need = dateFor(status);
    if (!need || currentProps()[need[0]]) return;
    state.prompt = { path: page.file.path, status };
    prompt.createSpan({ text: t(need[1]) });
    const yes = prompt.createEl('button', { text: t('common.yes'), attr: { type: 'button' } });
    const no = prompt.createEl('button', { text: t('common.no'), attr: { type: 'button' } });
    const close = () => {
      prompt.empty();
      state.prompt = null;
    };
    no.addEventListener('click', close);
    yes.addEventListener('click', async () => {
      close();
      await setProps({ [need[0]]: today() });
    });
  };
  select.addEventListener('change', async () => {
    const status = select.value;
    const previous = currentProps().status;
    try {
      const before = currentProps();
      const changes = { status };
      // A queue position only makes sense for a planned book.
      if (kindOf(status) !== 'planned' && before.queue != null) changes.queue = null;
      await setProps(changes);
      // The metadata cache updates later, so the date is checked against the values from before the write.
      prompt.empty();
      state.prompt = null;
      if (dateFor(status) && !before[dateFor(status)[0]]) askDate(status);
    } catch (err) {
      select.value = previous;
      prompt.setText(saveFailed(err));
    }
  });
  const waiting = state.prompt;
  if (waiting && waiting.path === page.file.path && waiting.status === page.status) {
    askDate(page.status);
  }
}

const coverText = (raw) => {
  const s = raw ? colophon.stripLink(raw) : '';
  return s.startsWith(COVERS) ? s.slice(COVERS.length) : s;
};
const options = (items) => [['', t('form.unspecified')], ...items.map((e) => [e.key, e.label])];
const RATINGS = [
  ['', t('rating.none')],
  ...[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((r) => [String(r), number(r)]),
];
const splitCommas = (s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const FIELDS = [
  { key: 'title', label: t('field.title'), type: 'text', wide: true },
  { key: 'subtitle', label: t('field.subtitle'), type: 'text', wide: true },
  {
    key: 'author',
    label: t('field.author'),
    type: 'text',
    wide: true,
    hint: t('field.authorHint'),
    read: (v) => list(v).join(', '),
    write: splitCommas,
  },
  {
    key: 'translator',
    label: t('field.translator'),
    type: 'text',
    wide: true,
    hint: t('field.translatorHint'),
    read: (v) => list(v).join(', '),
    write: splitCommas,
  },
  {
    key: 'status',
    label: t('field.status'),
    type: 'select',
    options: colophon.statuses.map((e) => [e.key, e.label]),
  },
  {
    key: 'rating',
    label: t('field.rating'),
    type: 'select',
    options: RATINGS,
    write: (s) => Number(s),
  },
  { key: 'format', label: t('field.format'), type: 'select', options: options(colophon.formats) },
  {
    key: 'category',
    label: t('field.category'),
    type: 'multi',
    wide: true,
    options: colophon.categories.map((e) => [e.key, e.label]),
    read: (v) => list(v).join(','),
    write: (s) => s.split(',').filter(Boolean),
  },
  {
    key: 'series',
    label: t('field.series'),
    type: 'text',
    suggest: () =>
      [
        ...new Set(
          dv
            .pages()
            .where((p) => p.type === 'book' && p.series)
            .array()
            .map((p) => String(p.series)),
        ),
      ].sort(collator.compare),
  },
  { key: 'series_index', label: t('field.seriesIndex'), type: 'number', write: (s) => Number(s) },
  { key: 'queue', label: t('field.queue'), type: 'number', write: (s) => Number(s) },
  { key: 'pages', label: t('field.pages'), type: 'number', write: (s) => Number(s) },
  { key: 'publication_year', label: t('field.year'), type: 'number', write: (s) => Number(s) },
  { key: 'started', label: t('field.started'), type: 'date' },
  { key: 'finished', label: t('field.finished'), type: 'date' },
  {
    key: 'cover',
    label: t('field.cover'),
    type: 'text',
    wide: true,
    hint: t('field.coverHint', { folder: paths.covers }),
    suggest: () =>
      app.vault
        .getFiles()
        .filter((x) => x.path.startsWith(COVERS))
        .map((x) => x.name),
    read: coverText,
    write: (s) => `[[${s.includes('/') ? s : COVERS + s}]]`,
  },
];
const readField = (f, fm) =>
  f.read ? f.read(fm[f.key]) : fm[f.key] == null ? '' : String(fm[f.key]);

const showForm = (draft) => {
  const fm = app.metadataCache.getFileCache(noteFile)?.frontmatter || {};
  root.addClass('is-editing');
  const form = root.createEl('form', { cls: 'book-detail__form' });
  isolate(form);
  const inputs = {};
  const remember = () => {
    state.draft = {
      path: page.file.path,
      values: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])),
    };
  };
  for (const f of FIELDS) {
    const box = form.createEl(f.type === 'multi' ? 'div' : 'label', {
      cls: 'book-detail__field' + (f.wide ? ' is-wide' : ''),
    });
    box.createSpan({ text: f.label });
    let input;
    if (f.type === 'multi') {
      input = box.createEl('input', { attr: { type: 'hidden' } });
    } else if (f.type === 'select') {
      input = box.createEl('select', { cls: 'dropdown' });
      for (const [value, text] of f.options) input.createEl('option', { value, text });
      const current = readField(f, fm);
      if (current && !f.options.some((o) => o[0] === current)) {
        input.createEl('option', { value: current, text: current });
      }
    } else {
      input = box.createEl('input', { attr: { type: f.type } });
      if (f.type === 'number') {
        input.min = '0';
        input.step = '1';
      }
      if (f.suggest) {
        const id = `colophon-${f.key}`;
        input.setAttr('list', id);
        const dl = box.createEl('datalist', { attr: { id } });
        f.suggest().forEach((value) => dl.createEl('option', { value }));
      }
    }
    input.value = draft && draft[f.key] !== undefined ? draft[f.key] : readField(f, fm);
    if (f.type === 'multi') {
      const known = f.options.map((o) => o[0]);
      const chosen = () => input.value.split(',').filter(Boolean);
      const group = box.createDiv({ cls: 'book-detail__checks' });
      for (const [value, text] of f.options) {
        const item = group.createEl('label');
        const check = item.createEl('input', { attr: { type: 'checkbox' } });
        check.checked = chosen().includes(value);
        item.appendText(text);
        check.addEventListener('change', () => {
          const current = chosen();
          const next = known.filter((k) => (k === value ? check.checked : current.includes(k)));
          input.value = [...next, ...current.filter((c) => !known.includes(c))].join(',');
          remember();
        });
      }
    }
    input.addEventListener('input', remember);
    input.addEventListener('change', remember);
    inputs[f.key] = input;
    if (f.hint) box.createEl('small', { text: f.hint });
  }
  remember(); // otherwise a Dataview refresh would close the form that was just opened
  const message = form.createDiv({ cls: 'book-detail__message' });
  const actions = form.createDiv({ cls: 'book-detail__actions' });
  const save = actions.createEl('button', {
    cls: 'mod-cta',
    text: t('form.save'),
    attr: { type: 'submit' },
  });
  const cancel = actions.createEl('button', { text: t('form.cancel'), attr: { type: 'button' } });
  const yaml = actions.createEl('button', {
    cls: 'book-detail__edit',
    text: t('form.openYaml'),
    attr: { type: 'button' },
  });

  const close = () => {
    state.draft = null;
    form.remove();
    root.removeClass('is-editing');
  };
  cancel.addEventListener('click', close);
  yaml.addEventListener('click', () => {
    let leaf = null;
    app.workspace.iterateAllLeaves((l) => {
      if (
        !leaf &&
        l.view &&
        l.view.file &&
        l.view.file.path === page.file.path &&
        l.view.containerEl.contains(root)
      ) {
        leaf = l;
      }
    });
    close();
    if (leaf) {
      leaf.setViewState({
        type: 'markdown',
        state: { file: page.file.path, mode: 'source', source: true },
        active: true,
      });
    }
  });
  // Esc saves and closes; if a field is invalid the form stays open. The form takes focus itself,
  // otherwise Esc would never reach it.
  form.setAttr('tabindex', '-1');
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (!save.disabled) form.requestSubmit();
  });
  requestAnimationFrame(() => {
    if (!draft || document.activeElement === document.body) form.focus({ preventScroll: true });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (save.disabled) return;
    const v = (k) => inputs[k].value.trim();
    if (!v('title')) return message.setText(t('validation.title'));
    if (v('started') && v('finished') && v('finished') < v('started')) {
      return message.setText(t('validation.dates'));
    }
    for (const k of ['pages', 'publication_year', 'series_index', 'queue']) {
      if (v(k) && !(Number.isInteger(Number(v(k))) && Number(v(k)) > 0)) {
        return message.setText(t('validation.integers'));
      }
    }
    if (
      v('cover') &&
      !app.metadataCache.getFirstLinkpathDest(
        v('cover').includes('/') ? v('cover') : COVERS + v('cover'),
        page.file.path,
      )
    ) {
      return message.setText(t('validation.cover'));
    }
    const before = app.metadataCache.getFileCache(noteFile)?.frontmatter || {};
    if (FIELDS.every((f) => v(f.key) === readField(f, before).trim())) return close();
    save.disabled = true;
    try {
      await app.fileManager.processFrontMatter(noteFile, (data) => {
        for (const f of FIELDS) {
          const value = v(f.key);
          if (value === readField(f, before).trim()) continue;
          const parsed = value === '' ? null : f.write ? f.write(value) : value;
          if (parsed === null || (Array.isArray(parsed) && !parsed.length)) delete data[f.key];
          else data[f.key] = parsed;
        }
      });
      close();
      message.setText('');
    } catch (err) {
      save.disabled = false;
      message.setText(saveFailed(err));
    }
  });
};

edit.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!root.querySelector('.book-detail__form')) showForm();
});
const pending = state.draft;
if (pending && pending.path === page.file.path) showForm(pending.values);
