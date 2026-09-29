# Cleaning Center production deployment

The general Functions deployment gate stays closed, and the Rules-only GitHub identity still has no Cloud Functions permissions. This separate, human-run path is limited to the three reviewed Cleaning Center APIs, the existing Cleaning Center wallboard projection, and the single `bring-fm` Hosting site, which serves the partner app. It does not deploy Database Rules or any other function.

## Preconditions

- The implementation commit is already merged into `codex/bring-field-platform`.
- The checkout contains that commit, has no uncommitted changes, and the Firebase CLI is authenticated as an authorized BRING operator.
- The `bring-fm` project has billing enabled and the required `DRIVE_*` Secret Manager versions available. Deploying Functions can incur Cloud Build, Artifact Registry, and Cloud Run usage charges.
- The company site build has `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` configured and passes `company-site/tests/firebase-partner-export.test.mjs` before Hosting deploy.
- CRM, Functions, Rules, and Worker tests have passed for the merged source. Deployment is not proof of employee-PC or physical-TV validation.

## Commands

From the repository root, first inspect the dry-run plan:

```powershell
node release/cleaning-center-deployment.js --project bring-fm
```

It must list only `field-platform:cleaningOrdersApi`, `field-platform:cleaningPartnerApi`, `field-platform:cleaningRefundsApi`, `field-platform:projectCleaningOrdersToWallboard`, and the single configured Hosting site (`bring-fm`) for `bring-fm`. The explicit codebase prefix is required by this repository's multi-codebase Firebase configuration. To apply after the PR is merged:

```powershell
node release/cleaning-center-deployment.js --project bring-fm --apply --confirm-project bring-fm
```

The command fetches the official release branch, refuses a source commit not yet merged there, refuses a dirty checkout, requires the exported `/partner` route, deploys the exact allowlist, and checks `firebase functions:list` for all four functions. Afterward, verify `/partner` responds over HTTPS and the three APIs return their expected unauthenticated responses. The command never prints or retrieves Secret Manager values. The script deliberately fails if the manifest allowlist changes, another Hosting site is configured, or general Functions deployment is enabled. Database Rules are not part of this release.

The desktop CRM updater runs its own release workflow when this implementation merges to `codex/bring-field-platform`. Employee-PC login and real customer/order verification still require a separate operational smoke test; physical TV validation is outside this release.
