// 견적서 → 작업 결과보고서 → 고객 알림. 한 줄로 잇는다.
//
// 대표가 한 말이 이 파일이 있는 이유다.
//
//   "견적서 -> 작업 결과보고서 -> 카카오톡 연결까지 저거 문서관리에 딱
//    순서대로 넣어줘 그리고 자동화가 될 수 있게끔 해주시고"
//
// 지금까지는 셋이 남남이었다. 견적서를 만들어 PDF 로 보내고, 며칠 뒤
// 결과보고서 화면에서 건물명·주소·건물주·연락처를 **처음부터 다시 친다.**
// 다 치고 나면 카톡을 열어 "작업 끝났습니다" 를 손으로 쓴다.
//
// 세 번 다 같은 것을 적는다. 그러면 세 군데가 조금씩 달라지고, 어느 것이
// 맞는지는 아무도 모른다.
//
// 그래서 앞 장이 아는 것은 뒷 장이 물려받는다.
//
// 다만 **모르는 것을 지어내지 않는다.**
//
// 견적서는 작업일을 모른다. 견적을 낸 날이지 일한 날이 아니다. 계약기간도
// 모른다. 그런 칸을 견적일로 채워 두면 보고서에 거짓 날짜가 찍히고, 그건
// 빈칸보다 나쁘다 — 빈칸은 사람이 채우지만 채워진 칸은 아무도 안 본다.
//
// 그래서 물려받는 것은 견적서가 **실제로 아는 것**뿐이고, 남은 칸은
// missing 으로 돌려준다. 화면은 그걸 그대로 보여 준다.
//
// 하지 않는 것
//
// 1. 보고서를 저절로 만들지 않는다. 물려받은 초안을 열어 주고, 만드는 것은
//    사람이 누른다. 견적을 낼 때마다 보고서가 생기면 안 한 일의 보고서가 쌓인다.
// 2. 알림을 저절로 보내지 않는다. 문구는 여기가 정하고, 보낼지는 사람이 정한다.
// 3. 문구를 여기서 새로 쓰지 않는다. notify-core 가 단계마다 이미 들고 있다.
//    두 벌이 되면 한쪽이 반드시 뒤처진다.
(function attachDocFlowCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringDocFlowCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createDocFlowCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);

  // 문서관리에 놓이는 순서. 화면이 이 순서를 읽어 띠를 그린다 — 여기 한 곳만
  // 고치면 세 화면이 같이 바뀐다.
  const STEPS = Object.freeze([
    Object.freeze({ key: "quote", no: 1, label: "견적서", view: "quotes", hint: "무엇을 얼마에 할지 낸다" }),
    Object.freeze({ key: "report", no: 2, label: "작업 결과보고서", view: "workReports", hint: "무엇을 했는지 사진으로 보인다" }),
    Object.freeze({ key: "notice", no: 3, label: "고객 알림", view: "customerNotices", hint: "끝났다고 건물주에게 알린다" }),
  ]);

  // 견적서의 '작업 종류' 를 결과보고서의 '항목 묶음' 으로 옮긴다.
  //
  // 못 맞추면 special(특수·기타) 로 둔다. 억지로 입주청소에 넣으면 계단
  // 항목이 통째로 빠진 보고서가 나오는데, 그 보고서는 멀쩡해 보인다.
  const SERVICE_KINDS = Object.freeze([
    Object.freeze({ kind: "stairs", words: Object.freeze(["계단", "공용부", "공용"]) }),
    Object.freeze({ kind: "moveIn", words: Object.freeze(["입주", "이사", "퇴실", "준공"]) }),
  ]);

  function kindFromService(service) {
    const value = text(service, 60);
    if (!value) return "special";
    const found = SERVICE_KINDS.find(item => item.words.some(word => value.includes(word)));
    return found ? found.kind : "special";
  }

  // 견적서가 실제로 아는 것만 옮긴다.
  //
  // buildingName 은 견적의 '공사명' 자리다. 사람이 거기에 건물 이름을 적는다.
  // 비어 있거나 기본값이면 받는 사람 이름으로 대신한다 — "시설관리 견적" 이
  // 건물명 칸에 들어가 있으면 목록에서 어느 건물인지 알 수 없다.
  const DEFAULT_PROJECT = "시설관리 견적";

  function reportSeedFromQuote(quote) {
    const value = quote && typeof quote === "object" && !Array.isArray(quote) ? quote : {};
    const project = text(value.projectName, 200);
    const recipient = text(value.recipient, 80);
    const buildingName = project && project !== DEFAULT_PROJECT ? project : recipient;
    const service = text(value.service, 60);
    const seed = {
      buildingName,
      siteAddress: text(value.siteAddress, 300),
      ownerName: recipient,
      ownerContact: text(value.recipientPhone, 120),
      kind: kindFromService(service),
      title: service ? `${service} 결과보고서` : "작업 결과보고서",
      summary: text(value.summary, 2000),
      // 견적서가 모르는 것은 비워 둔다. 견적일을 작업일로 쓰면 거짓이 된다.
      workDate: "",
      workerName: "",
      area: "",
      contractFrom: "",
      contractTo: "",
    };
    const missing = [];
    if (!seed.buildingName) missing.push("건물명");
    if (!seed.siteAddress) missing.push("현장 주소");
    if (!seed.ownerName) missing.push("건물주");
    missing.push("작업일", "작업자");
    return { seed, missing, service, matched: seed.kind !== "special" };
  }

  // 결과보고서에서 고객에게 보낼 문구를 만든다. 문구 자체는 notify-core 가
  // 들고 있는 것을 그대로 쓴다.
  function noticeValuesFromReport(report) {
    const value = report && typeof report === "object" && !Array.isArray(report) ? report : {};
    return { 건물명: text(value.buildingName, 200) };
  }

  // 세 걸음 중 지금 어디인가.
  //
  // done 은 "그 장이 손에 있다" 는 뜻이고, ready 는 "지금 누를 수 있다" 는
  // 뜻이다. 앞 장이 없으면 뒷 장은 눌러도 채울 것이 없다.
  function chain(state) {
    const value = state && typeof state === "object" && !Array.isArray(state) ? state : {};
    const hasQuote = Boolean(value.quote);
    const hasReport = Boolean(value.report);
    const hasNotice = Boolean(value.notice);
    const done = { quote: hasQuote, report: hasReport, notice: hasNotice };
    const ready = { quote: true, report: hasQuote || hasReport, notice: hasReport };
    const next = STEPS.find(step => !done[step.key]) || null;
    return {
      steps: STEPS.map(step => Object.assign({}, step, {
        done: done[step.key],
        ready: ready[step.key],
        current: Boolean(next && next.key === step.key),
      })),
      next,
      complete: hasQuote && hasReport && hasNotice,
    };
  }

  return Object.freeze({
    STEPS,
    kindFromService,
    reportSeedFromQuote,
    noticeValuesFromReport,
    chain,
  });
});
