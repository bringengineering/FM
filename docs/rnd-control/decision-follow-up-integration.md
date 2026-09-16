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
