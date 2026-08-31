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

  function renderLanding() {
    const folders = [
      ["operations", "운영 폴더", "고객·건물과 모든 기존 CRM 업무"],
      ["marketing", "마케팅 폴더", "마케팅 업무와 콘텐츠 관리"],
    ];
    return `<section class="workspace-landing" aria-labelledby="workspaceLandingTitle">
      <header><span>BRING WORKSPACE</span><h2 id="workspaceLandingTitle">작업 폴더를 선택하세요</h2><p>하나의 로그인으로 운영과 마케팅 업무를 오갈 수 있습니다.</p></header>
      <div class="workspace-folder-grid">${folders.map(([key, title, description]) => `<button type="button" class="workspace-folder-card" data-workspace-enter="${escapeHtml(key)}"><span class="workspace-folder-icon" aria-hidden="true">▰</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></button>`).join("")}</div>
    </section>`;
  }

  return Object.freeze({ normalizeWorkspace, createWorkspaceCoordinator, renderLanding });
});
