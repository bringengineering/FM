# CRM Drive OAuth broker release

The approved fix adds only `crmDriveOAuth` in `bring-fm`, asia-northeast3.
General Functions deployment remains disabled. No rules, Hosting, OAuth scopes,
IAM grants or secret versions are changed. Existing `DRIVE_CLIENT_ID` and
`DRIVE_CLIENT_SECRET` are used only in the function runtime; the shared field
platform refresh token/root folder are not bound to this function.

Before publishing: check other releases, merge the current release branch, inspect
all tags/drafts/reservations, and atomically reserve the next version using the
existing release scripts. Run the full Desktop, Worker, Functions and Emulator
tests and validate the installer. Only then deploy this one server function and
publish the installer. Never publish the desktop client if server verification fails.

After merging, from a clean exact release-branch checkout:

    node release/crm-drive-oauth-deployment.js --project bring-fm
    node release/crm-drive-oauth-deployment.js --project bring-fm --apply --confirm-project bring-fm

This first-deployment-only guard checks the live function inventory and fails if
the broker already exists. It verifies every other function's code hash is
unchanged afterward. Capture the pre-deployment inventory and source SHA before
applying. Rollback before desktop publication: stop the release and leave this
unused authenticated endpoint in place, with no data migration or shared-token
change. Removal or an update to an existing endpoint needs a separately reviewed
rollback plan; never delete unrelated Functions or force/reuse a release version.

Verify unauthenticated POST is denied (401), invalid methods denied (405), then
use a canonical CRM member/admin to check server/client configuration and Google
consent, photo listing, app restart and expired-access-token refresh. A successful
browser callback is only consent received, not proof of completed connection.
Real Google consent cannot be simulated by the unit/Emulator tests. If the
existing secret pair does not match the configured Desktop client, stop and
request credential setup; never replace or print the existing secrets.
