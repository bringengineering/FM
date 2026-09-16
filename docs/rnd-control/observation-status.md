# Observation backend checkpoint

Original EXP-04 was missing: sensor missing/not inspected/unobservable had no explicit entity. Added immutable observation records with experiment/plan/unit, value/status, reason, observed time and trusted Main actor. Zero remains numeric0; non-observed values remain null and are normalized after Firebase omission of null fields. Unknown fields, forged actors, bad times/plan versions and malformed value/status combinations are rejected. Existing records cannot be overwritten or deleted.

Node422 pass, full emulator suite including raw invalid inputs/immutable observations pass, actual Electron Main local fixture save/re-read pass. Independent scoped backend review found no Critical/Important issue. Observation input UI, search/portfolio/reporting and packaged verification remain pending; EXP-04 and overall release are unproven. Existing Windows review ZIP continues to be the earlier verified follow-up build, without observation UI.

## Input and report integration

Native input now saves four explicit states, keeping OBSERVED0 numeric and non-observed values null with a reason. The list renders 50 per page; search labels and portfolio totals distinguish observed/missing/not-inspected/unobservable. Internal Markdown includes value/status, reason, target, experiment/plan, observed/recorded time and actor; all observation content is excluded from review exports pending its disclosure policy.

Node423 and focused actual Main/UI local-fixture checks pass, including same experiment ID in A/B project drafts, delayed A reply while editing B, A-B-A pending reply and reset during pending work. Actual Main ZIP CRC/UTF8/SHA/size/relative links and zero/missing/review exclusion pass. Independent scoped UI/export review found no Critical/Important issue. Packaged validation and review ZIP refresh are the next step; real company account/cloud checks remain separate.
