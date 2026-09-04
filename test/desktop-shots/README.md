# 데스크톱 CRM 화면 확인 도구

`desktop-crm/src/index.html` 을 실제 브라우저(Chromium)로 띄워 각 메뉴 화면을
PNG 로 남깁니다. UI 를 손볼 때 **바꾸기 전과 후를 눈으로 비교**하려고 만든
수동 도구라서 CI 에서는 돌지 않습니다.

Electron 이 없어도 되도록 `window.bringCRM`(preload 가 넣어주는 창구)을
가짜 응답으로 대신 채우고, 로그인은 통과한 상태로 시작합니다. 화면이 비어
보이지 않게 예시 고객·건물·계약·업체 자료도 함께 넣습니다.

## 쓰는 법

```bash
cd test/desktop-shots
npm install            # 처음 한 번 (playwright + 브라우저)
npm run shot           # out/ 에 메뉴별 화면 저장
npm run shot:login     # 로그인 화면만 저장
```

특정 화면만 찍으려면 `VIEWS` 에 메뉴 이름을 쉼표로 이어 넣습니다.

```bash
VIEWS=dashboard,customers,security npm run shot
```

이 저장소가 준비해 둔 브라우저를 쓰는 환경이라면 `npm install` 대신
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install` 로 내려받기를 건너뛸 수 있습니다.

결과 PNG(`out/`)와 `node_modules/` 는 저장소에 넣지 않습니다.
