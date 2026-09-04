# index.html 브라우저 테스트

업무 흐름 빌더(`index.html`)의 자동 테스트입니다.
이 앱은 6,000줄이 넘는 단일 파일인데 그동안 자동 테스트가 하나도 없어서,
작은 수정도 손으로 눌러보는 것 말고는 확인할 방법이 없었습니다.

## 안전장치

테스트는 **실제 Firebase 에 절대 붙지 않습니다.** 두 겹으로 막습니다.

1. `databaseURL` 을 가짜 값으로 바꾼 사본을 임시 폴더에 만들어 띄웁니다 → 앱이 **로컬 모드**로 동작
2. `file://` 이외의 모든 요청을 차단합니다 (gstatic 의 Firebase SDK 포함)

첫 번째 테스트가 `isConfigured === false` 를 단언하므로, 혹시라도 실 DB 로
붙는 상태면 테스트가 바로 실패합니다.

## 실행

```bash
cd test/browser
npm install
npm test
```

브라우저는 `playwright` 설치 시 자동으로 내려받습니다.
이미 Chromium 이 있는 환경이라면 `PLAYWRIGHT_BROWSERS_PATH` 를 보고 그걸 씁니다.

## 무엇을 지키는가

- 로컬 모드로 부팅되고 시드 보드가 그려진다 (자바스크립트 오류 0)
- `APP_VERSION` 과 `CHANGELOG` 최신 버전이 일치한다 (저장소 규칙)
- 노드를 추가하면 화면과 로컬 저장소에 반영된다
- **저장 실패가 조용히 넘어가지 않고 화면에 표시된다** (닫기 동작 포함)
- 불러오기 실패는 저장 실패와 다른 안내를 보여준다
- 성공한 저장에는 알림이 뜨지 않는다
- 손가락 입력에서 조작 핸들의 히트 영역이 넓어지고, 마우스 환경에서는 꺼져 있다

## 테스트를 추가할 때

`harness.mjs` 의 `openApp()` 을 쓰세요. `openApp({ mobile: true })` 는
Chromium 모바일 에뮬레이션(`pointer: coarse`)으로 띄웁니다.
`app.pageErrors` 에는 차단된 외부 리소스를 제외한 진짜 오류만 쌓이므로,
새 테스트에서도 `assert.deepEqual(app.pageErrors, [])` 로 확인하면 좋습니다.
