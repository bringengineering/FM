"use strict";

const { execFileSync } = require("node:child_process");

const CRM_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CRM_TAG_PATTERN = /^crm-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CRM_RESERVATION_PATTERN = /^refs\/heads\/crm-release-reservations\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const CRM_RELEASE_TYPES = Object.freeze(["patch", "minor", "major"]);
const CRM_RELEASE_TYPE_INDEX = Object.freeze({ major: 0, minor: 1, patch: 2 });

function releaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseVersion(value, code = "CRM_RELEASE_VERSION_INVALID") {
  const match = CRM_VERSION_PATTERN.exec(String(value || "").trim());
  if (!match) throw releaseError(code, `Invalid CRM release version: ${String(value || "")}`);
  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw releaseError(code, "CRM release version is outside the safe integer range.");
  return { version: parts.join("."), parts };
}

function parseReleaseType(value, code = "CRM_RELEASE_TYPE_INVALID") {
  const releaseType = String(value || "").trim().toLowerCase();
  if (!CRM_RELEASE_TYPES.includes(releaseType)) {
    throw releaseError(code, `Invalid CRM release type: ${String(value || "")}`);
  }
  return releaseType;
}

function parseTag(tag) {
  const match = CRM_TAG_PATTERN.exec(String(tag || "").trim());
  return match ? { version: match.slice(1).map(Number).join("."), parts: match.slice(1).map(Number) } : null;
}

function parseReservationRef(ref) {
  const match = CRM_RESERVATION_PATTERN.exec(String(ref || "").trim());
  return match ? { version: match.slice(1).map(Number).join("."), parts: match.slice(1).map(Number) } : null;
}

function compareParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function assertSha(value, code = "CRM_RELEASE_SHA_INVALID") {
  const sha = String(value || "").trim().toLowerCase();
  if (!FULL_SHA_PATTERN.test(sha)) throw releaseError(code, `Invalid commit SHA: ${String(value || "")}`);
  return sha;
}

function assertSourceBranch(value) {
  const branch = String(value || "").trim();
  if (!branch || branch.startsWith("-") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{") || /[~^:?*[\\\u0000-\u001f\u007f]/.test(branch)) {
    throw releaseError("CRM_RELEASE_SOURCE_BRANCH_INVALID", "The CRM release source branch is invalid.");
  }
  return branch;
}

function parseLsRemote(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{40})\s+(.+)$/.exec(line.trim());
    if (!match) throw releaseError("CRM_RELEASE_REMOTE_REFS_INVALID", "git ls-remote returned an invalid row.");
    rows.push({ sha: match[1], ref: match[2] });
  }
  return rows;
}

function uniqueClaims(claims) {
  const seen = new Set();
  return claims.filter(claim => {
    const key = `${claim.kind}:${claim.version}:${claim.ref || claim.releaseId || ""}:${claim.sha || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectVersionClaims({ tagRefs = [], reservationRefs = [], releases = [] } = {}) {
  const claims = [];
  const tagStates = new Map();
  for (const item of tagRefs) {
    const rawRef = String(item.ref || "");
    const normalizedRef = rawRef.replace(/\^\{\}$/, "");
    const tagName = normalizedRef.replace(/^refs\/tags\//, "");
    const parsed = parseTag(tagName);
    if (!parsed) continue;
    const state = tagStates.get(normalizedRef) || { kind: "tag", version: parsed.version, parts: parsed.parts, ref: normalizedRef, sha: "", peeledSha: "" };
    if (rawRef.endsWith("^{}")) state.peeledSha = assertSha(item.sha);
    else state.sha = assertSha(item.sha);
    tagStates.set(normalizedRef, state);
  }
  claims.push(...tagStates.values());
  for (const item of reservationRefs) {
    const parsed = parseReservationRef(item.ref);
    if (!parsed) continue;
    claims.push({ kind: "reservation", version: parsed.version, parts: parsed.parts, ref: item.ref, sha: assertSha(item.sha) });
  }
  for (const release of releases) {
    if (!release || typeof release !== "object") continue;
    const parsed = parseTag(release.tag_name);
    if (!parsed) continue;
    claims.push({
      kind: release.draft === true ? "draft" : "release",
      version: parsed.version,
      parts: parsed.parts,
      releaseId: String(release.id || ""),
      target: String(release.target_commitish || ""),
      prerelease: release.prerelease === true,
    });
  }
  return uniqueClaims(claims);
}

function annotatedTagState(tagRefs, tagRef) {
  const objectRows = (Array.isArray(tagRefs) ? tagRefs : []).filter(item => item.ref === tagRef);
  const peeledRows = (Array.isArray(tagRefs) ? tagRefs : []).filter(item => item.ref === `${tagRef}^{}`);
  if (!objectRows.length && !peeledRows.length) return null;
  if (objectRows.length !== 1 || peeledRows.length !== 1) {
    throw releaseError("CRM_RELEASE_TAG_FORMAT_INVALID", `Release tag ${tagRef} must be one deterministic annotated tag.`);
  }
  return { objectSha: assertSha(objectRows[0].sha), commitSha: assertSha(peeledRows[0].sha) };
}

function claimsByVersion(claims) {
  const grouped = new Map();
  for (const claim of claims) {
    if (!grouped.has(claim.version)) grouped.set(claim.version, []);
    grouped.get(claim.version).push(claim);
  }
  return grouped;
}

function incrementVersion(parts, releaseType) {
  const next = [...parts];
  const index = CRM_RELEASE_TYPE_INDEX[releaseType];
  if (!Number.isSafeInteger(index) || next[index] >= Number.MAX_SAFE_INTEGER) {
    throw releaseError("CRM_RELEASE_VERSION_EXHAUSTED", `CRM ${releaseType} version is exhausted.`);
  }
  next[index] += 1;
  for (let resetIndex = index + 1; resetIndex < next.length; resetIndex += 1) next[resetIndex] = 0;
  return next;
}

function highestVersionParts(partsList) {
  return partsList.length ? [...partsList].sort((left, right) => compareParts(right, left))[0] : null;
}

function planNextVersion({ packageVersion, sourceSha, claims, blockedVersions = [], releaseType = "patch" }) {
  const current = parseVersion(packageVersion);
  const normalizedSourceSha = assertSha(sourceSha);
  const normalizedReleaseType = parseReleaseType(releaseType);
  const normalizedClaims = Array.isArray(claims) ? claims : [];
  const parsedBlockedVersions = Array.isArray(blockedVersions) ? blockedVersions.map(value => parseVersion(value)) : [];
  const blocked = new Set(parsedBlockedVersions.map(parsed => parsed.version));
  const globalHighWater = highestVersionParts(normalizedClaims.map(claim => claim.parts).concat(parsedBlockedVersions.map(parsed => parsed.parts)));

  const grouped = claimsByVersion(normalizedClaims);
  const resumable = [...grouped.entries()].filter(([version, entries]) => {
    const reservations = entries.filter(entry => entry.kind === "reservation");
    return !blocked.has(version) && reservations.some(entry => entry.sha === normalizedSourceSha);
  }).sort((left, right) => compareParts(parseVersion(right[0]).parts, parseVersion(left[0]).parts));
  if (resumable.length && globalHighWater && compareParts(parseVersion(resumable[0][0]).parts, globalHighWater) === 0) {
    const [version, entries] = resumable[0];
    const parsed = parseVersion(version);
    return {
      version,
      parts: parsed.parts,
      tag: `crm-v${version}`,
      reservationRef: `refs/heads/crm-release-reservations/v${version}`,
      sourceSha: normalizedSourceSha,
      resume: true,
      claims: entries,
    };
  }

  const latestStable = highestVersionParts(normalizedClaims.filter(claim => claim.kind === "release" && claim.prerelease !== true && claim.verifiedStable === true).map(claim => claim.parts));
  const requestedCandidate = incrementVersion(latestStable || current.parts, normalizedReleaseType);
  const parts = !globalHighWater || compareParts(requestedCandidate, globalHighWater) > 0
    ? requestedCandidate
    : incrementVersion(globalHighWater, "patch");
  const version = parts.join(".");
  return {
    version,
    parts,
    tag: `crm-v${version}`,
    reservationRef: `refs/heads/crm-release-reservations/v${version}`,
    sourceSha: normalizedSourceSha,
    resume: false,
    claims: [],
  };
}

function assertCanonicalBranchHead({ sourceBranch, sourceSha, branchRefs }) {
  const branch = assertSourceBranch(sourceBranch);
  const sha = assertSha(sourceSha);
  const expectedRef = `refs/heads/${branch}`;
  const matches = (Array.isArray(branchRefs) ? branchRefs : []).filter(item => item.ref === expectedRef);
  if (matches.length !== 1 || assertSha(matches[0].sha) !== sha) {
    throw releaseError("CRM_RELEASE_SOURCE_MOVED", `Remote source branch ${branch} is not exactly ${sha}.`);
  }
  return { branch, sha, ref: expectedRef };
}

function assertReservationFresh({ plan, claims }) {
  const grouped = claimsByVersion(Array.isArray(claims) ? claims : []);
  const entries = grouped.get(plan.version) || [];
  if (plan.resume) {
    const reservations = entries.filter(entry => entry.kind === "reservation");
    if (reservations.length !== 1 || reservations[0].sha !== plan.sourceSha || reservations[0].ref !== plan.reservationRef) {
      throw releaseError("CRM_RELEASE_RESERVATION_CHANGED", "The resumable reservation changed after planning.");
    }
    return { create: false };
  }
  if (entries.length) throw releaseError("CRM_RELEASE_VERSION_CLAIMED", `CRM version ${plan.version} was claimed after planning.`);
  return { create: true };
}

function assertPostReservationOwnership({ plan, claims, tagRefs, releases, inspectCommit }) {
  const entries = (Array.isArray(claims) ? claims : []).filter(claim => claim.version === plan.version);
  const reservations = entries.filter(entry => entry.kind === "reservation");
  if (reservations.length !== 1 || reservations[0].sha !== plan.sourceSha || reservations[0].ref !== plan.reservationRef) {
    throw releaseError("CRM_RELEASE_RESERVATION_CHANGED", "The reserved version is no longer owned by the exact source commit.");
  }
  const releaseClaims = entries.filter(entry => entry.kind === "draft" || entry.kind === "release");
  const tagClaims = entries.filter(entry => entry.kind === "tag");
  if (!tagClaims.length && !releaseClaims.length) return { releaseSha: "", hasRelease: false };
  if (tagClaims.length !== 1 || releaseClaims.length > 1) {
    throw releaseError("CRM_RELEASE_VERSION_CLAIM_CONFLICT", "The reserved version acquired ambiguous tag or release claims.");
  }
  const tagState = annotatedTagState(tagRefs, `refs/tags/${plan.tag}`);
  if (!tagState || typeof inspectCommit !== "function") {
    throw releaseError("CRM_RELEASE_VERSION_CLAIM_CONFLICT", "The reserved version does not have one inspectable annotated tag.");
  }
  const inspected = inspectCommit(tagState.commitSha);
  const versionOnlyFiles = ["desktop-crm/package-lock.json", "desktop-crm/package.json"];
  if (!inspected || !Array.isArray(inspected.parents) || inspected.parents.length !== 1 || assertSha(inspected.parents[0]) !== plan.sourceSha
    || !Array.isArray(inspected.changed) || JSON.stringify([...inspected.changed].sort()) !== JSON.stringify(versionOnlyFiles)
    || inspected.deterministic !== true || inspected.version !== plan.version || inspected.lockVersion !== plan.version || inspected.rootLockVersion !== plan.version) {
    throw releaseError("CRM_RELEASE_VERSION_CLAIM_CONFLICT", "The reserved tag is not a version-only child of the exact source commit.");
  }
  if (releaseClaims.length) {
    const matchingReleases = (Array.isArray(releases) ? releases : []).filter(release => release && release.tag_name === plan.tag);
    if (matchingReleases.length !== 1 || assertSha(matchingReleases[0].target_commitish, "CRM_RELEASE_TARGET_INVALID") !== tagState.commitSha) {
      throw releaseError("CRM_RELEASE_VERSION_CLAIM_CONFLICT", "The reserved GitHub Release target differs from its annotated tag.");
    }
  }
  return { releaseSha: tagState.commitSha, hasRelease: releaseClaims.length === 1 };
}

function resolveStablePublishedState({ plan, claims, tagRefs, releases, inspectCommit }) {
  if (!plan || !plan.resume) return null;
  const versionClaims = (Array.isArray(claims) ? claims : []).filter(claim => claim.version === plan.version);
  const publishedClaims = versionClaims.filter(claim => claim.kind === "release");
  if (!publishedClaims.length) return null;
  if (publishedClaims.length !== 1 || versionClaims.some(claim => claim.kind === "draft")) {
    throw releaseError("CRM_RELEASE_STABLE_STATE_AMBIGUOUS", "Stable same-source release state is ambiguous.");
  }
  const releaseMatches = (Array.isArray(releases) ? releases : []).filter(release => release && release.tag_name === plan.tag && release.draft !== true);
  if (releaseMatches.length !== 1) throw releaseError("CRM_RELEASE_STABLE_STATE_AMBIGUOUS", "Stable GitHub Release must be unique.");
  const release = releaseMatches[0];
  if (release.prerelease === true) throw releaseError("CRM_RELEASE_STABLE_STATE_INVALID", "Stable CRM release cannot be a prerelease.");
  const releaseSha = assertSha(release.target_commitish, "CRM_RELEASE_STABLE_TARGET_INVALID");
  const tagState = annotatedTagState(tagRefs, `refs/tags/${plan.tag}`);
  if (!tagState || tagState.commitSha !== releaseSha) throw releaseError("CRM_RELEASE_STABLE_TAG_MISMATCH", "Stable CRM tag does not peel to its exact release target.");
  if (typeof inspectCommit !== "function") throw releaseError("CRM_RELEASE_STABLE_INSPECTOR_REQUIRED", "Stable release commit inspector is required.");
  const inspected = inspectCommit(releaseSha);
  const versionOnlyFiles = ["desktop-crm/package-lock.json", "desktop-crm/package.json"];
  if (!inspected || !Array.isArray(inspected.parents) || inspected.parents.length !== 1 || assertSha(inspected.parents[0]) !== plan.sourceSha
    || !Array.isArray(inspected.changed) || JSON.stringify([...inspected.changed].sort()) !== JSON.stringify(versionOnlyFiles)
    || inspected.deterministic !== true || inspected.version !== plan.version || inspected.lockVersion !== plan.version || inspected.rootLockVersion !== plan.version) {
    throw releaseError("CRM_RELEASE_STABLE_COMMIT_MISMATCH", "Stable release commit is not the deterministic version-only child of the reserved source.");
  }
  const installer = `BRING.CRM.Company.Setup.${plan.version}.exe`;
  const expectedAssets = [installer, `${installer}.blockmap`, "latest.yml"];
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const names = assets.map(asset => String(asset && asset.name || ""));
  if (assets.length !== 3 || new Set(names).size !== 3 || JSON.stringify([...names].sort()) !== JSON.stringify([...expectedAssets].sort())
    || assets.some(asset => !Number.isSafeInteger(Number(asset.size)) || Number(asset.size) <= 0)) {
    throw releaseError("CRM_RELEASE_STABLE_ASSETS_INVALID", "Stable same-source release does not have the exact three non-empty assets.");
  }
  return { version: plan.version, releaseSha, tagObjectSha: tagState.objectSha, release };
}

function git(args, options = {}) {
  const environment = Object.assign({}, process.env);
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (token) {
    const existingCount = Number(environment.GIT_CONFIG_COUNT || 0);
    if (!Number.isSafeInteger(existingCount) || existingCount < 0) throw releaseError("CRM_RELEASE_GIT_CONFIG_INVALID", "GIT_CONFIG_COUNT is invalid.");
    environment.GIT_CONFIG_COUNT = String(existingCount + 1);
    environment[`GIT_CONFIG_KEY_${existingCount}`] = "http.https://github.com/.extraheader";
    environment[`GIT_CONFIG_VALUE_${existingCount}`] = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return execFileSync("git", args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    env: environment,
  }).trim();
}

function inspectDeterministicReleaseCommit({ cwd = process.cwd(), releaseSha, sourceSha, version }) {
  const releaseCommit = assertSha(releaseSha);
  const sourceCommit = assertSha(sourceSha);
  const releaseVersion = parseVersion(version).version;
  const packageAtSource = JSON.parse(git(["show", `${sourceCommit}:desktop-crm/package.json`], { cwd }));
  const lockAtSource = JSON.parse(git(["show", `${sourceCommit}:desktop-crm/package-lock.json`], { cwd }));
  const packageAtCommitText = git(["show", `${releaseCommit}:desktop-crm/package.json`], { cwd });
  const lockAtCommitText = git(["show", `${releaseCommit}:desktop-crm/package-lock.json`], { cwd });
  const packageAtCommit = JSON.parse(packageAtCommitText);
  const lockAtCommit = JSON.parse(lockAtCommitText);
  const expectedPackage = Object.assign({}, packageAtSource, { version: releaseVersion });
  const expectedLock = Object.assign({}, lockAtSource, {
    version: releaseVersion,
    packages: Object.assign({}, lockAtSource.packages, {
      "": Object.assign({}, lockAtSource.packages && lockAtSource.packages[""], { version: releaseVersion }),
    }),
  });
  const parents = git(["show", "-s", "--format=%P", releaseCommit], { cwd }).split(/\s+/).filter(Boolean);
  const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", releaseCommit], { cwd }).split(/\r?\n/).filter(Boolean).sort();
  const sourceCommitter = git(["cat-file", "-p", sourceCommit], { cwd }).split(/\r?\n/).find(line => line.startsWith("committer ")) || "";
  const timestamp = /(\d+ [+-]\d{4})$/.exec(sourceCommitter);
  const tree = git(["show", "-s", "--format=%T", releaseCommit], { cwd });
  const identity = "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>";
  const expectedCommit = timestamp ? [
    `tree ${tree}`,
    `parent ${sourceCommit}`,
    `author ${identity} ${timestamp[1]}`,
    `committer ${identity} ${timestamp[1]}`,
    "",
    `chore(release): crm v${releaseVersion}`,
  ].join("\n") : "";
  const rawCommit = git(["cat-file", "-p", releaseCommit], { cwd });
  const deterministic = parents.length === 1 && parents[0] === sourceCommit
    && packageAtCommitText === JSON.stringify(expectedPackage, null, 2)
    && lockAtCommitText === JSON.stringify(expectedLock, null, 2)
    && rawCommit === expectedCommit;
  return {
    parents,
    changed,
    version: packageAtCommit.version,
    lockVersion: lockAtCommit.version,
    rootLockVersion: lockAtCommit.packages && lockAtCommit.packages[""] && lockAtCommit.packages[""].version,
    deterministic,
  };
}

function listRemoteRefs({ cwd = process.cwd(), remote = "origin" } = {}) {
  const tagRows = parseLsRemote(git(["ls-remote", "--tags", remote, "refs/tags/crm-v*"], { cwd }));
  const reservationRows = parseLsRemote(git(["ls-remote", "--heads", remote, "refs/heads/crm-release-reservations/v*"], { cwd }));
  return { tagRefs: tagRows, reservationRefs: reservationRows };
}

function listRemoteBranch({ sourceBranch, cwd = process.cwd(), remote = "origin" }) {
  const branch = assertSourceBranch(sourceBranch);
  return parseLsRemote(git(["ls-remote", "--heads", remote, `refs/heads/${branch}`], { cwd }));
}

function githubHeaders(token, extra = {}) {
  if (!token) throw releaseError("CRM_RELEASE_GITHUB_TOKEN_REQUIRED", "GITHUB_TOKEN is required so draft releases are included.");
  return Object.assign({
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "BRING-CRM-Release",
    "X-GitHub-Api-Version": "2022-11-28",
  }, extra);
}

async function listGithubReleases({ owner, repo, token, fetchImpl = globalThis.fetch, maximumPages = 10 }) {
  if (typeof fetchImpl !== "function") throw releaseError("CRM_RELEASE_FETCH_UNAVAILABLE", "fetch is unavailable.");
  const releases = [];
  for (let page = 1; page <= maximumPages; page += 1) {
    const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100&page=${page}`, {
      headers: githubHeaders(token),
    });
    if (!response || !response.ok) throw releaseError("CRM_RELEASE_GITHUB_UNAVAILABLE", `GitHub releases request failed (${response && response.status || 0}).`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw releaseError("CRM_RELEASE_GITHUB_INVALID", "GitHub releases response is not an array.");
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
  throw releaseError("CRM_RELEASE_GITHUB_PAGINATION_LIMIT", "GitHub releases exceeded the configured pagination limit.");
}

function writeGithubOutput(values, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const fs = require("node:fs");
  const lines = Object.entries(values).map(([key, value]) => {
    const normalized = String(value ?? "");
    if (/\r|\n/.test(normalized)) throw releaseError("CRM_RELEASE_OUTPUT_INVALID", `GitHub output ${key} contains a newline.`);
    return `${key}=${normalized}`;
  });
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

module.exports = {
  CRM_VERSION_PATTERN,
  CRM_TAG_PATTERN,
  CRM_RESERVATION_PATTERN,
  CRM_RELEASE_TYPES,
  releaseError,
  parseVersion,
  parseReleaseType,
  parseTag,
  parseReservationRef,
  compareParts,
  assertSha,
  assertSourceBranch,
  parseLsRemote,
  collectVersionClaims,
  annotatedTagState,
  claimsByVersion,
  planNextVersion,
  assertCanonicalBranchHead,
  assertReservationFresh,
  assertPostReservationOwnership,
  resolveStablePublishedState,
  git,
  inspectDeterministicReleaseCommit,
  listRemoteRefs,
  listRemoteBranch,
  githubHeaders,
  listGithubReleases,
  writeGithubOutput,
};
