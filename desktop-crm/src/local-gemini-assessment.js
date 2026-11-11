'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {prepareAssessment, promptForAssessment} = require('./work-assessment');

function runBringOsGemini({localAppData, prompt, timeoutMs = 90000}) {
  return new Promise(async (resolve, reject) => {
    const runtime = path.join(localAppData, 'BRING-OpenExecutive');
    const python = path.join(runtime, 'venv', 'Scripts', 'python.exe');
    const key = path.join(runtime, 'gemini-key.dpapi-base64');
    const script = path.join(localAppData, 'Programs', 'BRING OS', 'resources', 'app.asar.unpacked', 'src', 'executive_advisor.py');
    try { await Promise.all([fs.access(python), fs.access(key), fs.access(script)]); }
    catch { reject(new Error('이 PC의 BRING OS Gemini 연결을 확인해 주세요.')); return; }
    const child = spawn(python, ['-I', script], {cwd: runtime, env: {...process.env, LOCALAPPDATA: localAppData}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Gemini 응답 시간이 초과됐습니다.')); }, timeoutMs);
    child.on('error', () => finish(new Error('Gemini 실행 환경을 확인해 주세요.')));
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 30000) { child.kill(); finish(new Error('Gemini 응답 크기를 확인해 주세요.')); } });
    child.on('close', code => {
      if (settled) return;
      try {
        if (code !== 0) throw new Error('Gemini 실행에 실패했습니다.');
        const result = JSON.parse(output);
        if (!result?.ok || typeof result.text !== 'string' || !result.text.trim()) throw new Error('Gemini 응답을 확인하지 못했습니다.');
        finish(null, {text: result.text.trim().slice(0, 1600), model: String(result.model || 'Gemini'), inputTokens: result.inputTokens, outputTokens: result.outputTokens});
      } catch (error) { finish(error); }
    });
    child.stdin.end(JSON.stringify({role: 'coo', consent: true, question: prompt}));
  });
}

function createLocalWorkAssessor({userDataPath, localAppData, run = runBringOsGemini, now = () => new Date()}) {
  const usagePath = path.join(userDataPath, 'work-assessment-usage.json');
  const cache = new Map();
  let busy = false;
  return async function assess({data, selectedUid, viewer}) {
    const prepared = prepareAssessment(data, selectedUid, viewer);
    const key = `${viewer.uid}:${prepared.fingerprint}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.createdAt < 10 * 60000) return {...cached.result, cached: true};
    if (busy) throw new Error('다른 Gemini 분석이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.');
    busy = true;
    try {
      const day = new Date(now().getTime() + 9 * 3600000).toISOString().slice(0, 10);
      let usage = {day, calls: 0};
      try { const saved = JSON.parse(await fs.readFile(usagePath, 'utf8')); if (saved.day === day && Number.isSafeInteger(saved.calls) && saved.calls >= 0) usage = saved; } catch {}
      if (usage.calls >= 12) throw new Error('오늘의 Gemini 분석 호출 한도(12회)에 도달했습니다.');
      await fs.mkdir(userDataPath, {recursive: true});
      await fs.writeFile(usagePath, JSON.stringify({day, calls: usage.calls + 1}), {mode: 0o600});
      const response = await run({localAppData, prompt: promptForAssessment(prepared.source)});
      const result = {ok: true, text: response.text, model: response.model, analyzedAt: now().toISOString(), counts: prepared.source.counts, fingerprint: prepared.fingerprint, scope: prepared.scope, cached: false};
      cache.set(key, {createdAt: Date.now(), result});
      return result;
    } finally { busy = false; }
  };
}

module.exports = {createLocalWorkAssessor, runBringOsGemini};
