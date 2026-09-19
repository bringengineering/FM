# Company wallboard first slice

**Goal:** Add an independent company board folder and read-only visual playback without modifying CRM records.
**Architecture:** Pure safe projection and scene renderer in a standalone module; app mounts and disposes it on navigation/auth changes. Existing API supplies permission-scoped work orders. Explicitly local preview, not a paired remote TV.
**Tech Stack:** Existing Electron/vanilla JS/CSS and node:test.

- [x] Write failing projection tests: duplicate IDs, missing/invalid source, no contact/title/memo leakage, unknown states not counted as done.
- [x] Implement safe summary and chart/card renderer. Individual work titles remain excluded until a publication approval workflow exists.
- [x] Add folder, route, script and scoped CSS. Mount only with current authorization; clean timers on view/auth changes.
- [x] Add local playback control: previous/next, pause, duration, fullscreen, explicit loading/error/last success.
- [ ] Run projection and UI integration tests plus desktop suite. Document unimplemented calendar adapter, per-scene remote editing and TV device pairing instead of presenting them as completed.
