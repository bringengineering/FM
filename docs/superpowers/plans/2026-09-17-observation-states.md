# Explicit R&D observation states

Requirement: original EXP-04 separates real numeric zero from missing sensor readings, not inspected and unobservable records. Immutable records bind to experiment/plan/unit, preserve reason and observed time, and use current Main actor. Non-observed values are null; Firebase removes null fields, so hydration explicitly restores null by status.

Implemented: domain validation/research command, repository immutable collection patches, archive/import/backup compatibility and server Rules. Native Main and full emulator verification use explicit local fixtures; no company cloud assertion.

Remaining: native observation form with project drafts/session guards, current-state reporting/search and internal export/disclosure exclusion, focused UI/packaged verification and refreshed Windows package. No EXP-04 PASS claim before the full input/reporting scope is tested.
