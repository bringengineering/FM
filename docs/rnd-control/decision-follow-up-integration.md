# Decision follow-up integration checkpoint

The native CRM research command processor now handles `followUp` commands. Every change appends an event and updates a derived task head in the same project patch. Existing events and heads cannot be deleted or rewound. Changed heads must reference one new event from the previous head, and the repository binds its author to the current Main actor.

Hydration accepts Firebase keyed event maps and reconstructs sequence order. Import/project validation rejects missing or inconsistent heads, invalid transitions, cross-project or missing decision references, unsafe result URLs, unknown event fields and malformed completion metadata. Duplicate IDs are rejected before object-map conversion.

Verification: `npm test` in desktop-crm: 419/419 pass. Focused follow-up tests: 8/8 pass. Existing Firebase Rules compatibility suite: pass (rnd-follow-up-compatibility-rules-results.txt); this is not a follow-up Rules permission test. Prior foundation commit 60e34bb CI run 35141170863 succeeded.

Not released: follow-up Firebase Rules, CRM forms, task reporting/search and packaged Main/UI verification remain pending. Existing Windows review artifacts remain the previously verified build; this checkpoint does not claim the new workflow is available in that package or production. Historical imports with multiple events per task require a separate shared restoration design; normal shared saves intentionally accept one event per task per patch.
