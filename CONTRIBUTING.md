# Contributing

Thank you for helping. Bug reports, wording fixes and new languages are all welcome. Please read the
[Code of Conduct](CODE_OF_CONDUCT.md) first.

## How the project is laid out

```text
example-vault/
  Colophon/          the product: copy this folder into a vault
    lib.js           shared code: language, Intl formatting, vault helpers
    model.js         pure settings logic (config.json, statuses, labels), also run by the tools and tests
    book/            book page (view.js, view.css)
    statistics/      statistics page
    locales/         one JSON file per language (en.json is the source)
    localized/       generated: Library, Summaries, templates and statistics note per language
    config.json      the settings block
  Books/, Templates/ demo content (generated files here are the English ones)
tools/               dev tooling, by purpose
  user/              dependency-free installer, CSV importers and cover compressor
  check/             repository checks run by `npm run check`
  build/             generators and the release builder (sources/ holds the Library and template sources)
  dev/               helpers for development: synthetic libraries, demo covers
  lib/               code shared by the Node tools (common.mjs, note-validation.mjs)
  test/              Node tests (*.test.mjs)
docs/                screenshots and INSTALL.md (shipped in the archive)
```

Colophon has no runtime dependencies. The tools use Node and Python only for checks and generation.

## Setting up

You need Node 20 or newer and [uv](https://docs.astral.sh/uv/) for the Python tools. CI runs the Python tools on
Python 3.11 to 3.15. Python 3.16 is not tested yet: it is still a pre-release and Pillow has no wheel for it. The cover script needs Pillow, which
`uv sync` installs.

```bash
npm ci
uv sync
```

## Checking your change

```bash
npm run check
uv run ruff check .
uv run ruff format --check .
uv run yamllint .github .yamllint.yml
uv run python -m unittest discover -s tools/user -p "test_*.py"
```

`npm run check` runs ESLint, markdownlint, the Prettier format check (`npm run format` fixes it; JavaScript and CSS only), the locale check, the generated-files check, the example vault check, the
personal data scan and the Node tests (`npm test`, files `tools/test/*.test.mjs`, Node's built-in runner). CI runs the same
commands.

The scripts also need to be tried in Obsidian, because no test can open a note for you. Open `example-vault` as a
vault, install and enable Dataview with JavaScript queries turned on (see the README), and open a book note and
`Books/Statistics`. For UI changes look at a narrow window (about 375 px wide), the light and the dark theme, and
at least one language with long words (German) and one with a different script (Japanese).

## Building the release archive

```bash
npm run build:release
```

This writes `dist/colophon-<version>.zip` and `dist/colophon-<version>.zip.sha256` (the version comes from
`package.json`; `dist/` is git-ignored). The archive holds `install.mjs`, `INSTALL.md`, `LICENSE`, `CHANGELOG.md` and the
`Colophon` folder, under one folder `colophon-<version>/`. It is reproducible: files are sorted, timestamps and
permissions are fixed and nothing is compressed, so the same checkout gives the same bytes. Run `npm run check` first
(it also builds the archive twice in a test and runs the installer from it), and make sure the generated files are up
to date (`npm run build`). To release, bump the version in `package.json`, move the changelog entries to the new
version, build, check the `.sha256` file and attach both files to the GitHub release. The build does not publish
anything.

## Rules for the code

- All interface text lives in `example-vault/Colophon/locales/*.json`. Do not put text in scripts. The locale check
  fails on unknown keys, unused keys and non-ASCII letters in code.
- Property values (`status`, `format`, `category`) are stable keys stored in notes. Only their labels are
  translated. The lists of values come from `config.json` through `model.js`; do not write them into a script. Logic
  follows the kind of a status (`kindOf`), never a status key.
- `model.js` and `lib.js` are function bodies (top-level `return`), not modules. Anything that must be tested in Node
  goes into `model.js`, which must not use Dataview, Obsidian or the DOM; the tests load it with `new Function`.
- Problems in `config.json` are described by locale keys `config.error.<code>`. A new problem code needs a message in
  every locale.
- Use `Intl` for plurals, numbers, dates and lists. Do not build sentences from pieces, give translators whole
  messages with placeholders.
- `tools/user/` must stay dependency-free: it may import only `node:` modules and files of its own folder (ESLint
  enforces this), because it runs from the release archive without `npm install`.
- Do not add runtime dependencies. Dev dependencies need a reason.
- The files in `example-vault/Colophon/localized/`, `example-vault/Books/Library.base`,
  `example-vault/Books/Summaries.base`, `example-vault/Templates/Book.md`, `example-vault/Templates/Summary.md` and
  `example-vault/Books/Statistics.md` are generated. Change the source in
  `tools/build/sources/` or the locale files, then run `npm run build`.

## Adding a language

1. Copy `example-vault/Colophon/locales/en.json` to `example-vault/Colophon/locales/<code>.json`. The code is a BCP 47
   tag such as `it` or `pt-BR`, and Obsidian's own language code should match it.
2. Translate every value. Keep the keys and every `{placeholder}` exactly as they are.
3. Messages that are objects are plural messages. Provide every form your language needs. For example Russian needs
   `one`, `few`, `many` and `other`; Japanese only `other`. `npm run check:locales` tells you what is missing.
4. Set `language.name` to the name of the language in that language.
5. Run `npm run build` to generate the Library base, template and statistics note for the new language.
6. Add the language to the table in the README and update the languages badge number.
7. Run `npm run check`, then look at the result in Obsidian: no text should be cut off or break the layout at a
   narrow width. Say in the pull request whether a native speaker has reviewed it.

## Reporting problems

Use the issue templates. Do not paste notes, screenshots or exports from a private library. If you need to show data,
reproduce the problem on the example vault.

## Content in the repository

Only public domain texts and metadata may be used in the example vault, and covers must be created for the project.
Do not add publisher covers, quotes from in-copyright books, personal notes or ratings.
