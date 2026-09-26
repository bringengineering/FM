# Unified work period implementation

**Goal:** Apply the approved current/previous/all period to existing cards and performance without server writes.
**Architecture:** Extend the existing performance core with a pure period selector; retain raw server projection for authoritative date validation. UI reuses existing period event and editor guard.
**Tech Stack:** Electron renderer JavaScript, node:test.

- [x] Add failing node:test cases for previous-week year boundary, invalid/overlapping schedules and immutable input.
- [x] Extend summarize to accept previous-week; expose selectPeriod returning selected records and diagnostics using the same summary IDs.
- [x] Default UI to current-week. Place period controls above cards, preserve editor guard, align card IDs with raw projection and retain explicit unavailable state.
- [x] Run `node --test test/weekly-performance.test.js test/work-period.test.js`, then full `node --test test/*.test.js` through the package test command. Verify no operational data writes.
- [ ] Review diff and commit only implementation/test/docs files; leave unrelated verification distributions untouched. Report local vs deployed status separately.
