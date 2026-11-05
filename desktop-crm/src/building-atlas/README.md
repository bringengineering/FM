# Preserved Building Atlas upstream

- Source repository: `bringengineering1008-pixel/FM`
- Source pull request: https://github.com/bringengineering1008-pixel/FM/pull/2
- Exact source commit: `f5f43f7971bd7043435ad149dea9b1eab341a188`
- Original path: `building-operations/`
- Preserved location: `upstream/`, retaining paths relative to the original directory.

This directory contains preserved upstream runtime JavaScript, CSS, HTML, vendor
files (including the three.js MIT license), and original `.test.mjs` unit tests.
Browser automation scripts, screenshots, fixture reports, and unrelated source
files are intentionally excluded. The MIT license in `upstream/vendor/LICENSE`
applies to the bundled three.js vendor code; it does not relicense the CRM.

The module is not enabled in the CRM. This preservation step adds no production
storage integration (no production storage reads, writes, or migration). Upstream
standalone/demo persistence remains preserved source code only, not an approved
CRM persistence contract. No CRM renderer entry point, IPC wiring, or database
rules are changed by this import.

Any CRM integration should be implemented outside `upstream/` so that the
preserved files can be compared directly with the pinned source commit.

Run the import contract from the repository root:

```text
node --test desktop-crm/test/building-atlas-upstream.test.js
node --test desktop-crm/src/building-atlas/upstream/*.test.mjs
```
