# Observation backend checkpoint

Original EXP-04 was missing: sensor missing/not inspected/unobservable had no explicit entity. Added immutable observation records with experiment/plan/unit, value/status, reason, observed time and trusted Main actor. Zero remains numeric0; non-observed values remain null and are normalized after Firebase omission of null fields. Unknown fields, forged actors, bad times/plan versions and malformed value/status combinations are rejected. Existing records cannot be overwritten or deleted.

Node422 pass, full emulator suite including raw invalid inputs/immutable observations pass, actual Electron Main local fixture save/re-read pass. Independent scoped backend review found no Critical/Important issue. This was the backend checkpoint; the completed local input/reporting and packaged checks are recorded below. Company operational release remains unproven.

## Input and report integration

Native input now saves four explicit states, keeping OBSERVED0 numeric and non-observed values null with a reason. The list renders 50 per page; search labels and portfolio totals distinguish observed/missing/not-inspected/unobservable. Internal Markdown includes value/status, reason, target, experiment/plan, observed/recorded time and actor; all observation content is excluded from review exports pending its disclosure policy.

Node423 and focused actual Main/UI local-fixture checks pass, including same experiment ID in A/B project drafts, delayed A reply while editing B, A-B-A pending reply and reset during pending work. Actual Main ZIP CRC/UTF8/SHA/size/relative links and zero/missing/review exclusion pass. Independent scoped UI/export review found no Critical/Important issue. Packaged x64 checks also pass against source70e2297: all77 source files match ASAR byte-for-byte. Observation Main/UI/report/draft/session checks and follow-up workflow pass. Delivery ZIPs are refreshed with the observation logs and source verification. Real company account/cloud checks remain separate.

Additional native and packaged checks:101-record renderer fixture traverses50/50/1 records without omissions or duplicates and clamps after shrinking the list. Delayed actual Main save persists the submitted snapshot exactly once, excludes newer unsent input and preserves that draft across project switches. A subsequent explicit shared-fixture refresh isolates the pending-session-reset check. Independent test review found no Critical/Important issue. Production sources unchanged.
