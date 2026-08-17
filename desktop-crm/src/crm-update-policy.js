const RELEASES_API = "https://api.github.com/repos/bringengineering/FM/releases?per_page=50";
const CRM_TAG = /^crm-v(\d+)\.(\d+)\.(\d+)$/;

function versionParts(tag) {
  const match = CRM_TAG.exec(String(tag || ""));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function selectLatestCrmRelease(releases) {
  const candidates = (Array.isArray(releases) ? releases : []).flatMap(release => {
    if (!release || release.draft || release.prerelease) return [];
    const parts = versionParts(release.tag_name);
    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (!parts || !assets.some(asset => asset && asset.name === "latest.yml")) return [];
    return [{ release, parts }];
  }).sort((left, right) => compareVersions(right.parts, left.parts));
  if (!candidates.length) return null;
  const tag = candidates[0].release.tag_name;
  return {
    tag,
    version: candidates[0].parts.join("."),
    feedUrl: `https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(tag)}/`,
  };
}

function channelError(message, cause) {
  const error = new Error(message);
  error.code = "CRM_UPDATE_CHANNEL_UNAVAILABLE";
  if (cause) error.cause = cause;
  return error;
}

async function checkCrmUpdates({ updater, fetchImpl = globalThis.fetch }) {
  try {
    if (typeof fetchImpl !== "function") throw new Error("fetch unavailable");
    const response = await fetchImpl(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "BRING-CRM-Updater" },
    });
    if (!response || !response.ok) throw new Error(`release API ${response && response.status || "failed"}`);
    const selected = selectLatestCrmRelease(await response.json());
    if (!selected) throw new Error("CRM release not found");
    updater.setFeedURL({ provider: "generic", url: selected.feedUrl });
    await updater.checkForUpdates();
    return selected;
  } catch (error) {
    if (error && error.code === "CRM_UPDATE_CHANNEL_UNAVAILABLE") throw error;
    throw channelError("CRM 업데이트 채널을 확인하지 못했습니다.", error);
  }
}

module.exports = { RELEASES_API, selectLatestCrmRelease, checkCrmUpdates };
