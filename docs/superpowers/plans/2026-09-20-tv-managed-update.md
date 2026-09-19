# BRING TV 관리자 승인 업데이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRM 관리자가 특정 회사 TV의 검증된 새 버전을 승인하면 해당 TV만 다운로드·재시작 설치하고 결과를 관리 화면에서 확인할 수 있게 한다.

**Architecture:** 기존 회사 운영보드 Worker의 Durable Object에 기기별 업데이트 명령과 상태를 저장한다. TV는 별도 GitHub 채널에서 해시로 묶인 불변 자산만 확인하고, 서버가 자기 기기에 발급한 목표 버전과 일치할 때 Electron updater를 실행한다. CRM 채널·태그·설치본과 TV 채널을 분리하며, Windows 회사 서명 검증 전에는 운영 채널 게시를 막는다.

**Tech Stack:** Electron, electron-updater, Node.js test runner, Vitest/JSDOM, Cloudflare Workers Durable Objects, GitHub Actions, electron-builder/NSIS

---

## 파일 구조

- Create `desktop-crm/src/tv-update-policy.js`: TV 전용 채널 포인터와 릴리스 자산의 정확한 이름·버전·크기·해시를 검증하고 updater feed를 설정한다.
- Create `desktop-crm/test/tv-update-policy.test.js`: CRM 채널 혼용, 잘못된 해시·리디렉션·버전·자산을 거부하는 정책 테스트.
- Create `desktop-crm/scripts/tv-release/verify-assets.js`: TV 설치본·blockmap·`latest-tv.yml` 및 Authenticode를 검증한다.
- Create `desktop-crm/scripts/tv-release/write-channel-pointer.js`: 검증된 자산 메타데이터만 `tv-update-channel/latest.json`으로 만든다.
- Create `.github/workflows/tv-release.yml`: TV 전용 빌드·검증·불변 릴리스·채널 전진 작업.
- Modify `desktop-crm/electron-builder.tv.cjs`: TV 전용 파일명·매니페스트·publish 설정과 운영 버전 메타데이터.
- Modify `crm-ai-worker/src/wallboard-http.js`: 관리자 업데이트 예약·취소와 TV 상태 보고 입력 경계.
- Modify `crm-ai-worker/src/wallboard-devices.js`: 새 작업을 Durable Object 서비스에 연결.
- Modify `crm-ai-worker/src/wallboard-pairing.js`: 기기별 목표 버전·상태·승인자·소비·완료 상태 기계.
- Modify `crm-ai-worker/test/wallboard-http.test.js`, `crm-ai-worker/test/wallboard-pairing.test.js`: 권한·격리·멱등성·해제·재시작 보존 테스트.
- Modify `desktop-crm/src/wallboard-tv-client.js`: 자기 기기의 업데이트 명령만 검증해 main에 반환하고 상태를 보고한다.
- Modify `desktop-crm/src/wallboard-tv-main.js`: updater 이벤트, 다운로드, 검증, 재시작 설치를 main process에만 둔다.
- Modify `desktop-crm/src/wallboard-tv-preload.js`, `desktop-crm/src/wallboard-tv-renderer.js`, `desktop-crm/src/wallboard-tv.html`: 자격증명 없이 업데이트 상태만 TV 화면에 표시한다.
- Modify `desktop-crm/src/wallboard-admin-client.js`, `desktop-crm/src/wallboard-admin-ui.js`: 기기별 최신 버전·상태·예약 버튼과 확인창.
- Modify `company-site/tests/field/wallboard-admin.test.ts`, `desktop-crm/test/wallboard-tv-client.test.js`, `desktop-crm/test/wallboard-package.test.js`: UI·TV·패키지 회귀 검사.
- Modify `docs/superpowers/reports/2026-09-20-tv-acceptance-status.md`: 실제 배포·설치 증거를 순차 기록한다.

### Task 1: 기기별 업데이트 명령 상태 기계

**Files:**
- Modify: `crm-ai-worker/src/wallboard-pairing.js`
- Modify: `crm-ai-worker/src/wallboard-devices.js`
- Test: `crm-ai-worker/test/wallboard-pairing.test.js`

- [ ] **Step 1: 관리자 예약·기기 소비·완료를 재현하는 실패 테스트 작성**

```js
test('administrator schedules one immutable target and device reports completion', async () => {
  const f = fixture();
  const enrolled = await enroll(f.service, '회의실 TV');
  await f.service.scheduleUpdate(enrolled.deviceId, '0.2.0', admin);
  const command = await f.service.readBoard(enrolled.deviceToken, '0.1.2', { updateStatus: 'idle' });
  assert.deepEqual(command.update, { targetVersion: '0.2.0' });
  await f.service.readBoard(enrolled.deviceToken, '0.2.0', { updateStatus: 'installed' });
  const device = (await f.service.list(admin)).devices[0];
  assert.equal(device.updateStatus, 'installed');
  assert.equal(device.targetVersion, null);
});
```

- [ ] **Step 2: 테스트가 `scheduleUpdate is not a function`으로 실패하는지 확인**

Run: `node --test crm-ai-worker/test/wallboard-pairing.test.js`
Expected: FAIL at the new update lifecycle test.

- [ ] **Step 3: 최소 상태 기계 구현**

```js
const version = value => /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(String(value || '')) ? String(value) : null;

async scheduleUpdate(deviceId, targetVersion, identity) {
  admin(identity);
  if (!version(targetVersion)) invalid();
  return run(state => {
    const device = Object.values(state.devices).find(item => item.id === deviceId && item.revokedAt === null);
    if (!device) notFound();
    device.targetVersion = targetVersion;
    device.updateStatus = 'scheduled';
    device.updateApprovedBy = identity.uid;
    device.updateApprovedAt = now();
    return { status: 'scheduled', targetVersion };
  });
}
```

`readBoard`는 유효한 `clientVersion`과 `updateStatus`만 받으며, 예약 대상과 현재 버전이 다를 때만 `{targetVersion}`을 반환한다. 현재 버전이 목표와 같고 `installed`가 보고되면 목표를 지우고 완료시각을 기록한다. 해제된 기기는 기존처럼 먼저 거부한다.

- [ ] **Step 4: 상태 기계 테스트 통과 확인**

Run: `node --test crm-ai-worker/test/wallboard-pairing.test.js`
Expected: all tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add crm-ai-worker/src/wallboard-pairing.js crm-ai-worker/src/wallboard-devices.js crm-ai-worker/test/wallboard-pairing.test.js
git commit -m "feat: store per-device TV update approvals"
```

### Task 2: Worker 관리자·TV API 경계

**Files:**
- Modify: `crm-ai-worker/src/wallboard-http.js`
- Modify: `crm-ai-worker/test/wallboard-http.test.js`
- Modify: `crm-ai-worker/test/runtime/verify-wallboard.cjs`

- [ ] **Step 1: 관리자 전용 예약과 TV 상태 보고 실패 테스트 작성**

```js
test('only verified administrators schedule an exact TV version', async () => {
  assert.equal((await staff.fetch(req('schedule-update', { deviceId, targetVersion: '0.2.0' }), env)).status, 403);
  assert.equal((await admin.fetch(req('schedule-update', { deviceId, targetVersion: '0.2.0' }), env)).status, 200);
  assert.equal((await admin.fetch(req('schedule-update', { deviceId, targetVersion: 'latest' }), env)).status, 400);
});
```

- [ ] **Step 2: 새 작업이 404 또는 400으로 실패하는지 확인**

Run: `node --test crm-ai-worker/test/wallboard-http.test.js`
Expected: FAIL because `schedule-update` is not accepted.

- [ ] **Step 3: 입력 화이트리스트와 전달 구현**

```js
const actions = {
  ...existingActions,
  'schedule-update': ['deviceId', 'targetVersion'],
  'cancel-update': ['deviceId'],
  display: ['clientVersion', 'updateStatus', 'updateError'],
};
```

`schedule-update`와 `cancel-update`는 기존 Firebase 관리자 검증을 사용한다. `updateStatus`는 `idle|downloading|ready|installing|installed|failed`만, `updateError`는 정해진 오류 코드와 80자 이하 문자열만 받는다. 내부 Durable Object 요청 외부에는 승인자 UID를 반환하지 않는다.

- [ ] **Step 4: 실제 로컬 SQLite 재시작 후 명령과 상태 보존 확인**

Run: `node crm-ai-worker/test/runtime/verify-wallboard.cjs`
Expected: PASS and the restarted runtime returns the scheduled target to only the enrolled device.

- [ ] **Step 5: Worker 전체 테스트**

Run: `node --test crm-ai-worker/test/*.test.js`
Expected: all tests PASS.

- [ ] **Step 6: 커밋**

```bash
git add crm-ai-worker/src/wallboard-http.js crm-ai-worker/test/wallboard-http.test.js crm-ai-worker/test/runtime/verify-wallboard.cjs
git commit -m "feat: expose protected TV update commands"
```

### Task 3: TV 전용 업데이트 채널 정책

**Files:**
- Create: `desktop-crm/src/tv-update-policy.js`
- Create: `desktop-crm/test/tv-update-policy.test.js`

- [ ] **Step 1: CRM 채널 혼용과 잘못된 포인터를 거부하는 실패 테스트 작성**

```js
test('accepts only the immutable TV channel namespace', () => {
  const pointer = parseTvChannelPointer(JSON.stringify({
    schemaVersion: 1,
    tag: 'tv-v0.2.0',
    version: '0.2.0',
    publishedAt: '2026-09-20T00:00:00Z',
    installer: { name: 'BRING.TV.Setup.0.2.0.exe', size: 100, sha512: 'a'.repeat(128) },
    manifest: { name: 'latest-tv.yml', size: 50, sha256: 'b'.repeat(64) },
  }));
  assert.equal(pointer.tag, 'tv-v0.2.0');
  assert.throws(() => parseTvChannelPointer(JSON.stringify({ ...pointer, tag: 'crm-v0.2.0' })));
});
```

- [ ] **Step 2: 모듈 부재로 실패하는지 확인**

Run: `node --test desktop-crm/test/tv-update-policy.test.js`
Expected: FAIL with module not found.

- [ ] **Step 3: 고정 채널·정확한 자산 검증 구현**

```js
const TV_CHANNEL_POINTER_URL = 'https://raw.githubusercontent.com/bringengineering/FM/tv-update-channel/latest.json';
const TV_TAG = /^tv-v(\d+)\.(\d+)\.(\d+)$/;
const expectedTvAssets = version => ({
  installer: `BRING.TV.Setup.${version}.exe`,
  blockmap: `BRING.TV.Setup.${version}.exe.blockmap`,
  manifest: 'latest-tv.yml',
});
```

CRM 정책과 동일한 제한된 응답 읽기, 정확한 키 집합, HTTPS 고정 호스트, 리디렉션 금지, 크기·SHA-256·SHA-512 검증을 적용한다. updater에는 검증된 `tv-v` 릴리스 URL만 전달한다.

- [ ] **Step 4: 정상·변조·오프라인 정책 테스트 통과 확인**

Run: `node --test desktop-crm/test/tv-update-policy.test.js`
Expected: all tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add desktop-crm/src/tv-update-policy.js desktop-crm/test/tv-update-policy.test.js
git commit -m "feat: add isolated verified TV update policy"
```

### Task 4: TV main process 다운로드·승인 설치

**Files:**
- Modify: `desktop-crm/src/wallboard-tv-main.js`
- Modify: `desktop-crm/src/wallboard-tv-client.js`
- Modify: `desktop-crm/src/wallboard-tv-preload.js`
- Modify: `desktop-crm/test/wallboard-tv-client.test.js`

- [ ] **Step 1: 예약 버전과 채널 버전이 같은 경우만 다운로드하는 실패 테스트 작성**

```js
test('returns one exact approved update without exposing the device token', async () => {
  const result = await client.display();
  assert.deepEqual(result.update, { targetVersion: '0.2.0' });
  assert.equal(JSON.stringify(result).includes(deviceToken), false);
});
```

- [ ] **Step 2: 현재 응답에 update가 없어 실패하는지 확인**

Run: `node --test desktop-crm/test/wallboard-tv-client.test.js`
Expected: FAIL at the new update assertion.

- [ ] **Step 3: TV client의 명령·상태 보고 구현**

```js
display: updateState => serial(async () => {
  const token = await vault.read();
  const result = await request('display', token, {
    clientVersion,
    updateStatus: updateState.status,
    ...(updateState.error ? { updateError: updateState.error } : {}),
  });
  return { paired: true, board: validatedBoard(result.board), update: validatedUpdate(result.update) };
})
```

- [ ] **Step 4: main process updater 상태 기계 구현**

```js
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;

async function acceptUpdate(targetVersion) {
  const channel = await resolveTvChannel({ updater: autoUpdater });
  if (channel.version !== targetVersion) throw updateError('TARGET_MISMATCH');
  updateState = { status: 'downloading', error: '' };
  await autoUpdater.downloadUpdate();
}

autoUpdater.on('update-downloaded', info => {
  if (info.version !== approvedTarget) return failUpdate('TARGET_MISMATCH');
  updateState = { status: 'ready', error: '' };
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 3000);
});
```

updater 객체와 채널 정책은 main process에만 둔다. renderer와 preload에는 토큰·다운로드 URL·파일 경로를 노출하지 않는다. 동시에 한 버전만 처리하고 실패 시 현재 화면을 유지한다.

- [ ] **Step 5: TV client와 main 헬퍼 테스트**

Run: `node --test desktop-crm/test/wallboard-tv-client.test.js desktop-crm/test/tv-update-policy.test.js`
Expected: all tests PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/src/wallboard-tv-main.js desktop-crm/src/wallboard-tv-client.js desktop-crm/src/wallboard-tv-preload.js desktop-crm/test/wallboard-tv-client.test.js
git commit -m "feat: install only administrator-approved TV updates"
```

### Task 5: 관리자 기기별 버전·예약 UI

**Files:**
- Modify: `desktop-crm/src/wallboard-admin-client.js`
- Modify: `desktop-crm/src/wallboard-admin-ui.js`
- Modify: `company-site/tests/field/wallboard-admin.test.ts`

- [ ] **Step 1: 버전 상태와 확인창을 요구하는 실패 테스트 작성**

```ts
test('administrator confirms one device and exact target before scheduling', async () => {
  expect(row.textContent).toContain('현재 0.1.2');
  expect(row.textContent).toContain('최신 0.2.0');
  row.querySelector('[data-device-update]').click();
  expect(confirmMessage).toContain('회의실 TV');
  expect(confirmMessage).toContain('0.1.2 → 0.2.0');
  expect(requests).toContainEqual({ action: 'schedule-update', deviceId, targetVersion: '0.2.0' });
});
```

- [ ] **Step 2: 예약 버튼 부재로 실패하는지 확인**

Run: `pnpm --dir company-site vitest run tests/field/wallboard-admin.test.ts`
Expected: FAIL because update controls are absent.

- [ ] **Step 3: 관리자 client action 화이트리스트 확장**

```js
if (!['list', 'approve', 'revoke', 'publish', 'schedule-update', 'cancel-update'].includes(action)) fail('INVALID_INPUT');
```

기기 ID와 정확한 semver를 main process에서 다시 검증한다. 목록 응답은 `latestVersion`, `targetVersion`, `updateStatus`, `updateAt`, `updateError`만 정제해 renderer로 전달한다.

- [ ] **Step 4: 기존 FM 카드·파란 버튼 스타일의 기기 행 구현**

각 행은 현재/최신 버전과 상태를 텍스트로 표시한다. `업데이트 예약`은 최신 버전이 더 높고 기기가 승인 상태일 때만 활성화한다. 확인창 승인 후 요청하며, 예약 상태에서는 `예약 취소`를 제공한다. 성공 메시지는 서버 예약 성공으로만 표현하고 실제 설치 성공으로 표현하지 않는다.

- [ ] **Step 5: 관리자 UI 테스트 통과 확인**

Run: `pnpm --dir company-site vitest run tests/field/wallboard-admin.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/src/wallboard-admin-client.js desktop-crm/src/wallboard-admin-ui.js company-site/tests/field/wallboard-admin.test.ts
git commit -m "feat: manage TV updates per device from CRM"
```

### Task 6: TV 전용 패키지와 서명 게이트

**Files:**
- Modify: `desktop-crm/electron-builder.tv.cjs`
- Modify: `desktop-crm/package.json`
- Create: `desktop-crm/scripts/tv-release/verify-assets.js`
- Create: `desktop-crm/scripts/tv-release/write-channel-pointer.js`
- Modify: `desktop-crm/test/wallboard-package.test.js`

- [ ] **Step 1: 독립 파일명·피드·서명 요구 실패 테스트 작성**

```js
test('TV package uses only its dedicated update namespace', () => {
  assert.equal(config.artifactName, 'BRING.TV.Setup.${version}.${ext}');
  assert.equal(config.publish[0].channel, 'latest-tv');
  assert.notEqual(config.publish[0].channel, 'latest');
});
```

- [ ] **Step 2: 기존 Preview 설정으로 실패하는지 확인**

Run: `node --test desktop-crm/test/wallboard-package.test.js`
Expected: FAIL because artifactName and publish are still preview/null.

- [ ] **Step 3: TV 운영 패키지 설정과 검증 스크립트 구현**

```js
artifactName: 'BRING.TV.Setup.${version}.${ext}',
publish: [{ provider: 'github', owner: 'bringengineering', repo: 'FM', channel: 'latest-tv' }],
```

`verify-assets.js`는 정확히 세 자산만 허용하고 매니페스트의 버전·파일명·크기·SHA-512를 설치본과 대조한다. PowerShell `Get-AuthenticodeSignature` 결과가 `Valid`가 아니거나 회사가 확정한 게시자·지문과 다르면 실패한다. `write-channel-pointer.js`는 성공한 검증 결과만 정확한 키 구조로 출력한다.

- [ ] **Step 4: 서명 없는 로컬 빌드가 운영 검증에서 차단되는지 확인**

Run: `npm --prefix desktop-crm run build:tv -- --publish never` then `node desktop-crm/scripts/tv-release/verify-assets.js --version <built-version> --dist desktop-crm/dist-tv`
Expected: build succeeds for preview; release verification fails with `TV_SIGNATURE_INVALID` until the company certificate is configured.

- [ ] **Step 5: 패키지 회귀 테스트 통과 확인**

Run: `node --test desktop-crm/test/wallboard-package.test.js desktop-crm/test/tv-update-policy.test.js`
Expected: all code-level tests PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/electron-builder.tv.cjs desktop-crm/package.json desktop-crm/scripts/tv-release desktop-crm/test/wallboard-package.test.js
git commit -m "build: isolate and verify BRING TV releases"
```

### Task 7: TV 전용 GitHub 릴리스 작업

**Files:**
- Create: `.github/workflows/tv-release.yml`
- Test: local YAML and release-script tests in `desktop-crm/test/`

- [ ] **Step 1: 워크플로 구조 검사 실패 테스트 작성**

```js
test('TV release cannot move the CRM channel or publish unsigned assets', () => {
  const yaml = fs.readFileSync('.github/workflows/tv-release.yml', 'utf8');
  assert.match(yaml, /tv-v\$\{\{/);
  assert.match(yaml, /tv-update-channel/);
  assert.doesNotMatch(yaml, /crm-update-channel|crm-v/);
  assert.match(yaml, /verify-assets\.js/);
});
```

- [ ] **Step 2: 워크플로 부재로 실패하는지 확인**

Run: `node --test desktop-crm/test/tv-release-workflow.test.js`
Expected: FAIL with file not found.

- [ ] **Step 3: 수동 승인형 릴리스 작업 작성**

워크플로는 `workflow_dispatch`만 허용하고, TV 버전과 확정된 소스 SHA를 입력받는다. Windows runner에서 의존성 설치→전체 테스트→TV 빌드→서명→자산·서명 검증→불변 `tv-v` 태그와 릴리스 생성→공개 자산 probe→`tv-update-channel` 포인터 전진→채널 probe 순으로 실행한다. 기존 태그가 있으면 같은 SHA·같은 자산 해시인 경우에만 재개하고, 그 외에는 실패한다.

- [ ] **Step 4: 권한과 비밀정보 경계 확인**

워크플로 environment는 `bring-tv-production`을 사용하고 운영 브랜치만 허용한다. 인증서와 비밀번호는 environment secrets에서만 주입하며 출력하지 않는다. `contents: write` 외 권한은 `none`으로 둔다. Firebase 배포 명령을 포함하지 않는다.

- [ ] **Step 5: 워크플로·스크립트 테스트 통과 확인**

Run: `node --test desktop-crm/test/tv-release-workflow.test.js desktop-crm/test/tv-update-policy.test.js desktop-crm/test/wallboard-package.test.js`
Expected: all tests PASS.

- [ ] **Step 6: 커밋**

```bash
git add .github/workflows/tv-release.yml desktop-crm/test/tv-release-workflow.test.js
git commit -m "ci: add protected BRING TV release channel"
```

### Task 8: 회귀검사·배포·실제 TV 인수

**Files:**
- Modify: `docs/superpowers/reports/2026-09-20-tv-acceptance-status.md`

- [ ] **Step 1: 전체 자동 검사 실행**

Run: `npm --prefix desktop-crm test`
Expected: zero failures; the existing two intentional skips remain identified.

Run: `pnpm --dir company-site test:field:run && pnpm --dir company-site typecheck:field && pnpm --dir company-site build`
Expected: all commands exit 0.

Run: `node --test crm-ai-worker/test/*.test.js && node crm-ai-worker/test/runtime/verify-wallboard.cjs`
Expected: all tests and actual local SQLite runtime verification PASS.

- [ ] **Step 2: 회사 Worker 선행 배포와 무권한 probe**

배포 전 현재 회사 account ID와 Worker 이름을 재확인하고, TV 관련 Worker 변경만 배포한다. health 200, 익명 관리자 예약 401/403, 미승인 기기 상태 보고 401, 잘못된 버전·상태 400을 확인한다. Firebase Functions/Hosting은 배포하지 않는다.

- [ ] **Step 3: CRM 검토 요청과 운영 반영**

최신 운영 브랜치를 병합해 충돌·동료 변경을 보존하고 전체 검사를 다시 실행한다. 검토 요청 #118의 diff와 CI를 확인한 뒤 보호 규칙에 따라 fast-forward 또는 검토 병합한다. force push, 기존 태그 이동, 기존 릴리스 자산 교체를 하지 않는다.

- [ ] **Step 4: 서명된 TV 릴리스 발행**

회사 서명 environment가 준비된 뒤 `tv-release.yml`을 첫 미사용 TV 버전으로 수동 실행한다. 정확한 설치본·blockmap·`latest-tv.yml`과 `tv-update-channel/latest.json`의 공개 probe가 모두 성공해야 채널을 활성 상태로 기록한다.

- [ ] **Step 5: 실제 Windows TV 1대 인수 검사**

사용자가 TV 컴퓨터에서 최초 서명 설치본을 실행하거나 이미 승인된 원격 접속을 제공한다. 기기 승인→5개 장면→공지 변경→업데이트 예약→다운로드→재시작→새 버전 보고→오프라인 표시→기기 해제를 순서대로 확인한다. 1280×720과 1920×1080에서 잘림 여부를 사진 또는 캡처로 남긴다.

- [ ] **Step 6: 인수 보고서 갱신과 최종 커밋**

보고서에 실제 CRM/TV 버전, 설치본 SHA-256, Authenticode 게시자·상태, Worker 버전, 기기명, 승인·수신·재시작·해제 시각과 결과를 기록한다. 토큰·출입정보·고객정보는 기록하지 않는다.

```bash
git add docs/superpowers/reports/2026-09-20-tv-acceptance-status.md
git commit -m "docs: record BRING TV production acceptance"
```
