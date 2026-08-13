# CRM Staged Migration Design

## Goal

Copy the CRM data that the currently signed-in BRING CRM account can read from the separate `bring-fm-hj` Firebase project into an isolated, server-only staging area in the company-owned `bring-fm` project. The source project and the currently installed CRM must remain unchanged and usable throughout the operation.

## Scope

The first migration pass copies these application data roots because they are the complete set read by the tracked CRM client:

- `crmShared/data`
- `cases`
- `paymentCalendars/shared`
- `caseSettings`
- `crmAccess/{currentUid}` as an informational access snapshot only

Firebase Authentication password hashes, other users' access records, Google OAuth credentials, refresh tokens, and local Electron caches are not migration payloads. They cannot be safely or completely exported with the current non-admin source access.

## Architecture

The migration is a local, operator-run export/import tool. It uses the installed CRM's DPAPI-protected refresh token only in memory, refreshes it against `bring-fm-hj`, verifies the current CRM access record, and performs GET-only requests against the five approved source paths. It never writes to `bring-fm-hj`.

The tool builds a deterministic snapshot containing:

- a schema version and migration ID;
- source and destination project IDs;
- export timestamp and source user UID/email;
- per-root record counts;
- a SHA-256 checksum for each root and for the complete canonical payload;
- the copied application payload.

The snapshot is first written to a local temporary file inside a newly created migration directory. The destination write uses the authenticated Firebase CLI against `bring-fm` and stores the snapshot at:

`crmMigrationStaging/{migrationId}`

The temporary plaintext snapshot is removed after the destination verification succeeds. A manifest without application payload or tokens is retained locally as the audit receipt.

## Security Boundaries

- **Non-negotiable source immutability:** no `PUT`, `PATCH`, `POST`, or `DELETE` request may be sent to any `bring-fm-hj` endpoint. The migration stops before network access if a source request method is anything other than `GET`.
- Source requests are GET-only and are restricted to an explicit path allowlist.
- The source Firebase project configuration, Realtime Database rules, Authentication users, OAuth settings, Hosting files, and billing settings are never changed.
- The source reader and destination writer are separate modules. The destination writer rejects every host or project ID other than `bring-fm`, so a programming error cannot redirect an import back to `bring-fm-hj`.
- The DPAPI refresh token and refreshed ID token are never printed, logged, committed, or included in the snapshot.
- `crmMigrationStaging` is denied to all client SDK reads and writes by Realtime Database rules. Only Firebase administrative tooling can access it.
- The destination import never writes to live FIELD roots or a future live `/crm` root.
- The current CRM Firebase configuration remains `bring-fm-hj` during this phase.
- The original CRM project is not deleted, modified, disabled, or switched to read-only.
- No deployment command is run with `--project bring-fm-hj`.

## Data Validation

Before upload, the exporter validates that every requested source root returned successfully. A permission failure, expired session, malformed JSON response, or missing required root aborts the migration without any destination write.

After upload, the tool reads the staged snapshot back through Firebase administrative tooling and recomputes all per-root counts and SHA-256 checksums. The migration is considered verified only when the source snapshot, uploaded value, and read-back value match exactly.

Empty optional roots such as `caseSettings` are valid, but `crmShared/data`, `cases`, and `paymentCalendars/shared` must be present as objects. No data normalization or schema conversion occurs in this staging phase.

## Failure Handling and Rollback

- Failure before destination upload leaves the destination unchanged.
- Failure during upload may leave only a migration-ID-scoped staging record. Re-running creates a new migration ID rather than overwriting an earlier record.
- Failed or unverified staging records are never promoted to live CRM paths.
- Rollback consists of deleting only the exact failed `crmMigrationStaging/{migrationId}` record after its path is verified. The source CRM needs no rollback because it is read-only throughout.

## Testing

Automated tests cover canonical JSON checksums, root allowlisting, secret exclusion, required-root validation, count generation, manifest construction, destination path validation, exact read-back verification, and rejection of mismatched payloads. A dry run must complete before the first administrative destination write.

Tests must also prove that every non-GET source method is rejected before `fetch`, that every destination other than `bring-fm` is rejected, and that the migration command contains no source-project deployment or write target.

## Out of Scope

This phase does not switch CRM clients, migrate or recreate staff accounts, enable dual writes, deploy Cloud Functions, copy Firebase Authentication password hashes, or delete either project. Promotion from staging to live `/crm` data requires a separate reviewed design after this snapshot is verified.
