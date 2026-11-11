// Single source of the Summaries base: notes with `type: summary` (a summary of a book you have not
// read in full). They are not books, so the Library base, the statistics and the suggestions never see
// them. build-localized.mjs calls summaries(t, catalog) once per language.

// Topics are the categories that describe a subject (config.json: "topic": true); the labels are
// checked for quotes and backslashes like the Library labels.
const topicsFormula = (catalog) => {
  const topics = catalog.categories.filter((c) => c.topic);
  const labelled = topics.reduceRight(
    (rest, c) => `if(value == "${c.key}", "${c.label}", ${rest})`,
    'value',
  );
  return `list(note.category).filter(${topics
    .map((c) => `value == "${c.key}"`)
    .join(' || ') || 'false'}).map(${labelled}).join(", ")`;
};

export const summaries = (t, catalog) => ({
  filters: { and: ['type == "summary"'] },
  formulas: {
    summary: 'file.asLink(if(note.title, note.title, file.basename))',
    topics: topicsFormula(catalog),
  },
  properties: {
    'formula.summary': { displayName: t('base.prop.summary') },
    'note.author': { displayName: t('base.prop.author') },
    'formula.topics': { displayName: t('base.prop.topics') },
  },
  views: [
    {
      type: 'table',
      name: t('base.view.summaries'),
      order: ['formula.summary', 'author', 'formula.topics'],
      sort: [{ property: 'formula.summary', direction: 'ASC' }],
      columnSize: { 'formula.summary': 360, 'note.author': 220, 'formula.topics': 220 },
    },
    {
      type: 'table',
      name: t('base.view.byTopic'),
      groupBy: { property: 'formula.topics', direction: 'ASC' },
      order: ['formula.summary', 'author'],
      sort: [{ property: 'formula.summary', direction: 'ASC' }],
    },
  ],
});
