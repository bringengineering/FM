# Drive sync recovery index

The scheduled recovery worker performs exactly three bounded Realtime Database
queries under `/fieldPlatform/driveSyncJobs`, all ordered by the composite
`recoveryKey` field:

- queued: `startAt("queued|").endAt("queued|\uf8ff").limitToFirst(20)`
- due failed: `startAt("failed|").endAt("failed|<now>|\uf8ff").limitToFirst(20)`
- expired syncing: `startAt("syncing|").endAt("syncing|<now>|\uf8ff").limitToFirst(20)`

`database.rules.json` declares `".indexOn": ["recoveryKey"]` at that node.
Writers atomically maintain keys in the canonical form
`<status>|<canonical ISO time>|<media UUID>`. Terminal, complete, and cancelled
jobs have no recovery key, so they cannot occupy any recovery page. The runtime
revalidates the key against the job fields, skips malformed rows, round-robins
the three pages, and processes at most 24 jobs per invocation. It never reads
the complete job collection.
