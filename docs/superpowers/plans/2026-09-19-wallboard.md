# Company wallboard first slice

**Goal:** Add an independent company board folder and read-only visual playback without modifying CRM records.
**Architecture:** Pure safe projection and scene renderer in a standalone module; app mounts and disposes it on navigation/auth changes. Existing API supplies permission-scoped work orders. Explicitly local preview, not a paired remote TV.
**Tech Stack:** Existing Electron/vanilla JS/CSS and node:test.

- [x] Write failing projection tests: duplicate IDs, missing/invalid source, no contact/title/memo leakage, unknown states not counted as done.
- [x] Implement safe summary and chart/card renderer. Individual work titles remain excluded until a publication approval workflow exists.
- [x] Add folder, route, script and scoped CSS. Mount only with current authorization; clean timers on view/auth changes.
- [x] Add local playback control: previous/next, pause, duration, fullscreen, explicit loading/error/last success.
- [ ] Run projection and UI integration tests plus desktop suite. Document unimplemented calendar adapter, per-scene remote editing and TV device pairing instead of presenting them as completed.

## Local playlist follow-up
- [x] Match existing FM theme tokens, menu icons and controls without changing shared styles.
- [x] Add enabled screens, ordering and per-screen 10–120 second duration.
- [x] Persist only local presentation preferences, not notices or operational records.
- [x] Verify reload, disabled scenes, empty playlist and duration bounds with DOM tests.
- [ ] Calendar adapter, visual screenshot verification and remote TV pairing remain separate unfinished steps.

## 2026-09-20 progress
- Connected `api.load()` serviceRecords to a privacy-filtered today schedule scene. Cancelled items are excluded; missing time and unavailable source are distinguished.
- Calendar remains a paginated card list. Current-time line, next-event emphasis, explicit all-day semantics and screenshot verification are not yet complete.
- Local preferences and CRM theme alignment are implemented. No production deployment or remote TV connection has occurred.
- Desktop regression run: 2154 passed, 2 skipped, 0 failed.

## Timeline and visual verification
- Added current-time line, next planned timed entry, unknown-time count and six-entry pagination.
- Hidden Electron renderer uses synthetic data with no CRM preload. Five scenes at 1920x1080 and 1280x720 passed viewport overflow checks. Schedule screenshot visually inspected at 720p.
- This verifies representative content, not arbitrary long names/notices or physical TV readability. Native fullscreen and management-screen visual checks remain.
- Existing calendar has no verified explicit all-day contract; unknown times remain labelled unknown, not inferred as all-day.
- Remote read-only device authentication, server-side approved display projection, remote playlist publication and physical TV deployment remain unfinished. Do not advertise local preview as remotely connected.
