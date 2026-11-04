// Single source of the Library base. build-localized.mjs calls library(t, catalog) once per
// language, where t(key) returns the label of that language and catalog holds the statuses, formats
// and categories of config.json with labels in that language (see Colophon/model.js). Values such
// as "planned" are stable keys and are never translated; only names and labels are.

const COLUMNS = ['formula.cover_image', 'formula.book', 'author'];
// Categories that come first in the generated Library and show the format column. Other
// categories, including your own, follow in the order of config.json.
const FEATURED_CATEGORIES = ['fiction', 'non-fiction', 'philosophy', 'it'];

// Expression strings are written in double quotes; labels are checked for quotes and backslashes.
const labelFormula = (property, items) =>
  items.reduceRight((rest, item) => `if(${property} == "${item.key}", "${item.label}", ${rest})`, `${property}`);

// Books whose status has the given kind. One status gives a plain filter, several give "or".
const kindFilter = (catalog, kind) => {
  const expressions = catalog.keysOfKind(kind).map((key) => `status == "${key}"`);
  return expressions.length === 1 ? { and: expressions } : { or: expressions };
};

export const library = (t, catalog) => {
  const table = (name, extra) => ({ type: 'table', name, ...extra, rowHeight: 'tall' });
  const categoryView = ({ key, label }) =>
    table(label, {
      filters: { and: [`category.contains("${key}")`] },
      order: [
        ...COLUMNS,
        'formula.status_label',
        'rating',
        ...(FEATURED_CATEGORIES.includes(key) ? ['formula.format_label'] : []),
        'finished',
      ],
      sort: [{ property: 'finished', direction: 'DESC' }],
    });
  const featured = FEATURED_CATEGORIES.map((key) => catalog.categories.find((c) => c.key === key)).filter(Boolean);
  const categories = [...featured, ...catalog.categories.filter((c) => !featured.includes(c))];

  return {
    filters: { and: ['type == "book"'] },
    formulas: {
      book: 'file.asLink(if(note.title, note.title, file.basename))',
      cover_image: 'if(note.cover, image(note.cover), "")',
      status_label: labelFormula('note.status', catalog.statuses),
      format_label: labelFormula('note.format', catalog.formats),
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
      table(t('base.view.queue'), {
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
      table(t('base.view.reading'), {
        filters: kindFilter(catalog, 'in_progress'),
        order: [...COLUMNS, 'formula.format_label', 'started', 'pages'],
        sort: [{ property: 'started', direction: 'DESC' }],
      }),
      table(t('base.view.planned'), {
        filters: kindFilter(catalog, 'planned'),
        order: [...COLUMNS, 'pages', 'date_added'],
        sort: [{ property: 'date_added', direction: 'DESC' }],
      }),
      table(t('base.view.finished'), {
        filters: kindFilter(catalog, 'finished'),
        order: [...COLUMNS, 'rating', 'formula.format_label', 'started', 'finished', 'pages'],
        sort: [{ property: 'finished', direction: 'DESC' }],
      }),
      table(t('base.view.abandoned'), {
        filters: kindFilter(catalog, 'abandoned'),
        order: [...COLUMNS, 'formula.format_label', 'started', 'pages'],
        sort: [{ property: 'started', direction: 'DESC' }],
      }),
      table(t('base.view.topRated'), {
        filters: { and: ['rating >= 4.5'] },
        order: [...COLUMNS, 'rating', 'formula.format_label', 'finished'],
        sort: [
          { property: 'rating', direction: 'DESC' },
          { property: 'finished', direction: 'DESC' },
        ],
      }),
      // The view needs the built-in "audiobook" format; without it there is nothing to filter.
      ...(catalog.has('format', 'audiobook')
        ? [
            table(t('base.view.audiobooks'), {
              filters: { and: ['format == "audiobook"'] },
              order: [...COLUMNS, 'formula.status_label', 'rating', 'started', 'finished'],
              sort: [{ property: 'date_added', direction: 'DESC' }],
            }),
          ]
        : []),
      ...categories.map(categoryView),
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
