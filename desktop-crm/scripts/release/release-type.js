"use strict";

const {
  annotatedTagState,
  assertSha,
  compareParts,
  git,
  inspectDeterministicReleaseCommit,
  parseTag,
  releaseError,
} = require("./release-lib");

const RELEASE_TYPES = Object.freeze(["patch", "minor", "major"]);

function releaseTypeRank(value) {
  return ({ patch: 0, minor: 1, major: 2 })[value] ?? -1;
}

function highestReleaseType(values) {
  return (Array.isArray(values) ? values : []).reduce((highest, value) => (
    releaseTypeRank(value) > releaseTypeRank(highest) ? value : highest
  ), "patch");
}

function commitFooterReleaseType(message) {
  const matches = [...String(message || "").matchAll(/^CRM-Release:\s*([^\r\n]*)$/gim)];
  if (!matches.length) return "";
  const rawValues = matches.map(match => match[1].trim().toLowerCase());
  if (rawValues.some(value => !RELEASE_TYPES.includes(value))) {
    throw releaseError("CRM_RELEASE_TYPE_INVALID", "CRM-Release footer must be patch, minor, or major.");
  }
  const values = [...new Set(rawValues)];
  if (values.length !== 1) {
    throw releaseError("CRM_RELEASE_TYPE_CONFLICT", "The source commit has conflicting CRM-Release footers.");
  }
  return values[0];
}

function conventionalCommitReleaseType(message) {
  const text = String(message || "");
  const header = text.split(/\r?\n/, 1)[0].trim();
  if (/^[a-z][a-z0-9-]*(?:\([^\r\n()]+\))?!:/i.test(header) || /^BREAKING(?: |-)CHANGE:\s*\S/im.test(text)) return "major";
  if (/^feat(?:\([^\r\n()]+\))?:/i.test(header)) return "minor";
  return "patch";
}

function selectReleaseType({ messages = [] } = {}) {
  const normalizedMessages = (Array.isArray(messages) ? messages : []).map(value => String(value || "").trim()).filter(Boolean);
  const sourceFooter = commitFooterReleaseType(normalizedMessages[0] || "");
  if (sourceFooter) return sourceFooter;
  return highestReleaseType(normalizedMessages.map(conventionalCommitReleaseType));
}

function stableReleasesNewestFirst(releases) {
  return (Array.isArray(releases) ? releases : []).map(release => {
    const parsed = release && release.draft !== true && release.prerelease !== true ? parseTag(release.tag_name) : null;
    return parsed ? { release, parsed } : null;
  }).filter(Boolean).sort((left, right) => compareParts(right.parsed.parts, left.parsed.parts));
}

function verifiedStableReleases({ sourceSha, releases, tagRefs, reservationRefs, cwd = process.cwd(), gitImpl = git, inspectCommitImpl = inspectDeterministicReleaseCommit } = {}) {
  const source = assertSha(sourceSha);
  for (const { release } of stableReleasesNewestFirst(releases)) {
    try {
      const parsed = parseTag(release.tag_name);
      const releaseSha = assertSha(release.target_commitish, "CRM_RELEASE_TARGET_INVALID");
      const tagState = annotatedTagState(tagRefs, `refs/tags/${release.tag_name}`);
      if (!tagState || tagState.commitSha !== releaseSha) continue;
      const parents = String(gitImpl(["show", "-s", "--format=%P", releaseSha], { cwd }) || "").split(/\s+/).filter(Boolean);
      if (parents.length !== 1) continue;
      gitImpl(["merge-base", "--is-ancestor", parents[0], source], { cwd });
      const expectedReservationRef = `refs/heads/crm-release-reservations/v${parsed.version}`;
      const reservations = (Array.isArray(reservationRefs) ? reservationRefs : []).filter(item => item.ref === expectedReservationRef && item.sha === parents[0]);
      if (reservations.length !== 1) continue;
      const inspected = inspectCommitImpl({ cwd, releaseSha, sourceSha: parents[0], version: parsed.version });
      const versionOnlyFiles = ["desktop-crm/package-lock.json", "desktop-crm/package.json"];
      if (!inspected || inspected.deterministic !== true || inspected.parents?.length !== 1 || inspected.parents[0] !== parents[0]
        || JSON.stringify([...(inspected.changed || [])].sort()) !== JSON.stringify(versionOnlyFiles)
        || inspected.version !== parsed.version || inspected.lockVersion !== parsed.version || inspected.rootLockVersion !== parsed.version) continue;
      return [{ release, parsed, releaseSha, sourceSha: parents[0] }];
    } catch {
      // Malformed and unrelated Releases remain collision claims, but never
      // become the semantic baseline or commit-history anchor.
    }
  }
  return [];
}

function markVerifiedStableClaims(claims, verifiedReleases) {
  const verified = new Set((Array.isArray(verifiedReleases) ? verifiedReleases : []).map(item => `${item.parsed.version}:${item.releaseSha}`));
  return (Array.isArray(claims) ? claims : []).map(claim => ({
    ...claim,
    verifiedStable: claim.kind === "release" && verified.has(`${claim.version}:${String(claim.target || "").toLowerCase()}`),
  }));
}

function sourceCommitMessages({ sourceSha, verifiedReleases, cwd = process.cwd(), gitImpl = git } = {}) {
  const source = assertSha(sourceSha);
  const previousSource = Array.isArray(verifiedReleases) && verifiedReleases.length
    ? assertSha(verifiedReleases[0].sourceSha)
    : "";
  const revision = previousSource ? `${previousSource}..${source}` : source;
  const raw = String(gitImpl(["log", "--format=%B%x1e", revision], { cwd }) || "");
  const messages = raw.split("\x1e").map(value => value.trim()).filter(Boolean);
  if (messages.length) return messages;
  if (previousSource) return [];
  return [String(gitImpl(["show", "-s", "--format=%B", source], { cwd }) || "").trim()].filter(Boolean);
}

module.exports = {
  RELEASE_TYPES,
  commitFooterReleaseType,
  conventionalCommitReleaseType,
  highestReleaseType,
  markVerifiedStableClaims,
  selectReleaseType,
  sourceCommitMessages,
  stableReleasesNewestFirst,
  verifiedStableReleases,
};
