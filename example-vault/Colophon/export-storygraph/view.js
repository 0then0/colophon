// Colophon export page. Use it in a note: await dv.view("Colophon/export-storygraph")
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
const { app, t, joinList, collator, kindOf, books, readHistory } = colophon;
await colophon.injectStyle('colophon-export-style', 'export-storygraph/view.css');

for (const stale of dv.container.querySelectorAll(':scope > .colophon-export')) stale.remove();
const root = dv.container.createDiv({ cls: 'colophon-export' });
root.addEventListener('mousedown', (event) => event.stopPropagation());
colophon.showProblems(root);
root.createEl('p', { text: t('export.intro') });
root.createEl('p', { cls: 'colophon-export-muted', text: t('export.retained') });
const status = root.createEl('p', { text: t('export.loading'), attr: { role: 'status' } });

const core = await colophon.loadStoryGraph();
const { createPlanner, csv } = new Function(
  await app.vault.adapter.read(`${libFile.parent.path}/export-storygraph/engine.js`),
)();
const planBook = createPlanner({ kindOf, ...core });
const entries = [];
for (const page of books().array()) {
  const { path, name } = page.file;
  const file = app.vault.getAbstractFileByPath(path);
  // Use the original Properties, before Dataview interprets strings as dates, links, etc.
  const props = file ? (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) : {};
  const history = await readHistory(page).catch(() => null);
  if (!dv.container.contains(root)) return;
  entries.push(planBook({ path, name, props, history }));
}
if (!dv.container.contains(root)) return;
entries.sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.path, b.path));
const rows = entries.filter((entry) => entry.cells);
const skipped = entries.filter((entry) => !entry.cells);

status.setText(t('export.counts', { included: rows.length, skipped: skipped.length }));
const download = root.createEl('button', {
  cls: 'mod-cta',
  text: t('export.download'),
  attr: { type: 'button' },
});
download.disabled = rows.length === 0;
const feedback = root.createDiv({ cls: 'colophon-export-error', attr: { role: 'alert' } });
download.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  feedback.empty();
  try {
    // The click uses the very same rows as the preview, with no second read of the vault.
    const browser = root.ownerDocument.defaultView;
    const data = new browser.Blob([csv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = browser.URL.createObjectURL(data);
    const link = root.createEl('a', {
      attr: { href: url, download: 'colophon-storygraph.csv', hidden: '' },
    });
    link.click();
    link.remove();
    browser.setTimeout(() => browser.URL.revokeObjectURL(url), 30000);
  } catch (error) {
    feedback.setText(t('export.downloadFailed', { message: error.message }));
  }
});

const fields = [
  ['Author', t('base.prop.author')],
  ['Additional Authors', t('export.additionalAuthors')],
  ['ISBN', 'ISBN-10'],
  ['ISBN13', 'ISBN-13'],
  ['Exclusive Shelf', t('meta.status')],
  ['My Rating', t('meta.rating')],
  ['Date Added', t('base.prop.dateAdded')],
  ['Date Read', t('meta.finished')],
  ['Read Count', t('export.readCount')],
];

const drawEntry = (list, entry) => {
  const item = list.createEl('li', { attr: { tabindex: '-1' } });
  item.createEl('strong', { cls: 'colophon-export-value', text: entry.title });
  item.createDiv({ cls: 'colophon-export-muted', text: entry.path });
  if (entry.cells) {
    const data = item.createEl('dl');
    for (const [field, label] of fields) {
      const group = data.createDiv();
      group.createEl('dt', { text: label });
      group.createEl('dd', { cls: 'colophon-export-value', text: entry.cells[field] || '\u2013' });
    }
  }
  if (entry.messages.length) {
    const messages = item.createEl('ul', { cls: 'colophon-export-warnings' });
    for (const { key, params } of entry.messages) {
      const values = Object.fromEntries(
        Object.entries(params ?? {}).map(([name, value]) => [
          name,
          Array.isArray(value) ? joinList(value) : value,
        ]),
      );
      messages.createEl('li', { text: t(key, values) });
    }
  }
};

const PAGE = 25;
const showList = (heading, list) => {
  if (!list.length) return;
  root.createEl('h2', { text: heading });
  const items = root.createEl('ul', { cls: 'colophon-export-books', attr: { role: 'list' } });
  const more = root.createDiv({ cls: 'colophon-export-more' });
  const count = more.createSpan({ attr: { role: 'status' } });
  const button = more.createEl('button', { text: t('import.showMore'), attr: { type: 'button' } });
  let shown = 0;
  const showPage = () => {
    const start = shown;
    const next = Math.min(shown + PAGE, list.length);
    for (const entry of list.slice(start, next)) drawEntry(items, entry);
    shown = next;
    count.setText(t('import.shown', { shown, total: list.length }));
    more.hidden = shown === list.length;
    return items.children[start];
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    showPage()?.focus();
  });
  showPage();
};
showList(t('export.included'), rows);
showList(t('export.skipped'), skipped);
