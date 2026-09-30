# Project CRM context implementation plan

> Execute in the existing isolated integration worktree, one task at a time.

**Goal:** Preserve the CRM ledger context used by each R&D project and its selected customer/building relationships.

**Architecture:** Main reads the current CRM ledger and checks fresh R&D mutation approval. A dedicated service creates an append-only project context record from that trusted projection. The serialized snapshot preserves nulls and arrays through Firebase; its checksum detects content edits, not origin authenticity. Saving uses the existing revision conflict and save-attempt mechanisms.

**Tech Stack:** Electron IPC, CommonJS services, existing project repository, Node tests and native Electron UI tests.

- [x] Add failing service tests for trusted snapshot creation, selected IDs, stale/partial refusal, revision conflicts, viewer refusal and session changes.
- [x] Implement context service and immutable repository validation; ordinary saves may preserve existing records but cannot add/change/delete context records.
- [x] Add Main/preload dedicated freeze action using the existing GET-only CRM source.
- [x] Add project UI with selection, reason, explicit shared save, preserved unsaved edits and history display.
- [x] Include internal export records; exclude CRM context from review exports until a disclosure workflow exists.
- [x] Extend DB rules and emulator cases before production readiness claims.
- [x] Verify Node and native tests, update acceptance evidence and review packages.

Actual company ledger permissions, two-PC checks and production deployment remain separate acceptance gates.
