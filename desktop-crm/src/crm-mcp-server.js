const fs = require("node:fs/promises");
const readline = require("node:readline");
const path = require("node:path");
const http = require("node:http");

const PROTOCOL_VERSION = "2025-06-18";
const MAX_LINE_BYTES = 300 * 1024;

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "crm_connection_status",
    description: "현재 실행 중인 BRING CRM의 로그인·관리자 연결 상태를 확인합니다. 업무 데이터는 조회하지 않습니다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "crm_work_order_context",
    description: "현재 CRM 관리자 세션에서 담당자 계정과 미완료 업무지시의 제목·마감 요약만 읽습니다. 저장하지 않습니다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "crm_preview_work_order_draft",
    description: "프로젝트와 업무지시 초안을 BRING CRM의 기존 검증 규칙으로 미리 확인합니다. 저장하지 않습니다. 담당자 UID 등 정보가 불명확하면 먼저 대표에게 질문하세요.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["workOrders"],
      properties: {
        project: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, portfolioId: { type: "string" }, owner: { type: "string" }, goal: { type: "string" }, status: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" }, assignees: { type: "array" }, offCapacity: { type: "boolean" } } },
        workOrders: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["title", "assigneeUid", "assigneeName", "why", "what", "doneWhen", "hours", "dueDate", "deliverableKind", "deliverable", "deliverableCount"], properties: { title: { type: "string" }, assigneeUid: { type: "string" }, assigneeName: { type: "string" }, why: { type: "string" }, what: { type: "string" }, doneWhen: { type: "string" }, track: { type: "string" }, startDate: { type: "string" }, hours: { type: "number" }, weight: { type: "number" }, deliverable: { type: "string" }, deliverableKind: { type: "string", enum: ["photo", "doc", "sheet", "link", "none"] }, deliverableCount: { type: "number" }, dueDate: { type: "string" } } } },
      },
    },
  },
  {
    name: "crm_publish_work_order_draft",
    description: "발행된 미리보기 초안을 기존 BRING CRM 관리자 저장 경로로 등록합니다. 현재 대화에서 대표가 해당 초안 내용을 확인하고 명시적으로 발행을 승인하기 전에는 절대 호출하지 마세요. 승인 문구는 정확히 'CRM 발행 승인'이어야 합니다.",
    inputSchema: { type: "object", additionalProperties: false, required: ["previewId", "approvalPhrase"], properties: { previewId: { type: "string" }, approvalPhrase: { type: "string", const: "CRM 발행 승인" } } },
  },
]);

function textResult(value, isError = false) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function createHttpBridgeClient(options = {}) {
  const userDataPath = String(options.userDataPath || process.env.BRING_CRM_USER_DATA || "");
  if (!userDataPath) throw new Error("BRING_CRM_USER_DATA is required");
  const manifestPath = path.join(userDataPath, "codex-crm-bridge.json");
  return async function requestBridge(method, pathname, body) {
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); }
    catch (_error) { throw new Error("BRING CRM을 먼저 실행해 주세요. CRM 연결 파일이 없습니다."); }
    if (!Number.isInteger(manifest.port) || manifest.port < 1 || manifest.port > 65535 || typeof manifest.token !== "string" || !/^[a-f0-9]{64}$/u.test(manifest.token)) {
      throw new Error("BRING CRM 연결 정보가 올바르지 않습니다. CRM을 다시 실행해 주세요.");
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1", port: manifest.port, path: pathname, method,
        headers: { authorization: `Bearer ${manifest.token}`, ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) },
        timeout: 5000,
      }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          let result;
          try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch (_error) { return reject(new Error("BRING CRM에서 올바른 응답을 받지 못했습니다.")); }
          if (response.statusCode >= 400) return reject(new Error(result.message || `BRING CRM 요청 실패 (${response.statusCode})`));
          resolve(result);
        });
      });
      request.on("timeout", () => request.destroy(new Error("BRING CRM 응답 시간이 초과되었습니다.")));
      request.on("error", error => reject(new Error(`BRING CRM 연결 실패: ${error.message}`)));
      if (payload) request.write(payload);
      request.end();
    });
  };
}

function createMcpServer(options = {}) {
  const requestBridge = options.requestBridge || createHttpBridgeClient(options);
  return Object.freeze({
    async handle(message) {
      const id = message && Object.prototype.hasOwnProperty.call(message, "id") ? message.id : undefined;
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code: -32600, message: "Invalid Request" } };
      if (message.method.startsWith("notifications/")) return null;
      if (message.method === "initialize") {
        const requested = String(message.params && message.params.protocolVersion || PROTOCOL_VERSION);
        return { jsonrpc: "2.0", id, result: { protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "bring-crm", version: "1.0.0" }, instructions: "Use only status and non-mutating preview before explicit user approval. Never publish until the chairman explicitly approves the exact preview in the current conversation." } };
      }
      if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
      if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOL_DEFINITIONS } };
      if (message.method === "tools/call") {
        const params = message.params || {};
        const tool = TOOL_DEFINITIONS.find(item => item.name === params.name);
        if (!tool) return { jsonrpc: "2.0", id, result: textResult("지원하지 않는 BRING CRM 도구입니다.", true) };
        const args = params.arguments || {};
        try {
          let result;
          if (tool.name === "crm_connection_status") result = await requestBridge("GET", "/v1/status");
          else if (tool.name === "crm_work_order_context") result = await requestBridge("GET", "/v1/context");
          else if (tool.name === "crm_preview_work_order_draft") result = await requestBridge("POST", "/v1/preview", args);
          else result = await requestBridge("POST", "/v1/publish", args);
          return { jsonrpc: "2.0", id, result: textResult(result) };
        } catch (error) {
          const detail = String(error && error.message || "CRM 연결에 실패했습니다.");
          return { jsonrpc: "2.0", id, result: textResult(detail.includes("BRING CRM") ? detail : `BRING CRM 연결 오류: ${detail}`, true) };
        }
      }
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    },
    async run(input = process.stdin, output = process.stdout) {
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
          output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: message too large" } })}\n`);
          continue;
        }
        let response;
        try { response = await this.handle(JSON.parse(line)); }
        catch (_error) { response = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }; }
        if (response) output.write(`${JSON.stringify(response)}\n`);
      }
    },
  });
}

if (require.main === module) {
  createMcpServer().run().catch(error => {
    process.stderr.write(`BRING CRM MCP server failed: ${String(error && error.message || error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createMcpServer, createHttpBridgeClient, TOOL_DEFINITIONS, PROTOCOL_VERSION };
