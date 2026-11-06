import { cleanDate } from './import-library.mjs';

// StoryGraph separates sessions with commas and joins their dates with a hyphen. Partial dates
// also appear in exports, but Colophon needs a day. Bare dates in Dates Read are finish dates.
const DATE_PART = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{4}(?:/\d{1,2}){0,2})`;
const RANGE = new RegExp(`^(${DATE_PART})?\\s*-\\s*(${DATE_PART})?$`);
const FULL_DATE = /^(?:\d{4}\/\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})$/;
const preciseDate = (value) => (value && FULL_DATE.test(value) ? cleanDate(value) : null);
const partialDate = (value) => {
  const parts = /^(\d{4})(?:\/(\d{1,2}))?$/.exec(value ?? '');
  if (!parts) return null;
  const [, year, month] = parts;
  if (!month) return year;
  return cleanDate(`${year}/${month}/1`)?.slice(0, 7) ?? null;
};

export const parseStoryGraphReadings = (row, kind) => {
  const warnings = [];
  const completed = [];
  const openStarts = [];
  const partialFinishes = [];
  const datesRead = (row['Dates Read'] ?? '').trim();
  for (const session of datesRead
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const range = RANGE.exec(session);
    const start = range?.[1];
    const end = range ? range[2] : session;
    const startedOn = preciseDate(start);
    const finishedOn = preciseDate(end);
    const prefix = partialDate(end);
    const label = `Dates Read ${JSON.stringify(session)}`;
    if (start && !startedOn) warnings.push(`${label}: start without an unambiguous day omitted`);
    if (finishedOn) {
      if (startedOn && startedOn > finishedOn) {
        warnings.push(`${label}: interval ends before it starts and was omitted`);
      } else {
        completed.push({ startedOn, finishedOn });
      }
    } else if (startedOn && !end && kind === 'in_progress') {
      openStarts.push(startedOn);
    } else if (prefix) {
      partialFinishes.push({ prefix, label });
    } else {
      warnings.push(`${label}: session without an unambiguous finish day omitted`);
    }
  }
  completed.sort((a, b) => a.finishedOn.localeCompare(b.finishedOn));

  const rawLast = (row['Last Date Read'] ?? '').trim();
  const last = preciseDate(rawLast);
  if (rawLast && !last) {
    warnings.push(`Last Date Read ${JSON.stringify(rawLast)}: no unambiguous finish day, omitted`);
  }

  // An abandoned attempt can have dates without being a completed reading. Only keep
  // intervals within the completed history corroborated by Last Date Read.
  if (kind === 'abandoned') {
    const unconfirmed = completed.findIndex(({ finishedOn }) => !last || finishedOn > last);
    if (unconfirmed >= 0) {
      completed.splice(unconfirmed);
      warnings.push(
        'Dates Read intervals without a corresponding confirmed completion were omitted for the abandoned book',
      );
    }
  }

  const latest = completed.at(-1)?.finishedOn;
  const matchingPartial = last
    ? partialFinishes.findIndex(({ prefix }) => last.startsWith(`${prefix}-`))
    : -1;
  const laterPartial = (day) =>
    kind !== 'abandoned' && partialFinishes.some(({ prefix }) => prefix > day);
  if (last) {
    if (laterPartial(last)) {
      warnings.push(`Last Date Read (${last}) predates a Dates Read finish and was omitted`);
    } else if (last !== latest) {
      const canFillMissing =
        matchingPartial >= 0 || (!latest && !partialFinishes.length) || kind === 'abandoned';
      if (canFillMissing && (!latest || last > latest)) {
        completed.push({ startedOn: null, finishedOn: last });
        if (matchingPartial >= 0) partialFinishes.splice(matchingPartial, 1);
      } else {
        warnings.push(`Last Date Read (${last}) disagrees with Dates Read and was omitted`);
      }
    }
  }
  for (const { label } of partialFinishes) {
    warnings.push(`${label}: session without an unambiguous finish day omitted`);
  }

  const rawCount = (row['Read Count'] ?? '').trim();
  const count = Number(rawCount);
  if (rawCount && (!/^\d+$/.test(rawCount) || !Number.isSafeInteger(count))) {
    warnings.push(`Read Count ${JSON.stringify(rawCount)} is not a valid count`);
  } else if (rawCount && count > completed.length) {
    warnings.push(
      `Read Count is ${count}, but only ${completed.length} reading(s) have confirmed finish dates. Undated readings were omitted`,
    );
  } else if (rawCount && count < completed.length) {
    warnings.push(
      `Read Count is ${count}, but ${completed.length} dated readings were found. The dated readings were kept`,
    );
  }
  if (new Set(completed.map(({ finishedOn }) => finishedOn)).size < completed.length) {
    warnings.push(
      'Multiple readings ended on the same day. Colophon statistics count that day once',
    );
  }

  let startedOn = null;
  let finishedOn = null;
  if (kind === 'finished') {
    const current = completed.at(-1);
    if (current && !laterPartial(current.finishedOn)) {
      ({ startedOn, finishedOn } = completed.pop());
    } else warnings.push('Read status has no confirmed finish date');
  } else if (openStarts.length) {
    const previousFinish = completed.at(-1)?.finishedOn;
    if (openStarts.length === 1 && (!previousFinish || openStarts[0] >= previousFinish)) {
      startedOn = openStarts[0];
    } else {
      warnings.push(
        'Dates Read does not identify a single current start after the last completed reading',
      );
    }
  }

  return { startedOn, finishedOn, history: completed, warnings };
};
