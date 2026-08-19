# 《하지 말라고 했습니다》 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고민과 두 선택지를 입력하고 전통 3동전 방식으로 주역 괘를 만든 뒤 자기성찰형 결과를 보여주는 모바일 테스트 웹앱을 만든다.

**Architecture:** 빌드 도구가 필요 없는 정적 웹앱으로 만든다. `iching.js`는 순수 계산, `readings.js`는 64괘 데이터, `app.js`는 입력·동전 애니메이션·결과 렌더링만 담당하며 Node 기본 테스트 러너로 핵심 로직을 검증한다.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript ES modules, Node.js built-in test runner

---

## 파일 구조

- `iching-decision-test/index.html`: 세 화면의 의미 구조와 접근 가능한 폼
- `iching-decision-test/styles.css`: 모바일 우선 시각 디자인과 동전/효 애니메이션
- `iching-decision-test/iching.js`: 동전 합계, 효, 팔괘, 64괘, 변괘 계산
- `iching-decision-test/readings.js`: 64괘 이름·핵심 메시지와 해석 템플릿
- `iching-decision-test/app.js`: 상태 관리, 유효성 검사, 위험 주제 경고, 렌더링, 복사/초기화
- `iching-decision-test/tests/iching.test.js`: 계산 엔진 단위 테스트
- `iching-decision-test/tests/readings.test.js`: 64괘 데이터 완전성과 결과 문장 테스트
- `iching-decision-test/README.md`: 실행법과 테스트 범위
- `iching-decision-test/package.json`: 테스트 명령과 ES module 설정

### Task 1: 계산 엔진

**Files:**
- Create: `iching-decision-test/package.json`
- Create: `iching-decision-test/tests/iching.test.js`
- Create: `iching-decision-test/iching.js`

- [ ] 6·7·8·9가 각각 노음·소양·소음·노양으로 변환되는 실패 테스트를 작성한다.
- [ ] `npm test`를 실행해 모듈 부재로 실패하는지 확인한다.
- [ ] `coinTotalToLine`, `trigramFromLines`, `hexagramFromLines`, `changedLines`를 구현한다.
- [ ] 건/곤 및 변효 사례가 통과하는지 확인한다.
- [ ] 관련 파일만 커밋한다.

### Task 2: 64괘 데이터와 맞춤 문장

**Files:**
- Create: `iching-decision-test/tests/readings.test.js`
- Create: `iching-decision-test/readings.js`

- [ ] 64개 조합이 모두 존재하고 번호·한글명·핵심 문장을 갖는 실패 테스트를 작성한다.
- [ ] 고민과 A/B 선택지가 결과 문장에 포함되고 단정적 예언 문구가 없는 실패 테스트를 작성한다.
- [ ] 64괘 기본 데이터와 `buildReflection` 규칙을 구현한다.
- [ ] 위험 키워드가 의료·법률·투자 우선 안내를 반환하도록 구현한다.
- [ ] 전체 테스트를 실행하고 관련 파일만 커밋한다.

### Task 3: 모바일 사용자 화면

**Files:**
- Create: `iching-decision-test/index.html`
- Create: `iching-decision-test/styles.css`
- Create: `iching-decision-test/app.js`

- [ ] 시작·동전·결과 화면의 필수 요소를 검사하는 정적 테스트를 추가한다.
- [ ] 테스트 실패를 확인한다.
- [ ] 역설적 소개, 고민/A/B 폼, 진행률, 동전 3개, 6효 도식, 결과 섹션을 구현한다.
- [ ] 여섯 번 던지기 전에는 결과가 열리지 않고, 완료 후 본괘·변괘·상세 결과가 렌더링되도록 연결한다.
- [ ] 결과 복사, 다시 하기, 접근 가능한 오류 메시지를 구현한다.
- [ ] 전체 테스트를 실행하고 관련 파일만 커밋한다.

### Task 4: 실행 및 완성도 검증

**Files:**
- Create: `iching-decision-test/README.md`
- Modify: `iching-decision-test/tests/iching.test.js`
- Modify: `iching-decision-test/tests/readings.test.js`

- [ ] 경계 사례와 64개 조합 전체 매핑 테스트를 보강한다.
- [ ] `npm test`로 모든 자동 테스트를 통과시킨다.
- [ ] 로컬 서버에서 앱을 열어 모바일 크기에서 입력→6회 던지기→결과→복사→초기화를 확인한다.
- [ ] 브라우저 콘솔 오류와 화면 넘침이 없는지 확인한다.
- [ ] README에 실행법, 상품 의도, 현재 제한을 기록한다.
- [ ] 최종 변경만 커밋한다.

## 완료 조건

- 별도 설치 없이 로컬 서버로 실행할 수 있다.
- 전통 3동전 방식과 64괘 매핑이 자동 테스트로 검증된다.
- 사용자 입력이 브라우저 밖으로 전송·저장되지 않는다.
- 모바일에서 전체 흐름을 완료할 수 있다.
- 예언 보장 대신 자기성찰 질문을 제공하고 고위험 판단에는 현실 정보 우선 경고를 표시한다.
