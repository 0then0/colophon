// Single source of the Library base. build-localized.mjs calls library(t) once per language,
// where t(key) returns the label of that language. Values such as "planned" are stable keys and
// are never translated; only names and labels are.

const COLUMNS = ['formula.cover_image', 'formula.book', 'author'];
const CATEGORY_VIEWS = [
  ['fiction', true],
  ['non-fiction', true],
  ['philosophy', true],
  ['it', true],
  ['fantasy', false],
  ['science-fiction', false],
  ['classics', false],
  ['detective', false],
  ['psychology', false],
  ['productivity', false],
  ['business', false],
  ['science', false],
  ['health', false],
  ['history', false],
  ['biography', false],
];

// Expression strings are written in double quotes; the generator checks labels for quotes.
const labelFormula = (property, group, keys, t) =>
  keys.reduceRight((rest, key) => `if(${property} == "${key}", "${t(`${group}.${key}`)}", ${rest})`, `${property}`);

export const library = (t) => {
  const table = (nameKey, extra) => ({ type: 'table', name: t(nameKey), ...extra, rowHeight: 'tall' });
  const categoryView = ([key, withFormat]) =>
    table(`category.${key}`, {
      filters: { and: [`category.contains("${key}")`] },
      order: [
        ...COLUMNS,
        'formula.status_label',
        'rating',
        ...(withFormat ? ['formula.format_label'] : []),
        'finished',
      ],
      sort: [{ property: 'finished', direction: 'DESC' }],
    });

  return {
    filters: { and: ['type == "book"'] },
    formulas: {
      book: 'file.asLink(if(note.title, note.title, file.basename))',
      cover_image: 'if(note.cover, image(note.cover), "")',
      status_label: labelFormula('note.status', 'status', ['planned', 'in_progress', 'finished', 'abandoned'], t),
      format_label: labelFormula('note.format', 'format', ['audiobook', 'ebook', 'hardcover', 'paperback'], t),
    },
    properties: {
      'formula.book': { displayName: t('base.prop.book') },
      'formula.status_label': { displayName: t('base.prop.status') },
      'formula.cover_image': { displayName: t('base.prop.cover') },
      'note.author': { displayName: t('base.prop.author') },
      'note.status': { displayName: t('base.prop.status') },
      'note.rating': { displayName: t('base.prop.rating') },
      'formula.format_label': { displayName: t('base.prop.format') },
      'note.started': { displayName: t('base.prop.started') },
      'note.finished': { displayName: t('base.prop.finished') },
      'note.pages': { displayName: t('base.prop.pages') },
      'note.date_added': { displayName: t('base.prop.dateAdded') },
      'note.series': { displayName: t('base.prop.series') },
      'note.series_index': { displayName: t('base.prop.seriesIndex') },
      'note.queue': { displayName: t('base.prop.queue') },
    },
    views: [
      {
        type: 'table',
        name: t('base.view.library'),
        order: [...COLUMNS, 'formula.status_label', 'rating', 'formula.format_label', 'started', 'finished', 'pages'],
        sort: [{ property: 'date_added', direction: 'DESC' }],
        rowHeight: 'tall',
        columnSize: {
          'formula.cover_image': 80,
          'formula.book': 300,
          'note.author': 180,
          'formula.status_label': 120,
          'note.rating': 70,
          'formula.format_label': 170,
          'note.started': 120,
          'note.finished': 120,
          'note.pages': 70,
        },
      },
      table('base.view.queue', {
        filters: { and: ['queue >= 1'] },
        order: ['queue', ...COLUMNS.slice(0, 2), 'author', 'formula.format_label', 'pages'],
        sort: [{ property: 'queue', direction: 'ASC' }],
      }),
      {
        type: 'cards',
        name: t('base.view.series'),
        filters: { and: ['series != null'] },
        groupBy: { property: 'series', direction: 'ASC' },
        order: ['formula.book', 'series_index', 'formula.status_label', 'rating'],
        sort: [{ property: 'series_index', direction: 'ASC' }],
        image: 'note.cover',
        imageFit: 'contain',
        imageAspectRatio: 1.5,
        cardSize: 190,
      },
      table('base.view.reading', {
        filters: { and: ['status == "in_progress"'] },
        order: [...COLUMNS, 'formula.format_label', 'started', 'pages'],
        sort: [{ property: 'started', direction: 'DESC' }],
      }),
      table('base.view.planned', {
        filters: { and: ['status == "planned"'] },
        order: [...COLUMNS, 'pages', 'date_added'],
        sort: [{ property: 'date_added', direction: 'DESC' }],
      }),
      table('base.view.finished', {
        filters: { and: ['status == "finished"'] },
        order: [...COLUMNS, 'rating', 'formula.format_label', 'started', 'finished', 'pages'],
        sort: [{ property: 'finished', direction: 'DESC' }],
      }),
      table('base.view.abandoned', {
        filters: { and: ['status == "abandoned"'] },
        order: [...COLUMNS, 'formula.format_label', 'started', 'pages'],
        sort: [{ property: 'started', direction: 'DESC' }],
      }),
      table('base.view.topRated', {
        filters: { and: ['rating >= 4.5'] },
        order: [...COLUMNS, 'rating', 'formula.format_label', 'finished'],
        sort: [
          { property: 'rating', direction: 'DESC' },
          { property: 'finished', direction: 'DESC' },
        ],
      }),
      table('base.view.audiobooks', {
        filters: { and: ['format == "audiobook"'] },
        order: [...COLUMNS, 'formula.status_label', 'rating', 'started', 'finished'],
        sort: [{ property: 'date_added', direction: 'DESC' }],
      }),
      ...CATEGORY_VIEWS.map(categoryView),
      {
        type: 'cards',
        name: t('base.view.cards'),
        order: ['formula.book', 'author', 'rating', 'formula.status_label'],
        sort: [{ property: 'started', direction: 'DESC' }],
        image: 'note.cover',
        imageFit: 'contain',
        imageAspectRatio: 1.5,
        cardSize: 180,
      },
    ],
  };
};
