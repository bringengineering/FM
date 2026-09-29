# Cleaning partner management design

## Goal

Extend reference screen 14, Partner Management, through the canonical CRM partner/vendor record so cleaning-specific onboarding, service coverage, manual availability, and compliance review are managed without duplicate vendor identities.

## Current project evidence

- The CRM stores partner vendors in `partnerVendors`; `normalizePartnerVendor` currently preserves existing fields.
- Partner vendor edits already pass through `sanitizeSharedStore`, shared-save authorization, and audit logging.
- Cleaning Center partner search already reads active CRM vendor records and can open the canonical partner manager.
- The 34 reference PNGs and index are named in the cleaning-screen audit, but their binary files are not present in the project or its parent worktree. Implement against the audited screen-14 requirements and compare pixel/layout details when those references are available.

## Approved design

Keep `partnerVendors` as the single identity source. Add an allow-listed `cleaningProfile` object only for vendors with cleaning eligibility. It contains service types (`move_in_cleaning`, `move_out_cleaning`, `common_cleaning`, `stair_cleaning`, `other`), service regions, onboarding status (`not_started`, `in_progress`, `submitted`, `approved`, `changes_requested`), manually checked availability (`unknown`, `available`, `unavailable`) with check date, compliance review (`not_reviewed`, `pending`, `verified`, `needs_review`) with review date, and a bounded note. Legacy vendors without this object remain valid and display an explicit unregistered state.

The partner/vendor screen will expose cleaning-specific coverage and onboarding summary counts, a cleaning-vendor filter, and a detail/edit section for this profile. Existing generic partner information and quote history remain on the canonical vendor. Availability and compliance values are manual CRM records; the UI must not imply live status or external verification. No document content, account numbers, or new file-upload mechanism is added in this change.

## Data and authorization

Normalize and sanitize every profile field with closed enums, trimmed unique arrays, explicit limits, and safe defaults. Preserve unrelated legacy vendor fields. Save through the existing authorized shared-store mutation and audit trail. Cleaning Center partner search uses the structured cleaning service types and regions when present, with the current generic service/region fields as a legacy fallback.

## Verification

Test normalization round-trip, invalid enum rejection/defaulting, bounded profile values, legacy vendor compatibility, management counts/filtering, existing-save wiring, and cleaning search preference for structured profile fields. Run the full desktop CRM test suite, JavaScript syntax checks, `git diff --check`, and Electron smoke coverage.

## Review notes

- No inferred ratings, prices, acceptance rates, map positions, real-time availability, or document-verification claims.
- A person must explicitly set the manual availability and compliance statuses.
- Exact visual parity remains unverified until the supplied reference PNG/index is available in the workspace.
