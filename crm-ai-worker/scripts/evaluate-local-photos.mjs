// Local opt-in evaluation, never imported by the Worker or packaged in the app.
// No HTTP listener, Firebase bypass, production writes, or raw provider logging.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import * as candidate from "../src/photo-classify.js";
const require = createRequire(import.meta.url);
const { reviewCandidates, mergeReview } = require("../../desktop-crm/src/photo-review-refinement.js");
const { evaluate } = require("../../desktop-crm/src/photo-classification-evaluation.js");
const { classifyPhotosWithGateway } = require("../../desktop-crm/src/ai-photo-classifier-client.js");
const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(workerRoot, "..");
const BASELINE = "c07de033ea1e23912b2b396d957935999b3ebb34";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
const fail = code => Object.assign(new Error(code), { code });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const safeCodes = new Set(["GEMINI_NOT_CONFIGURED", "LOCAL_KEY_INVALID", "LOCAL_INPUT_INVALID", "LOCAL_IMAGE_INVALID", "LOCAL_LIMIT", "LOCAL_ENDPOINT_DENIED", "LOCAL_BASELINE_INVALID", "RATE_LIMITED", "AI_TEMPORARY_FAILURE", "AI_INVALID_RESPONSE", "AI_CONFIGURATION_ERROR", "INVALID_INPUT", "INPUT_TOO_LARGE"]);
export const safeCode = error => safeCodes.has(error?.code) ? error.code : "LOCAL_EVALUATION_FAILED";

export function parseLocalKey(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16384) throw fail("LOCAL_KEY_INVALID");
  const matches = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter(line => /^\s*GEMINI_API_KEY\s*=/u.test(line));
  if (matches.length !== 1) throw fail("GEMINI_NOT_CONFIGURED");
  let key = matches[0].slice(matches[0].indexOf("=") + 1).trim();
  if (!key) throw fail("GEMINI_NOT_CONFIGURED");
  if (/^(["']).*\1$/u.test(key)) key = key.slice(1, -1);
  // Keys are opaque: newer authorization keys contain dots. Validate safe
  // header transport only, not an obsolete key alphabet/prefix/short length.
  const masked = /\.{2,}|[…•●]/u.test(key);
  if (!/^[\x21-\x7e]{20,4096}$/u.test(key) || masked || key.includes("GEMINI_API_KEY=") || /["']/u.test(key)) {
    // Closed structural diagnostics only: never include any key characters.
    const keyFormatIssue = key.includes("GEMINI_API_KEY=") ? "duplicated_assignment"
      : /\s/u.test(key) ? "embedded_whitespace"
      : masked ? "masked_value"
      : /["']/u.test(key) ? "unmatched_quotes"
      : key.length < 20 ? "value_too_short"
      : key.length > 4096 ? "value_too_long"
      : "unexpected_characters";
    throw Object.assign(fail("LOCAL_KEY_INVALID"), { keyFormatIssue });
  }
  return key;
}

function readBounded(filename, limit) {
  const fd = fs.openSync(filename, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw fail("LOCAL_INPUT_INVALID");
    const buffer = Buffer.alloc(stat.size + 1);
    const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (size !== stat.size) throw fail("LOCAL_INPUT_INVALID");
    return buffer.subarray(0, size);
  } finally { fs.closeSync(fd); }
}

export function validateJpeg(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > 120 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw fail("LOCAL_IMAGE_INVALID");
  let offset = 2, frameSeen = false;
  for (let i = 0; i < 2048 && offset + 4 <= bytes.length; i++) {
    if (bytes[offset++] !== 255) throw fail("LOCAL_IMAGE_INVALID");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw fail("LOCAL_IMAGE_INVALID");
    // Permit JFIF, but no EXIF/XMP/ICC/IPTC/comments or arbitrary APP payloads.
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) throw fail("LOCAL_IMAGE_INVALID");
    if (marker === 0xe0 && bytes.toString("ascii", offset + 2, offset + 7) !== "JFIF\0") throw fail("LOCAL_IMAGE_INVALID");
    if ([0xc0, 0xc2].includes(marker)) {
      if (length < 8) throw fail("LOCAL_IMAGE_INVALID");
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > 1600 || height > 1600) throw fail("LOCAL_IMAGE_INVALID");
      frameSeen = true;
    }
    if (marker === 0xda) {
      if (!frameSeen || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw fail("LOCAL_IMAGE_INVALID");
      return;
    }
    offset += length;
  }
  throw fail("LOCAL_IMAGE_INVALID");
}

function contained(root, filename) {
  const resolved = fs.realpathSync(filename), rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw fail("LOCAL_INPUT_INVALID");
  return resolved;
}

export function loadDataset(directory) {
  const root = fs.realpathSync(directory);
  // Originals/reference IDs remain outside source control, even in ignored paths.
  if (!path.relative(repoRoot, root).startsWith("..")) throw fail("LOCAL_INPUT_INVALID");
  const referenceBytes = readBounded(contained(root, path.join(root, "selection-and-reference.json")), 256 * 1024);
  const preparedBytes = readBounded(contained(root, path.join(root, "prepared-manifest.json")), 256 * 1024);
  const reference = JSON.parse(referenceBytes), prepared = JSON.parse(preparedBytes);
  if (!Array.isArray(reference.samples) || reference.samples.length < 1 || reference.samples.length > 30 || !Array.isArray(prepared.samples) || prepared.samples.length !== reference.samples.length) throw fail("LOCAL_INPUT_INVALID");
  const refs = new Map(reference.samples.map(sample => [sample.id, sample]));
  if (refs.size !== reference.samples.length) throw fail("LOCAL_INPUT_INVALID");
  const ids = new Set(), labels = [], samples = [];
  for (const row of prepared.samples) {
    const ref = refs.get(row?.id);
    if (!row || !/^[a-z]+-[0-9]{2}$/u.test(row.id) || ids.has(row.id) || !["common", "moveIn"].includes(row.kind) || !ref || ref.kind !== row.kind || !ref.labels || ref.labels.id !== row.id || row.metadataStripped !== true) throw fail("LOCAL_INPUT_INVALID");
    ids.add(row.id);
    const label = { id: row.id };
    for (const axis of ["category", "space", "target", "phase", "scene"]) {
      if (ref.labels[axis] !== undefined) {
        if (typeof ref.labels[axis] !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u.test(ref.labels[axis])) throw fail("LOCAL_INPUT_INVALID");
        label[axis] = ref.labels[axis];
      }
    }
    const whole = readBounded(contained(root, path.join(root, "prepared", `${row.id}-whole.jpg`)), 120 * 1024);
    const detail = readBounded(contained(root, path.join(root, "prepared", `${row.id}-detail.jpg`)), 120 * 1024);
    validateJpeg(whole); validateJpeg(detail);
    if (hash(whole) !== row.wholeSha256 || whole.length !== row.wholeBytes || detail.length !== row.detailBytes) throw fail("LOCAL_INPUT_INVALID");
    samples.push({ id: row.id, kind: row.kind, dataUrl: `data:image/jpeg;base64,${whole.toString("base64")}`, detailDataUrl: `data:image/jpeg;base64,${detail.toString("base64")}`, wholeSha256: hash(whole), detailSha256: hash(detail) });
    labels.push(label);
  }
  return { root, labels, samples, referenceHash: hash(referenceBytes), preparedHash: hash(preparedBytes), preprocessing: "Pillow; same image limits, not byte-identical to Electron", referenceType: "assistant_visual_reference_not_independent_heldout" };
}

export function boundedFetch(fetchImpl, key, audit, deadline) {
  return async (url, options) => {
    if (url !== ENDPOINT || options?.method !== "POST" || options.redirect !== "manual" || options.headers?.["x-goog-api-key"] !== key) throw fail("LOCAL_ENDPOINT_DENIED");
    if (audit.apiCalls >= 16 || deadline.aborted || typeof options.body !== "string" || Buffer.byteLength(options.body) > 5 * 1024 * 1024) throw fail("LOCAL_LIMIT");
    audit.apiCalls++;
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.any([deadline, options.signal || deadline]) });
      audit.httpStatuses.push(response.status);
      if (!response.ok) {
        // Reduce provider diagnostics to fixed labels. Never retain or print the
        // error text, which may echo a key, resource name, or submitted content.
        let message = "";
        const reader = response.body?.getReader();
        if (reader) {
          try {
            const chunks = []; let size = 0;
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.length;
              if (size > 16384) break;
              chunks.push(part.value);
            }
            message = String(JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error?.message || "").toLowerCase();
          } catch {} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const kind = /complex|too.many.states|state.limit|constraint/u.test(message) ? "schema_complexity"
          : /schema/u.test(message) ? "schema_validation"
          : /api.key|credential|authentication/u.test(message) ? "authentication"
          : /quota|rate.limit/u.test(message) ? "quota"
          : /model.*(?:not.found|not.support)/u.test(message) ? "model_unavailable"
          : "provider_rejection";
        const diagnosticWords = [...new Set(message.match(/\b(?:states|maximum|complexity|constraint|constraints|enum|enums|schema|property|properties|field|parameter|tokens|invalid|unsupported|nesting|depth|size|large|many|exceeds|generatecontent|responsejsonschema|response_schema|thinking|budget|dimensions|image|images)\b/gu) || [])];
        (audit.providerErrors ||= []).push({ status: response.status, kind, diagnosticWords });
        return new Response(null, { status: response.status });
      }
      return response;
    } catch { throw fail("AI_TEMPORARY_FAILURE"); }
  };
}

async function payload(api, value) {
  return api.readPhotoClassificationPayload(new Request("https://local.invalid/validation-only", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }));
}

async function clientResult(response, input) {
  // Exercise the real desktop normalization without opening a server, bypassing
  // authentication, or contacting a gateway. The provider call already ran.
  return classifyPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify",
    idToken: "local-evaluation-no-server", input,
    fetchImpl: async () => Response.json({ ok: true, requestId: "local-evaluation", ...response }),
  });
}

async function runVersion(api, dataset, env, fetchImpl, audit, refinement, onStage) {
  const start = performance.now(), initialCalls = audit.apiCalls;
  const result = { classifications: [], firstPass: [], pairs: [], kinds: {}, usage: { inputTokens: 0, outputTokens: 0 }, reviewFailures: 0 };
  for (const kind of ["common", "moveIn"]) {
    const selected = dataset.samples.filter(row => row.kind === kind);
    if (!selected.length) continue;
    const images = selected.map(({ id, dataUrl }) => ({ id, dataUrl }));
    const input = { kind, images };
    const response = await clientResult(await api.classifyPhotos(await payload(api, input), env, fetchImpl), input);
    result.firstPass.push(...response.classifications);
    for (const key of ["inputTokens", "outputTokens"]) result.usage[key] += response.usage[key];
    let classifications = response.classifications;
    if (refinement) {
      const reviewIds = new Set(reviewCandidates(classifications));
      if (reviewIds.size) {
        try {
          const reviewInput = { kind, mode: "review", images: selected.filter(row => reviewIds.has(row.id)).map(({ id, dataUrl, detailDataUrl }) => ({ id, dataUrl, detailDataUrl })) };
          const reviewed = await clientResult(await api.classifyPhotos(await payload(api, reviewInput), env, fetchImpl, 30000), reviewInput);
          classifications = mergeReview(classifications, reviewed.classifications);
          for (const key of ["inputTokens", "outputTokens"]) result.usage[key] += reviewed.usage[key];
        } catch (error) {
          result.reviewFailures++;
          // No retry. As in the app, preserve the first-pass result.
          onStage({ stage: "refinement_failed", kind, code: safeCode(error) });
        }
      }
    }
    result.classifications.push(...classifications);
    result.kinds[kind] = evaluate(dataset.labels.filter(label => selected.some(row => row.id === label.id)), { classifications });
    onStage({ stage: "classified", kind, count: classifications.length });
  }
  result.apiCalls = audit.apiCalls - initialCalls;
  result.durationMs = Math.round(performance.now() - start);
  return result;
}

export async function main(argv) {
  const probe = argv[0] === "--candidate-probe";
  const onlyCandidate = argv[0] === "--candidate-only" || probe;
  const live = argv[0] === "--live" || onlyCandidate, check = argv[0] === "--check";
  if ((!live && !check) || argv.length !== 3 || argv[1] !== "--dataset") throw fail("LOCAL_INPUT_INVALID");
  const dataset = loadDataset(argv[2]);
  if (probe) {
    dataset.samples = dataset.samples.slice(0, 6);
    dataset.labels = dataset.labels.filter(row => dataset.samples.some(sample => sample.id === row.id));
  }
  const key = parseLocalKey(readBounded(path.join(workerRoot, ".dev.vars"), 16384).toString("utf8"));
  for (const kind of ["common", "moveIn"]) {
    const images = dataset.samples.filter(row => row.kind === kind).map(({ id, dataUrl }) => ({ id, dataUrl }));
    if (images.length) await payload(candidate, { kind, images });
  }
  const emit = value => process.stdout.write(JSON.stringify(value) + "\n");
  emit({ status: "ready", keyConfigured: true, photos: dataset.samples.length, live });
  if (!live) return;
  // A fixed reviewed baseline, not an arbitrary ref or downloaded executable.
  const baselineSource = execFileSync("git", ["show", `${BASELINE}:crm-ai-worker/src/photo-classify.js`], { cwd: repoRoot, encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  if (/^\s*import\s/mu.test(baselineSource)) throw fail("LOCAL_BASELINE_INVALID");
  const baseline = await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString("base64")}`);
  const codeHashes = {};
  for (const file of ["crm-ai-worker/src/photo-classify.js", "crm-ai-worker/src/photo-evidence.js", "desktop-crm/src/photo-review-refinement.js", "desktop-crm/src/ai-photo-classifier-client.js"]) codeHashes[file] = hash(readBounded(path.join(repoRoot, file), 256 * 1024));
  const record = { schemaVersion: 1, startedAt: new Date().toISOString(), status: "running", baselineRevision: BASELINE, baselineSourceHash: hash(baselineSource), codeHashes, referenceHash: dataset.referenceHash, preparedHash: dataset.preparedHash, referenceType: dataset.referenceType, preprocessing: dataset.preprocessing, scope: { workerClassification: true, appRefinement: true, pairRecommendations: false, installedAppEndToEnd: false, monthlyReport: false }, labels: dataset.labels, imageHashes: dataset.samples.map(({ id, wholeSha256, detailSha256 }) => ({ id, wholeSha256, detailSha256 })), baseline: null, candidate: null };
  const resultPath = path.join(dataset.root, `model-comparison-${randomUUID()}.json`);
  const output = fs.openSync(resultPath, "wx", 0o600);
  const audit = { apiCalls: 0, httpStatuses: [] };
  const deadline = AbortSignal.timeout(240000);
  const fetchImpl = boundedFetch(fetch, key, audit, deadline);
  const env = { GEMINI_API_KEY: key };
  try {
    const versions = onlyCandidate ? [["candidate", candidate, !probe]] : [["baseline", baseline, false], ["candidate", candidate, true]];
    for (const [name, api, refinement] of versions) {
      emit({ stage: "starting", version: name });
      record[name] = await runVersion(api, dataset, env, fetchImpl, audit, refinement, value => emit({ version: name, ...value }));
      emit({ stage: "completed", version: name, metrics: evaluate(dataset.labels, record[name]) });
    }
    record.status = "completed";
  } catch (error) {
    record.status = "failed"; record.errorCode = safeCode(error);
    throw error;
  } finally {
    record.finishedAt = new Date().toISOString();
    record.audit = audit;
    fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
    fs.closeSync(output);
    // Only the random result basename and aggregate diagnostics, never key/payloads.
    emit({ status: record.status, resultFile: path.basename(resultPath), ...audit });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    const issues = ["duplicated_assignment", "embedded_whitespace", "masked_value", "unmatched_quotes", "value_too_short", "value_too_long", "unexpected_characters"];
    process.stderr.write(JSON.stringify({ error: safeCode(error), ...(issues.includes(error?.keyFormatIssue) ? { keyFormatIssue: error.keyFormatIssue } : {}) }) + "\n");
    process.exitCode = 1;
  });
}
