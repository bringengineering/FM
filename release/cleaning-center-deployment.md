# Cleaning Center production deployment

The general Functions deployment gate stays closed, and the Rules-only GitHub identity still has no Cloud Functions permissions. This separate, human-run path is limited to the two reviewed Cleaning Center exports plus RTDB Database Rules.

## Preconditions

- The implementation commit is already merged into `codex/bring-field-platform`.
- The checkout contains that commit, has no uncommitted changes, and the Firebase CLI is authenticated as an authorized BRING operator.
- The `bring-fm` project has billing enabled and the required `DRIVE_*` Secret Manager versions available. Deploying Functions can incur Cloud Build, Artifact Registry, and Cloud Run usage charges.
- CRM, Functions, Rules, and Worker tests have passed for the merged source. Deployment is not proof of employee-PC or physical-TV validation.

## Commands

From the repository root, first inspect the dry-run plan:

```powershell
node release/cleaning-center-deployment.js --project bring-fm
```

It must list only `field-platform:cleaningOrdersApi`, `field-platform:projectCleaningOrdersToWallboard`, and `database` for `bring-fm`. The explicit codebase prefix is required by this repository's multi-codebase Firebase configuration. To apply after the PR is merged:

```powershell
node release/cleaning-center-deployment.js --project bring-fm --apply --confirm-project bring-fm
```

The command fetches the official release branch, refuses a source commit not yet merged there, refuses a dirty checkout, deploys the exact allowlist, and checks `firebase functions:list` for both function names. It never prints or retrieves Secret Manager values. The script deliberately fails if the manifest allowlist changes or general Functions deployment is enabled.

The CRM updater and physical TV still require their own release/runtime checks after this backend step.
