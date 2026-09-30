# CRM account setup Functions deployment

This is a separate, human-run deployment target for the email-invitation account setup flow. The general Functions gate remains closed. The target is pinned to `bring-fm`, `asia-northeast3`, and exactly four callable functions. It never deploys Database Rules or Hosting; the static page is exported and deployed by the separate Firebase Hosting workflow.

Before applying, the implementation must already be merged into `codex/bring-field-platform`, the checkout must be clean, the complete CRM/Functions/site tests must pass, and Firebase Emulator tests must cover anonymous, admin, viewer, member, disabled, unverified, wrong-provider, and must-change-password identities. Confirm that `bring-fm` is the selected project and that none of the four target functions is already deployed. The command records the live function inventory before making changes and fails closed if it cannot read that baseline.

Inspect the dry-run plan first:

```powershell
node release/crm-account-setup-deployment.js --project bring-fm
```

Apply only after the checks above:

```powershell
node release/crm-account-setup-deployment.js --project bring-fm --apply --confirm-project bring-fm
```

The script refreshes the official release branch, refuses unmerged or dirty source, verifies that the account functions are absent from the live baseline, deploys only their four explicit `functions:field-platform:<name>` selectors, and confirms all four appear in `asia-northeast3`. It does not enable general Functions deployment and does not change Firebase Auth provider settings, Hosting, or any database data/rules.

## Updating an already-deployed account setup flow

The initial deployment script intentionally refuses to replace an existing function. For a reviewed update, use `release/crm-account-setup-update.js`. It requires the checkout to be clean and exactly equal to the latest `codex/bring-field-platform` head, verifies the rollback source is in that branch and contains all four reviewed callables, and refuses to proceed unless the live four functions are all `ACTIVE` in `asia-northeast3` / `field-platform` with one exact code hash matching `--expected-code-hash`. It deploys only those four selectors, then confirms all four are active with one new common hash. Database Rules, Hosting, and unrelated Functions are never selected.

Check the pinned target and provide the exact live code hash plus the last known-good function source commit:

```powershell
node release/crm-account-setup-update.js --project bring-fm
node release/crm-account-setup-update.js --project bring-fm --apply --confirm-project bring-fm --expected-code-hash <current-verified-function-hash> --rollback-source-sha <last-known-good-source-commit>
```

If the pre-deploy hash, function inventory, branch head, or rollback commit differs from the reviewed values, the script stops before writing. Keep the printed prior hash and rollback source SHA as the recovery reference. To roll back, use a clean detached checkout at that SHA, build `functions`, and deploy only the same four explicit selectors to `bring-fm`; do not delete Auth or invitation records. This update path does not change Auth provider settings.

Rollback: the pre-deploy inventory is the baseline. Since the target names must be absent before applying, rollback removes only the newly introduced endpoints using Firebase Console or an explicitly reviewed `firebase functions:delete <name> --region asia-northeast3 --project bring-fm --force` command for each of the four names. Do not delete invitation/user records; preserve them so a redeploy or a new invite link can recover the workflow. Restore the previous Hosting version from Firebase Hosting Releases if the account setup page needs rollback; unrelated existing app routes remain in the preserved previous site version.
