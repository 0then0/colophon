# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Private Vulnerability Reporting:

1. Open the [Security tab](https://github.com/0then0/colophon/security) of the repository.
2. Choose **Report a vulnerability** and describe the problem.

Please do not open a public issue or pull request for a security problem. You will get a reply in the same private
report. This is a volunteer project, so there is no guaranteed response time.

## What counts as a vulnerability

Colophon runs as DataviewJS inside Obsidian, with the same access to your vault as any other script you run there.
Relevant problems include:

- a view script that reads or writes files outside the notes it is meant to touch;
- a way for the content of a note (title, author, quote, property value) to run script or inject HTML;
- a tool in `tools/` that deletes or overwrites data it should not touch, for example the cover compression script
  replacing a file without keeping the original.

Obsidian, the Dataview plugin and community themes are separate projects. Please report problems in them to their
maintainers.

## Supported versions

Only the latest release receives fixes.

## Using Colophon safely

- DataviewJS must be enabled for Colophon to work. Enable it only in vaults whose notes you trust: any note that can
  contain a `dataviewjs` block can run code.
- Read the scripts in the `Colophon/` folder before you copy them into your vault.
- Keep backups of your vault. The view scripts edit note properties (rating, status, queue and so on) when you use
  their buttons and the edit form.
