# Settings

Colophon is configured in one file, [`Colophon/config.json`](../example-vault/Colophon/config.json):

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

- `language`: `auto` follows the Obsidian interface language. Set a code from the [language table](../README.md#languages) such as
  `de` to force one language. An unknown code falls back to English.
- `paths.library`: the folder with book notes. Statistics look for quotes (Markdown blockquotes) in notes here.
- `paths.notes`: notes about a series. A note with the same `series` property as a book is linked from the series panel.
- `paths.covers`: where cover images live. The edit form suggests files from this folder.

## Your own statuses, formats and categories

Three optional lists replace the built-in values. Leave a list out to keep the built-in one. Each item is either a key
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

### Generating the Library for your lists

A `.base` file cannot read `config.json`, so the Library base has to be generated for your lists. Run this from a clone of
the repository (`npm ci` once), then copy the files you want, as in [the installation guide](INSTALL.md):

```bash
node tools/build/build-localized.mjs --config path/to/your/config.json --out path/to/folder
```

The folder gets `Library.<code>.base`, `Book.<code>.md` and `Statistics.<code>.md` for every language, with your labels.
The Library views follow your lists: one view per kind of status, one per category, and "Audiobooks" only if the
`audiobook` format is in your list. The Library keeps its table layout (the format column is shown for `fiction`,
`non-fiction`, `philosophy` and `it`, which also come first).

## Where the scripts and the books live

The location of the scripts needs no setting. The notes call `dv.view("Colophon/book")` and
`dv.view("Colophon/statistics")`, and the scripts find their own files by the `Colophon` folder name. Dataview documents
this path as relative to the vault root, so keep the folder there.

Books are found by the property `type: book`, wherever the notes are stored.
