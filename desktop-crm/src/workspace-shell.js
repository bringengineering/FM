(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringWorkspaceShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const storageKey = "bring.crm.workspace";
  const workspaceNames = Object.freeze(["operations", "marketing"]);
  const normalizeWorkspace = value => workspaceNames.includes(value) ? value : "operations";
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function createWorkspaceCoordinator(options) {
    const storage = options.storage;
    let currentWorkspace = null;
    const apply = () => {
      if (typeof options.onWorkspaceChange === "function") options.onWorkspaceChange(currentWorkspace);
      const operations = currentWorkspace === "operations";
      options.setOperationsNav(operations);
      if (currentWorkspace === null) options.renderLanding();
      else if (currentWorkspace === "marketing") options.renderMarketing();
      else options.renderOperations();
      return currentWorkspace;
    };
    return Object.freeze({
      start() {
        try {
          const savedWorkspace = storage.getItem(storageKey);
          if (savedWorkspace === null) currentWorkspace = null;
          else if (workspaceNames.includes(savedWorkspace)) currentWorkspace = savedWorkspace;
          else {
            storage.removeItem(storageKey);
            currentWorkspace = null;
          }
        } catch (_error) { currentWorkspace = null; }
        return apply();
      },
      render: apply,
      async select(value) {
        currentWorkspace = normalizeWorkspace(value);
        if (typeof options.beforeTransition === "function") await options.beforeTransition(currentWorkspace);
        try { storage.setItem(storageKey, currentWorkspace); } catch (_error) {}
        return apply();
      },
      async showLanding() {
        if (typeof options.beforeTransition === "function") await options.beforeTransition(null);
        currentWorkspace = null;
        return apply();
      },
    });
  }

  // 처음 들어왔을 때 고르는 폴더. 사이드바 폴더와 같은 이름·같은 순서로 둔다.
  // 여기와 사이드바가 다른 이름을 쓰면 같은 곳을 두 이름으로 부르게 된다.
  //
  // workspace 는 둘뿐이다(operations·marketing). 나머지는 운영 안의 폴더라
  // 눌렀을 때 운영으로 들어가면서 그 폴더의 첫 화면을 연다. view 가 있는
  // 카드는 운영 폴더고, 없는 카드는 그 workspace 자체로 들어간다.
  const LANDING_FOLDERS = Object.freeze([
    { workspace: "operations", view: "customers", title: "CRM", description: "고객·건물·협력업체·공실" },
    { workspace: "operations", view: "tasks", title: "프로젝트 관리", description: "할 일과 민원" },
    { workspace: "operations", view: "buildingCalendar", title: "ERP·일정", description: "업무·계약 일정과 입금" },
    { workspace: "operations", view: "officeHome", title: "HRIS·그룹웨어", description: "근태와 메신저" },
    { workspace: "operations", view: "operationsIntelligence", title: "BI·대시보드", description: "운영 분석과 밸류스코프" },
    { workspace: "operations", view: "buildingDocuments", title: "문서관리", description: "건물 문서함과 정보·열쇠" },
    { workspace: "operations", view: "aiAssistant", title: "워크플로·AI", description: "AI 비서" },
    { workspace: "marketing", view: "", title: "마케팅", description: "마케팅 업무와 콘텐츠 관리" },
  ]);

  function renderLanding() {
    const folders = LANDING_FOLDERS.map(folder => [folder.workspace, folder.title, folder.description, folder.view]);
    return `<section class="workspace-landing" aria-labelledby="workspaceLandingTitle">
      <header><span>BRING WORKSPACE</span><h2 id="workspaceLandingTitle">작업 폴더를 선택하세요</h2><p>하나의 로그인으로 모든 업무를 오갈 수 있습니다. 들어간 뒤에도 왼쪽에서 바꿀 수 있습니다.</p></header>
      <div class="workspace-folder-grid">${folders.map(([key, title, description, view]) => `<button type="button" class="workspace-folder-card" data-workspace-enter="${escapeHtml(key)}"${view ? ` data-workspace-enter-view="${escapeHtml(view)}"` : ""}><span class="workspace-folder-icon" aria-hidden="true"><svg class="workspace-folder-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 7.5a2 2 0 0 1 2-2h3.4l2 2.4h7.6a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg></span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></button>`).join("")}</div>
    </section>`;
  }

  return Object.freeze({ normalizeWorkspace, createWorkspaceCoordinator, renderLanding, LANDING_FOLDERS });
});
