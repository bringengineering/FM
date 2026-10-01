# Completed account invitation history

CRM administrators can remove a completed item from **계정 등록 → 계정 설정 현황** using **삭제 → 목록에서 삭제**. Pending invitations keep the resend action. The confirmation explains that the login account and work records remain available.

`archiveCrmAccountInvite` checks the existing verified password-provider CRM administrator role on the server and accepts only a safe UID of a completed invitation. A transaction preserves the original invitation and adds `archivedAt` and `archivedBy`. Retries retain the first audit values. The list excludes archived rows before applying its 200-item limit. No Auth user, CRM access grant, employee profile, or attendance/message record is deleted.

Deploy the six pinned account setup callables using `release/crm-account-setup-update.js` after the complete tests and emulator role checks. The pre-deploy inventory must match the recorded live hash, and the rollback source must be an ancestor of the latest release branch. No Firebase rules deployment or data migration is needed.

Rollback: restore the preceding desktop release/update pointer and redeploy the five pre-existing account callables from the recorded rollback source. Keep the additive archive callable; do not delete user or invitation data. Existing archived records retain their full contents. Restoring a particular archived row is a separate authorized administrative operation removing only its two archive fields, not recreating a login account.
