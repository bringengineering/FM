# Observation backend checkpoint

Original EXP-04 was missing: sensor missing/not inspected/unobservable had no explicit entity. Added immutable observation records with experiment/plan/unit, value/status, reason, observed time and trusted Main actor. Zero remains numeric0; non-observed values remain null and are normalized after Firebase omission of null fields. Unknown fields, forged actors, bad times/plan versions and malformed value/status combinations are rejected. Existing records cannot be overwritten or deleted.

Node422 pass, full emulator suite including raw invalid inputs/immutable observations pass, actual Electron Main local fixture save/re-read pass. Independent scoped backend review found no Critical/Important issue. Observation input UI, search/portfolio/reporting and packaged verification remain pending; EXP-04 and overall release are unproven. Existing Windows review ZIP continues to be the earlier verified follow-up build, without observation UI.
