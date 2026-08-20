"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const ClientPolicy = require("../src/crm-update-policy");
const {
  CHANNEL_REF,
  MAX_CHANNEL_BYTES,
  assertNewestStableRelease,
  buildUpdateChannel,
  parseUpdateChannel,
  publishUpdateChannel,
} = require("../scripts/release/publish-update-channel");
const { advanceUpdateChannel } = require("../scripts/release/advance-update-channel");

function fixture(version, publishedAt = "2026-08-20T01:29:12Z") {
  const installerName = `BRING.CRM.Company.Setup.${version}.exe`;
  const installer = Buffer.from(`installer-${version}`);
  const sha512 = crypto.createHash("sha512").update(installer).digest("base64");
  const manifest = Buffer.from([
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${publishedAt}'`,
    "",
  ].join("\n"));
  const tag = `crm-v${version}`;
  const release = { tag_name: tag, draft: false, prerelease: false, published_at: publishedAt };
  const bodies = new Map([
    [installerName, installer],
    [`${installerName}.blockmap`, Buffer.from(`blockmap-${version}`)],
    ["latest.yml", manifest],
  ]);
  return { release, bodies, pointer: buildUpdateChannel({ version, release, bodies }) };
}

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function stableReleaseFixture(version, sourceSha, releaseSha) {
  const built = fixture(version);
  const names = [...built.bodies.keys()];
  const tag = `crm-v${version}`;
  const assets = names.map((name, index) => ({
    id: index + 101,
    name,
    state: "uploaded",
    size: built.bodies.get(name).length,
    url: `https://api.github.com/repos/bringengineering/FM/releases/assets/${index + 101}`,
    browser_download_url: `https://github.com/bringengineering/FM/releases/download/${tag}/${encodeURIComponent(name)}`,
  }));
  return {
    built,
    remoteRefs: {
      tagRefs: [
        { ref: `refs/tags/${tag}`, sha: "a".repeat(40) },
        { ref: `refs/tags/${tag}^{}`, sha: releaseSha },
      ],
      reservationRefs: [{ ref: `refs/heads/crm-release-reservations/v${version}`, sha: sourceSha }],
    },
    release: {
      id: 88,
      tag_name: tag,
      target_commitish: releaseSha,
      draft: false,
      prerelease: false,
      published_at: built.release.published_at,
      assets,
    },
  };
}

function inspectedRelease(version, sourceSha) {
  return {
    parents: [sourceSha],
    changed: ["desktop-crm/package-lock.json", "desktop-crm/package.json"],
    deterministic: true,
    version,
    lockVersion: version,
    rootLockVersion: version,
  };
}

function fakeChannelApi(initialText = "") {
  let sequence = 1;
  const nextSha = () => (sequence++).toString(16).padStart(40, "0");
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const calls = [];
  let refSha = "";
  let conflict = null;

  const install = text => {
    const blobSha = nextSha();
    const treeSha = nextSha();
    const commitSha = nextSha();
    blobs.set(blobSha, Buffer.from(text));
    trees.set(treeSha, [{ path: "latest.json", mode: "100644", type: "blob", sha: blobSha }]);
    commits.set(commitSha, { treeSha, parents: refSha ? [refSha] : [] });
    refSha = commitSha;
    return commitSha;
  };
  if (initialText) install(initialText);

  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, body });
    if (method === "GET" && path.endsWith("/git/ref/heads/crm-update-channel")) {
      return refSha
        ? jsonResponse(200, { ref: CHANNEL_REF, object: { type: "commit", sha: refSha } })
        : jsonResponse(404, { message: "Not Found" });
    }
    const commitMatch = path.match(/\/git\/commits\/([a-f0-9]{40})$/);
    if (method === "GET" && commitMatch) {
      const commit = commits.get(commitMatch[1]);
      return commit ? jsonResponse(200, { sha: commitMatch[1], tree: { sha: commit.treeSha }, parents: commit.parents.map(sha => ({ sha })) }) : jsonResponse(404, {});
    }
    const treeMatch = path.match(/\/git\/trees\/([a-f0-9]{40})$/);
    if (method === "GET" && treeMatch) {
      const tree = trees.get(treeMatch[1]);
      return tree ? jsonResponse(200, { sha: treeMatch[1], truncated: false, tree }) : jsonResponse(404, {});
    }
    const blobMatch = path.match(/\/git\/blobs\/([a-f0-9]{40})$/);
    if (method === "GET" && blobMatch) {
      const bytes = blobs.get(blobMatch[1]);
      return bytes ? jsonResponse(200, { sha: blobMatch[1], encoding: "base64", size: bytes.length, content: bytes.toString("base64") }) : jsonResponse(404, {});
    }
    if (method === "POST" && path.endsWith("/git/blobs")) {
      const sha = nextSha();
      blobs.set(sha, Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8"));
      return jsonResponse(201, { sha });
    }
    if (method === "POST" && path.endsWith("/git/trees")) {
      const sha = nextSha();
      trees.set(sha, body.tree);
      return jsonResponse(201, { sha });
    }
    if (method === "POST" && path.endsWith("/git/commits")) {
      const sha = nextSha();
      commits.set(sha, { treeSha: body.tree, parents: body.parents });
      return jsonResponse(201, { sha });
    }
    if (method === "POST" && path.endsWith("/git/refs")) {
      if (conflict) return conflict({ install, body, current: () => refSha });
      if (refSha) return jsonResponse(422, {});
      refSha = body.sha;
      return jsonResponse(201, { ref: body.ref, object: { sha: refSha } });
    }
    if (method === "PATCH" && path.endsWith("/git/refs/heads/crm-update-channel")) {
      if (conflict) return conflict({ install, body, current: () => refSha });
      const commit = commits.get(body.sha);
      if (!commit || commit.parents.length !== 1 || commit.parents[0] !== refSha || body.force !== false) return jsonResponse(422, {});
      refSha = body.sha;
      return jsonResponse(200, { ref: CHANNEL_REF, object: { sha: refSha } });
    }
    return jsonResponse(500, { unexpected: `${method} ${path}` });
  };
  return {
    fetchImpl,
    calls,
    current: () => refSha,
    install,
    setConflict(handler) { conflict = handler; },
  };
}

test("builds one bounded exact-schema pointer from immutable manifest and installer bytes", () => {
  const built = fixture("1.8.8");
  const value = built.pointer;
  assert.ok(Buffer.byteLength(value.text, "utf8") <= MAX_CHANNEL_BYTES);
  assert.deepEqual(parseUpdateChannel(value.text), value.value);
  assert.deepEqual(ClientPolicy.parseCrmChannelPointer(value.text), value.value);
  assert.doesNotThrow(() => ClientPolicy.assertCrmPointerManifest(built.bodies.get("latest.yml").toString("utf8"), value.value));
  assert.equal(value.value.publishedAt, "2026-08-20T01:29:12.000Z");
  assert.equal(value.value.manifest.sha256, crypto.createHash("sha256").update(built.bodies.get("latest.yml")).digest("hex"));
  assert.throws(() => parseUpdateChannel(JSON.stringify({ ...value.value, unexpected: true })), error => error.code === "CRM_UPDATE_CHANNEL_SCHEMA_INVALID");
  const wrongBodies = new Map(built.bodies);
  wrongBodies.set("BRING.CRM.Company.Setup.1.8.8.exe", Buffer.from("different"));
  assert.throws(
    () => buildUpdateChannel({ version: "1.8.8", release: built.release, bodies: wrongBodies }),
    error => error.code === "CRM_UPDATE_CHANNEL_MANIFEST_MISMATCH"
  );
});

test("rejects advancing an older target after any newer stable CRM release exists", () => {
  assert.throws(
    () => assertNewestStableRelease([
      { tag_name: "crm-v1.8.8", draft: false, prerelease: false },
      { tag_name: "crm-v1.8.9", draft: false, prerelease: false },
    ], "1.8.8"),
    error => error.code === "CRM_UPDATE_CHANNEL_TARGET_SUPERSEDED"
  );
  assert.equal(assertNewestStableRelease([{ tag_name: "crm-v9.0.0", draft: true }], "1.8.8"), true);
});

test("bootstraps the dedicated branch with one root commit and then verifies the exact ref", async () => {
  const api = fakeChannelApi();
  const pointer = fixture("1.8.8").pointer;
  const result = await publishUpdateChannel({ owner: "bringengineering", repo: "FM", token: "token", pointer, fetchImpl: api.fetchImpl });
  assert.equal(result.advanced, true);
  assert.equal(result.status, "advanced");
  const createRef = api.calls.find(call => call.method === "POST" && call.path.endsWith("/git/refs"));
  assert.deepEqual(createRef.body.ref, CHANNEL_REF);
  const commit = api.calls.find(call => call.method === "POST" && call.path.endsWith("/git/commits"));
  assert.deepEqual(commit.body.parents, []);
});

test("same-source retry is an exact no-op and creates no Git objects", async () => {
  const pointer = fixture("1.8.8").pointer;
  const api = fakeChannelApi(pointer.text);
  const result = await publishUpdateChannel({ owner: "bringengineering", repo: "FM", token: "token", pointer, fetchImpl: api.fetchImpl });
  assert.equal(result.advanced, false);
  assert.equal(result.status, "current");
  assert.equal(api.calls.some(call => call.method === "POST" || call.method === "PATCH"), false);
});

test("a failed compare-and-swap leaves the previous channel ref unchanged", async () => {
  const oldPointer = fixture("1.8.7").pointer;
  const nextPointer = fixture("1.8.8").pointer;
  const api = fakeChannelApi(oldPointer.text);
  const initial = api.current();
  api.setConflict(() => jsonResponse(422, { message: "ref changed" }));
  await assert.rejects(
    publishUpdateChannel({ owner: "bringengineering", repo: "FM", token: "token", pointer: nextPointer, fetchImpl: api.fetchImpl }),
    error => error.code === "CRM_UPDATE_CHANNEL_REF_CONFLICT"
  );
  assert.equal(api.current(), initial);
  const patch = api.calls.find(call => call.method === "PATCH");
  assert.equal(patch.body.force, false);
});

test("a concurrent newer pointer wins without being overwritten", async () => {
  const oldPointer = fixture("1.8.7").pointer;
  const target = fixture("1.8.8").pointer;
  const newer = fixture("1.8.9").pointer;
  const api = fakeChannelApi(oldPointer.text);
  api.setConflict(({ install }) => {
    install(newer.text);
    return jsonResponse(422, { message: "ref changed" });
  });
  const result = await publishUpdateChannel({ owner: "bringengineering", repo: "FM", token: "token", pointer: target, fetchImpl: api.fetchImpl });
  assert.equal(result.advanced, false);
  assert.equal(result.status, "concurrent-superseded");
  assert.equal(result.value.version, "1.8.9");
});

test("the release orchestrator binds tag, reservation, exact remote bytes, and the atomic pointer", async () => {
  const sourceSha = "b".repeat(40);
  const releaseSha = "c".repeat(40);
  const stable = stableReleaseFixture("1.8.8", sourceSha, releaseSha);
  const api = fakeChannelApi();
  const byUrl = new Map(stable.release.assets.map(asset => [asset.url, stable.built.bodies.get(asset.name)]));
  const fetchImpl = async (url, options) => {
    if (byUrl.has(url)) {
      const bytes = byUrl.get(url);
      return { ok: true, status: 200, async arrayBuffer() { return bytes; } };
    }
    return api.fetchImpl(url, options);
  };
  const result = await advanceUpdateChannel({
    version: "1.8.8",
    sourceSha,
    releaseSha,
    owner: "bringengineering",
    repo: "FM",
    token: "token",
    fetchImpl,
    listRefs: () => stable.remoteRefs,
    listReleases: async () => [stable.release],
    inspectCommit: () => inspectedRelease("1.8.8", sourceSha),
  });
  assert.equal(result.channel_advanced, "true");
  assert.equal(result.channel_status, "advanced");
});

test("the release orchestrator rejects a non-deterministic release commit before network mutation", async () => {
  const sourceSha = "1".repeat(40);
  const releaseSha = "2".repeat(40);
  const api = fakeChannelApi();
  await assert.rejects(
    advanceUpdateChannel({
      version: "1.8.8",
      sourceSha,
      releaseSha,
      owner: "bringengineering",
      repo: "FM",
      token: "token",
      fetchImpl: api.fetchImpl,
      inspectCommit: () => ({ ...inspectedRelease("1.8.8", sourceSha), deterministic: false }),
    }),
    error => error.code === "CRM_UPDATE_CHANNEL_RELEASE_COMMIT_INVALID"
  );
  assert.deepEqual(api.calls, []);
});

test("a release identity change after byte verification aborts before any channel mutation", async () => {
  const sourceSha = "d".repeat(40);
  const releaseSha = "e".repeat(40);
  const stable = stableReleaseFixture("1.8.8", sourceSha, releaseSha);
  const api = fakeChannelApi();
  const byUrl = new Map(stable.release.assets.map(asset => [asset.url, stable.built.bodies.get(asset.name)]));
  let listCount = 0;
  await assert.rejects(
    advanceUpdateChannel({
      version: "1.8.8",
      sourceSha,
      releaseSha,
      owner: "bringengineering",
      repo: "FM",
      token: "token",
      fetchImpl: async (url, options) => byUrl.has(url)
        ? { ok: true, status: 200, async arrayBuffer() { return byUrl.get(url); } }
        : api.fetchImpl(url, options),
      listRefs: () => stable.remoteRefs,
      inspectCommit: () => inspectedRelease("1.8.8", sourceSha),
      listReleases: async () => {
        listCount += 1;
        return listCount === 1
          ? [stable.release]
          : [{ ...stable.release, assets: stable.release.assets.map((asset, index) => index ? asset : { ...asset, id: 999, url: "https://api.github.com/repos/bringengineering/FM/releases/assets/999" }) }];
      },
    }),
    error => error.code === "CRM_UPDATE_CHANNEL_RELEASE_CHANGED"
  );
  assert.equal(listCount, 2);
  assert.equal(api.calls.some(call => /\/git\/(blobs|trees|commits|refs)/.test(call.path) && call.method !== "GET"), false);
});
