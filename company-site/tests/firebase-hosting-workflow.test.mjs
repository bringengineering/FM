import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workflowPath = path.join(
  repositoryRoot,
  ".github/workflows/firebase-hosting.yml",
);

test("production site workflow builds, verifies, and deploys Firebase Hosting", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /codex\/bring-field-platform/);
  assert.match(workflow, /pnpm\/action-setup/);
  assert.match(workflow, /pnpm --dir company-site install --frozen-lockfile/);
  assert.match(workflow, /pnpm --dir company-site build/);
  assert.match(workflow, /pnpm --dir company-site export:firebase/);
  assert.match(workflow, /building-care\/index\.html/);
  assert.match(workflow, /stair-cleaning\/index\.html/);
  assert.match(workflow, /move-in-cleaning\/index\.html/);
  assert.match(workflow, /FirebaseExtended\/action-hosting-deploy/);
  assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT/);
  assert.match(workflow, /channelId: live/);
  assert.match(workflow, /projectId: bring-fm/);
});
