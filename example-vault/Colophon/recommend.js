// Colophon recommendations: the "What to read next" logic, free of Dataview and the DOM.
//
// A function body like model.js: no arguments, returns the API object. lib.js loads it, and the
// tests run it with `new Function(source)()`.
//
// It works on plain records, one per book:
//   { id, title, authors[], categories[], kind, rating|null, series|null, seriesIndex|null,
//     queue|null, pages|null, formats[], dateAdded ("YYYY-MM-DD")|null, snoozedUntil|null, links[] }
// where kind is the kind of the status (planned, in_progress, finished, abandoned) and links are
// the ids of the notes this note links to.

// An abandoned book without a rating counts as this rating, so its author and topic lose points.
const ABANDONED_AS = 2;
// Rotation: the monthly pick is drawn from this many next-best candidates.
const ROTATION_POOL = 12;

const average = (values) => values.reduce((sum, x) => sum + x, 0) / values.length;
const byTitle = (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

// The book filters of the list. Fiction is the category key "fiction"; everything else is
// non-fiction. A filter is offered only when some candidate matches it.
const FILTERS = {
  all: () => true,
  fiction: (book) => book.categories.includes('fiction'),
  nonfiction: (book) => !book.categories.includes('fiction'),
  short: (book) => typeof book.pages === 'number' && book.pages <= 300,
  audio: (book) => book.formats.includes('audiobook'),
};

// Scores the planned books and finds the series worth continuing.
//   books   the records
//   today   "YYYY-MM-DD"
//   isTopic (categoryKey) => true when the category counts as a topic
// Returns { globalAvg, seriesPicks, candidates }. Reasons are { code, ...params } objects for the
// view to turn into text: link, author, category, waited.
const analyze = (books, today, isTopic) => {
  const finishedRated = books.filter((b) => b.kind === 'finished' && b.rating);
  const abandoned = books.filter((b) => b.kind === 'abandoned');
  const globalAvg = finishedRated.length ? average(finishedRated.map((b) => b.rating)) : 0;

  const groupRatings = (pick) => {
    const groups = {};
    const add = (key, value, real) => {
      const g = (groups[key] = groups[key] || { all: [], rated: [] });
      g.all.push(value);
      if (real) g.rated.push(value);
    };
    for (const b of finishedRated) for (const key of pick(b)) add(key, b.rating, true);
    for (const b of abandoned) for (const key of pick(b)) add(key, b.rating || ABANDONED_AS, false);
    return groups;
  };
  // While there are few books, an average is pulled towards the overall one (as if k books with the
  // overall average were added), so a single high rating counts for less than several of them.
  const smoothed = (values, k) =>
    (values.reduce((s, x) => s + x, 0) + k * globalAvg) / (values.length + k);
  const byAuthor = groupRatings((b) => b.authors);
  const byCategory = groupRatings((b) => b.categories.filter(isTopic));

  const seriesBooks = {};
  for (const b of books)
    if (b.series) (seriesBooks[b.series] = seriesBooks[b.series] || []).push(b);
  const position = (b) => (typeof b.seriesIndex === 'number' ? b.seriesIndex : Infinity);
  const seriesDropped = (b) => (seriesBooks[b.series] || []).some((x) => x.kind === 'abandoned');
  const blockedInSeries = (b) =>
    (seriesBooks[b.series] || []).some(
      (o) =>
        o !== b &&
        (o.kind === 'planned' || o.kind === 'in_progress') &&
        // A prequel (number 0) can be read at any time and does not hold back the main books.
        o.seriesIndex !== 0 &&
        position(o) < position(b),
    );
  const seriesRating = (b) => {
    const ratings = (seriesBooks[b.series] || [])
      .filter((x) => x.kind === 'finished' && x.rating)
      .map((x) => x.rating);
    return ratings.length
      ? { value: smoothed(ratings, 1), avg: average(ratings), count: ratings.length }
      : null;
  };
  // Not in the queue, not snoozed, not a series with a dropped book, and earlier books of its series are done.
  const available = (b) =>
    b.kind === 'planned' &&
    b.queue == null &&
    !(b.snoozedUntil && b.snoozedUntil > today) &&
    !(b.series && (seriesDropped(b) || blockedInSeries(b)));

  // A planned book linked, in either direction, with a finished book rated 4 or more.
  const byId = new Map(books.map((b) => [b.id, b]));
  const linked = new Map();
  const addLink = (planned, read) => {
    if (!linked.has(planned.id)) linked.set(planned.id, new Map());
    linked.get(planned.id).set(read.id, read);
  };
  for (const b of books) {
    for (const id of b.links) {
      const other = byId.get(id);
      if (!other || other === b) continue;
      if (b.kind === 'planned' && other.kind === 'finished' && other.rating >= 4) addLink(b, other);
      if (other.kind === 'planned' && b.kind === 'finished' && b.rating >= 4) addLink(other, b);
    }
  }

  // Continuing a series is shown on its own, when the books already read were liked.
  const seriesPicks = books
    .filter((b) => b.series && available(b))
    .map((book) => ({ book, rating: seriesRating(book) }))
    .filter((x) => x.rating && x.rating.value >= globalAvg - 0.25)
    .sort((a, b) => b.rating.value - a.rating.value || byTitle(a.book, b.book));
  const inSeriesPicks = new Set(seriesPicks.map((x) => x.book.id));

  const candidates = books
    .filter((b) => available(b) && !inSeriesPicks.has(b.id))
    .map((book) => {
      let score = 0;
      const reasons = [];
      let author = null;
      for (const name of book.authors) {
        const g = byAuthor[name];
        if (!g) continue;
        const delta = smoothed(g.all, 2) - globalAvg;
        if (!author || delta > author.delta) author = { name, g, delta };
      }
      if (author) {
        score += author.delta * 8;
        if (author.delta > 0 && author.g.rated.length) {
          reasons.push({
            code: 'author',
            author: author.name,
            avg: average(author.g.rated),
            count: author.g.rated.length,
          });
        }
      }
      const categories = book.categories.filter((c) => byCategory[c] && isTopic(c));
      if (categories.length) {
        const deltas = categories.map((key) => ({
          key,
          g: byCategory[key],
          delta: smoothed(byCategory[key].all, 5) - globalAvg,
        }));
        score += average(deltas.map((x) => x.delta)) * 4;
        const best = deltas
          .filter((x) => x.delta > 0 && x.g.rated.length >= 5)
          .sort((a, b) => b.delta - a.delta)[0];
        if (best)
          reasons.push({ code: 'category', category: best.key, avg: average(best.g.rated) });
      }
      const links = [...(linked.get(book.id)?.values() || [])].sort((a, b) => b.rating - a.rating);
      if (links.length) {
        score += links.slice(0, 2).reduce((s, x) => s + 1.5 + (x.rating - globalAvg), 0);
        reasons.unshift({
          code: 'link',
          title: links[0].title,
          rating: links[0].rating,
          more: links.length - 1,
        });
      }
      // A small bonus for books that have waited a long time.
      const waited = book.dateAdded
        ? (Date.parse(today) - Date.parse(book.dateAdded)) / (365.25 * 864e5)
        : 0;
      if (waited >= 1) score += Math.min(waited, 5) * 0.1;
      if (waited >= 3) reasons.push({ code: 'waited', years: Math.floor(waited) });
      return { book, score, reasons };
    })
    .filter((x) => x.score > 0 && x.reasons.length);

  return { globalAvg, seriesPicks, candidates };
};

// A fixed pseudo-random order for a month: the list changes on the first of the month, not at every opening.
const monthHash = (monthKey, id) => {
  let h = 2166136261;
  for (const ch of monthKey + id) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
};

// Takes up to n books from the candidates, best first, with at most one book per author and two per
// topic (counting the books in `used`). The last `rotating` places go to the monthly pick.
const pickFrom = (pool, n, rotating, used, monthKey, isTopic) => {
  const authors = new Set(used.flatMap((x) => x.book.authors));
  const topics = {};
  const topicsOf = (x) => x.book.categories.filter(isTopic);
  for (const x of used) for (const c of topicsOf(x)) topics[c] = (topics[c] || 0) + 1;
  const fits = (x) =>
    !x.book.authors.some((a) => authors.has(a)) && !topicsOf(x).some((c) => (topics[c] || 0) >= 2);
  const take = (x) => {
    x.book.authors.forEach((a) => authors.add(a));
    topicsOf(x).forEach((c) => (topics[c] = (topics[c] || 0) + 1));
  };
  const sorted = [...pool].sort((a, b) => b.score - a.score || byTitle(a.book, b.book));
  const out = [];
  for (const x of sorted) {
    if (out.length >= n - rotating) break;
    if (fits(x)) {
      out.push(x);
      take(x);
    }
  }
  for (let i = 0; i < rotating; i++) {
    const rest = sorted
      .filter((x) => !out.some((o) => o.book === x.book) && fits(x))
      .slice(0, ROTATION_POOL)
      .sort((a, b) => monthHash(monthKey, a.book.id) - monthHash(monthKey, b.book.id));
    if (!rest.length) break;
    const x = { ...rest[0], monthly: true };
    out.push(x);
    take(x);
  }
  return out;
};

// The six books shown for a filter. "all" gives three fiction and three non-fiction books, one of
// each as the monthly pick; a filter gives six books, two of them monthly picks.
const choose = (candidates, filter, monthKey, isTopic) => {
  if (filter !== 'all') {
    return pickFrom(
      candidates.filter((x) => FILTERS[filter](x.book)),
      6,
      2,
      [],
      monthKey,
      isTopic,
    );
  }
  const first = pickFrom(
    candidates.filter((x) => FILTERS.fiction(x.book)),
    3,
    1,
    [],
    monthKey,
    isTopic,
  );
  const second = pickFrom(
    candidates.filter((x) => FILTERS.nonfiction(x.book)),
    3,
    1,
    first,
    monthKey,
    isTopic,
  );
  let picks = [...first, ...second];
  if (picks.length < 6) {
    const rest = candidates.filter((x) => !picks.some((o) => o.book === x.book));
    picks = [...picks, ...pickFrom(rest, 6 - picks.length, 0, picks, monthKey, isTopic)];
  }
  return picks;
};

return { FILTERS, analyze, choose, pickFrom, monthHash };
