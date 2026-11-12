# Installing Colophon

This archive holds Colophon, a book library and reading journal for Obsidian, and an installer for it. Colophon needs
[Obsidian](https://obsidian.md) 1.9.10 or newer and the [Dataview](https://github.com/blacksmithgu/obsidian-dataview)
plugin. The installer needs [Node.js](https://nodejs.org) 20 or newer. It has no other dependencies and no `npm install`
step. Without Node, use the [manual steps](#manual-installation).

## One command

Unpack the archive, open a terminal in the unpacked folder and run the installer with the path of your vault. By default
it only shows what it would do:

```bash
node install.mjs "/path/to/your/vault"
```

If the plan looks right, run it again with `--apply`:

```bash
node install.mjs "/path/to/your/vault" --apply --language en
```

Try it on a copy of the vault first if you have notes you care about.

What the installer does:

- copies the `Colophon` folder into the vault and writes `Colophon/config.json` with your language and folders;
- installs the book template (`Templates/Book.md`), `Library.base`, `Statistics.md` and the import page `Import.md` in
  the chosen language. The last three go to the parent folder of the library folder (`Books` by default);
- creates the library, notes and covers folders if they are missing;
- never overwrites a file that exists and differs. It lists the conflicts and stops without writing anything. `--force`
  overwrites only those files and never deletes anything. Running it twice is safe;
- never creates or changes `.obsidian`.

Options:

- `--apply`: write the files. Without it the installer only prints the plan.
- `--force`: overwrite files that exist and differ.
- `--summaries`: also install `Templates/Summary.md` and `Summaries.base` (see [Summaries](https://github.com/0then0/colophon/blob/main/docs/NOTES.md#summaries)). They are not
  installed by default.
- `--language <code>`: `en`, `ru`, `es`, `de`, `fr`, `ja` or `pt-BR`. Sets the interface language and the language of
  the template, base and statistics note. The default is `auto`: the interface follows Obsidian and the files are English.
- `--library <folder>`, `--notes <folder>`, `--covers <folder>`: folders of book notes, series notes and cover images,
  default `Books/Library`, `Books/Notes` and `Books/covers`.
- `--templates <folder>`: folder for the book template, default `Templates`.
- `--skip-template`, `--skip-base`, `--skip-statistics`, `--skip-import`: leave that file out.
- `--no-vault-check`: install into a folder that has no `.obsidian` folder yet.

Folders are written relative to the vault root. The installer refuses folders outside the vault and hidden folders.

## What you do in Obsidian

The installer does not touch your Obsidian settings, so these steps are yours:

1. Settings, Community plugins: turn off Restricted mode, then install and enable **Dataview**.
2. In the Dataview settings turn on **Enable JavaScript Queries**.
3. Settings, Core plugins: enable **Templates** and set **Template folder** to the folder you chose (`Templates` by
   default).
4. Create a note in your library folder, run **Templates: Insert template** and choose `Book`. Fill in the title and the
   author.
5. Open `Statistics` and `Library.base` from the folder where they were installed.
6. To bring in a StoryGraph library, open `Import`, choose the exported CSV file, check the preview and confirm.

## Manual installation

1. Install and enable Dataview, with **Enable JavaScript Queries** turned on.
2. Copy the `Colophon` folder into the root of your vault. Keep the folder name: the notes call
   `dv.view("Colophon/book")`.
3. Edit `Colophon/config.json` to set your folders and language.
4. From `Colophon/localized/` copy the files in your language and rename them: `Book.<code>.md` to `Templates/Book.md`,
   `Library.<code>.base` to `Books/Library.base`, `Statistics.<code>.md` to `Books/Statistics.md`, `Import.<code>.md` to
   `Books/Import.md`.
5. Enable the Templates plugin and set its template folder.

A StoryGraph export can be imported inside Obsidian on the `Import` page, without Node. From a terminal, use
`import-goodreads.mjs` or `import-storygraph.mjs` from this archive to preview a CSV import and add `--apply` to write
notes to the folder specified by `--out`. Keep the scripts next to the `Colophon` folder of the archive: they load the
import logic from it.

## Updating

Unpack the new archive and run the installer again with the same options as before. New files are created. Files that
differ from the new version are listed as conflicts and nothing is written until you add `--force`.

`--force` also rewrites `Colophon/config.json` from the options on the command line. If you edited that file by hand,
for example to add your own statuses, formats or categories, keep a copy and restore your additions after the update.
Other files that you changed yourself (the template, `Library.base`) are overwritten in the same way; use the
`--skip-*` options to leave them out. Your book notes are never touched.

## More documentation

The archive holds this file only. The rest is in the repository:

- [Settings](https://github.com/0then0/colophon/blob/main/docs/SETTINGS.md): language, folders, your own statuses,
  formats and categories.
- [Book notes](https://github.com/0then0/colophon/blob/main/docs/NOTES.md): properties, reading history, summaries.
- [Importing books](https://github.com/0then0/colophon/blob/main/docs/IMPORT.md): StoryGraph, Goodreads, covers.
- [README](https://github.com/0then0/colophon#readme): overview, requirements, compatibility.

## Checking the download

Every release has a `.sha256` file next to the archive. Compare it with
`shasum -a 256 colophon-<version>.zip` (macOS, Linux) or `Get-FileHash colophon-<version>.zip` (Windows).
