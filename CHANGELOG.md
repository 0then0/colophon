# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/0then0/colophon/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/0then0/colophon/releases/tag/v0.1.0
