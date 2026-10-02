"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  prepareBuildingMonthlyNarrative,
  promptForBuildingMonthlyNarrative,
  parseBuildingMonthlyNarrative,
} = require("./building-monthly-report-ai");
const { runBringOsGemini } = require("./local-gemini-assessment");

function createBuildingReportWriter({ userDataPath, localAppData = "", run = runBringOsGemini, now = () => new Date() }) {
  const usagePath = path.join(userDataPath, "building-monthly-report-gemini-usage.json");
  const cache = new Map();
  let busy = false;

  return async function write({ report, nextMonthPlan, viewer, generate = run }) {
    if (!viewer || !viewer.uid || !["admin", "member"].includes(viewer.role)) {
      throw new Error("월간 보고서 AI 작성 권한이 없습니다.");
    }
    const prepared = prepareBuildingMonthlyNarrative(report, nextMonthPlan);
    const key = `${viewer.uid}:${prepared.fingerprint}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.createdAt < 30 * 60000) return { ...cached.result, cached: true };
    if (busy) throw new Error("다른 Gemini 보고서 작성이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.");

    busy = true;
    try {
      const day = new Date(now().getTime() + 9 * 3600000).toISOString().slice(0, 10);
      let usage = { day, calls: 0 };
      try {
        const saved = JSON.parse(await fs.readFile(usagePath, "utf8"));
        if (saved.day === day && Number.isSafeInteger(saved.calls) && saved.calls >= 0) usage = saved;
      } catch (_error) {}
      if (usage.calls >= 30) throw new Error("오늘의 건물 월간보고서 Gemini 호출 한도(30회)에 도달했습니다.");
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.writeFile(usagePath, JSON.stringify({ day, calls: usage.calls + 1 }), { mode: 0o600 });

      const response = await generate({ localAppData, prompt: promptForBuildingMonthlyNarrative(prepared.source) });
      const narrative = parseBuildingMonthlyNarrative(response.text);
      const result = Object.freeze({
        ok: true,
        narrative,
        model: String(response.model || "Gemini"),
        generatedAt: now().toISOString(),
        fingerprint: prepared.fingerprint,
        cached: false,
      });
      cache.set(key, { createdAt: Date.now(), result });
      return result;
    } finally {
      busy = false;
    }
  };
}

module.exports = Object.freeze({
  createBuildingReportWriter,
  createLocalBuildingReportWriter: createBuildingReportWriter,
});
