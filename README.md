<p align="center">
  <img src="assets/icon.svg" alt="Colophon icon: an open book with a bookmark" width="96" height="96">
</p>

<h1 align="center">Colophon</h1>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/github/license/0then0/colophon"></a>
  <a href="https://github.com/0then0/colophon/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0then0/colophon/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/0then0/colophon/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/0then0/colophon?include_prereleases"></a>
  <a href="#languages"><img alt="Languages: 7" src="https://img.shields.io/badge/languages-7-blue"></a>
</p>

Colophon is a book library and reading journal for [Obsidian](https://obsidian.md). One note per book, plain
Markdown with Properties, and a few scripts that turn those notes into a book page, a library, a reading queue and
statistics. Your data stays in your notes. Without Colophon they are still ordinary notes.

Colophon is an independent project. It is not affiliated with Obsidian or endorsed by Obsidian.

## Screenshots

Screenshots use the example vault (public domain books, generated placeholder covers).

![Book page with the series panel open](docs/screenshots/book-page.png)

![Edit form](docs/screenshots/edit-form.png)

![Statistics, dark theme](docs/screenshots/statistics-dark.png)

They were taken in Obsidian 1.15.0 on macOS at twice the pixel density (the current interface). The interface language
here is English; every language and both themes were also checked at 1100 px and 375 px wide.

## What it does

- **Book page.** Cover, title, authors, series, format, category, dates and a rating in half-star steps. Status,
  rating and queue position change in place, and a form edits every property. Everything is written back to the note's
  Properties.
- **Author and series panels.** Click an author or a series to see their other books in your library.
- **Reading queue.** Mark a planned book with "Add to queue"; the queue is ordered and shows up in statistics and in the
  Library base.
- **Read again.** Starts a new read, keeps the previous dates in a "Reading history" section and counts each read in
  its own year in the statistics.
- **Reading time.** The book page shows how many days a read took, or how long a book has been in progress.
- **Statistics.** Books and pages per year and month, average rating, formats, genres, series progress, most-read
  authors, reading time, rereads, a quote from your own notes, and suggestions for what to read next based on your
  ratings. Every suggestion shows its reason. Every number is clickable and opens the list of its books under it (cards
  at the top, months, topics, and the bars of the detailed breakdowns).
- **What to read next.** Three fiction and three non-fiction books from your plans, at most one per author and two per
  topic. Averages of authors and topics are smoothed while there are few books; an abandoned book counts against its
  author and topic; a series you dropped is not suggested; a link in your notes to a book you rated 4 or more is a
  reason; a book that waited for years gets a small bonus. "Continue a series" is a block of its own. One place in each
  half rotates once a month ("Pick of the month"). Filters (all, fiction, non-fiction, up to 300 pages, audio) appear
  when a book matches. "Add to queue" puts a book at the end of the queue; "Not now" hides it for three months through
  the property `snoozed_until`. Delete the property to bring the book back.
- **Library base.** A Bases file with table and card views: all books, queue, series, reading, want to read, finished,
  abandoned, top rated, audiobooks and one view for each category.
- **Prequels.** Number 0 in a series marks a prequel. It is named in the series panel and the Series view, it sorts
  first, and it never holds back the main books in "Continue a series" and the suggestions.
- **Summaries.** Notes with `type: summary` (see [Summaries](#summaries)) keep ideas from books you do not read in full
  apart from the library and the statistics.
- **Seven interface languages**, chosen from the Obsidian language or from a setting.
- **A cover script** that shrinks oversized JPEG covers and keeps the originals.

## Requirements

- **Obsidian 1.9.10 or newer.** Bases became available to everyone in 1.9.10 ([official
  changelog](https://obsidian.md/changelog/2025-08-18-desktop-v1.9.10/)), and the Library base needs it. The
  scripts were run on Obsidian 1.15.0 on macOS; no older version has been tried, so 1.9.10 is the documented
  minimum, not a tested one.
- **[Dataview](https://github.com/blacksmithgu/obsidian-dataview)** with **Enable JavaScript Queries** turned on. Tried
  with the 0.5.70 release. Dataview's own manifest asks for Obsidian 0.13.11 or newer.
- The core **Templates** plugin, if you want to create books from the template.

Colophon has no runtime dependencies besides these. The scripts in `tools/` are for development only, except the
installer and the importer (`tools/user/`), which needs Node 20+ and is part of the release archive. The cover script needs Python 3.11+ and Pillow
(installed by `uv`, see below).

## Install

The installation never touches your `.obsidian` folder; you enable the two plugins yourself.

### One command

Download the release archive (`colophon-<version>.zip`) from the [releases
page](https://github.com/0then0/colophon/releases), unpack it and run the installer from the unpacked folder. It needs
[Node.js](https://nodejs.org) 20 or newer, nothing else and no `npm install`. Without `--apply` it only prints a plan:

```bash
node install.mjs "/path/to/your/vault"
node install.mjs "/path/to/your/vault" --apply --language en
```

It copies the `Colophon` folder, writes `Colophon/config.json` with your language and folders, and installs the book
template, `Library.base` and the statistics note in your language. It never overwrites a changed file without
`--force`, never deletes anything, is safe to run twice, and refuses a folder that is not a vault. Options and the
manual steps it leaves to you (enabling Dataview with JavaScript queries, the Templates folder) are in
[docs/INSTALL.md](docs/INSTALL.md), which is also inside the archive. Try it on a copy of your vault first.

### Manual installation

The same thing by hand, if you do not have Node:

1. Install Obsidian and the Dataview plugin (Settings, Community plugins). In Dataview's settings turn on **Enable
   JavaScript Queries**.
2. Copy the folder [`example-vault/Colophon`](example-vault/Colophon) into the root of your vault. Keep the folder name
   `Colophon`: the notes call `dv.view("Colophon/book")`, and Dataview resolves that path from the vault root.
3. Open `Colophon/config.json` and set your folders (see [Settings](#settings)). The defaults match the example vault.
4. Pick your language files in `Colophon/localized/` and copy them where you want them. Rename them as you copy:
   - `Book.<code>.md` to `Templates/Book.md`, and set **Settings, Core plugins, Templates, Template folder** to
     `Templates`.
   - `Library.<code>.base` to `Books/Library.base`.
   - `Statistics.<code>.md` to `Books/Statistics.md`.
5. Create a book: make a new note in your library folder, then run **Templates: Insert template** and choose `Book`.
   Fill in the title and the author, and set the status. The book page appears at the top of the note.
6. Open `Statistics`. Statistics are empty until a few books are finished.

To try it first, open [`example-vault`](example-vault) as a vault. Its `.obsidian` folder contains only two files:
`community-plugins.json` (lists Dataview) and `plugins/dataview/data.json` (turns on JavaScript queries). Plugin
files are not stored in the repository, so install Dataview from the Community plugins browser after Obsidian asks
whether you trust the vault and you turn community plugins on. Obsidian creates other files in `.obsidian` itself;
they are git-ignored.

### Settings

Settings live in one file, [`Colophon/config.json`](example-vault/Colophon/config.json):

```json
{
  "language": "auto",
  "paths": {
    "library": "Books/Library",
    "notes": "Books/Notes",
    "covers": "Books/covers"
  }
}
```

- `language`: `auto` follows the Obsidian interface language. Set a code from the [table below](#languages) such as
  `de` to force one language. An unknown code falls back to English.
- `paths.library`: the folder with book notes. Statistics look for quotes (Markdown blockquotes) in notes here.
- `paths.notes`: notes about a series. A note with the same `series` property as a book is linked from the series panel.
- `paths.covers`: where cover images live. The edit form suggests files from this folder.

#### Your own statuses, formats and categories

Three optional lists replace the built-in values. Without them everything works as before. Each item is either a key
(text) or an object:

```json
{
  "statuses": [
    "planned",
    "in_progress",
    { "key": "on_hold", "kind": "in_progress", "labels": { "en": "On hold", "ru": "Отложена" } },
    "finished",
    "abandoned"
  ],
  "formats": ["paperback", "ebook", { "key": "comics", "labels": { "en": "Comics" } }],
  "categories": ["fiction", "non-fiction", { "key": "memoir", "labels": { "en": "Memoir" } }, { "key": "reference", "topic": false }]
}
```

- `key`: the value stored in the note. Lowercase letters, digits, `-` and `_`, starting with a letter or digit, up to 64
  characters. Keys are not translated.
- `labels`: optional, `{ "<language code>": "text" }`. The label of a value is, in this order: your label for the
  interface language (or its base language, `pt` for `pt-BR`), the translation that ships with Colophon for a built-in
  key, your `en` label, the key itself. Your own values do not need to be translated into every language.
- `topic` (categories only, default `true`): `false` keeps a category out of the statistics about topics. `fiction` and
  `non-fiction` are `false` by default.
- `kind` (statuses only): one of `planned`, `in_progress`, `finished`, `abandoned`. All behaviour follows the kind, not
  the key: which date is asked for, the reading queue, "Read again", the counts and charts in the statistics, and the
  Library views. A custom status needs a `kind`. The four built-in keys cannot be removed and keep their own kind, but you
  can change their order and their labels. Several statuses of one kind appear together in that kind's Library view.
- A list replaces the default list as a whole. If you list `formats`, only those formats are offered. Notes that already
  use another value keep it and show it as it is.
- The order of a list is the order in the edit form and in the Library.

If `config.json` has a mistake (an unknown name, a duplicate or invalid key, a wrong kind, a label that is not text), the
book page and the statistics show what is wrong and use the defaults for the affected list, instead of failing. The
checks `npm run check:vault` and `npm run build` report the same problems.

A `.base` file cannot read `config.json`, so the Library base has to be generated for your lists. Run this from a clone of
the repository (`npm ci` once), then copy the files you want, as in [Install](#install):

```bash
node tools/build/build-localized.mjs --config path/to/your/config.json --out path/to/folder
```

The folder gets `Library.<code>.base`, `Book.<code>.md` and `Statistics.<code>.md` for every language, with your labels.
The Library views follow your lists: one view per kind of status, one per category, and "Audiobooks" only if the
`audiobook` format is in your list. The Library keeps its table layout (the format column is shown for `fiction`,
`non-fiction`, `philosophy` and `it`, which also come first).

The location of the scripts needs no setting. The notes call `dv.view("Colophon/book")` and
`dv.view("Colophon/statistics")`, and the scripts find their own files by the `Colophon` folder name. Dataview documents
this path as relative to the vault root, so keep the folder there.

Books are found by the property `type: book`, wherever the notes are stored.

## Property format

Colophon reads and writes ordinary Properties:

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
[Settings](#settings); values that are not in a list are shown as they are.

"Read again" adds a section like this to the note. The statistics read it, so keep the heading and the line format:

```markdown
## Reading history

- 2024-08-02 → 2024-08-30
  - rating: 4
```

### Reading time

The book page shows how long a read took, by the same rule as the "Reading time" block of the statistics (one shared
function, `readingDays` in `Colophon/model.js`, whole days from `started` to `finished`):

- A finished book with both dates shows **Reading time**: "23 days". A read that began and ended on the same day shows
  "Same day", not "0 days".
- A missing date or a finish date before the start date shows nothing. The statistics leave out zero and negative
  intervals from the averages and say how many books they skipped; same-day reads are the ones you see in the header
  but not in the averages.
- A book in progress shows **Reading so far**: the days from `started` to today, or "Started today".
- After "Read again" the header describes the current read only. Earlier reads stay in the Reading history section.

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
[Settings](#settings)). Summaries can live in the library folder, because only notes with `type: book` are counted;
a quote of the day is also taken from book notes only. The `Summary` template writes `type: "{{date:[summary]}}"` for the
same reason as the book template. The installer adds the template and the base with `--summaries`; for a manual
installation copy `Summary.<code>.md` and `Summaries.<code>.base` from `Colophon/localized/`.

## Adding and importing books

A new book is a note with the properties above: use the template, or write the properties yourself. The edit form on the
book page accepts a comma-separated list for authors and translators and a file name for the cover.

### Import from Goodreads

`import-goodreads.mjs` turns a Goodreads export (My Books, Import and export, Export Library, a `.csv` file) into book
notes. It has no dependencies and no network access (it does not download covers) and needs Node 20 or newer. It is in the
release archive and in `tools/user/`. **Run it on a copy of your vault first.**

```bash
# Report only: nothing is written, not even the folder
node import-goodreads.mjs goodreads_library_export.csv --out "/path/to/vault/Books/Library"

# Write the notes
node import-goodreads.mjs goodreads_library_export.csv --out "/path/to/vault/Books/Library" --apply
```

Options: `--config <file>` (your `Colophon/config.json`, so that your own statuses, formats and categories are used),
`--map <file>` (see below), `--reviews` and `--private-notes` (copy "My Review" and "Private Notes" under the notes
heading of the note), `--language <code>` (language of the headings), `--overwrite`.

What is mapped:

- **Status** from "Exclusive Shelf": `read` is the first status of kind `finished`, `currently-reading` of kind
  `in_progress`, `to-read` of kind `planned`. A custom exclusive shelf (for example `dnf`) needs a mapping, or the book is
  skipped and listed in the report.
- **Rating**: 0 means no rating, 1 to 5 become `rating`.
- **Format** from "Binding", by a fixed table: `Hardcover` is `hardcover`; `Paperback` and `Mass Market Paperback` are
  `paperback`; `Kindle Edition`, `ebook`, `e-book`, `Nook` and `Kindle` are `ebook`; `Audiobook`, `Audible Audio`,
  `Audio CD`, `Audio Cassette`, `Audio` and `Audible` are `audiobook`. Anything else sets no format and is listed in the
  report, as is a format that is not in your config.
- **Pages** from "Number of Pages". **Year**: `publication_year` is the "Original Publication Year" (1854 for Walden),
  because that is the year of the work. "Year Published" is the year of the edition you shelved and is used only when the
  original year is missing; the report says how often.
- **Dates**: "Date Read" becomes `finished` (only for read books) and "Date Added" becomes `date_added`, as `YYYY-MM-DD`.
  The export has no start dates. A read book without a "Date Read" gets no `finished` date (none is invented) and is
  reported; Colophon wants a finish date there.
- **Authors**: "Author" and "Additional Authors" become the `author` list. Goodreads does not say who is a translator
  or an illustrator, so all of them are authors.
- **ISBN** and **ISBN13** become the text properties `isbn` and `isbn13` (text, so a leading zero stays; the `="..."`
  spreadsheet wrapper is removed). Colophon does not use them yet; they keep the data with the book. The Goodreads "Book
  Id" becomes `goodreads_id`, the stable identifier the importer uses to recognise a book.
- **Categories**: shelves are written as categories only through a map file. Shelves without a mapping are listed in the
  report and are not written. The map file:

  ```json
  {
    "categories": { "sci-fi": "science-fiction", "history": "history" },
    "statuses": { "dnf": "abandoned" }
  }
  ```

  Targets must exist in your config; the importer checks that.
- **Rereads**: "Read Count" above 1 is reported only. Goodreads does not export the dates of earlier reads, and
  `reread_count` must match the lines of the Reading history section, so the importer creates neither. Use "Read again"
  or write the history by hand for the books you care about.
- **Title** is kept as Goodreads has it (a series often sits in it, "Title (Series, #1)"). Edit it afterwards.
- **Reviews** have their HTML reduced to plain text. Lines that would act as Markdown structure (headings, quotes, code
  fences) get a backslash, so imported text cannot become a code block that runs or a fake "Reading history".

File names are made from the title: characters that file systems or Obsidian links do not allow are removed, long names
are shortened, and names are compared without regard to case or Unicode form. If a name is taken, by an earlier import,
another new book or one of your own notes, `Title (Author)` and then `Title (id)` are tried. Existing files are never
overwritten.

Running the import again is safe: a book whose `goodreads_id` is already in the folder or its sub-folders (even renamed) is
skipped. `--overwrite` replaces such a note with a fresh one. That replaces the whole file, including anything you wrote
in it, so use it only on a copy.

The report lists what was created, skipped, shelves and bindings that were not recognised, rereads and warnings.

### Import from StoryGraph

Export your library in StoryGraph under **Manage Account → Manage Your Data → Export StoryGraph Library**. Use Node 20
or newer to run the importer from the release archive or from `tools/user/`. It reads the CSV locally.

```bash
# Preview which notes will be created or skipped
node import-storygraph.mjs storygraph.csv --out "/path/to/vault/Books/Library"

# Create the notes
node import-storygraph.mjs storygraph.csv --out "/path/to/vault/Books/Library" --apply
```

Use your configured library folder for `--out`. Pass `--config <file>` with your vault's `Colophon/config.json` to use
your own statuses and formats. `--language <code>` sets the note headings.

Writing requires a filesystem that supports hard links. If the process is killed, remove the
`.colophon-storygraph-import` folder in the library after confirming the import has stopped, then run the command again.

- The CSV supplies the title, authors, format, date added and reading status. `read`, `currently-reading`, `to-read` and
  `did-not-finish` use the first configured status of the corresponding kind. `paused` is treated as in progress.
  Half-star ratings are imported as given. Ratings between those steps, such as 4.25, are listed in the report.
- For a finished book, the latest confirmed reading supplies `started` and `finished`. Earlier completions go in
  `Reading history`. For a book being reread, all confirmed completions go in the history and `finished` stays
  empty. Each history line counts towards `reread_count`. A `?` marks an unknown start in the history.
- An exact `Last Date Read` can supply a missing finish. The report lists omitted ambiguous dates, conflicting fields
  and reads without dates. `Read Count` alone supplies no dates. A book marked read with no confirmed finish keeps its
  status and has no dated entry in the statistics.
- The importer recognises its own notes by `storygraph_id`, based on a valid ISBN or an ASIN from `ISBN/UID`.
  ISBN-10 and ISBN-13 are kept distinct because StoryGraph can use them for separate editions. The exported ISBN goes
  in `isbn` or `isbn13` and a non-ISBN value in `storygraph_uid`. For a blank or unrecognised ID, it stores a fingerprint
  of all the CSV cells in `storygraph_row`. Repeating the same row skips it. Changes to those cells can create a new note
  on a later import.
- Rows with ambiguous matches are reported and skipped. Different editions stay separate. Matching uses the
  import properties, so renamed notes still match and other notes with the same title or ISBN stay separate. The
  importer leaves existing notes intact.

Covers are ordinary image files that you provide; nothing downloads them for you. To shrink oversized JPEG covers:

```bash
# Dry run: prints what would be saved, changes nothing
uv run --group covers tools/user/compress-book-covers.py path/to/covers

# Shrink in place; each original is copied to the folder given in --originals first
uv run --group covers tools/user/compress-book-covers.py path/to/covers --apply --originals path/to/originals
```

The script uses [Pillow](https://pillow.readthedocs.io/), which `uv` installs for you; without uv run `pip install pillow`
and start the script with Python. No ffmpeg or other program is needed. It works on macOS, Linux and Windows, keeps every
file name, skips images that are already within 800 by 1200 pixels, and refuses to keep the originals inside the covers
folder. CMYK files are reported and left alone. Only `.jpg` and `.jpeg` files are processed.

## Languages

| Code    | Language           |
| ------- | ------------------ |
| `en`    | English (source)   |
| `ru`    | Русский            |
| `es`    | Español            |
| `de`    | Deutsch            |
| `fr`    | Français           |
| `ja`    | 日本語             |
| `pt-BR` | Português (Brasil) |

All interface text is in [`Colophon/locales/`](example-vault/Colophon/locales). Missing keys fall back to English. Plurals,
numbers, dates and lists use the browser's `Intl`, so Russian has its four plural forms and dates follow the language.

## Limitations

- **Library base labels are static.** A `.base` file cannot load translations at run time, so the view names, column
  names and status labels in it are fixed text. They are generated per language into
  `Colophon/localized/Library.<code>.base` from one source (`npm run build`). Copy the file for your language; changing
  the Obsidian language later does not change an existing base.
- Filters and sorting inside the base use the stable English keys, so every language file shows the same books.
- The template and the statistics note are generated per language for the same reason.
- DataviewJS runs code from your vault. Enable it only in vaults you trust; see [SECURITY.md](SECURITY.md).
- Dates in the edit form use your system's date picker, not the Colophon language.
- The "Reading history" heading is not translated, because the statistics parse it.
- Only JPEG covers can be shrunk by the cover script.
- **Size of the library.** Measured in Obsidian 1.15.0 on macOS with synthetic libraries: with 5000 book notes the
  statistics page draws in about 0.2 s, the book page opens in about 60 ms and the author or series panel in under 60 ms.
  When a note changes, Dataview refreshes an open statistics page after its own refresh interval (2.5 s by default).
  Larger libraries or slower machines were not measured.
- **Narrow windows and themes.** The book page, form, panels, statistics and Library base were checked in a 375 px wide
  window in all seven languages, light and dark, and with the themes Minimal, Things, Blue Topaz and AnuPpuccin. This is
  a desktop window, not a phone: touch behaviour and the mobile app were not tried (see below).
- Tested in Obsidian 1.15.0 on macOS with the Dataview 0.5.70 release. Windows, Linux, iOS and Android were not tried.

## Contributing

Bug reports, wording fixes and translations are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). The example vault contains only metadata of public domain books, quotations from public domain
texts and covers generated by `tools/dev/generate-demo-covers.py`.
