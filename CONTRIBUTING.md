# Contributing

Thank you for helping. Bug reports, wording fixes and new languages are all welcome. Please read the
[Code of Conduct](CODE_OF_CONDUCT.md) first.

## How the project is laid out

```text
example-vault/
  Colophon/          the product: copy this folder into a vault
    lib.js           shared code: settings, language, Intl formatting
    book/            book page (view.js, view.css)
    statistics/      statistics page
    locales/         one JSON file per language (en.json is the source)
    localized/       generated: Library, template and statistics note per language
    config.json      the settings block
  Books/, Templates/ demo content (generated files here are the English ones)
tools/               checks, generators and the cover script (Node and Python, dev only)
```

Colophon has no runtime dependencies. The tools use Node and Python only for checks and generation.

## Setting up

You need Node 20 or newer and [uv](https://docs.astral.sh/uv/) for the Python tools. CI runs the Python tools on
Python 3.11 to 3.16; 3.16 is a pre-release, so a failure there does not fail CI. The cover script needs Pillow, which
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
uv run python -m unittest discover -s tools -p "test_*.py"
```

`npm run check` runs ESLint, markdownlint, the locale check, the generated-files check, the example vault check and
the personal data scan. CI runs the same commands.

The scripts also need to be tried in Obsidian, because no test can open a note for you. Open `example-vault` as a
vault, install and enable Dataview with JavaScript queries turned on (see the README), and open a book note and
`Books/Statistics`. For UI changes look at a narrow window (about 375 px wide), the light and the dark theme, and
at least one language with long words (German) and one with a different script (Japanese).

## Rules for the code

- All interface text lives in `example-vault/Colophon/locales/*.json`. Do not put text in scripts. The locale check
  fails on unknown keys, unused keys and non-ASCII letters in code.
- Property values (`status`, `format`, `category`) are stable English keys stored in notes. Only their labels are
  translated.
- Use `Intl` for plurals, numbers, dates and lists. Do not build sentences from pieces, give translators whole
  messages with placeholders.
- Do not add runtime dependencies. Dev dependencies need a reason.
- The files in `example-vault/Colophon/localized/`, `example-vault/Books/Library.base`,
  `example-vault/Templates/Book.md` and `example-vault/Books/Statistics.md` are generated. Change the source in
  `tools/sources/` or the locale files, then run `npm run build`.

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
