"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, safeStorage } = require("electron");

const WORKER_DIR = path.resolve(__dirname, "..");
const WRANGLER_BIN = path.join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
const NODE_BIN = String(process.env.BRING_NODE_PATH || "");
const CRM_DATA_DIR = path.join(process.env.APPDATA || "", "bring-crm-desktop");
const SETTINGS_FILE = path.join(CRM_DATA_DIR, "bring-crm-telegram.json");
const EXPECTED_CHAT_TITLE = "브링엔지니어링 업무방";

app.setPath("userData", CRM_DATA_DIR);

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_BIN, [WRANGLER_BIN, "secret", "put", name], {
      cwd: WORKER_DIR,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let outputBytes = 0;
    const capOutput = chunk => { outputBytes += chunk.length; };
    child.stdout.on("data", capOutput);
    child.stderr.on("data", capOutput);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Cloudflare Secret 저장 시간이 초과됐습니다: ${name}`));
    }, 60_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error(`Cloudflare Secret 저장을 시작하지 못했습니다: ${name}`));
    });
    child.once("close", code => {
      clearTimeout(timer);
      if (code !== 0 || outputBytes > 64 * 1024) {
        reject(new Error(`Cloudflare Secret을 저장하지 못했습니다: ${name}`));
        return;
      }
      console.log(`저장 완료: ${name}`);
      resolve();
    });
    child.stdin.end(`${value}\n`);
  });
}

async function verifyTelegram(botToken, chatId) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("텔레그램에서 업무방 연결을 확인하지 못했습니다.");
  }
  let result = {};
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok || result.ok !== true || result.result?.title !== EXPECTED_CHAT_TITLE) {
    throw new Error("저장된 봇과 브링엔지니어링 업무방이 일치하지 않습니다.");
  }
}

async function main() {
  if (!process.env.XDG_CONFIG_HOME) throw new Error("배포용 Cloudflare 인증 위치가 없습니다.");
  if (!path.isAbsolute(NODE_BIN) || !fs.existsSync(NODE_BIN)) throw new Error("Node 실행 파일이 없습니다.");
  if (!fs.existsSync(WRANGLER_BIN)) throw new Error("Wrangler 실행 파일이 없습니다.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 보안 저장소를 사용할 수 없습니다.");

  const envelope = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  if (envelope?.version !== 1 || typeof envelope.ciphertext !== "string") {
    throw new Error("CRM 텔레그램 설정 파일 형식이 올바르지 않습니다.");
  }

  let plainText = "";
  let settings = null;
  try {
    plainText = safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64"));
    settings = JSON.parse(plainText);
    plainText = "";
    const botToken = String(settings.botToken || "");
    const chatId = String(settings.chatId || "");
    if (!/^[0-9]{6,15}:[A-Za-z0-9_-]{30,80}$/.test(botToken)) throw new Error("저장된 봇 토큰 형식이 올바르지 않습니다.");
    if (!/^-[0-9]{5,30}$/.test(chatId)) throw new Error("저장된 업무방 번호 형식이 올바르지 않습니다.");

    await verifyTelegram(botToken, chatId);
    console.log(`연결 확인: ${EXPECTED_CHAT_TITLE}`);
    await putSecret("TELEGRAM_BOT_TOKEN", botToken);
    await putSecret("TELEGRAM_WORK_CHAT_ID", chatId);
    settings.botToken = "";
    settings.chatId = "";
  } finally {
    plainText = "";
    if (settings && typeof settings === "object") {
      settings.botToken = "";
      settings.chatId = "";
    }
  }
}

app.whenReady()
  .then(main)
  .then(() => {
    console.log("텔레그램 서버 비밀값 등록 완료");
    app.quit();
  })
  .catch(error => {
    console.error(`설정 실패: ${error.message}`);
    app.exit(1);
  });
