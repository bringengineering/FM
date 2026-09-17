# CSV company Drive original reverification

Continue source preservation and current company Drive original verification. No deployment, OAuth change, DB mutation or company acceptance inference.

- [x] RED tests: only known account-owned CSV Drive references; source hash/version/size/root verifier path; readonly project requirement; fresh session and role; immutable confirmation even late response cannot be disclosed.
- [x] csv-drive-verification.js: Main receives jobId/fileId only, derives all authoritative source metadata from validated job and immutable CSV receipts; verifyVersion checks current company ownership/root/content; append a new VERIFIED event, never replace historical receipt.
- [x] Main/preload guarded IPC, local-test mode rejects actual company calls.
- [x] History per-reference verify button with explicit confirmation, current project guard and session epoch cleanup. Only after verification create canonical Drive link; no external document execution.
- [ ] Full Node/native Main+UI/review; Windows/source package refresh. Real company account and two-PC/shared ImportJob audit remain pending.
