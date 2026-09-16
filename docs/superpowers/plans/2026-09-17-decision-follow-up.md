# Decision follow-up implementation plan

**Goal:** Turn each R&D business decision into assigned, dated and reviewable execution work in the actual CRM.

**Architecture:** Preserve every follow-up state change as an immutable event. Project the current task from the linked event chain. Use the existing project revision conflict control; add a server task-head constraint to prevent stale branches even when a caller supplies the latest project revision. Existing decisions remain immutable.

**Tech Stack:** Native CRM Electron, ESM domain modules, Main workflow IPC, Firebase Rules and Emulator, native Playwright checks.

- [x] Add failing domain tests and implement create/transition/project functions in desktop-crm/src/rnd-control/follow-up.mjs.
- [x] Verify admin creation, calendar dates, decision reference, owner/reviewer roles, completed/cancelled terminal states, result links, stale predecessor and duplicate event rejection.
- [ ] Strengthen replay/import validation, including missing sequence, cross-project/decision identity, transition rules and unsafe historical result URLs.
- [ ] Integrate follow-up commands into research.mjs, repository.js immutable event patches, archive.mjs hydration and import.mjs references. Add taskHeads maintained atomically with events and project revision.
- [ ] Add Rules for event immutability, new-event actor, owner/reviewer transitions, fixed task specification, task head update and stale predecessor rejection. Verify direct requests, revoked rights and two concurrent callers in test-rnd-rules.mjs.
- [ ] Add decision-linked create and lifecycle UI using current Main actor; never accept renderer-supplied author/completion identity. Preserve unfinished forms and account epochs during delayed replies.
- [ ] Include current tasks and immutable events in portfolio summaries, metadata search, internal Markdown and metadata backup. Exclude review disclosure until a task disclosure policy exists.
- [ ] Exercise actual Main/UI save, shared re-read, stale updates, review completion, session cleanup and native/packaged layouts.
- [ ] Update EVD-06 acceptance evidence, README, draft PR and review packages after integration verification.

Current status: domain foundation only. The company UI and production DB do not expose or persist this new workflow yet. Existing Windows review packages remain the previously verified integrated build until this feature is wired and rebuilt. Do not claim EVD-06 complete from domain tests alone.
