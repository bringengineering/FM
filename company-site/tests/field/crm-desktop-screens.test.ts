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
  ["dailyLog", "무엇에 몇 시간을 썼는지 그 자리에서"],
  ["workOrders", "표의 한 줄이 곧 업무지시"],
  ["objectives", "이번 분기에 무엇을 이루려 하는가"],
  ["growth", "다음 단계가 무엇인지 적어 둡니다"],
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
  calls: Array<{ name: string; input: unknown }>;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 주는 월요일에 시작한다. 화면·코어와 같은 잣대를 써야 검사가 오늘 날짜에
// 상관없이 돈다 — 고정 날짜를 박으면 다음 주에 검사가 깨진다.
function mondayOf(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc.toISOString().slice(0, 10);
}

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
    loadSupplies: {
      ...empty,
      items: [{ id: "i-lax", name: "락스 4L", unit: "통", category: "clean", active: true }],
      moves: [{ id: "m1", itemId: "i-lax", kind: "in", qty: 3, date: "2026-09-01" }],
      costs: [],
    },
    loadDeliveryFlows: { ...empty, flows: [] },
    loadWorkReports: { ...empty, reports: [] },
    loadTelegramSettings: { ok: true, configured: false, chatId: "", autoSend: true, includePhone: false, lastSentDay: "" },
    findTelegramChats: {
      ok: true,
      chats: [
        { id: "-1001234567890", type: "supergroup", title: "브링 알림", group: true },
        { id: "987654321", type: "private", title: "서 창환", group: false },
      ],
      hint: "",
    },
    loadGrowth: {
      ...empty,
      checkins: [
        { id: "gc1", uid: "u-admin", name: "서창환", week: "2026-08-31", answers: { done: "햇빛빌라 계단청소", stuck: "건물주가 전화를 안 받습니다", next: "입주청소 두 건", grow: "결과보고서 혼자 내기" } },
        { id: "gc2", uid: "u-admin", name: "서창환", week: "2026-08-24", answers: { done: "입주청소 한 건", stuck: "건물주가 전화를 안 받습니다", next: "계단청소", grow: "" } },
      ],
      reviews: [
        { id: "gr1", uid: "u-admin", name: "서창환", quarter: "2026-Q3", level: "L3", skills: { field: "L3", owner: "L2", record: "L3", plan: "L3", tool: "L3", biz: "L3" }, did: "계단청소 12건", nextStep: "건물 한 채를 통째로 맡아 본다" },
      ],
    },
    loadObjectives: {
      ...empty,
      objectives: [
        {
          id: "ob1", quarter: "2026-Q3", title: "원주에서 계단청소를 자리잡힌 일로 만든다",
          why: "단발 청소로는 매달 다시 영업해야 한다.", ownerUid: "u-admin", ownerName: "서창환",
          track: "biz", status: "active", projectIds: ["p1"],
          keyResults: [
            { id: "k1", title: "정기 계약 건수", unit: "count", baseline: 0, target: 10, current: 7, ownerUid: "u-admin", ownerName: "서창환" },
            { id: "k2", title: "재계약률", unit: "percent", baseline: 0, target: 80, current: 20, ownerUid: "", ownerName: "" },
          ],
        },
      ],
    },
    // 진짜 Drive 에 있는 폴더·파일 이름이다. 지어낸 이름으로 검사하면
    // 지어낸 것만 통과한다.
    scanWorkReportPhotos: {
      ok: true,
      plan: {
        folderName: "입주청소(햇빛빌라)_블로그_20260831",
        work: "입주청소", buildingName: "햇빛빌라", workDate: "2026-08-31", kind: "moveIn",
        buckets: [
          {
            folder: "화장실", itemKey: "bath", confident: true, reason: "1009분이 벌어진 자리에서 나눴습니다.",
            before: [{ id: "p1", name: "20260831_172901.jpg", webViewLink: "https://drive.google.com/file/d/p1/view" }],
            after: [{ id: "p2", name: "20260901_101819.jpg", webViewLink: "https://drive.google.com/file/d/p2/view" }],
            unsorted: [], heic: [], skipped: 0,
          },
          {
            folder: "공간기획", itemKey: "", confident: false, reason: "사진이 한 번에 찍혔습니다.",
            before: [], after: [], unsorted: [{ id: "p3", name: "20260831_190000.jpg", webViewLink: "https://drive.google.com/file/d/p3/view" }],
            heic: [], skipped: 0,
          },
        ],
        warnings: ["아이폰 사진(HEIC) 2장은 화면과 PDF 에서 안 열립니다. JPG 로 바꿔 올려 주세요."],
        skipped: [], photoCount: 3, heicCount: 2, matched: 1, unmatched: ["공간기획"],
      },
    },
    loadWorkOrders: {
      ...empty,
      // 두 사람을 둔다. 한 사람뿐이면 "이번 주에 아직 이야기 안 한 사람"
      // 이 늘 0 이라, 그 칸이 도는지 알 수 없다.
      members: [{ uid: "u-admin", displayName: "서창환" }, { uid: "u-hwang", displayName: "황우중" }],
      // 한 사람만 시간표를 넣어 둔다. 넣은 사람과 안 넣은 사람이 화면에서
      // 다르게 보여야 하는데, 둘 다 넣으면 그게 도는지 알 수 없다.
      capacity: [
        {
          uid: "u-admin", name: "서창환", window: { start: "09:00", end: "22:00" }, workDays: [1, 2, 3, 4, 5],
          blocks: [{ id: "c1", day: 1, start: "13:00", end: "14:00", label: "수문학", place: "이공1-502", skippable: true }],
          updatedAt: "2026-09-01T00:00:00.000Z", updatedBy: "u-admin",
        },
      ],
      projects: [
        { id: "p1", name: "브링 케어", status: "active", startDate: "2026-09-01", endDate: "2026-09-30" },
        // 어느 목표에도 안 붙은 프로젝트. 분기 목표 화면이 이걸 세어 보여 줘야 한다.
        { id: "p2", name: "회사 서버", status: "active", startDate: "2026-09-01", endDate: "2026-09-30" },
      ],
      // 이번 주 지시서. 머리말만 담고 지시 줄은 안 담는다 — 복사해 두면 갈라진다.
      directives: [
        {
          id: "u-admin_" + mondayOf(new Date()), uid: "u-admin", name: "서창환", weekStart: mondayOf(new Date()),
          background: "임차인이 두 번 민원을 넣었고 다음 주에 갱신 면담이 있습니다.",
          goal: "누수 원인이 확인되고 건물주에게 보고가 나가 있습니다.",
          loss: "", scopeExclude: "", precondition: "", approvers: "대표", note: "",
          publishedAt: "", updatedAt: "2026-09-06T00:00:00.000Z", updatedBy: "u-admin",
        },
      ],
      orders: [
        // 기한 지난 것·오늘·이번 주·담당자 없는 것을 한 벌씩 둔다. 표가
        // 빈 목록에서만 그려지는지 아닌지는 자료를 넣어 봐야 안다.
        { id: "o1", title: "지난 것", why: "왜", what: "무엇", doneWhen: "끝", assigneeUid: "u-admin", assigneeName: "서창환", projectId: "p1", track: "ops", status: "doing", dueDate: "2026-01-02", startDate: "2026-01-01", progress: 40, hours: 4, weight: 30 },
        { id: "o2", title: "담당 없음", why: "왜", what: "무엇", doneWhen: "끝", assigneeUid: "", assigneeName: "", projectId: "p1", track: "biz", status: "assigned", dueDate: "", startDate: "", progress: 0 },
        { id: "o3", title: "검수 대기", why: "왜", what: "무엇", doneWhen: "끝", assigneeUid: "u-admin", assigneeName: "서창환", projectId: "p1", track: "tech", status: "submitted", dueDate: "2026-09-20", startDate: "2026-09-10", progress: 100, hours: 6, weight: 40 },
        // 어느 프로젝트에도 안 붙은 업무. 이것이 "왜 하는지 모르는 일" 이다.
        // 이번 주에 걸친 지시. 지시서를 보내려면 이 주에 뭔가 있어야 한다.
        { id: "o5", title: "3층 누수 확인", why: "임차인이 두 번 민원을 넣었습니다", what: "천장을 열어 배관을 봅니다", doneWhen: "사진 3장과 원인 한 줄", deliverable: "20260906_3층누수.xlsx", assigneeUid: "u-admin", assigneeName: "서창환", projectId: "p1", track: "ops", status: "assigned", startDate: mondayOf(new Date()), dueDate: mondayOf(new Date()), progress: 0, hours: 8, weight: 100 },
        { id: "o4", title: "떠도는 일", why: "왜", what: "무엇", doneWhen: "끝", assigneeUid: "u-admin", assigneeName: "서창환", projectId: "", track: "etc", status: "assigned", dueDate: "", startDate: "", progress: 0, raci: { R: ["u-admin"], A: ["u-admin"] } },
      ],
    },
    loadDailyLogs: {
      ...empty,
      name: "서창환",
      logs: [
        // 어제 것. 오늘 자리가 비어 있어도 화면이 도는지 보려고 다른 날로 둔다.
        {
          id: "u-admin_2026-09-05", uid: "u-admin", name: "서창환", date: "2026-09-05",
          entries: [
            { id: "e1", start: "09:00", end: "11:00", title: "BRING OFFICE 통합", nature: "innovation", orderId: "o1", progress: 60, note: "" },
            { id: "e2", start: "11:00", end: "18:00", title: "철근콘크리트 수강", nature: "routine", orderId: "", progress: 100, note: "" },
          ],
          plans: [{ id: "p1", title: "견적서 화면 마무리", nature: "innovation", hours: 3, dueDate: "2026-09-06", orderId: "" }],
          blockers: "당근 비즈프로필 권한이 아직 안 넘어왔습니다.",
          ideas: "", feedback: "", requests: "",
          submittedAt: "2026-09-05T18:00:00.000Z", confirmedBy: "", confirmedAt: "",
          updatedAt: "2026-09-05T18:00:00.000Z", updatedBy: "u-admin",
        },
      ],
    },
    loadForms: { ...empty, templates: [], entries: [], canEditTemplates: true, canFill: true },
    loadOfficeSnapshot: {
      ok: true,
      users: { "u-admin": { displayName: "서창환", email: "admin@bring.test", role: "admin", enabled: true } },
      attendance: {}, leave: {}, leaveGrants: {}, members: {}, approvals: {}, payroll: {},
    },
  };

  const api: Record<string, unknown> = {};
  const calls: Array<{ name: string; input: unknown }> = [];
  for (const name of names) {
    api[name] = async (input: unknown) => {
      calls.push({ name, input });
      return payloads[name] ? JSON.parse(JSON.stringify(payloads[name])) : { ok: true };
    };
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

  // 스타일시트를 진짜로 물린다.
  //
  // jsdom 은 <link> 를 따라가지 않는다. 그래서 CSS 가 없는 채로 돌았고,
  // "고른 폴더만 보인다" 검사가 hidden 속성만 보고 통과했다. 실제로는
  // .nav-folder{display:grid} 가 브라우저 기본 [hidden]{display:none} 을
  // 덮어써서 화면에는 모든 폴더가 그대로 남아 있었다.
  //
  // CSS 를 물려 두면 이 검사가 사람이 보는 것과 같은 것을 본다.
  const styleTag = window.document.createElement("style");
  styleTag.textContent = fs.readFileSync(path.join(SRC, "styles.css"), "utf8");
  window.document.head.appendChild(styleTag);

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
  return { window, document, errors, calls };
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

    // hidden 속성이 아니라 **실제로 보이는지**를 본다.
    //
    // .nav-folder{display:grid} 가 브라우저 기본 [hidden]{display:none} 을
    // 덮어써서, 속성은 제대로 들어가는데 화면에는 다 남아 있었다. 속성만
    // 보던 이 검사는 그동안 통과했고, 대표는 두 번 "안 된다" 고 말했다.
    const visible = (element: HTMLElement) =>
      booted.window.getComputedStyle(element).display !== "none";
    const folders = [...booted.document.querySelectorAll("[data-nav-folder]")] as HTMLElement[];
    const shown = folders.filter(visible);
    expect(shown.map(folder => folder.dataset.navFolder), "고른 폴더만 남아야 한다").toEqual(["office"]);
    // 자식까지 보지는 않는다. jsdom 은 부모가 감춰져도 자식의 display 를
    // 그대로 내주기 때문이다 — 브라우저와 다르다. 감춰야 할 것은 폴더이고,
    // 폴더가 감춰지면 그 안의 메뉴도 같이 사라진다.

    // 사이드바 안에서 다른 폴더로 바로 옮겨 갈 수 있어야 한다.
    const switcher = booted.document.querySelector("[data-nav-folder-switch]");
    expect(switcher, "사이드바에 폴더를 바꾸는 자리가 있어야 한다").toBeTruthy();
    const targets = [...booted.document.querySelectorAll("[data-nav-folder-go]")] as HTMLElement[];
    expect(targets.length, "옮겨 갈 폴더 목록이 있어야 한다").toBeGreaterThan(1);

    const project = targets.find(item => item.dataset.navFolderGo === "project");
    expect(project, "프로젝트 관리로 가는 길이 있어야 한다").toBeTruthy();
    project?.click();
    await sleep(150);
    const after = folders.filter(visible);
    expect(after.map(folder => folder.dataset.navFolder)).toEqual(["project"]);

    // '전체 보기' 는 없어야 한다. 한 번에 다 보이면 폴더를 나눈 뜻이 없다.
    const all = [...booted.document.querySelectorAll("[data-nav-folder-go]")] as HTMLElement[];
    expect(all.every(item => item.dataset.navFolderGo), "폴더를 안 고르는 길이 있으면 안 된다").toBe(true);
  }, 60000);

  it("비품에 수기로 여러 줄을 적고 저장까지 간다", async () => {
    // 이 화면의 값어치는 "적은 것이 무엇으로 들어가는가" 를 누르기 전에
    // 보여 주는 데 있다. 그 표가 실제로 나오는지는 쳐 봐야 안다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="supplies"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(180);

    const open = booted.document.querySelector("[data-supply-manual]") as HTMLElement | null;
    expect(open, "수기로 적는 단추가 있어야 한다").toBeTruthy();
    open!.click();
    await sleep(120);
    const form = booted.document.querySelector("[data-supply-manual-form]") as HTMLFormElement | null;
    expect(form, "수기 폼이 열려야 한다").toBeTruthy();

    const area = form!.querySelector('[name="lines"]') as HTMLTextAreaElement;
    const submit = form!.querySelector('button[type="submit"]') as HTMLButtonElement;

    // 한 줄은 못 읽게 둔다. 그 상태로는 저장이 잠겨야 한다.
    area.value = "락스4l 2통 입고 쿠팡\n극세사걸레 5개 입고 다이소\n3개 입고";
    area.dispatchEvent(new booted.window.Event("input", { bubbles: true }));
    await sleep(100);
    const preview = form!.querySelector(".sp-manual-preview") as HTMLElement | null;
    expect(preview, "무엇이 들어갈지 표가 나와야 한다").toBeTruthy();
    const shown = (preview!.textContent || "").replace(/\s+/gu, " ");
    expect(shown, "이미 있는 품목은 새 품목으로 잡히면 안 된다").toContain("새 품목");
    expect(shown).toContain("못 읽은 줄");
    expect(submit.disabled, "못 읽은 줄이 있으면 저장이 잠겨야 한다").toBe(true);

    // 그 줄을 지우면 열린다.
    area.value = "락스4l 2통 입고 쿠팡\n극세사걸레 5개 입고 다이소";
    area.dispatchEvent(new booted.window.Event("input", { bubbles: true }));
    await sleep(100);
    expect(submit.disabled, "다 읽혔으면 저장이 열려야 한다").toBe(false);
    expect(submit.textContent).toContain("2줄");

    const before = booted.calls.length;
    form!.dispatchEvent(new booted.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(250);
    const sent = booted.calls.slice(before).find(call => call.name === "saveSupplyBatch");
    expect(sent, "저장 통로로 실제로 나가야 한다").toBeTruthy();
    const body = sent!.input as { items: Array<{ id: string; name: string }>; moves: Array<{ itemId: string; qty: number }> };
    expect(body.moves.length).toBe(2);
    // 이미 있는 락스는 다시 만들지 않는다. 새 걸레만 만든다.
    expect(body.items.map(item => item.name)).toEqual(["극세사걸레"]);
    expect(body.moves.some(move => move.itemId === "i-lax" && move.qty === 2), "있는 품목에 붙어야 한다").toBe(true);
    // 미리보기용 임시 번호가 그대로 나가면 두 줄이 한 줄로 덮인다.
    expect(new Set(body.moves.map(move => (move as unknown as { id: string }).id)).size).toBe(2);
    expect(body.moves.every(move => (move as unknown as { id: string }).id !== "preview")).toBe(true);
    // 저장 뒤에 터지는 것도 잡는다. api 호출만 확인하면 그 다음 줄에서
    // 없는 함수를 불러도 통과한다 — 실제로 그렇게 한 번 놓쳤다.
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("결과보고서가 Drive 폴더에서 사진을 끌어온다", async () => {
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="workReports"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(180);

    // 새 보고서를 연다.
    const newButton = [...booted.document.querySelectorAll("button")]
      .find(button => (button.textContent || "").includes("새 보고서")) as HTMLElement | undefined;
    expect(newButton, "새 보고서 단추가 있어야 한다").toBeTruthy();
    newButton!.click();
    await sleep(150);

    const box = booted.document.querySelector(".wr-drive") as HTMLElement | null;
    expect(box, "Drive 에서 끌어오는 자리가 있어야 한다").toBeTruthy();

    // 주소창을 통째로 붙여 넣는다. ID 만 떼어내라고 시키면 안 쓴다.
    const idInput = box!.querySelector("[data-report-drive-id]") as HTMLInputElement;
    const scan = box!.querySelector("[data-report-drive-scan]") as HTMLButtonElement;
    expect(scan.disabled, "폴더를 적기 전에는 잠겨 있어야 한다").toBe(true);
    idInput.value = "https://drive.google.com/drive/folders/17EWMXA834daN5r9ZedRWrhJHWR8ppB7q";
    idInput.dispatchEvent(new booted.window.Event("input", { bubbles: true }));
    await sleep(60);
    expect(scan.disabled, "폴더를 적으면 열려야 한다").toBe(false);

    const before = booted.calls.length;
    scan.click();
    await sleep(250);
    const asked = booted.calls.slice(before).find(call => call.name === "scanWorkReportPhotos");
    expect(asked, "훑기 통로로 실제로 나가야 한다").toBeTruthy();
    // 링크가 아니라 떼어낸 ID 가 나가야 한다.
    expect((asked!.input as { folderId: string }).folderId).toBe("17EWMXA834daN5r9ZedRWrhJHWR8ppB7q");

    const table = booted.document.querySelector(".wr-drive-table") as HTMLElement | null;
    expect(table, "무엇이 어디에 붙는지 표가 나와야 한다").toBeTruthy();
    const shown = (booted.document.querySelector(".wr-drive") as HTMLElement).textContent || "";
    expect(shown).toContain("화장실");
    expect(shown).toContain("욕실");
    expect(shown, "못 붙인 폴더도 숨기지 않는다").toContain("공간기획");
    expect(shown, "못 여는 사진은 미리 말해 준다").toContain("HEIC");

    // 초안에 얹는다.
    const apply = booted.document.querySelector("[data-report-drive-apply]") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    apply.click();
    await sleep(200);

    // 욕실 항목에 전·후가 한 장씩 붙었는지 화면에서 본다.
    const items = [...booted.document.querySelectorAll(".wr-item")] as HTMLElement[];
    const bath = items.find(item => (item.textContent || "").includes("욕실"));
    expect(bath, "욕실 항목이 있어야 한다").toBeTruthy();
    const links = [...bath!.querySelectorAll("[data-report-open-photo]")];
    expect(links.length, "전·후 한 장씩 붙어야 한다").toBe(2);
    // 얹었다고 서버에 쓰지 않는다. 사람이 저장을 눌러야 한다.
    expect(booted.calls.some(call => call.name === "saveWorkReport")).toBe(false);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("분기 목표가 목표와 이어지지 않은 일을 같이 보여 준다", async () => {
    // 이 화면의 값어치는 목표판을 예쁘게 채우는 데 있지 않고, **지금 하는
    // 일 중에 무엇이 목표와 상관없는지**를 드러내는 데 있다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="objectives"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(250);

    const shown = (booted.document.getElementById("main") as HTMLElement).textContent || "";
    expect(shown).toContain("원주에서 계단청소를 자리잡힌 일로 만든다");
    // 핵심결과 두 개의 평균은 (0.7 + 0.25) / 2 = 0.475 → 48%
    expect(shown, "진척도를 사람이 적지 않고 값에서 센다").toContain("48%");
    expect(shown).toContain("정기 계약 건수");
    expect(shown).toContain("7건 / 10건");

    // 목표에 안 붙은 것을 실제로 세어 보여 준다. 붙인 프로젝트는 p1 뿐이다.
    expect(shown, "이어지지 않은 일을 드러내야 한다").toContain("이 일들은 어느 목표에 닿는지 적혀 있지 않습니다");

    // RACI 설명이 화면에 있어야 한다 — 팀원이 처음 보는 말이다.
    expect(shown).toContain("끝났는지 판단하고 책임지는 한 사람");

    const bars = booted.document.querySelectorAll(".okr-bar i");
    expect(bars.length, "핵심결과마다 막대가 하나씩").toBe(2);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("핵심결과 없이는 목표를 저장할 수 없다", async () => {
    const newButton = [...booted.document.querySelectorAll("button")]
      .find(button => (button.textContent || "").trim() === "새 목표") as HTMLElement | undefined;
    expect(newButton, "새 목표 단추가 있어야 한다").toBeTruthy();
    newButton!.click();
    await sleep(180);

    const form = booted.document.querySelector("[data-okr-form]") as HTMLFormElement;
    expect(form, "목표 편집기가 열려야 한다").toBeTruthy();
    // 기본으로 핵심결과 한 줄이 깔려 있어야 한다 — 빈 폼을 주면 사람은
    // 그 칸을 안 채우고 저장부터 누른다.
    expect(form.querySelectorAll("[data-okr-kr-row]").length).toBe(1);

    const before = booted.calls.length;
    form.dispatchEvent(new booted.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(200);
    // 제목·책임자·핵심결과가 비어 있으므로 서버로 나가면 안 된다.
    expect(booted.calls.slice(before).some(call => call.name === "saveObjective"),
      "덜 채운 목표가 저장되면 안 된다").toBe(false);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("성장 화면이 다음 단계와 이번 주 1on1 을 같이 보여 준다", async () => {
    // 이 화면의 값어치는 레벨을 붙이는 데 있지 않고, **다음에 무엇을
    // 배울지가 적혀 있게** 하는 데 있다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="growth"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(250);

    const shown = () => (booted.document.getElementById("main") as HTMLElement).textContent || "";
    // 지금 레벨(L3 맡는 사람)과 다음 레벨(L4 넓히는 사람)이 같이 보여야 한다.
    expect(shown()).toContain("맡는 사람");
    expect(shown(), "다음 단계가 적혀 있어야 한다").toContain("넓히는 사람");
    expect(shown()).toContain("하던 일을 서식·표준 항목으로 만들어 남긴다");
    // 역량이 레벨을 다 받치지 못하면 말해 준다 (owner 가 L2 인데 레벨은 L3).
    expect(shown()).toContain("건물주 응대");

    // 매주 같은 네 가지를 묻는다.
    const form = booted.document.querySelector("[data-growth-checkin-form]") as HTMLFormElement;
    expect(form, "이번 주 기록 칸이 있어야 한다").toBeTruthy();
    ["done", "stuck", "next", "grow"].forEach(key => {
      expect(form.querySelector(`[name="${key}"]`), key).toBeTruthy();
    });

    // 팀 탭 — 이번 주에 아직 이야기 안 한 사람이 보여야 한다.
    (booted.document.querySelector('[data-growth-tab="team"]') as HTMLElement).click();
    await sleep(200);
    expect(shown()).toContain("이번 주에 아직 이야기 안 한 사람");
    // 두 주째 같은 곳에 막혀 있으면 드러나야 한다.
    expect(shown(), "같은 곳에 계속 막힌 것이 보여야 한다").toContain("같은 곳에 계속 막힘");

    // 레벨 기준 탭 — 다섯 단계가 다 적혀 있어야 한다.
    (booted.document.querySelector('[data-growth-tab="ladder"]') as HTMLElement).click();
    await sleep(200);
    ["배우는 사람", "혼자 하는 사람", "맡는 사람", "넓히는 사람", "정하는 사람"].forEach(label => {
      expect(shown(), label).toContain(label);
    });
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("다음에 무엇을 배울지 없는 평가는 저장으로 안 나간다", async () => {
    (booted.document.querySelector('[data-growth-tab="team"]') as HTMLElement).click();
    await sleep(200);
    const open = booted.document.querySelector("[data-growth-review]") as HTMLElement | null;
    expect(open, "분기 평가를 여는 자리가 있어야 한다").toBeTruthy();
    open!.click();
    await sleep(200);

    const form = booted.document.querySelector("[data-growth-review-form]") as HTMLFormElement;
    expect(form, "평가 서식이 열려야 한다").toBeTruthy();
    (form.querySelector('[name="nextStep"]') as HTMLTextAreaElement).value = "";

    const before = booted.calls.length;
    form.dispatchEvent(new booted.window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(200);
    expect(booted.calls.slice(before).some(call => call.name === "saveGrowthReview"),
      "성적표는 저장하지 않는다").toBe(false);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("텔레그램 방 번호를 앱이 찾아 준다", async () => {
    // 사람에게 브라우저 주소창에 토큰을 치고 JSON 에서 숫자를 찾아내라고
    // 시키던 자리다. 그건 앱이 할 일이다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    (booted.document.querySelector('[data-workspace-enter-folder="customer-management"]') as HTMLElement).click();
    await sleep(150);
    (booted.document.querySelector('.nav-item[data-view="settings"]') as HTMLElement).click();
    await sleep(250);

    const form = booted.document.querySelector("[data-telegram-form]") as HTMLFormElement | null;
    expect(form, "텔레그램 설정 칸이 있어야 한다").toBeTruthy();
    // 아직 저장 안 한 토큰을 친 상태에서 찾을 수 있어야 한다.
    (form!.querySelector('[name="botToken"]') as HTMLInputElement).value = "123456789:AAF-abcdefghijklmnopqrstuvwxyz012345";

    const before = booted.calls.length;
    (booted.document.querySelector("[data-telegram-find]") as HTMLElement).click();
    await sleep(250);
    const asked = booted.calls.slice(before).find(call => call.name === "findTelegramChats");
    expect(asked, "찾기 통로로 나가야 한다").toBeTruthy();
    expect((asked!.input as { botToken: string }).botToken,
      "화면이 방금 친 토큰을 실어 보내야 한다").toContain("123456789:");

    // 찾은 방이 눌러서 고를 수 있게 나와야 한다.
    const picks = [...booted.document.querySelectorAll("[data-telegram-pick]")] as HTMLElement[];
    expect(picks.length).toBe(2);
    expect(picks[0].textContent).toContain("브링 알림");
    expect(picks[0].textContent).toContain("그룹");

    picks[0].click();
    await sleep(200);
    const chatInput = booted.document.querySelector('[data-telegram-form] [name="chatId"]') as HTMLInputElement;
    expect(chatInput.value, "고른 방 번호가 칸에 들어가야 한다").toBe("-1001234567890");
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
  it("가용시간 판이 건수가 아니라 시간으로 말하고, 시간표를 그 자리에서 고친다", async () => {
    // 지금까지 사람별 부하는 건수였다. "4건" 은 30분짜리인지 이틀짜리인지
    // 말해 주지 않아서, 일을 나눌 때 결국 감으로 했다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="workOrders"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(250);

    const shown = () => (booted.document.getElementById("main") as HTMLElement).textContent || "";
    expect(shown()).toContain("이번 주 가용시간");
    // 시간표를 넣은 사람과 안 넣은 사람이 다르게 보여야 한다.
    expect(shown(), "시간표가 없으면 비율을 내지 않는다").toContain("시간표 없음");
    // 서창환은 월요일 13~14 한 시간만 막혀 있다. 주 5일 09~22 에서 한 시간을
    // 빼면 64시간이고, 그 수업은 빠져도 되니 +1 이 따로 붙는다.
    expect(shown(), "수업을 뺀 시간이 나와야 한다").toContain("64시간");
    expect(shown(), "빠져도 되는 수업은 따로 알린다").toContain("수업 빼면 +1");

    // 시간표를 고치는 자리로 들어간다.
    const edit = booted.document.querySelector('[data-cap-edit="u-admin"]') as HTMLElement;
    expect(edit, "본인·대표는 시간표를 고칠 수 있어야 한다").toBeTruthy();
    edit.click();
    await sleep(200);
    expect(booted.document.querySelector(".cap-editor"), "시간표 편집기가 열려야 한다").toBeTruthy();

    // 줄을 하나 넣는다. 빈 줄을 넣으면 정규화가 조용히 버려서 아무 일도 안
    // 일어난 것처럼 보인다 — 그래서 저장 가능한 값으로 시작해야 한다.
    const rowsBefore = booted.document.querySelectorAll('.cap-editor [data-cap-field="day"]').length;
    (booted.document.querySelector("[data-cap-add]") as HTMLElement).click();
    await sleep(150);
    expect(booted.document.querySelectorAll('.cap-editor [data-cap-field="day"]').length).toBe(rowsBefore + 1);

    // 화면에 친 것이 저장으로 실려 나가야 한다. 상태에만 있고 화면에서 안
    // 읽으면 사람이 고친 값이 통째로 사라진다.
    const labels = [...booted.document.querySelectorAll('.cap-editor [data-cap-field="label"]')] as HTMLInputElement[];
    labels[labels.length - 1].value = "구조역학(2)";
    const starts = [...booted.document.querySelectorAll('.cap-editor [data-cap-field="start"]')] as HTMLInputElement[];
    starts[starts.length - 1].value = "14:00";
    const ends = [...booted.document.querySelectorAll('.cap-editor [data-cap-field="end"]')] as HTMLInputElement[];
    ends[ends.length - 1].value = "17:00";

    const before = booted.calls.length;
    (booted.document.querySelector("[data-cap-save]") as HTMLElement).click();
    await sleep(300);
    const saved = booted.calls.slice(before).find(call => call.name === "saveCapacity");
    expect(saved, "저장 통로로 나가야 한다").toBeTruthy();
    const sent = saved!.input as { uid: string; blocks: Array<{ label: string; start: string; end: string }> };
    expect(sent.uid).toBe("u-admin");
    const added = sent.blocks.find(block => block.label === "구조역학(2)");
    expect(added, "화면에 친 줄이 실려 나가야 한다").toBeTruthy();
    expect(added!.start).toBe("14:00");
    expect(added!.end).toBe("17:00");
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("기본 프로젝트 여섯 개를 한 번에 만든다", async () => {
    // 빈 화면을 주면 사람들은 자기 일을 어디에 넣어야 할지 몰라 아무 데도
    // 안 넣고, 결국 일은 다시 카톡으로 간다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="workOrders"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(250);

    const button = booted.document.querySelector("[data-wo-seed]") as HTMLElement;
    expect(button, "아직 안 만든 것이 있으면 버튼이 보여야 한다").toBeTruthy();
    expect(button.textContent).toContain("6개");

    const before = booted.calls.length;
    button.click();
    await sleep(600);
    const made = booted.calls.slice(before).filter(call => call.name === "saveProject");
    expect(made.length, "여섯 개를 다 만들어야 한다").toBe(6);
    const names = made.map(call => (call.input as { name: string }).name);
    expect(names).toContain("브링 CRM·OFFICE");
    expect(names).toContain("학업·자기계발");
    // 학업만 가용시간을 잡아먹지 않는 것으로 둔다. 수업 시간은 시간표에서
    // 이미 빠졌는데 "수강 7시간" 을 또 더하면 학생은 늘 넘침으로 뜬다.
    const study = made.find(call => (call.input as { id: string }).id === "pj-study");
    expect((study!.input as { offCapacity: boolean }).offCapacity).toBe(true);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
  it("오늘 화면에서 줄을 넣고 보내면 지시로 올라간다", async () => {
    // 같은 숫자를 일지에 한 번, 지시에 또 한 번 적게 하면 둘은 반드시 어긋난다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="dailyLog"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(300);

    const shown = () => (booted.document.getElementById("main") as HTMLElement).textContent || "";
    expect(shown()).toContain("일일 업무일지");
    // 오늘은 아직 안 썼다. 어제 것이 딸려 오면 날짜를 잘못 고른 것이다.
    expect(shown()).toContain("아직 안 보냄");
    expect(shown()).toContain("아직 한 줄도 없습니다");

    // 줄을 하나 넣는다.
    (booted.document.querySelector("[data-dl-add]") as HTMLElement).click();
    await sleep(150);
    const titles = [...booted.document.querySelectorAll('[data-dl-field="title"]')] as HTMLInputElement[];
    expect(titles.length).toBe(1);
    titles[0].value = "3층 누수 확인";
    const starts = booted.document.querySelector('[data-dl-field="start"]') as HTMLInputElement;
    const ends = booted.document.querySelector('[data-dl-field="end"]') as HTMLInputElement;
    starts.value = "09:00";
    ends.value = "13:00";
    // 지시를 고르면 그 시간이 "시킨 일 밖" 에서 빠져야 한다.
    const orderPick = booted.document.querySelector('[data-dl-field="orderId"]') as HTMLSelectElement;
    const mine = [...orderPick.options].find(option => option.textContent === "지난 것");
    expect(mine, "내가 물고 있는 지시가 골라져야 한다").toBeTruthy();
    orderPick.value = mine!.value;
    const progress = booted.document.querySelector('[data-dl-field="progress"]') as HTMLInputElement;
    progress.value = "80";
    // change 는 칸을 떠날 때 온다 — 글자 칸은 안 걸려서 커서가 안 튄다.
    progress.dispatchEvent(new booted.window.Event("change", { bubbles: true }));
    await sleep(200);

    // 합계가 그 자리에서 다시 나와야 한다.
    expect(shown(), "시각에서 뽑은 시간이 나와야 한다").toContain("4시간");
    expect(shown(), "지시를 골랐으니 지시 밖은 0 이다").toContain("0시간");

    const before = booted.calls.length;
    (booted.document.querySelector("[data-dl-submit]") as HTMLElement).click();
    await sleep(400);
    const sent = booted.calls.slice(before).find(call => call.name === "saveDailyLog");
    expect(sent, "보내기 통로로 나가야 한다").toBeTruthy();
    const body = sent!.input as { submit: boolean; date: string; entries: Array<{ title: string; start: string; end: string; orderId: string; progress: number }> };
    expect(body.submit, "보내기는 저장과 다르다").toBe(true);
    expect(body.entries.length).toBe(1);
    expect(body.entries[0].title).toBe("3층 누수 확인");
    expect(body.entries[0].start).toBe("09:00");
    expect(body.entries[0].end).toBe("13:00");
    expect(body.entries[0].progress).toBe(80);
    expect(body.entries[0].orderId).toBe("o1");
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("한 줄도 없으면 보내지 못하고, 친 것을 날리지 않는다", async () => {
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="dailyLog"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(300);

    // 막힌 것만 적고 줄은 안 적었다.
    const blockers = booted.document.querySelector('[data-dl-word="blockers"]') as HTMLTextAreaElement;
    blockers.value = "건물주가 전화를 안 받습니다.";
    const before = booted.calls.length;
    (booted.document.querySelector("[data-dl-submit]") as HTMLElement).click();
    await sleep(300);
    expect(booted.calls.slice(before).some(call => call.name === "saveDailyLog"),
      "무엇을 했는지가 없으면 보내지 않는다").toBe(false);
    // 다시 치게 하면 다음부터 안 쓴다.
    const kept = booted.document.querySelector('[data-dl-word="blockers"]') as HTMLTextAreaElement;
    expect(kept.value, "친 것을 날리지 않는다").toBe("건물주가 전화를 안 받습니다.");
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);

  it("대표는 누가 안 썼는지를 먼저 본다", async () => {
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="dailyLog"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(300);

    // 어제로 옮긴다. 받은 보고가 있는 날이다.
    const dateInput = booted.document.querySelector("[data-dl-date]") as HTMLInputElement;
    dateInput.value = "2026-09-05";
    dateInput.dispatchEvent(new booted.window.Event("change", { bubbles: true }));
    await sleep(200);
    (booted.document.querySelector('[data-dl-tab="team"]') as HTMLElement).click();
    await sleep(250);

    const shown = (booted.document.getElementById("main") as HTMLElement).textContent || "";
    expect(shown).toContain("받은 보고");
    // 서창환은 냈고 황우중은 안 냈다.
    expect(shown).toContain("서창환");
    expect(shown, "안 쓴 사람이 드러나야 한다").toContain("아직 안 썼습니다");
    // 09~11 혁신 2시간 + 11~18 기존 7시간 = 9시간.
    expect(shown).toContain("9시간");
    // 수업 7시간은 지시에 안 붙었다. 그 합계가 대표가 봐야 할 숫자다.
    expect(shown).toContain("7h");
    // 숫자로 안 남는 것이 대개 더 중요하다.
    expect(shown).toContain("당근 비즈프로필 권한이 아직 안 넘어왔습니다.");

    const confirm = booted.document.querySelector("[data-dl-confirm]") as HTMLElement;
    expect(confirm, "보낸 일지는 확인할 수 있어야 한다").toBeTruthy();
    const before = booted.calls.length;
    confirm.click();
    await sleep(300);
    const asked = booted.calls.slice(before).find(call => call.name === "confirmDailyLog");
    expect(asked, "확인 통로로 나가야 한다").toBeTruthy();
    expect((asked!.input as { uid: string; date: string })).toEqual({ uid: "u-admin", date: "2026-09-05" });
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
  it("AI 초안은 화면에 뜬 숫자만 넘기고, 만들자마자 저장하지 않는다", async () => {
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="dailyLog"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(300);

    // 앞선 검사가 날짜와 탭을 옮겨 놓았을 수 있다. 화면을 내 일지·오늘로
    // 되돌린다 — 검사끼리 순서에 기대면 하나를 옮길 때마다 다른 게 깨진다.
    (booted.document.querySelector('[data-dl-tab="mine"]') as HTMLElement | null)?.click();
    await sleep(150);
    const back = booted.document.querySelector("[data-dl-date]") as HTMLInputElement;
    back.value = new Date().toISOString().slice(0, 10);
    back.dispatchEvent(new booted.window.Event("change", { bubbles: true }));
    await sleep(200);

    // 한 줄 적는다. 아무것도 없으면 초안을 만들 것도 없다.
    (booted.document.querySelector("[data-dl-add]") as HTMLElement).click();
    await sleep(150);
    (booted.document.querySelector('[data-dl-field="title"]') as HTMLInputElement).value = "3층 누수 확인";
    (booted.document.querySelector('[data-dl-field="start"]') as HTMLInputElement).value = "09:00";
    (booted.document.querySelector('[data-dl-field="end"]') as HTMLInputElement).value = "13:00";
    const orderPick = booted.document.querySelector('[data-dl-field="orderId"]') as HTMLSelectElement;
    orderPick.value = ([...orderPick.options].find(option => option.textContent === "지난 것") as HTMLOptionElement).value;
    (booted.document.querySelector('[data-dl-word="blockers"]') as HTMLTextAreaElement).value = "건물주가 전화를 안 받습니다.";

    const before = booted.calls.length;
    (booted.document.querySelector("[data-dl-ai]") as HTMLElement).click();
    await sleep(400);
    const asked = booted.calls.slice(before).find(call => call.name === "assist");
    expect(asked, "AI 통로로 나가야 한다").toBeTruthy();
    const sent = asked!.input as { task: string; content: string };
    expect(sent.task).toBe("daily_report");
    // 화면에 뜬 숫자를 그대로 넘긴다. 여기서 새로 세면 보고서와 화면이 다른
    // 말을 하고, 그러면 둘 다 못 믿는다.
    expect(sent.content).toContain("채운 시간: 4시간");
    // 지시는 번호가 아니라 이름으로 간다. 번호만 주면 AI 가 지어낸다.
    expect(sent.content).toContain("지시: 지난 것");
    // 사람이 적은 말은 줄이지 않고 그대로 넘어가야 한다.
    expect(sent.content).toContain("건물주가 전화를 안 받습니다.");
    // 칸 이름이 새어 나가면 AI 가 그걸 문장에 옮겨 적는다.
    expect(sent.content).not.toContain("weightedProgress");

    // 만들자마자 서버에 쓰지 않는다. 아무도 안 읽은 글이 대표에게 올라간다.
    expect(booted.calls.slice(before).some(call => call.name === "saveDailyLog"),
      "초안을 만들면서 저장하면 안 된다").toBe(false);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
  it("쓰던 지시서를 붙여 넣으면 읽어 보여 주고, 누르면 지시가 만들어진다", async () => {
    // 이미 시트에 다 적어 놓은 것을 화면에서 다시 치게 하면, 그건 일을 덜어
    // 준 게 아니라 하나 더 만든 것이다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="workOrders"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(250);

    (booted.document.querySelector("[data-wo-import]") as HTMLElement).click();
    await sleep(200);
    expect(booted.document.querySelector(".di-panel"), "붙여넣기 자리가 열려야 한다").toBeTruthy();

    const sheet = [
      "■ 주간 업무지시서",
      "배경\t당근에서 문의가 줄고 있습니다.",
      "목표\t채널 네 곳이 살아 있고 문의가 주 3건 들어옵니다.",
      "안 하면\t겨울 성수기 전에 못 살립니다.",
      "",
      "업무명\t목적\t완료기준\t산출물\t예상시간\t가중치\t마감",
      "당근 비즈프로필 정비\t권한을 받아 최신으로 만든다\t사진 5장이 올라가면 끝\t20260909_당근.png\t4\t60\t2026-09-09",
      "숨고 등록\t새 유입 통로를 만든다\t프로필 승인 화면\t20260911_숨고.png\t3\t40\t2026-09-11",
    ].join("\n");
    (booted.document.querySelector("[data-di-paste]") as HTMLTextAreaElement).value = sheet;
    (booted.document.querySelector("[data-di-uid]") as HTMLSelectElement).value = "u-hwang";
    (booted.document.querySelector("[data-di-week]") as HTMLInputElement).value = "2026-09-07";

    (booted.document.querySelector("[data-di-read]") as HTMLElement).click();
    await sleep(250);

    const shown = () => (booted.document.querySelector(".di-panel") as HTMLElement).textContent || "";
    expect(shown()).toContain("당근 비즈프로필 정비");
    expect(shown()).toContain("사진 5장이 올라가면 끝");
    expect(shown(), "가중치 합을 보여 줘야 한다").toContain("100%");
    // 못 읽은 줄을 조용히 버리면 대표는 시킨 줄 알고 애들은 못 받은 줄 안다.
    expect(shown()).toContain("못 읽은 줄");
    expect(shown()).toContain("■ 주간 업무지시서");
    // 머리말도 읽혀야 한다. 이게 없어서 애들이 헷갈렸다.
    expect(shown()).toContain("당근에서 문의가 줄고 있습니다.");
    // 읽어 보기만으로 아무것도 만들지 않는다.
    expect(booted.calls.some(call => call.name === "saveWorkOrder"), "읽기만으로 지시가 나가면 안 된다").toBe(false);
    // 붙여 넣은 글이 다시 그리면서 사라지면 안 된다.
    expect((booted.document.querySelector("[data-di-paste]") as HTMLTextAreaElement).value).toContain("당근 비즈프로필 정비");

    const before = booted.calls.length;
    (booted.document.querySelector("[data-di-make]") as HTMLButtonElement).click();
    await sleep(700);
    const orders = booted.calls.slice(before).filter(call => call.name === "saveWorkOrder");
    expect(orders.length, "업무지시 두 건이 나가야 한다").toBe(2);
    const first = orders[0].input as { title: string; why: string; doneWhen: string; deliverable: string; hours: number; weight: number; assigneeUid: string; dueDate: string };
    expect(first.title).toBe("당근 비즈프로필 정비");
    expect(first.why).toBe("권한을 받아 최신으로 만든다");
    expect(first.doneWhen).toBe("사진 5장이 올라가면 끝");
    expect(first.deliverable).toBe("20260909_당근.png");
    expect(first.hours).toBe(4);
    expect(first.weight).toBe(60);
    expect(first.assigneeUid).toBe("u-hwang");
    expect(first.dueDate).toBe("2026-09-09");

    // 머리말은 지시 줄과 따로 저장된다. 지시 줄을 여기 복사해 두면 둘이 갈라진다.
    const directive = booted.calls.slice(before).find(call => call.name === "saveWeeklyDirective");
    expect(directive, "주간 지시서 머리말도 나가야 한다").toBeTruthy();
    const head = directive!.input as { uid: string; weekStart: string; background: string; goal: string };
    expect(head.uid).toBe("u-hwang");
    expect(head.weekStart).toBe("2026-09-07");
    expect(head.background).toContain("당근에서 문의가 줄고");
    expect(head.goal).toContain("주 3건");
    expect("tasks" in (directive!.input as Record<string, unknown>), "지시 줄을 머리말에 복사하면 안 된다").toBe(false);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
  it("지시서를 텔레그램으로 바로 보낸다", async () => {
    // 대표가 하던 것은 — 이번 주 할 것을 적고, GPT 로 다듬고, 사람이 다시
    // 정리해서 텔레그램에 붙여 넣었다. 중간에 사람이 두 번 낀다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="workOrders"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(300);

    const shown = (booted.document.getElementById("main") as HTMLElement).textContent || "";
    expect(shown).toContain("주 지시서");
    // 아직 못 받은 사람이 드러나야 한다. 밑에 깔리면 그 사람은 그 주를 그냥 보낸다.
    expect(shown).toContain("아직 없음");

    const send = booted.document.querySelector('[data-wd-send="u-admin"]') as HTMLElement;
    expect(send, "지시가 있는 사람에게는 보내기가 있어야 한다").toBeTruthy();

    const before = booted.calls.length;
    send.click();
    await sleep(250);
    // 방에 있는 사람 모두가 보게 되고, 보낸 글은 지울 수 없다. 그래서 묻는다.
    const dialog = booted.document.querySelector(".confirmation-layer.open");
    expect(dialog, "묻지 않고 보내면 안 된다").toBeTruthy();
    expect((dialog as HTMLElement).textContent).toContain("3층 누수 확인");
    expect(booted.calls.slice(before).some(call => call.name === "sendTelegramDirective"),
      "묻기 전에 나가면 안 된다").toBe(false);

    (booted.document.querySelector('[data-confirm-choice="confirm"]') as HTMLElement).click();
    await sleep(400);
    const sent = booted.calls.slice(before).find(call => call.name === "sendTelegramDirective");
    expect(sent, "보내기 통로로 나가야 한다").toBeTruthy();
    const body = sent!.input as { name: string; orders: Array<{ title: string }>; directive: { background: string } };
    expect(body.name).toBe("서창환");
    expect(body.orders.map(order => order.title)).toContain("3층 누수 확인");
    expect(body.directive.background).toContain("임차인이 두 번 민원");
    // 보낸 뒤에 내보낸 것으로 찍는다. 먼저 찍으면 실패한 것도 보낸 것이 된다.
    const marked = booted.calls.slice(before).find(call => call.name === "saveWeeklyDirective");
    expect(marked, "내보낸 것으로 남겨야 한다").toBeTruthy();
    expect((marked!.input as { publish: boolean }).publish).toBe(true);
    expect(booted.calls.indexOf(sent!)).toBeLessThan(booted.calls.indexOf(marked!));
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
  it("대충 적고 [AI로 짜기] 를 누르면 지시서 모양으로 짜 주되 바로 만들지 않는다", async () => {
    // 대표가 하던 것 — 적고, 브라우저 GPT 로 다듬고, 다시 붙여 넣기. 그 가운데
    // 단계를 없앤다. 다만 AI 가 짠 것도 사람이 적은 것과 같은 길을 지나야 한다.
    (booted.document.querySelector("[data-workspace-switch]") as HTMLElement | null)?.click();
    await sleep(100);
    const navItem = booted.document.querySelector('.nav-item[data-view="workOrders"]') as HTMLElement;
    const folder = (navItem.closest("[data-nav-folder]") as HTMLElement).dataset.navFolder as string;
    (booted.document.querySelector(`[data-workspace-enter-folder="${folder}"]`) as HTMLElement).click();
    await sleep(150);
    navItem.click();
    await sleep(250);
    (booted.document.querySelector("[data-wo-import]") as HTMLElement).click();
    await sleep(200);

    // 누구 것인지 안 고르면 가용시간을 모른 채 짜게 된다.
    // 앞선 검사가 고른 사람이 남아 있을 수 있어 빈 상태로 되돌린다.
    (booted.document.querySelector("[data-di-uid]") as HTMLSelectElement).value = "";
    (booted.document.querySelector("[data-di-paste]") as HTMLTextAreaElement).value = "당근이랑 숨고 좀 살려야 함";
    let before = booted.calls.length;
    (booted.document.querySelector("[data-di-draft]") as HTMLElement).click();
    await sleep(250);
    expect(booted.calls.slice(before).some(call => call.name === "assist"),
      "받는 사람 없이 짜면 시간을 모른 채 짠다").toBe(false);

    (booted.document.querySelector("[data-di-uid]") as HTMLSelectElement).value = "u-admin";
    before = booted.calls.length;
    (booted.document.querySelector("[data-di-draft]") as HTMLElement).click();
    await sleep(400);
    const asked = booted.calls.slice(before).find(call => call.name === "assist");
    expect(asked, "AI 통로로 나가야 한다").toBeTruthy();
    const sent = asked!.input as { task: string; content: string };
    expect(sent.task).toBe("directive_draft");
    expect(sent.content).toContain("당근이랑 숨고 좀 살려야 함");
    expect(sent.content).toContain("받는 사람: 서창환");
    // 서창환은 월 13~14 한 시간만 막혀 있어 주 64시간이다.
    expect(sent.content, "가용시간을 같이 넘겨야 한다").toContain("64시간");
    // 지금 물고 있는 일을 알려야 같은 것을 또 시키지 않는다.
    expect(sent.content).toContain("이미 물고 있어서");

    // 짜면서 만들거나 보내면 안 된다. 사람이 읽고 고쳐야 한다.
    const after = booted.calls.slice(before);
    expect(after.some(call => call.name === "saveWorkOrder")).toBe(false);
    expect(after.some(call => call.name === "sendTelegramDirective")).toBe(false);
    expect(booted.errors, booted.errors.join(" / ")).toEqual([]);
  }, 60000);
});
