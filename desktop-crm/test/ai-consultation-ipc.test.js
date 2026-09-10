const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { validateAudioFile, transcribeWithGateway } = require("../src/ai-audio-client");

test("audio intake accepts only bounded MP3 M4A and WAV files", () => {
  assert.equal(validateAudioFile({ path: "call.m4a", size: 1024 }).extension, ".m4a");
  assert.equal(validateAudioFile({ path: "call.MP3", size: 1024 }).extension, ".mp3");
  assert.equal(validateAudioFile({ path: "call.wav", size: 24 * 1024 * 1024 }).extension, ".wav");
  assert.throws(() => validateAudioFile({ path: "call.exe", size: 1024 }), error => error?.code === "UNSUPPORTED_AUDIO");
  assert.throws(() => validateAudioFile({ path: "call.wav", size: 25 * 1024 * 1024 + 1 }), error => error?.code === "AUDIO_TOO_LARGE");
});

test("audio client sends the Firebase token and file only to the HTTPS gateway", async () => {
  let captured;
  const result = await transcribeWithGateway({
    endpoint: "https://gateway.example/v1/transcribe",
    idToken: "firebase-token",
    file: { name: "call.m4a", type: "audio/mp4", bytes: Buffer.from("audio") },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true, requestId: "tr-1", transcript: "청소 상담 내용" }), { status: 200 });
    }
  });
  assert.equal(result.transcript, "청소 상담 내용");
  assert.equal(captured.url, "https://gateway.example/v1/transcribe");
  assert.equal(captured.options.headers.authorization, "Bearer firebase-token");
  assert.equal(captured.options.body instanceof FormData, true);
});

test("Electron exposes narrow audio picker and transcription IPC without secrets", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
  assert.match(main, /secureCanonicalHandle\("crm:consultation-audio-pick"/);
  assert.match(main, /secureCanonicalHandle\("crm:consultation-audio-transcribe"/);
  assert.match(preload, /chooseConsultationAudio: \(\) => ipcRenderer\.invoke\("crm:consultation-audio-pick"\)/);
  assert.match(preload, /transcribeConsultationAudio: input => ipcRenderer\.invoke\("crm:consultation-audio-transcribe", input\)/);
  assert.doesNotMatch(preload, /GROQ_API_KEY|gsk_|idToken/);
});
