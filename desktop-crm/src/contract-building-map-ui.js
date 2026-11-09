(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./contract-building-map-core'));
  else root.BringContractBuildingMapUI = factory(root.BringContractBuildingMapCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Core) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = state => `<span class="cbm-status cbm-${state}">${Core.states[state].symbol} ${Core.states[state].label}</span>`;
  function locationLabel(row, state) {
    if (row.status === 'unknown') return '계약 상태 확인 필요';
    if (!row.address) return '주소 미등록';
    if (state.points.has(row.id)) return '위치 확인';
    const reason = typeof state.failed.get === 'function' ? state.failed.get(row.id) : state.failed.has(row.id) ? 'not-found' : '';
    if (reason === 'missing-address') return '주소 미등록';
    if (reason === 'not-found') return '주소 조회 실패';
    if (reason) return '위치 조회 실패';
    return state.config?.enabled ? '위치 조회 대기' : '지도 연결 대기';
  }
  function visibleRows(projection, state) {
    const query = String(state.query || '').toLocaleLowerCase('ko');
    return projection.rows.filter(row => (state.filter === 'all' || row.status === state.filter) && [row.name, row.address, ...row.customerNames].join(' ').toLocaleLowerCase('ko').includes(query));
  }
  // 지도 위 카드: 고른 건물의 핵심 정보와 바로 쓰는 버튼만 둔다. 계약 목록은 아래 상세에 있다.
  function card(selected, state) {
    if (!selected) return '';
    const first = selected.customerIds[0];
    return `<article class="cbm-card" data-cbm-card aria-label="선택한 건물"><div class="cbm-card-head"><strong>${esc(selected.name)}</strong>${badge(selected.status)}</div><p>${esc(selected.address || '주소 미등록')}</p><p class="cbm-card-meta">${esc(selected.customerNames.join(', '))}${selected.nextDate ? ` · 다음 작업 ${esc(selected.nextDate)}` : ''}</p><div class="cbm-card-actions">${first ? `<button type="button" class="primary-button" data-cbm-customer="${esc(first)}">상세 보기</button>` : ''}${state.points.has(selected.id) ? '<button type="button" class="secondary-button" data-cbm-focus>이 건물로 이동</button>' : `<span class="cbm-card-note">${esc(locationLabel(selected, state))}</span>`}${selected.address ? '<button type="button" class="secondary-button" data-cbm-copy>주소 복사</button>' : ''}</div></article>`;
  }
  function shell(projection, state, admin) {
    const rows = visibleRows(projection, state);
    const selected = rows.find(row => row.id === state.selected) || rows[0];
    const selectedId = selected?.id || '';
    const detail = selected ? `<h3>${esc(selected.name)}</h3>${badge(selected.status)}<p>${esc(selected.address || '주소 미등록')}</p><p>위치 · ${esc(locationLabel(selected, state))}</p><p>고객 · ${esc(selected.customerNames.join(', '))}</p><p>다음 작업 · ${esc(selected.nextDate ? selected.nextDate + ' · 캘린더 기준' : '향후 12개월 내 확인된 일정 없음')}</p><ul>${selected.contracts.map(contract => `<li><b>${esc(contract.name)}</b><span>${esc(contract.status || '상태 확인 필요')} · ${esc(contract.startDate || '시작일 미입력')} ~ ${esc(contract.endDate || '종료일 미입력')}</span></li>`).join('')}</ul><div class="cbm-customer-links">${selected.customerIds.map((id, index) => `<button type="button" class="secondary-button" data-cbm-customer="${esc(id)}">${selected.customerIds.length === 1 ? '고객·계약 상세 보기' : esc(selected.customerNames[index] || '고객') + ' · 상세 보기'} →</button>`).join('')}</div>` : '<p>선택할 계약 건물이 없습니다.</p>';
    return `<section class="cbm-workspace" aria-label="계약 건물 지도"><header class="cbm-heading"><p>등록 계약과 연결된 건물 ${projection.rows.length}동 · 건물마다 하나의 표식으로 표시합니다.</p><button type="button" class="secondary-button" data-cbm-reload>연결 상태 새로 확인</button></header>
      <nav class="cbm-filters" aria-label="계약 상태 필터">${[['all', '전체', projection.rows.length], ...Object.entries(Core.states).map(([key, value]) => [key, value.symbol + ' ' + value.label, projection.counts[key]])].map(([key, label, count]) => `<button type="button" class="${key === state.filter ? 'active' : ''}" aria-pressed="${key === state.filter}" data-cbm-filter="${key}">${label} <span>${count}</span></button>`).join('')}</nav>
      <div class="cbm-notice" role="status">${esc(state.notice || (state.loading ? '지도 연결 설정을 확인하고 있습니다.' : state.config?.enabled ? (state.config.source === 'server' ? '회사 지도 서버로 계약 건물 주소를 자동 조회합니다. 조회 위치는 이 화면에서만 사용하고 저장하지 않습니다.' : '계약 건물 주소를 자동 조회합니다. 조회 위치는 이 화면에서만 사용하고 저장하지 않습니다.') : '설정 필요 · 인증키를 나중에 등록하면 계약 건물의 주소를 자동으로 표시합니다. 지금은 외부 API를 호출하지 않습니다.'))}</div>
      ${projection.unlinked ? `<p class="cbm-help">고객 또는 건물이 연결되지 않은 계약 ${projection.unlinked}건은 지도에서 제외했습니다. 계약 고객 관리에서 연결 정보를 확인해 주세요.</p>` : ''}
      <div class="cbm-layout"><aside class="cbm-list"><label>건물·주소·고객 검색<input type="search" data-cbm-search placeholder="건물명·주소·고객명" value="${esc(state.query)}"></label><div class="cbm-list-scroll">${rows.map(row => `<button type="button" data-cbm-select="${esc(row.id)}" class="cbm-row${row.id === selectedId ? ' selected' : ''}" aria-pressed="${row.id === selectedId}"><strong>${esc(row.name)}</strong>${badge(row.status)}<span>${esc(row.address || '주소 미등록')}</span><small>${esc(row.customerNames.join(', '))} · ${esc(locationLabel(row, state))}</small></button>`).join('') || '<p class="cbm-help">조건에 맞는 계약 건물이 없습니다.</p>'}</div></aside>
      <div class="cbm-content"><div class="cbm-map" data-cbm-map role="region" aria-label="계약 건물 위치 지도" tabindex="0">${state.config?.enabled ? `<div class="cbm-tiles" data-cbm-tiles></div><div class="cbm-markers" data-cbm-markers></div><div class="cbm-map-tools"><button type="button" data-cbm-zoom="1" aria-label="지도 확대" title="확대">＋</button><button type="button" data-cbm-zoom="-1" aria-label="지도 축소" title="축소">－</button><button type="button" data-cbm-fit title="보이는 건물 전체 보기">전체</button></div><div class="cbm-legend" aria-hidden="true">${Object.entries(Core.states).filter(([key]) => key !== 'unknown').map(([key, value]) => `<span class="cbm-${key}"><i>${value.symbol}</i>${value.label}</span>`).join('')}</div>${card(selected, state)}<p class="cbm-attribution">공간정보 오픈플랫폼(브이월드) · 끌어서 이동 · 휠/더블클릭 확대</p>` : '<div class="cbm-placeholder"><span aria-hidden="true">⌖</span><h3>지도 연결을 준비했습니다</h3><p>인증키 등록 전에는 실제 지도와 건물 위치를 불러오지 않습니다.</p><p>왼쪽 목록에서 계약 건물과 상태를 먼저 확인할 수 있습니다.</p></div>'}</div><article class="cbm-detail" data-cbm-detail>${detail}</article></div></div>
      <p class="cbm-help">여러 계약이 있는 건물은 계약 중 → 예정 → 종료 순으로 대표 표시합니다. ‘종료 예정’은 종료 처리 전까지 계약 중입니다.</p>
      ${admin ? `<details class="cbm-settings" ${state.settingsOpen ? 'open' : ''}><summary>지도 연결 설정 · 이 PC에만 적용</summary><form data-cbm-settings><p>${state.config?.source === 'server' ? '현재 회사 지도 서버의 공용 키로 지도를 사용 중입니다. 이 PC에서 별도 키를 쓸 때만 아래에 등록하세요.' : '회사 지도 서버에 키가 등록되면 모든 PC에서 자동으로 사용됩니다. 아래는 이 PC에서만 쓰는 별도 키입니다.'} 키는 이 PC의 암호화 저장소에만 보관하며 공용 DB·백업·보고서에 포함하지 않습니다.</p><label>브이월드 인증키<input type="password" autocomplete="off" spellcheck="false" data-cbm-key maxlength="128" placeholder="${state.config?.configured ? '등록된 키 유지 (변경할 때만 입력)' : '키는 나중에 등록해도 됩니다'}"></label><label class="cbm-check"><input type="checkbox" data-cbm-usage ${state.config?.usageConfirmed ? 'checked' : ''}>운영키 및 회사 업무용 이용 허락·사용 조건을 확인했습니다.</label><label class="cbm-check"><input type="checkbox" data-cbm-enabled ${(state.config?.localEnabled ?? state.config?.enabled) ? 'checked' : ''}>주소 자동 표시와 지도 연결 사용 (브이월드에 건물 주소가 전송됩니다)</label><button type="submit" class="primary-button" ${state.saving ? 'disabled' : ''}>${state.saving ? '저장 중' : '이 PC에 안전하게 저장'}</button><p class="cbm-help">무료 API의 제공 한도와 운영 정책이 적용됩니다. 개발키만 발급된 상태에서는 사용 확인을 선택하지 마세요. 유료 서비스로 자동 전환하지 않습니다.</p></form></details>` : '<p class="cbm-help">지도 연결 설정은 CRM 관리자에게 요청해 주세요.</p>'}</section>`;
  }
  function mount(container, options) {
    const doc = container.ownerDocument, root = doc.createElement('div'); root.className = 'cbm-root'; container.replaceChildren(root);
    const projection = Core.project(options.store, options.today), admin = options.user?.role === 'admin';
    const state = { filter: 'all', query: '', selected: '', config: null, loading: true, saving: false, settingsOpen: false, notice: '', points: new Map(), failed: new Map(), center: [127.94, 37.34], zoom: 13 };
    let disposed = false, generation = 0, drag = null, userMoved = false, tileQueue = [], tileActive = 0, tileEpoch = 0, wheelAt = 0, wheelDelta = 0;
    // Tiles that failed stay blank until "연결 상태 새로 확인" instead of being re-requested on every repaint.
    const tileFailed = new Set();
    const tileCache = new Map(), tilePending = new Set();
    const active = () => !disposed && root.isConnected && options.isActive();
    function fit() {
      const points = visibleRows(projection, state).map(row => state.points.get(row.id)).filter(Boolean); if (!points.length) return;
      state.center = [(Math.min(...points.map(p => p.lon)) + Math.max(...points.map(p => p.lon))) / 2, (Math.min(...points.map(p => p.lat)) + Math.max(...points.map(p => p.lat))) / 2];
      const map = root.querySelector('[data-cbm-map]');
      for (state.zoom = points.length === 1 ? 15 : 16; state.zoom > 6; state.zoom--) {
        const pixels = points.map(p => Core.point(p.lon, p.lat, state.zoom));
        if (Math.max(...pixels.map(p => p.x)) - Math.min(...pixels.map(p => p.x)) < (map?.clientWidth || 600) - 100 && Math.max(...pixels.map(p => p.y)) - Math.min(...pixels.map(p => p.y)) < (map?.clientHeight || 420) - 100) break;
      }
    }
    function render() {
      if (!active()) return;
      const panel = root.querySelector('details'); if (panel) state.settingsOpen = panel.open;
      const scroll = root.querySelector('.cbm-list-scroll')?.scrollTop || 0;
      root.innerHTML = shell(projection, state, admin);
      const list = root.querySelector('.cbm-list-scroll'); if (list) list.scrollTop = scroll;
      paint();
    }
    function selectedId() {
      const rows = visibleRows(projection, state);
      return (rows.find(row => row.id === state.selected) || rows[0])?.id || '';
    }
    function lonLat(x, y, zoom) {
      const size = 256 * 2 ** zoom;
      return [x / size * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI];
    }
    // 커서 아래 지점을 고정한 채로 확대·축소한다.
    function zoomAt(delta, clientX, clientY) {
      const map = root.querySelector('[data-cbm-map]'), next = Math.max(6, Math.min(19, state.zoom + delta));
      if (next === state.zoom) return;
      const rect = map?.getBoundingClientRect?.(), dx = rect && Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0, dy = rect && Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
      const center = Core.point(...state.center, state.zoom), scale = 2 ** (next - state.zoom);
      const target = lonLat((center.x + dx) * scale - dx, (center.y + dy) * scale - dy, next);
      if (Core.point(...target, next)) state.center = target;
      state.zoom = next; userMoved = true; paint();
    }
    function focusSelected(minZoom) {
      const point = state.points.get(selectedId()); if (!point) return false;
      state.center = [point.lon, point.lat]; if (minZoom) state.zoom = Math.max(state.zoom, minZoom); userMoved = true; return true;
    }
    function revealRow(id) {
      const row = [...root.querySelectorAll('[data-cbm-select]')].find(item => item.dataset.cbmSelect === id && item.classList.contains('cbm-row'));
      row?.scrollIntoView?.({ block: 'nearest' });
    }
    function move(dx, dy) {
      const center = Core.point(...state.center, state.zoom), [lon, lat] = lonLat(center.x + dx, center.y + dy, state.zoom);
      if (Core.point(lon, lat, state.zoom)) state.center = [lon, lat]; userMoved = true; paint();
    }
    function paint() {
      if (!active() || !state.config?.enabled) return;
      const map = root.querySelector('[data-cbm-map]'), tiles = root.querySelector('[data-cbm-tiles]'), markers = root.querySelector('[data-cbm-markers]');
      if (!map || !tiles || !markers) return;
      const width = Math.min(map.clientWidth || 600, 1600), height = map.clientHeight || 420, center = Core.point(...state.center, state.zoom), left = center.x - width / 2, top = center.y - height / 2;
      tiles.replaceChildren(); markers.replaceChildren(); tileQueue = []; tileEpoch++;
      for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
        const key = `${state.zoom}/${x}/${y}`, image = doc.createElement('img'); image.alt = ''; image.draggable = false; image.width = 256; image.height = 256; image.dataset.cbmTile = key; image.style.left = `${x * 256 - left}px`; image.style.top = `${y * 256 - top}px`; tiles.append(image);
        if (tileCache.has(key)) image.src = tileCache.get(key);
        else if (!tilePending.has(key) && !tileFailed.has(key)) tileQueue.push({ key, x, y, z: state.zoom, epoch: tileEpoch });
      }
      tiles.style.transform = ''; markers.style.transform = '';
      // 확대하면 모든 건물 이름을, 멀리서는 고른 건물·마우스를 올린 건물 이름만 보인다.
      markers.classList.toggle('cbm-labels', state.zoom >= 15);
      const current = selectedId();
      // Spread colocated markers without changing the geocoded source positions.
      const colocated = new Map();
      for (const row of visibleRows(projection, state)) {
        const coordinates = state.points.get(row.id); if (!coordinates || row.status === 'unknown') continue;
        const point = Core.point(coordinates.lon, coordinates.lat, state.zoom); if (!point) continue;
        const bucket = `${Math.round(point.x / 22)}:${Math.round(point.y / 22)}`, offset = colocated.get(bucket) || 0; colocated.set(bucket, offset + 1);
        const button = doc.createElement('button'), pin = doc.createElement('span'), label = doc.createElement('span');
        button.type = 'button'; button.className = `cbm-marker cbm-${row.status}${row.id === current ? ' selected' : ''}`; button.dataset.cbmSelect = row.id;
        pin.className = 'cbm-pin'; pin.textContent = Core.states[row.status].symbol; label.className = 'cbm-label'; label.textContent = row.name; button.append(pin, label);
        button.setAttribute('aria-label', `${row.name} · ${Core.states[row.status].label}`); button.setAttribute('aria-pressed', String(row.id === current));
        button.style.left = `${point.x - left + (offset ? Math.cos(offset * 2.4) * 30 : 0)}px`; button.style.top = `${point.y - top + (offset ? Math.sin(offset * 2.4) * 30 : 0)}px`; markers.append(button);
      }
      pumpTiles();
    }
    function pumpTiles() {
      while (active() && tileActive < 3 && tileQueue.length && state.config?.enabled) {
        const item = tileQueue.shift(); if (tilePending.has(item.key)) continue;
        tileActive++; tilePending.add(item.key); const token = generation;
        Promise.resolve().then(() => options.api.contractMapTile({ x: item.x, y: item.y, z: item.z })).then(result => {
          if (!active() || token !== generation || !state.config?.enabled) return;
          if (!result?.ok || typeof result.dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.dataUrl) || result.dataUrl.length > 700000) {
            if (result?.code !== 'LIMIT') tileFailed.add(item.key);
            const notice = root.querySelector('[role="status"]'); if (notice) notice.textContent = '지도 일부를 불러오지 못했습니다. 키 권한·연결 상태를 확인한 뒤 새로 확인해 주세요.'; return;
          }
          if (tileCache.size >= 80) tileCache.delete(tileCache.keys().next().value); tileCache.set(item.key, result.dataUrl);
          root.querySelectorAll('[data-cbm-tile]').forEach(image => { if (image.dataset.cbmTile === item.key) image.src = result.dataUrl; });
        }).catch(() => {}).finally(() => { tileActive--; tilePending.delete(item.key); if (active()) pumpTiles(); });
      }
    }
    async function load() {
      const token = ++generation; state.loading = true; state.notice = ''; state.points.clear(); state.failed.clear(); tileCache.clear(); tileFailed.clear(); tileQueue = []; state.config = null; render();
      try {
        const config = await options.api.contractMapStatus(); if (!active() || token !== generation) return;
        if (!config?.ok) { state.notice = '지도 설정을 확인하지 못했습니다. CRM 로그인과 암호화 저장소를 확인해 주세요.'; return; }
        state.config = config; state.loading = false; render();
        if (!config.enabled) return;
        const candidates = projection.rows.filter(row => { if (!row.address || row.status === 'unknown') { state.failed.set(row.id, !row.address ? 'missing-address' : 'status'); return false; } return true; });
        for (let offset = 0; offset < candidates.length; offset += 10) {
          if (!active() || token !== generation) return;
          const batch = candidates.slice(offset, offset + 10);
          const result = await options.api.locateContractBuildings({ buildingIds: batch.map(row => row.id) });
          if (!active() || token !== generation) return;
          for (const row of batch) {
            const point = result?.ok && result.results?.find(item => item.id === row.id && item.status === 'located');
            const entry = result?.results?.find(item => item.id === row.id);
            if (point && Core.point(point.lon, point.lat)) state.points.set(row.id, { lon: Number(point.lon), lat: Number(point.lat) }); else state.failed.set(row.id, entry?.status === 'missing-address' ? 'missing-address' : entry?.status === 'not-found' ? 'not-found' : 'unavailable');
          }
          if (!result?.ok) { state.notice = '주소를 조회하지 못했습니다. 키 권한·제공 한도와 연결 상태를 확인해 주세요.'; break; }
        }
        if (!userMoved) fit();
        state.notice ||= `위치 확인 ${state.points.size}동 / 계약 건물 ${projection.rows.length}동${state.failed.size ? ` · 주소·상태 확인 필요 ${state.failed.size}동` : ''}`;
      } catch { if (active() && token === generation) state.notice = '지도 연결을 확인하지 못했습니다. 다른 CRM 업무는 계속 사용할 수 있습니다.'; }
      finally { if (active() && token === generation) { state.loading = false; render(); } }
    }
    async function submit(event) {
      if (!event.target.matches('[data-cbm-settings]')) return;
      event.preventDefault(); event.stopPropagation(); if (!active() || state.saving || !admin) return;
      const form = event.target, input = { apiKey: form.querySelector('[data-cbm-key]').value.trim(), enabled: form.querySelector('[data-cbm-enabled]').checked, usageConfirmed: form.querySelector('[data-cbm-usage]').checked };
      form.querySelector('[data-cbm-key]').value = ''; state.saving = true; const token = ++generation;
      try {
        const result = await options.api.saveContractMapSettings(input);
        if (!active() || token !== generation) return;
        state.saving = false;
        if (result?.ok) await load(); else { state.notice = '설정을 저장하지 못했습니다. 관리자 권한·키 형식·운영 사용 확인과 암호화 저장소를 확인해 주세요.'; render(); }
      } catch { if (active() && token === generation) { state.saving = false; state.notice = '지도 설정을 저장하지 못했습니다.'; render(); } }
      finally { input.apiKey = ''; }
    }
    function click(event) {
      const control = event.target.closest('button'); if (!control || !root.contains(control) || !active()) return;
      if (control.hasAttribute('data-cbm-filter')) { state.filter = Object.hasOwn(Core.states, control.dataset.cbmFilter) ? control.dataset.cbmFilter : 'all'; if (!userMoved) fit(); render(); }
      else if (control.hasAttribute('data-cbm-select')) {
        // 목록에서 고르면 지도를 그 건물로 옮기고, 지도에서 고르면 지도는 그대로 두고 목록을 맞춘다.
        const fromMap = Boolean(control.classList?.contains('cbm-marker')); state.selected = control.dataset.cbmSelect;
        if (!fromMap) focusSelected(15);
        render(); revealRow(state.selected);
      }
      else if (control.hasAttribute('data-cbm-customer')) options.onCustomer(control.dataset.cbmCustomer);
      else if (control.hasAttribute('data-cbm-reload')) void load();
      else if (control.hasAttribute('data-cbm-zoom')) zoomAt(Number(control.dataset.cbmZoom));
      else if (control.hasAttribute('data-cbm-fit')) { fit(); userMoved = false; paint(); }
      else if (control.hasAttribute('data-cbm-focus')) { if (focusSelected(16)) paint(); }
      else if (control.hasAttribute('data-cbm-copy')) {
        const row = projection.rows.find(item => item.id === selectedId()), clipboard = doc.defaultView?.navigator?.clipboard;
        if (!row?.address || !clipboard) return;
        clipboard.writeText(row.address).then(() => { if (control.isConnected) control.textContent = '복사했습니다'; }, () => { if (control.isConnected) control.textContent = '복사하지 못했습니다'; });
      }
    }
    function search(event) {
      if (!event.target.matches('[data-cbm-search]') || !active() || event.isComposing) return;
      const value = event.target.value; state.query = value.slice(0, 200); if (!userMoved) fit(); render(); const input = root.querySelector('[data-cbm-search]'); input?.focus();
    }
    function keydown(event) {
      if (!event.target.matches('[data-cbm-map]') || !state.config?.enabled) return;
      const delta = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] }[event.key];
      if (delta) { event.preventDefault(); move(...delta); }
      else if (['+', '=', '-', '_'].includes(event.key)) { event.preventDefault(); zoomAt(['+', '='].includes(event.key) ? 1 : -1); }
    }
    function layers() { return [root.querySelector('[data-cbm-tiles]'), root.querySelector('[data-cbm-markers]')].filter(Boolean); }
    function pointerDown(event) {
      const map = event.target.closest('[data-cbm-map]');
      if (!map || event.target.closest('button, [data-cbm-card]') || !state.config?.enabled || event.button > 0) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId }; map.setPointerCapture?.(event.pointerId); map.classList.add('dragging');
    }
    // 끌고 있는 동안 지도가 손을 따라 움직이고, 놓을 때 타일을 새로 맞춘다.
    function pointerMove(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const shift = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`; for (const layer of layers()) layer.style.transform = shift;
    }
    function pointerUp(event) {
      if (!drag || event.pointerId !== drag.id) return; const previous = drag; drag = null;
      root.querySelector('[data-cbm-map]')?.classList.remove('dragging');
      if (!active()) return;
      const dx = previous.x - event.clientX, dy = previous.y - event.clientY;
      if (Math.abs(dx) + Math.abs(dy) < 3) { for (const layer of layers()) layer.style.transform = ''; return; }
      move(dx, dy);
    }
    function wheel(event) {
      if (!event.target.closest('[data-cbm-map]') || event.target.closest('[data-cbm-card]') || !state.config?.enabled) return;
      event.preventDefault(); wheelDelta += event.deltaY;
      const now = Date.now(); if (now - wheelAt < 160 || Math.abs(wheelDelta) < 40) return;
      wheelAt = now; const direction = wheelDelta < 0 ? 1 : -1; wheelDelta = 0; zoomAt(direction, event.clientX, event.clientY);
    }
    function dblclick(event) {
      if (!event.target.closest('[data-cbm-map]') || event.target.closest('button, [data-cbm-card]') || !state.config?.enabled) return;
      event.preventDefault(); zoomAt(event.shiftKey ? -1 : 1, event.clientX, event.clientY);
    }
    // 목록에 마우스를 올리면 지도 표식도 같이 강조한다.
    function hover(event) {
      const row = event.target.closest?.('.cbm-row'); const id = event.type === 'mouseover' && row ? row.dataset.cbmSelect : '';
      root.querySelectorAll?.('.cbm-marker').forEach(marker => marker.classList.toggle('hovered', Boolean(id) && marker.dataset.cbmSelect === id));
    }
    root.addEventListener('click', click); root.addEventListener('input', search); root.addEventListener('compositionend', search); root.addEventListener('submit', submit); root.addEventListener('keydown', keydown); root.addEventListener('pointerdown', pointerDown); root.addEventListener('pointermove', pointerMove); root.addEventListener('pointerup', pointerUp); root.addEventListener('pointercancel', pointerUp); root.addEventListener('wheel', wheel, { passive: false }); root.addEventListener('dblclick', dblclick); root.addEventListener('mouseover', hover); root.addEventListener('mouseout', hover);
    const Observer = doc.defaultView.ResizeObserver, observer = Observer ? new Observer(() => paint()) : null; observer?.observe(root);
    render(); void load();
    return () => { disposed = true; generation++; observer?.disconnect(); tileQueue = []; tileCache.clear(); tilePending.clear(); state.points.clear(); root.removeEventListener('click', click); root.removeEventListener('input', search); root.removeEventListener('compositionend', search); root.removeEventListener('submit', submit); root.removeEventListener('keydown', keydown); root.removeEventListener('pointerdown', pointerDown); root.removeEventListener('pointermove', pointerMove); root.removeEventListener('pointerup', pointerUp); root.removeEventListener('pointercancel', pointerUp); root.removeEventListener('wheel', wheel); root.removeEventListener('dblclick', dblclick); root.removeEventListener('mouseover', hover); root.removeEventListener('mouseout', hover); root.replaceChildren(); };
  }
  return Object.freeze({ mount, shell });
});
