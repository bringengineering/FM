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

## Common-cleaning report schema rollout

The `common-v2` photo categories require only `cleaningOrdersApi`. Use an already authorized operator's normal CLI authentication; do not expand the Rules-only GitHub identity or retrieve Secret Manager values. From the latest clean operating-branch checkout after CI passes:

```bash
node release/crm-cleaning-report-deployment.cjs --operator --project bring-fm --confirm-project bring-fm --backup-dir /absolute/private/fresh-backup-directory
```

This path validates the unchanged deployment manifest, captures the existing function inventory and immutable regional source archive before deployment, and deploys only `functions:field-platform:cleaningOrdersApi`. Keep the backup directory for rollback. It verifies unrelated functions remain unchanged and that an anonymous request still returns 401 / `cleaning_order_auth_required` with `X-Bring-Cleaning-Report-Schema: common-v2`. No orders or report data are migrated.

The desktop release gate accepts that exact schema response before using its CI credential. It still requires a clean latest source and an immutable installer-version reservation. A missing capability keeps publication blocked. A static schema marker represents compatibility with the additive category catalogue, not a source-commit assertion. New backend behavior must advance the marker and corresponding readiness check when compatibility changes.

Start `CRM Automatic Release` manually from `codex/bring-field-platform` after this backend verification. The read-only preflight input must be false for publication. Release tags and failed version reservations remain immutable.

## Dedicated GitHub report deployment identity

`release/crm-cleaning-report-identity.json` is the public, reviewable identity and permission plan. Provisioning this access is a separate security change requiring action-time approval. Merely merging the workflow does not create Google Cloud access. Do not enlarge the existing Rules/backup identity or export a new service-account key.

Create a dedicated pool `bring-crm-report-github`, its single OIDC provider `github`, and the keyless account `bring-crm-report-deployer@bring-fm.iam.gserviceaccount.com`. The issuer is `https://token.actions.githubusercontent.com`. Apply exactly the JSON attribute mapping and condition: numeric repository/owner IDs, operating branch, `firebase-production` environment, subject, and the exact `crm-release.yml` workflow ref must all match. The pool must have no additional providers. Bind only its `attribute.repository_id/1276587874` principal set to the account as Workload Identity User.

The proposed project roles are Cloud Functions Admin, Firebase Viewer, Secret Manager Viewer (metadata, not secret payload access), and Service Usage Consumer. Grant Service Account User only on the existing default compute runtime account, and Storage Object Viewer only on the specified regional source bucket for rollback backups. These are explicit setup bindings, not changes made by the release script. Verify the runtime account and source bucket in the existing function configuration before granting access; stop rather than widening the plan if they differ.

Cloud Functions Admin is a **project-level** administrative role and also includes Cloud Run permissions; it is not an IAM restriction to a single function. The reviewed workflow and deployment script restrict the actual operation to the existing `cleaningOrdersApi`. Service Account User also lets a deployer run code with that runtime account's permissions. These scopes must be understood when approving the connection. No Owner/Editor role, Secret Accessor role, service-account key, or human-account impersonation is requested.

Only `cleaning-report-preflight` and `deploy-cleaning-report` receive `id-token: write`. The pinned Google auth action writes an ephemeral external-account configuration, which the script validates against the exact account and audience; the auth action cleans it up after the job. The file and Firebase debug logs are excluded from source/artifacts. Dependencies and tests run before authentication. Other release jobs retain their existing credentials and permissions.

After setup, dispatch the read-only preflight first. It must pass Firebase inventory and selected v2 function access checks before the full release. The release captures the immutable source backup, deploys only the selected API, verifies unchanged unrelated functions and continued anonymous denial, then permits Worker and installer publication. Retire access by disabling this dedicated provider or removing its Workload Identity User binding; the existing Rules/backup identity remains independent.

References: [Google federation setup](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [Firebase deployment permissions](https://firebase.google.com/docs/projects/iam/permissions), [pinned authentication action](https://github.com/google-github-actions/auth/tree/7c6bc770dae815cd3e89ee6cdf493a5fab2cc093).
