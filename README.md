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

They were taken in Obsidian 1.15.0 on macOS. The interface language here is English; every language and both themes
were also checked at 1100 px and 375 px wide.

## What it does

- **Book page.** Cover, title, authors, series, format, category, dates and a rating in half-star steps. Status,
  rating and queue position change in place, and a form edits every property. Everything is written back to the note's
  Properties.
- **Author and series panels.** Click an author or a series to see their other books in your library.
- **Reading queue.** Mark a planned book with "Add to queue"; the queue is ordered and shows up in statistics and in the
  Library base.
- **Read again.** Starts a new read, keeps the previous dates in a "Reading history" section and counts each read in
  its own year in the statistics.
- **Statistics.** Books and pages per year and month, average rating, formats, genres, series progress, most-read
  authors, reading time, rereads, a quote from your own notes, and suggestions for what to read next based on your
  ratings. Every suggestion shows its reason.
- **Library base.** A Bases file with table and card views: all books, queue, series, reading, want to read, finished,
  abandoned, top rated, audiobooks and one view for each category.
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

Colophon has no runtime dependencies besides these. The scripts in `tools/` are for development only; the cover script
needs Python 3.11+ and Pillow (installed by `uv`, see below).

## Install

The installation never touches your `.obsidian` folder; you enable the two plugins yourself.

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
status: finished # planned | in_progress | finished | abandoned
format: paperback # audiobook | ebook | hardcover | paperback
category: # fiction, non-fiction, philosophy, it, fantasy, science-fiction, classics,
  - philosophy # detective, psychology, productivity, business, science, health, history, biography
  - non-fiction
series: Sherlock Holmes # optional; series_index orders the books of a series
series_index: 1
queue: 1 # optional; only for planned books, lower is read sooner
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

`status`, `format` and `category` hold English keys in every language. Only their labels are translated, so notes and
queries keep working when you change the language. Unknown values are shown as they are.

"Read again" adds a section like this to the note. The statistics read it, so keep the heading and the line format:

```markdown
## Reading history

- 2024-08-02 → 2024-08-30
  - rating: 4
```

The template writes `type: "{{date:[book]}}"` on purpose. The Templates plugin turns it into `book` in the new note, but
the template file itself does not match `type == "book"`, so it does not appear in your library.

## Adding and importing books

There is no importer. A new book is a note with the properties above: use the template, or write the properties
yourself. For a larger collection, generate the notes with any script or tool that can write Markdown with
YAML properties in the format above, and run it on a copy of your vault first. The edit form on the book page
accepts a comma-separated list for authors and translators and a file name for the cover.

Covers are ordinary image files that you provide; nothing downloads them for you. To shrink oversized JPEG covers:

```bash
# Dry run: prints what would be saved, changes nothing
uv run --group covers tools/compress-book-covers.py path/to/covers

# Shrink in place; each original is copied to the folder given in --originals first
uv run --group covers tools/compress-book-covers.py path/to/covers --apply --originals path/to/originals
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
- Tested in Obsidian 1.15.0 on macOS with the Dataview 0.5.70 release. Windows, Linux, iOS and Android were not tried.

## Contributing

Bug reports, wording fixes and translations are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). The example vault contains only metadata of public domain books, quotations from public domain
texts and covers generated by `tools/generate-demo-covers.py`.
