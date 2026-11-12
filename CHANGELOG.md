# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-11-12

### Added

- StoryGraph import inside Obsidian: the new `Import` page (`dv.view("Colophon/import")`) reads a CSV chosen in the
  file picker, shows a preview (new, already imported, ambiguous and unusable rows, planned note names, readings and
  warnings) and creates the notes through the Vault API after you confirm. No Node, no file system path. The installer
  places `Import.md` next to `Statistics.md` (`--skip-import` leaves it out) and the statistics page links to it.
- Limits for a StoryGraph CSV, in the import page and in `import-storygraph.mjs`: 10 MB, 20,000 rows, 10,000 characters
  in a field. A larger file is refused; a row with a longer field is skipped and reported.

### Changed

- The StoryGraph conversion, identities, plan and note text moved to `Colophon/storygraph.js`, which the command-line
  importer and the import page both run. The command line, its report and the notes it writes are unchanged.
  `storygraph-readings.mjs` is gone from the archive; the importers now need the `Colophon` folder next to them, as the
  archive has it.
- The README is an overview with a quick start. Settings, the properties of a book note and importing are described in
  `docs/SETTINGS.md`, `docs/NOTES.md` and `docs/IMPORT.md`; `docs/INSTALL.md` explains how to update an installation.

## [0.4.0] - 2026-11-11

### Added

- Prequels: `series_index: 0` marks a prequel. The series panel, the book header and the Library Series view name it, the
  edit form accepts 0, and a prequel does not hold back the main books of its series in the suggestions.
- Summaries: notes with `type: summary` stay out of the library, the statistics and the suggestions. `Summaries.base` and
  the `Summary` template are generated for every language (`--summaries` in the installer installs them).

### Changed

- The quote of the day is taken from notes with `type: book` only.

## [0.3.0] - 2026-11-07

### Added

- `import-storygraph.mjs` imports StoryGraph CSV exports locally with a preview, repeat import detection and dated
  reading history.

## [0.2.0] - 2026-11-04

### Added

- Clickable statistics: a click on a number (the cards, a month, the topics of a year, the bars of the detailed
  breakdowns) opens the list of its books under it. The authors breakdown shows "3 of 5" and lists all books of the
  author.
- A better "What to read next" (`Colophon/recommend.js`, tested in Node): smoothed averages, a penalty for abandoned
  books, a block "Continue a series", links between notes as a reason, a small bonus for books that waited long, three
  fiction and three non-fiction picks with at most one book per author, a monthly rotation, filters, and the buttons
  "Add to queue" and "Not now". "Not now" writes the new optional property `snoozed_until`.
- Settings for your own statuses, formats and categories in `Colophon/config.json` (`statuses`, `formats`,
  `categories`). Labels per language fall back to English, then to the key. Custom statuses have a `kind` that decides
  their behaviour. Mistakes in the file are reported on the page and by the checks. Without the new sections nothing
  changes.
- `node tools/build-localized.mjs --config <file> --out <folder>` generates the Library base, template and statistics
  note for another `config.json`.
- Reading time on the book page: days from start to finish for a finished book ("Same day" for a one-day read), days so far for a book in progress. The statistics use the same `readingDays` function.
- `install.mjs`, a dependency-free installer (Node 20+) in the release archive: plan by default, `--apply` to write, no
  overwriting without `--force`, safe to repeat, never touches `.obsidian`. `npm run build:release` builds the
  reproducible archive (`docs/INSTALL.md` is included).
- `import-goodreads.mjs`: imports a Goodreads CSV export as book notes (dry run by default, no dependencies, no network;
  recognises books by `goodreads_id`, so a second run creates nothing). Shelves become categories only through a map file.
  Try it on a copy of your vault first.
- A shared validation of one book note (`tools/note-validation.mjs`) used by the example vault check and the importer tests.
- `tools/generate-synthetic-library.mjs`: a seeded generator of synthetic libraries for performance and layout checks.
- Node tests for the settings logic and the generator (`npm test`).

### Fixed

- A long series or author name on the book page wraps instead of running off a narrow screen (seen in German).
- The "Edit properties" and "Read again" buttons use the muted text color, which keeps a readable contrast on the themes
  that were checked.
- Month labels of the statistics chart fit a narrow screen in Japanese (month numbers are used where the language has no
  one-character month name).

### Changed

- The lists of statuses, formats and categories now come from one place (`Colophon/model.js` and `config.json`) in the
  views, the form, the Library generator and the example vault check.

## [0.1.0] - 2026-11-04

### Added

- Book page for Obsidian notes: cover, author and series panels, star rating in half steps, status selector, edit
  form, reading queue, and "Read again" with a reading history.
- Statistics page: overview, year chart, what to read next, and detailed breakdowns.
- Library base with table and card views, generated per language.
- Interface languages: English, Russian, Spanish, German, French, Japanese and Brazilian Portuguese. The language
  follows Obsidian and can be overridden in `Colophon/config.json`.
- `tools/compress-book-covers.py` for shrinking oversized JPEG covers with Pillow, no external programs needed (dry run by default).
- Example vault with ten public domain books and neutral placeholder covers.
- Checks for locales, generated files, the example vault and personal data, run in CI.

[Unreleased]: https://github.com/0then0/colophon/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/0then0/colophon/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/0then0/colophon/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/0then0/colophon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/0then0/colophon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/0then0/colophon/releases/tag/v0.1.0
