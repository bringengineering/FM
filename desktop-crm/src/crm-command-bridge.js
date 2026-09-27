const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const ProjectCore = require("./project-core");
const WorkOrderCore = require("./work-order-core");

const PROTOCOL_VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH_SIZE = 20;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const APPROVAL_PHRASE = "CRM 발행 승인";
const PROJECT_KEYS = new Set(["name", "portfolioId", "owner", "goal", "status", "startDate", "endDate", "assignees", "offCapacity"]);
const ORDER_KEYS = new Set(["title", "assigneeUid", "assigneeName", "why", "what", "doneWhen", "track", "startDate", "hours", "weight", "deliverable", "deliverableKind", "deliverableCount", "dueDate"]);

function bridgeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function safeRole(user) {
  return String(user && (user.accessRole || user.role) || "").trim();
}

function safeIdentity(authState) {
  const user = authState && authState.user;
  if (!user) return { connected: false, email: "", role: "", admin: false };
  const role = safeRole(user);
  return {
    connected: true,
    email: String(user.email || "").slice(0, 254),
    role,
    admin: role === "admin",
  };
}

function rejectUnknownKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeError(422, "INVALID_DRAFT", `${label} 형식이 올바르지 않습니다.`);
  }
  const unknown = Object.keys(value).filter(key => !keys.has(key));
  if (unknown.length) throw bridgeError(422, "INVALID_DRAFT", `${label}에 지원하지 않는 항목이 있습니다.`);
}

function createCrmCommandBridge(options = {}) {
  const userDataPath = String(options.userDataPath || "");
  const getAuthState = typeof options.getAuthState === "function" ? options.getAuthState : () => null;
  const saveProject = typeof options.saveProject === "function" ? options.saveProject : null;
  const saveWorkOrder = typeof options.saveWorkOrder === "function" ? options.saveWorkOrder : null;
  const loadWorkOrders = typeof options.loadWorkOrders === "function" ? options.loadWorkOrders : null;
  const refreshWallboard = typeof options.refreshWallboard === "function" ? options.refreshWallboard : null;
  const signalWallboard = typeof options.signalWallboard === "function" ? options.signalWallboard : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;
  const randomBytes = typeof options.randomBytes === "function" ? options.randomBytes : crypto.randomBytes;
  const workOrderCore = options.workOrderCore || WorkOrderCore;
  const projectCore = options.projectCore || ProjectCore;
  const previews = new Map();
  let server = null;
  let port = 0;
  let token = "";
  let manifestPath = "";
  let closed = false;

  const auth = () => {
    try { return getAuthState() || null; } catch (_error) { return null; }
  };

  function requireAdmin() {
    const state = auth();
    if (!state || !state.user) throw bridgeError(401, "AUTH_REQUIRED", "BRING CRM에 로그인해 주세요.");
    if (safeRole(state.user) !== "admin") throw bridgeError(403, "ADMIN_REQUIRED", "BRING CRM 관리자 계정으로 로그인해야 발행할 수 있습니다.");
    return state.user;
  }

  function normalizeDraft(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw bridgeError(422, "INVALID_DRAFT", "초안 형식이 올바르지 않습니다.");
    }
    const inputKeys = Object.keys(input);
    if (inputKeys.some(key => !["project", "workOrders"].includes(key))) {
      throw bridgeError(422, "INVALID_DRAFT", "초안에 지원하지 않는 항목이 있습니다.");
    }
    if (!Array.isArray(input.workOrders) || input.workOrders.length < 1 || input.workOrders.length > MAX_BATCH_SIZE) {
      throw bridgeError(422, "INVALID_DRAFT", `업무지시는 1~${MAX_BATCH_SIZE}건으로 요청해 주세요.`);
    }

    let project = null;
    let projectError = null;
    if (input.project !== undefined && input.project !== null) {
      try {
        rejectUnknownKeys(input.project, PROJECT_KEYS, "프로젝트");
        const id = crypto.randomUUID();
        const checked = projectCore.validateProject(Object.assign({}, input.project, { id }));
        if (!checked.ok) throw bridgeError(422, checked.code || "PROJECT_INVALID", checked.error || "프로젝트 정보를 확인해 주세요.");
        project = checked.project;
      } catch (error) { projectError = { ok: false, code: error.code || "PROJECT_INVALID", error: error.message }; }
    }

    const orders = [];
    const items = [];
    input.workOrders.forEach((raw, index) => {
      try {
        rejectUnknownKeys(raw, ORDER_KEYS, `업무지시 ${index + 1}`);
        const checked = workOrderCore.validatePublication(Object.assign({}, raw, {
          id: crypto.randomUUID(),
          projectId: project ? project.id : "",
          status: "assigned",
          progress: 0,
        }));
        if (!checked.ok) throw bridgeError(422, checked.code || "WORK_ORDER_INVALID", checked.error || "필수 내용을 확인해 주세요.");
        orders.push(checked.order);
        items.push({ index, title: checked.order.title, ok: true });
      } catch (error) {
        items.push({ index, title: String(raw && raw.title || ""), ok: false, code: error.code || "WORK_ORDER_INVALID", error: error.message });
      }
    });
    return { project, workOrders: orders, items, projectError, valid: !projectError && items.every(item => item.ok) };
  }

  async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw bridgeError(413, "BODY_TOO_LARGE", "요청 본문이 허용 크기를 초과했습니다.");
      chunks.push(chunk);
    }
    if (!size) throw bridgeError(400, "BODY_REQUIRED", "요청 내용을 보내 주세요.");
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch (_error) { throw bridgeError(400, "INVALID_JSON", "JSON 요청 형식이 올바르지 않습니다."); }
  }

  function sameToken(candidate) {
    if (typeof candidate !== "string" || !candidate || !token) return false;
    const left = Buffer.from(candidate);
    const right = Buffer.from(token);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function send(response, status, body) {
    const serialized = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(serialized),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(serialized);
  }

  async function previewDraft(input) {
    const user = requireAdmin();
    const normalized = normalizeDraft(input);
    if (!normalized.valid) {
      return { valid: false, project: normalized.project, projectError: normalized.projectError, items: normalized.items, writesPerformed: false };
    }
    const draft = { project: normalized.project, workOrders: normalized.workOrders };
    const canonical = JSON.stringify(draft);
    const previewId = crypto.randomUUID();
    const preview = {
      previewId,
      hash: crypto.createHash("sha256").update(canonical).digest("hex"),
      expiresAt: new Date(now() + PREVIEW_TTL_MS).toISOString(),
      createdByUid: String(user.uid || ""),
      project: draft.project,
      workOrders: draft.workOrders,
      completedProject: false,
      completedOrders: new Map(),
      result: null,
    };
    previews.set(previewId, preview);
    while (previews.size > 50) previews.delete(previews.keys().next().value);
    return {
      valid: true,
      previewId,
      hash: preview.hash,
      expiresAt: preview.expiresAt,
      project: preview.project,
      workOrders: preview.workOrders,
      approvalPhrase: APPROVAL_PHRASE,
      writesPerformed: false,
    };
  }

  async function workOrderContext() {
    requireAdmin();
    if (!loadWorkOrders) throw bridgeError(503, "READ_UNAVAILABLE", "업무지시 조회 경로가 준비되지 않았습니다.");
    const data = await loadWorkOrders();
    if (!data || !Array.isArray(data.members) || !Array.isArray(data.orders)) {
      throw bridgeError(503, "READ_UNAVAILABLE", "업무지시 목록을 확인하지 못했습니다.");
    }
    return {
      members: data.members.slice(0, 200).map(item => ({
        uid: String(item.uid || "").slice(0, 128),
        displayName: String(item.displayName || "").slice(0, 80),
        department: String(item.department || "").slice(0, 60),
      })).filter(item => item.uid),
      orders: data.orders.filter(item => item.status !== "done").slice(0, 500).map(item => ({
        id: String(item.id || "").slice(0, 80),
        title: String(item.title || "").slice(0, 200),
        assigneeUid: String(item.assigneeUid || "").slice(0, 128),
        status: String(item.status || "").slice(0, 20),
        dueDate: String(item.dueDate || "").slice(0, 10),
        createdAt: String(item.createdAt || "").slice(0, 40),
        projectId: String(item.projectId || "").slice(0, 80),
      })),
      projects: (Array.isArray(data.projects) ? data.projects : []).slice(0, 200).map(item => ({
        id: String(item.id || "").slice(0, 80),
        name: String(item.name || "").slice(0, 120),
        createdAt: String(item.createdAt || "").slice(0, 40),
      })),
      truncated: data.members.length > 200 || data.orders.filter(item => item.status !== "done").length > 500,
    };
  }

  async function publishDraft(input) {
    const user = requireAdmin();
    const previewId = String(input && input.previewId || "");
    const preview = previews.get(previewId);
    if (!preview) throw bridgeError(409, "PREVIEW_NOT_FOUND", "발행할 초안이 없거나 이미 만료되었습니다. 다시 미리보기해 주세요.");
    if (now() >= Date.parse(preview.expiresAt)) {
      previews.delete(previewId);
      throw bridgeError(409, "PREVIEW_EXPIRED", "초안 확인 시간이 만료되었습니다. 내용을 다시 확인해 주세요.");
    }
    if (input.approvalPhrase !== APPROVAL_PHRASE) throw bridgeError(403, "APPROVAL_REQUIRED", "대표님이 채팅에서 발행을 승인한 뒤 발행 도구를 호출해 주세요.");
    if (String(user.uid || "") !== preview.createdByUid) throw bridgeError(403, "SESSION_CHANGED", "초안 작성 후 CRM 로그인 계정이 바뀌었습니다. 다시 미리보기해 주세요.");

    if (preview.result && preview.result.complete) return Object.assign({}, preview.result, { repeated: true });

    const results = [];
    if (preview.project && !preview.completedProject) {
      if (!saveProject) throw bridgeError(503, "SAVE_UNAVAILABLE", "프로젝트 저장 경로가 준비되지 않았습니다.");
      try {
        const saved = await saveProject(preview.project);
        preview.completedProject = true;
        preview.savedProject = { id: String(saved && saved.id || preview.project.id), name: String(saved && saved.name || preview.project.name) };
      } catch (_error) {
        const message = "프로젝트를 CRM에 저장하지 못했습니다. 연결과 관리자 권한을 확인해 주세요.";
        return { complete: false, project: { ok: false, id: preview.project.id, error: message }, results: preview.workOrders.map(order => ({ id: order.id, title: order.title, ok: false, error: "연결 프로젝트가 저장되지 않아 발행하지 않았습니다." })) };
      }
    }

    for (const order of preview.workOrders) {
      const prior = preview.completedOrders.get(order.id);
      if (prior) { results.push(Object.assign({}, prior, { repeated: true })); continue; }
      try {
        if (!saveWorkOrder) throw bridgeError(503, "SAVE_UNAVAILABLE", "업무지시 저장 경로가 준비되지 않았습니다.");
        const saved = await saveWorkOrder(order);
        const row = { id: String(saved && saved.id || order.id), title: order.title, ok: true };
        preview.completedOrders.set(order.id, row);
        results.push(row);
      } catch (_error) {
        results.push({ id: order.id, title: order.title, ok: false, error: "CRM 저장에 실패했습니다. CRM에서 같은 ID의 저장 여부를 확인한 뒤 재시도해 주세요." });
      }
    }
    const complete = results.every(item => item.ok === true) && (!preview.project || preview.completedProject);
    const result = {
      complete,
      ...(preview.project ? { project: { ok: preview.completedProject, id: preview.savedProject && preview.savedProject.id || preview.project.id, name: preview.savedProject && preview.savedProject.name || preview.project.name } } : {}),
      results,
      ...(preview.result ? { repeated: true } : {}),
    };
    if (complete) preview.result = result;
    else preview.result = result;
    try { signalWallboard(); } catch (_error) {}
    return result;
  }

  async function handle(request, response) {
    if (!request.socket.remoteAddress || !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(request.socket.remoteAddress)) {
      return send(response, 403, { error: "LOOPBACK_ONLY", message: "로컬 BRING CRM 연결만 허용됩니다." });
    }
    if (!sameToken(String(request.headers.authorization || "").replace(/^Bearer\s+/iu, ""))) {
      return send(response, 401, { error: "UNAUTHORIZED", message: "BRING CRM 연결 인증이 필요합니다." });
    }
    try {
      if (request.method === "GET" && request.url === "/v1/status") {
        return send(response, 200, safeIdentity(auth()));
      }
      if (request.method === "GET" && request.url === "/v1/context") {
        return send(response, 200, await workOrderContext());
      }
      if (request.method === "POST" && request.url === "/v1/wallboard-refresh") {
        requireAdmin();
        if (!refreshWallboard) throw bridgeError(503, "REFRESH_UNAVAILABLE", "운영보드 갱신 경로가 준비되지 않았습니다.");
        return send(response, 200, await refreshWallboard());
      }
      if (request.method !== "POST" || !["/v1/preview", "/v1/publish"].includes(request.url)) {
        return send(response, 404, { error: "NOT_FOUND", message: "지원하지 않는 BRING CRM 연결 경로입니다." });
      }
      if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        return send(response, 415, { error: "CONTENT_TYPE_REQUIRED", message: "JSON 요청만 허용됩니다." });
      }
      const declaredLength = Number(request.headers["content-length"] || 0);
      if (declaredLength > MAX_BODY_BYTES) {
        request.resume();
        return send(response, 413, { error: "BODY_TOO_LARGE", message: "요청 본문이 허용 크기를 초과했습니다." });
      }
      const body = await readJson(request);
      if (request.url === "/v1/preview") {
        const preview = await previewDraft(body);
        return send(response, preview.valid ? 200 : 422, preview);
      }
      const result = await publishDraft(body);
      return send(response, result.complete ? 200 : 207, result);
    } catch (error) {
      const status = Number(error && error.status) || 500;
      const code = String(error && error.code || "CRM_BRIDGE_ERROR");
      const message = status < 500 ? String(error.message || "요청을 확인해 주세요.") : "BRING CRM에서 요청을 완료하지 못했습니다. 연결 상태를 확인해 주세요.";
      return send(response, status, { error: code, message });
    }
  }

  return Object.freeze({
    async start() {
      if (server) return { port, token };
      if (!userDataPath) throw new Error("BRING CRM 사용자 데이터 경로가 필요합니다.");
      token = randomBytes(32).toString("hex");
      server = http.createServer((request, response) => { void handle(request, response); });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      port = server.address().port;
      manifestPath = path.join(userDataPath, "codex-crm-bridge.json");
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.writeFile(manifestPath, JSON.stringify({ protocolVersion: PROTOCOL_VERSION, port, token }), { mode: 0o600 });
      closed = false;
      return { port, token };
    },
    async close() {
      if (!server || closed) return;
      closed = true;
      const activeServer = server;
      server = null;
      await new Promise(resolve => activeServer.close(() => resolve()));
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (manifest.token === token) await fs.unlink(manifestPath);
      } catch (_error) {}
      token = "";
      port = 0;
      previews.clear();
    },
    previewDraft,
    publishDraft,
    get port() { return port; },
    get token() { return token; },
  });
}

module.exports = { createCrmCommandBridge, PROTOCOL_VERSION, APPROVAL_PHRASE, MAX_BODY_BYTES };
