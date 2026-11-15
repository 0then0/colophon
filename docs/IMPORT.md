# Adding and importing books

A new book is a note with the [book properties](NOTES.md): use the template, or write the properties yourself. The edit form on the
book page accepts a comma-separated list for authors and translators and a file name for the cover.

A whole library can be imported from a CSV export of [Goodreads](#import-from-goodreads) or
[StoryGraph](#import-from-storygraph), [inside Obsidian](#import-inside-obsidian) on the Import page or from a terminal.

The importers only create new notes. They never download anything, and covers are [added by you](#covers). A book of one
service is never matched with a note imported from the other: Goodreads imports are recognised by `goodreads_id`,
StoryGraph imports by `storygraph_id` or `storygraph_row`, never by ISBN or title. Importing the same library from both
gives two notes per book.

## Import inside Obsidian

The Import page needs no Node and no terminal, only Dataview, like the rest of Colophon. The Goodreads conversion runs
the same code as `import-goodreads.mjs` (`Colophon/goodreads.js`) and the StoryGraph conversion the same code as
`import-storygraph.mjs` (`Colophon/storygraph.js`): the same file, settings and library give the same notes, and each
recognises what the other imported.

1. Open the `Import` note (installed next to `Statistics`; the statistics page links to it at the bottom). Any note
   with a `dataviewjs` block that calls `await dv.view("Colophon/import")` works.
2. Choose where the export comes from: Goodreads or StoryGraph. The file picker waits for this choice.
3. Choose the CSV file. It is read on your device; nothing is uploaded and nothing is written yet.
4. For Goodreads, set what you need under **Goodreads settings** (see [below](#goodreads-settings)). Every change reads
   the file again and builds a new preview.
5. Check the preview: the source, the file and the library folder from `Colophon/config.json`, how many rows are new,
   already imported or unusable (for StoryGraph also ambiguous), and for every new note its file name, title, authors,
   status, rating, reads, categories and warnings. Books that are already imported are listed with the note that has
   them, and skipped rows with the reason. Long lists show the first 50 entries with the total; "Show more" opens the rest.
6. Confirm. Notes are created one after another with a progress line and a button that stops after the current note.
7. Read the result: what was created, skipped, in conflict, failed or not attempted. The page then shows a new preview
   of what is left.

### Goodreads settings

- **Add “My Review” to the notes** and **Add “Private Notes” to the notes**: off by default, each on its own. The text
  goes under the notes heading of each new note, with its HTML reduced to plain text (see "Reviews" below).
- **Exclusive shelves**: `read`, `currently-reading` and `to-read` always get the first status of their kind. Every
  other exclusive shelf of the file (for example `dnf`) is listed with a status picker; its books are skipped until you
  choose a status.
- **Other shelves**: every other shelf of the file is listed with a category picker. A shelf becomes a category only if
  you choose one; otherwise it is not written.

These settings are those of the `--map`, `--reviews` and `--private-notes` options of the command line. They are kept
while the page is open and are not saved to `config.json`. Changing the source, the file or a setting replaces the
preview, so a preview made with other settings can never be confirmed.

### What to expect

- **Limits**: a file of up to 10 MB, 20,000 rows and 10,000 characters in one field. A larger file is refused before it
  is converted; a row with a longer field is skipped and listed. For Goodreads only the columns that are imported
  count, so a long "My Review" matters only when reviews are imported. `import-storygraph.mjs` applies the same limits;
  `import-goodreads.mjs` does not.
- **Wrong file**: a file of the other service is named as such, and a file without the required columns is refused
  before anything is planned.
- **Existing notes are never changed.** A note is only created at a free path. If a file takes the planned name between
  the preview and the creation, that book is reported as "not created" and gets another name on the next import. The
  page has no counterpart of `--overwrite`.
- **The plan is checked again when you confirm.** The file, `config.json` and the notes of the library are read again
  (the notes themselves, not Obsidian's cache). If the result differs from the preview, nothing is created and the new
  plan waits for a new confirmation. Problems in `config.json`, or a shelf setting whose status or category is no longer
  in it, block the import.
- **Not all or nothing.** If the import fails or you stop it, the notes created so far stay. Nothing is deleted to undo
  a run. Import again: existing notes are recognised by `goodreads_id`, `storygraph_id` or `storygraph_row`, also after
  a rename, a move inside the library or a restart of Obsidian. If a write was cut off, the result names the incomplete
  file; check or delete it by hand.
- **One import at a time per Obsidian window**, however many Import pages are open. Closing the page drops the
  preview; an import that has started runs to its end and its result is shown when the page is opened again.
- **Sync.** Colophon cannot see an import that runs on another device at the same moment. Import on one device and
  let the sync finish before importing elsewhere, otherwise both devices can create the same book.
- Headings of the created notes follow `language` in `config.json` (`auto` writes English headings, like the
  installed template). Covers are not imported.

The page uses only Obsidian's public Vault API and the standard file picker, so nothing in it is desktop-only. The
StoryGraph import has been tested on Obsidian 1.15.0 on macOS. The Goodreads import has been tested against a stand-in
vault and in a browser, not yet in Obsidian itself. Neither has been tested on Obsidian Mobile.

## Import from Goodreads

Export your library in Goodreads under My Books, Import and export, Export Library; you get a `.csv` file. Import it
[inside Obsidian](#import-inside-obsidian) or from a terminal.

### From a terminal

`import-goodreads.mjs` has no dependencies and no network access (it does not download covers) and needs Node 20 or
newer. It is in the release archive and in `tools/user/`; keep it next to the `Colophon` folder (as in the archive),
because it loads the conversion from there. **Run it on a copy of your vault first.**

```bash
# Report only: nothing is written, not even the folder
node import-goodreads.mjs goodreads_library_export.csv --out "/path/to/vault/Books/Library"

# Write the notes
node import-goodreads.mjs goodreads_library_export.csv --out "/path/to/vault/Books/Library" --apply
```

Options: `--config <file>` (your `Colophon/config.json`, so that your own statuses, formats and categories are used),
`--map <file>` (see below), `--reviews` and `--private-notes` (copy "My Review" and "Private Notes" under the notes
heading of the note), `--language <code>` (language of the headings), `--overwrite`.

### What is mapped

Both ways follow the same rules:

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
  spreadsheet wrapper is removed). Colophon does not use them; they keep the data with the book. The Goodreads "Book
  Id" becomes `goodreads_id`, the stable identifier the importer uses to recognise a book.
- **Categories**: shelves are written as categories only through a map file. Shelves without a mapping are listed in the
  report and are not written. The map file:

  ```json
  {
    "categories": { "sci-fi": "science-fiction", "history": "history" },
    "statuses": { "dnf": "abandoned" }
  }
  ```

  Targets must exist in your config; the importer checks that. On the Import page the same mapping is set with the
  pickers under Goodreads settings.
- **Rereads**: "Read Count" above 1 is reported only. Goodreads does not export the dates of earlier reads, and
  `reread_count` must match the lines of the Reading history section, so the importer creates neither. Use "Read again"
  or write the history by hand for the books you care about.
- **Title** is kept as Goodreads has it (a series often sits in it, "Title (Series, #1)"). Edit it afterwards.
- **Reviews** ("My Review", and "Private Notes" in the same way) are imported only when you ask for it. Their HTML is
  reduced to plain text. Lines that would act as Markdown structure (headings, quotes, code
  fences) get a backslash, so imported text cannot become a code block that runs or a fake "Reading history".

File names are made from the title: characters that file systems or Obsidian links do not allow are removed, long names
are shortened, and names are compared without regard to case or Unicode form. If a name is taken, by an earlier import,
another new book or one of your own notes, `Title (Author)` and then `Title (id)` are tried. Existing files are never
overwritten.

Running the import again is safe: a book whose `goodreads_id` is already in the folder or its sub-folders (even renamed) is
skipped. `--overwrite` replaces such a note with a fresh one. That replaces the whole file, including anything you wrote
in it, so use it only on a copy.

The report lists what was created, skipped, shelves and bindings that were not recognised, rereads and warnings. The
Import page shows the same per book.

## Import from StoryGraph

Export your library in StoryGraph under **Manage Account → Manage Your Data → Export StoryGraph Library**. Import the
CSV [inside Obsidian](#import-inside-obsidian) or from a terminal.

### From a terminal

Use Node 20 or newer to run the importer from the release archive or from `tools/user/`. Keep it next to the `Colophon`
folder (as in the archive): it loads the import logic from there. It reads the CSV locally.

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

### What is imported

Both ways follow the same rules:

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

## Covers

Covers are ordinary image files that you provide; nothing downloads them for you. Put them in the covers folder from
[Settings](SETTINGS.md) and set the `cover` property of the book, by hand or in the edit form.

The repository has a script that shrinks oversized JPEG covers. It needs Python 3.11 or newer; run it from a clone of
the repository:

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
