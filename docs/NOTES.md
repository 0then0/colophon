# Book notes

A book is one Markdown note. Colophon finds books by the property `type: book`, wherever the notes are stored, and
reads and writes ordinary Properties.

## Properties

```yaml
---
type: book
title: 'Walden'
subtitle: 'Life in the Woods'
author:
  - Henry David Thoreau
translator: []
status: finished # planned | in_progress | finished | abandoned, or your own (see Settings)
format: paperback # audiobook | ebook | hardcover | paperback, or your own
category: # fiction, non-fiction, philosophy, it, fantasy, science-fiction, classics,
  - philosophy # detective, psychology, productivity, business, science, health, history, biography, or your own
  - non-fiction
series: Sherlock Holmes # optional; series_index orders the books of a series
series_index: 1 # 0 is a prequel: it comes first and does not hold back the other books
queue: 1 # optional; only for planned books, lower is read sooner
snoozed_until: 2027-02-04 # optional; set by "Not now", the book is not suggested until that date
rating: 4.5 # 0.5 to 5 in steps of 0.5; leave empty for no rating
pages: 352
publication_year: 1854
started: 2026-02-20
finished: 2026-03-15
date_added: 2024-07-30
cover: '[[Books/covers/walden.png]]'
reread_count: 1 # written by "Read again"
cssclasses:
  - book-page # hides the inline title and Properties on the book page (not in Source mode)
---
```

`status`, `format` and `category` hold stable keys in every language, the built-in ones in English. Only their labels are
translated, so notes and queries keep working when you change the language. The allowed values are the lists from
[Settings](SETTINGS.md); values that are not in a list are shown as they are.

## Reading history

"Read again" adds a section like this to the note. The statistics read it, so keep the heading and the line format:

```markdown
## Reading history

- 2024-08-02 → 2024-08-30
  - rating: 4
```

## Reading time

The book page shows how long a read took, by the same rule as the "Reading time" block of the statistics (one shared
function, `readingDays` in `Colophon/model.js`, whole days from `started` to `finished`):

- A finished book with both dates shows **Reading time**: "23 days". A read that began and ended on the same day shows
  "Same day", not "0 days".
- A missing date or a finish date before the start date shows nothing. The statistics leave out zero and negative
  intervals from the averages and say how many books they skipped; same-day reads are the ones you see in the header
  but not in the averages.
- A book in progress shows **Reading so far**: the days from `started` to today, or "Started today".
- After "Read again" the header describes the current read only. Earlier reads stay in the Reading history section.

## The book template

The template writes `type: "{{date:[book]}}"` on purpose. The Templates plugin turns it into `book` in the new note, but
the template file itself does not match `type == "book"`, so it does not appear in your library.

## Summaries

Some notes are a summary of the ideas of a book you do not plan to read in full. They are not books, so keep them out of
the library, the statistics and the suggestions: give them `type: summary` instead of `type: book`.

```yaml
---
type: summary
title: 'The Prince'
author:
  - Niccolò Machiavelli
category:
  - philosophy
---
```

`Summaries.base` lists them in a table and grouped by topic (the categories that are topics, see
[Settings](SETTINGS.md)). Summaries can live in the library folder, because only notes with `type: book` are counted;
a quote of the day is also taken from book notes only. The `Summary` template writes `type: "{{date:[summary]}}"` for the
same reason as the book template. The installer adds the template and the base with `--summaries`; for a manual
installation copy `Summary.<code>.md` and `Summaries.<code>.base` from `Colophon/localized/`.
