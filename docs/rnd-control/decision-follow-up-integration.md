# Decision follow-up integration checkpoint

The native CRM research command processor now handles `followUp` commands. Every change appends an event and updates a derived task head in the same project patch. Existing events and heads cannot be deleted or rewound. Changed heads must reference one new event from the previous head, and the repository binds its author to the current Main actor.

Hydration accepts Firebase keyed event maps and reconstructs sequence order. Import/project validation rejects missing or inconsistent heads, invalid transitions, cross-project or missing decision references, unsafe result URLs, unknown event fields and malformed completion metadata. Duplicate IDs are rejected before object-map conversion.

Verification: `npm test` in desktop-crm: 419/419 pass. Focused follow-up tests: 8/8 pass. Existing Firebase Rules compatibility suite: pass (rnd-follow-up-compatibility-rules-results.txt); this is not a follow-up Rules permission test. Prior foundation commit 60e34bb CI run 35141170863 succeeded.

Not released: follow-up Firebase Rules deployment, CRM forms, task reporting/search and packaged Main/UI verification remain pending. Existing Windows review artifacts remain the previously verified build; this checkpoint does not claim the new workflow is available in that package or production. Historical imports with multiple events per task require a separate shared restoration design; normal shared saves intentionally accept one event per task per patch.

## Server Rules checkpoint

Follow-up Rules are implemented and verified locally in the full database emulator suite. They enforce actor UID/CRM role, active matching CRM/R&D permissions for both assignees, existing saved decision references, fixed task specification, immutable events, nondeletable heads, one-step atomically paired event/head writes, assigned reviewer completion and terminal states. Canonical UTC millisecond timestamps and actual calendar dates (including century leap-year rules) prevent malformed history from breaking hydration; backwards event times are rejected.

Independent scoped review found timestamp/date/text and URL parity gaps. These were fixed and re-reviewed with no remaining Critical/Important finding in that scope. Raw-write tests cover invalid calendar values, whitespace-only text, mismatched actor/role/assignees, result links, 4,001-character results/self-review reasons, bare/prefixed/encoded credential query keys, completion identity, self-review and cancelled-state resurrection. Concurrent writers commit exactly one head/revision; revocation blocks completion.

The generated follow-up-policy.mjs and server Rules share a deliberately conservative result-link profile: HTTP(S), DNS host containing a letter, ASCII path/query/fragment, no explicit port, no percent-encoded query keys and no credential-like query-key substrings. Ordinary version query strings and fragments are accepted. This keeps domain validation and direct DB writes consistent; it is not a general-purpose URL validator. Rules/policy regeneration is idempotent.

Latest local verification: Node 420/420; complete emulator suite including follow-up cases passes. Earlier integration commit e2f8bc9 GitHub CI 35141597664 succeeded. The Rules have not been deployed and company login/real shared-drive checks remain pending. CRM follow-up forms, reports/search and packaged Main/UI verification still remain.

## UI wiring checkpoint

A native R&D follow-up panel now contains creation and transition forms, task cards and immutable per-task history. Commands use existing Main workflow IPC and the latest local task predecessor. The panel tracks pending work for the CRM logout guard and discards delayed replies after session reset. It preserves newer form input and defers applying shared results when other unsaved input exists. No renderer author/completion identity is submitted.

Node 420/420 and the existing native Electron integration smoke suite pass with this module mounted. This smoke evidence checks CRM/module initialization and previous workflows; it does not yet exercise the new follow-up creation/review lifecycle, delayed follow-up responses or packaged follow-up forms. Those focused checks remain pending, as do task reporting/search and production membership/account checks. The production DB Rules and new Windows review build remain undeployed/unbuilt.

## Focused native and reporting verification

The focused actual Electron Main/UI test now passes creation, active/review/done transitions, single-test-account self-review, trusted completion identity and shared re-read. It also exercises A/B projects with the same decision ID, per-project form drafts, delayed A response while editing B, returning to A after successful background submission, pending-response session reset and logout draft tracking. Review found and fixed cross-project form carryover and restoration of an already submitted background form.

Current-task search and portfolio open/review/overdue counts are integrated without duplicate historical events. Internal Markdown now includes task specification, decision links, results and immutable history; review exports exclude all tasks pending a dedicated disclosure policy. The actual Main-generated internal/review ZIP was independently checked with Python for CRC, UTF8, file sizes/SHA256 and task exclusion. Node 421/421 and focused native checks pass. This remains local fixture evidence: separate company actors are covered by domain/emulator tests, not real company Electron login. Packaged follow-up verification, current Windows artifacts and real account/Drive checks remain pending.

## Windows review build verification

The Windows x64 directory build from dcbdfe6260b3452928c028f0dfc449ac3e40fac1 now passes the focused follow-up lifecycle/search/portfolio/ZIP/project-draft/delayed-response/session suite. Existing full CRM/R&D, CRM context freeze/export and disabled-module packaged checks also pass. All 75 src files match app.asar byte-for-byte; rnd-packaged-source-verification.json records the compiled source commit and ASAR SHA256. Package inventory/hash validation remains independent of application test evidence.

This is an unpacked review application, version 1.8.0; no installer, update channel, production Rules or OAuth pages were deployed. Local fixture and emulator evidence does not replace real company identities, shared Drive and two-PC operational checks. Overall original acceptance status remains 4/61 evidenced PASS / NOT READY.
