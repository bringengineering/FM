# CSV original company Drive preservation

Continue original CRM-04 source preservation and company Drive scope, not operational acceptance. Reuse company-only Drive connection, immutable version upload, byte/hash/root verification and current CRM/RND approval. No OAuth configuration or deployment changes.

- [x] RED source service tests for server-owned original bytes and IDs, project/session checks, verified metadata and recovery on uncertain verification.
- [x] Ledger internal original getter returns validated owned bytes; no renderer paths/bytes accepted.
- [x] csv-drive-source.js uploads job original as artifact csv-import-original, stable version job UUID. Fresh shared project required; no database or visit mutation. Preserve verified/unverified recovery in the atomic immutable CSV event journal under captured owner even if late reply cannot be disclosed. Failures never silently retry.
- [x] Main/preload IPC jobId only; existing local-test mode refuses real Drive.
- [x] History explicit company Drive original button with source project guard, separate confirmation and late-session response cleanup. Connect company Drive through existing CRM button. Display historical verified/unverified CSV Drive references, not current Drive permission guarantees. The general artifact upload ledger is not used by this path.
- [ ] Node/native IPC/UI tests; scoped review; rebuild review Windows/source package and inspect hashes. Company real-account/two-PC/Drive and shared ImportJob audit still required.
