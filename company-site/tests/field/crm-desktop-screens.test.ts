// @vitest-environment node

// 데스크톱 CRM 화면을 진짜로 띄워 본다.
//
// 이 검사가 왜 여기(company-site) 에 있는가 — jsdom 이 여기 있기 때문이다.
// desktop-crm 은 실행 의존성이 electron 하나뿐이고, 검사도 소스에 글자가
// 있는지만 본다. 그래서 이런 것을 못 잡았다.
//
//   app.js 의 Core 는 window.BringCore 이고, office.js 의 Core 는
//   window.BringOfficeCore 다. office.js 에서 Core.workDate() 를 그대로
//   옮겨 왔더니 app.js 에서는 없는 함수였다. 소스 검사는 전부 통과했고,
//   비품·프로젝트·수주 진행·결과보고서 네 화면이 열자마자 죽었다.
//
// 사람이 화면을 열었을 때 무엇이 그려지는지는, 화면을 열어 봐야 안다.

import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../desktop-crm/src");
const indexHtml = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

// 눌러 볼 화면과, 그 화면에만 나오는 글자.
//
// 오류를 잡아채는 방식은 미덥지 않았다. 화면을 여는 길이 async 라 오류가
// promise 거절로 새어 나가고, 검사 얼개가 그걸 조용히 삼킨다. 그래서
// **그 화면의 글자가 실제로 나왔는지**를 본다. 안 나왔으면 안 그려진 것이다.
const SCREENS: Array<[string, string]> = [
  ["customers", "고객"],
  ["partnerVendors", "협력"],
  ["vacancies", "공실"],
  ["quotes", "견적"],
  ["deliveryFlow", "견적서에서 입금까지"],
  ["workOrders", "표의 한 줄이 곧 업무지시"],
  ["tasks", "할 일"],
  ["cases", "민원"],
  ["buildingCalendar", "업무일정"],
  ["supplies", "우리 물품"],
  ["officeHome", "BRING"],
  ["officeAttendance", "근태"],
  ["officeLeave", "연차"],
  ["officeMembers", "인사기록"],
  ["officeApprovals", "결재"],
  ["officePayroll", "급여"],
  ["operationsIntelligence", "운영"],
  ["buildingDocuments", "문서"],
  ["workReports", "작업 종류를 고르면 항목이 깔립니다"],
  ["forms", "점검표·확인서"],
  ["security", "열쇠"],
  ["aiAssistant", "AI"],
];

type Booted = {
  window: JSDOM["window"];
  document: Document;
  errors: string[];
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function boot(): Promise<Booted> {
  const errors: string[] = [];
  const dom = new JSDOM(indexHtml, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const window = dom.window as unknown as JSDOM["window"] & Record<string, unknown>;
  window.addEventListener("error", (event: ErrorEvent) => errors.push(`window error: ${event.message}`));
  // 화면을 여는 길이 async 다. 거기서 터지면 promise 거절로 새어 나가고,
  // try/catch 도 window error 도 못 본다. 진짜 버그가 그렇게 숨어 있었다.
  process.on("unhandledRejection", (reason: unknown) => {
    errors.push(`unhandled: ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  // preload 가 내주는 이름을 그대로 흉내 낸다. 화면이 없는 이름을 부르면
  // 그 자리에서 터지므로, 이 목록이 곧 검사다.
  const preload = fs.readFileSync(path.join(SRC, "preload.js"), "utf8");
  const names = [...preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gmu)].map(match => match[1]);
  const empty = { admin: true, canWork: true, uid: "u-admin", loadedAt: "2026-09-06T00:00:00.000Z" };
  const payloads: Record<string, unknown> = {
    loadSupplies: { ...empty, items: [], moves: [], costs: [] },
    loadDeliveryFlows: { ...empty, flows: [] },
    loadWorkReports: { ...empty, reports: [] },
    loadWorkOrders: { ...empty, orders: [], projects: [], members: [{ uid: "u-admin", displayName: "서창환" }] },
    loadForms: { ...empty, templates: [], entries: [], canEditTemplates: true, canFill: true },
    loadOfficeSnapshot: {
      ok: true,
      users: { "u-admin": { displayName: "서창환", email: "admin@bring.test", role: "admin", enabled: true } },
      attendance: {}, leave: {}, leaveGrants: {}, members: {}, approvals: {}, payroll: {},
    },
  };

  const api: Record<string, unknown> = {};
  for (const name of names) {
    api[name] = async () => (payloads[name] ? JSON.parse(JSON.stringify(payloads[name])) : { ok: true });
  }
  api.read = async () => ({
    ok: true,
    data: {
      customers: [], buildings: [{ id: "b1", name: "우산동 빌딩", address: "강원 원주시" }],
      contracts: [], cases: [], tasks: [], activities: [], vacancies: [], partnerVendors: [],
      quotes: [], relationships: [], payments: [], settings: { owner: "김현진" },
    },
  });
  api.getSession = async () => ({ ok: true, user: { uid: "u-admin", email: "admin@bring.test", role: "admin", displayName: "서창환" } });
  api.onUpdateState = () => {};
  api.onAuthChanged = () => {};
  window.bringCRM = api;

  for (const file of [...indexHtml.matchAll(/<script src="\.\/([^"]+)"><\/script>/gu)].map(match => match[1])) {
    window.eval(fs.readFileSync(path.join(SRC, file), "utf8"));
  }
  // jsdom 에는 scrollIntoView 가 없다. 브라우저에는 있다 — 없어서 나는
  // 오류는 앱의 결함이 아니므로 채워 준다.
  (window as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype.scrollIntoView = () => {};
  await sleep(150);
  const document = window.document;
  const gate = document.getElementById("loginGate");
  if (gate) gate.hidden = true;
  const shell = document.getElementById("app");
  if (shell) shell.hidden = false;
  return { window, document, errors };
}

describe("desktop CRM screens actually render", () => {
  let booted: Booted;

  beforeAll(async () => {
    booted = await boot();
  }, 60000);

  it("처음 화면이 여덟 폴더를 다 내준다", () => {
    const cards = [...booted.document.querySelectorAll("[data-workspace-enter]")];
    expect(cards.length).toBe(8);
    // 폴더를 고르는 자리는 여기뿐이다. 하나라도 빠지면 그 폴더는 갈 길이 없다.
    const folders = cards.map(card => (card as HTMLElement).dataset.workspaceEnterFolder || "");
    for (const folder of ["customer-management", "project", "calendar", "office", "bi", "documents", "workflow"]) {
      expect(folders, folder).toContain(folder);
    }
  });

  it("모든 화면이 터지지 않고 그려진다", async () => {
    const main = booted.document.getElementById("main") as HTMLElement;
    const failures: string[] = [];

    for (const [view, marker] of SCREENS) {
      const button = booted.document.querySelector(`.nav-item[data-view="${view}"]`) as HTMLElement | null;
      if (!button) { failures.push(`${view}: 사이드바에 단추가 없다`); continue; }

      // 사람이 하는 순서 그대로 간다. 처음 화면으로 나가서, 그 화면이 사는
      // 폴더 카드를 고르고, 그 다음에 왼쪽 메뉴를 누른다. 이 순서를 안 지키면
      // 처음 화면에 머문 채로 메뉴만 눌러서 아무 일도 안 일어난다 —
      // 실제로 이 검사가 그렇게 헛돌았다.
      const folder = button.closest("[data-nav-folder]") as HTMLElement | null;
      const back = booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null;
      back?.click();
      await sleep(80);
      // 한눈에 보기·설정처럼 폴더에 안 속한 메뉴는 아무 폴더로나 들어가면
      // 사이드바에 늘 보인다.
      const wanted = folder?.dataset.navFolder || "customer-management";
      const card = booted.document.querySelector(`[data-workspace-enter-folder="${wanted}"]`) as HTMLElement | null;
      if (!card) { failures.push(`${view}: 처음 화면에 "${wanted}" 폴더 카드가 없다`); continue; }
      card.click();
      await sleep(140);

      const before = booted.errors.length;
      let thrown = "";
      try {
        button.click();
        await sleep(160);
      } catch (error) {
        thrown = (error as Error).message;
      }
      await sleep(60);
      const fresh = booted.errors.slice(before);
      const drawn = (main.textContent || "").replace(/\s+/gu, " ");
      if (thrown) failures.push(`${view}: ${thrown}`);
      else if (!drawn.trim()) failures.push(`${view}: 빈 화면`);
      else if (!drawn.includes(marker)) {
        failures.push(`${view}: "${marker}" 가 안 나왔다 — 그리다 터진 것이다${fresh.length ? ` (${fresh[0]})` : ""}. 나온 것: ${drawn.slice(0, 70)}`);
      }
    }

    expect(failures, failures.join(String.fromCharCode(10))).toEqual([]);
  }, 120000);

  it("폴더에 들어가도 다른 폴더로 갈 길이 있다", async () => {
    // 고른 폴더만 남기는 것은 그렇게 하기로 정한 것이다. 그런데 나갈 길이
    // 안 보이면 사람은 "다른 화면이 사라졌다" 고 읽는다. 실제로 그랬다.
    // 앞 검사가 앱 안에 들어와 있으므로 처음 화면으로 한 번 나간다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const card = booted.document.querySelector('[data-workspace-enter-folder="office"]') as HTMLElement;
    card.click();
    await sleep(150);

    const folders = [...booted.document.querySelectorAll("[data-nav-folder]")] as HTMLElement[];
    const shown = folders.filter(folder => !folder.hidden);
    expect(shown.length, "고른 폴더만 남아야 한다").toBe(1);
    expect(shown[0].dataset.navFolder).toBe("office");

    // 사이드바 안에서 다른 폴더로 바로 옮겨 갈 수 있어야 한다.
    const switcher = booted.document.querySelector("[data-nav-folder-switch]");
    expect(switcher, "사이드바에 폴더를 바꾸는 자리가 있어야 한다").toBeTruthy();
    const targets = [...booted.document.querySelectorAll("[data-nav-folder-go]")] as HTMLElement[];
    expect(targets.length, "옮겨 갈 폴더 목록이 있어야 한다").toBeGreaterThan(1);

    const project = targets.find(item => item.dataset.navFolderGo === "project");
    expect(project, "프로젝트 관리로 가는 길이 있어야 한다").toBeTruthy();
    project?.click();
    await sleep(150);
    const after = folders.filter(folder => !folder.hidden);
    expect(after.length).toBe(1);
    expect(after[0].dataset.navFolder).toBe("project");
  }, 60000);
});
