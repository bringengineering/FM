# Naver Low-Cost Ad Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 파워링크 캠페인 3개에 원주 저비용 광고그룹·키워드·소재·랜딩을 구성하고 10,000원 잔액 이상을 쓰지 않도록 검증한다.

**Architecture:** 네이버 광고 UI에서 광고그룹을 OFF로 작성하고 키워드·소재·지역·URL을 검수한 뒤 최종 단계에서만 ON으로 전환한다. 자동충전은 사용하지 않으며 CRM 동기화가 검증되기 전에는 실제 집행하지 않는다.

**Tech Stack:** Naver Search Ads Manager, BRING CARE Firebase Hosting landings, UTM attribution

---

### Task 1: 계정 안전장치 확인

- [ ] 로그인 계정이 `dpvld858`, 광고계정이 `2575255`인지 확인한다.
- [ ] 비즈머니 10,000원과 자동충전 OFF를 확인한다.
- [ ] 세 캠페인 외 다른 캠페인은 변경하지 않는다.

### Task 2: 광고그룹·키워드 작성

- [ ] 입주청소 그룹 `원주 | 입주·이사청소 | 저비용`, 기본 입찰가 1,500원, 원주시 타기팅, 키워드 `원주입주청소업체`, `원주원룸청소`, `원주아파트입주청소`, `원주이사청소`를 OFF 상태로 만든다.
- [ ] 계단청소 그룹 `원주 | 계단·공용부청소 | 저비용`, 기본 입찰가 1,000원, 원주시 타기팅, 키워드 `원주계단청소`, `원주건물청소`, `원주빌라청소`, `원주공용부청소`를 OFF 상태로 만든다.
- [ ] 건물관리 그룹 `원주 | 건물관리 | 저비용`, 기본 입찰가 800원, 원주시 타기팅, 키워드 `원주건물관리`, `원주원룸관리`, `원주시설관리`, `원주상가관리`를 OFF 상태로 만든다.

### Task 3: 소재와 추적 URL 작성

- [ ] 각 그룹에 서비스명·원주 직영팀·무료상담을 명확히 표현한 반응형 소재를 작성한다.
- [ ] 각 랜딩 URL에 `utm_source=naver`, `utm_medium=cpc`, 서비스별 `utm_campaign`을 붙인다.
- [ ] 랜딩 URL을 열어 상담폼과 전화·카카오톡 링크를 확인한다.

### Task 4: 최종 검수와 집행

- [ ] 네이버 검토 상태, 원주시 타기팅, 입찰가, 자동충전, 랜딩 URL을 다시 확인한다.
- [ ] CRM 지표 동기화가 검증되기 전까지 광고그룹을 OFF로 유지한다.
- [ ] CRM 검증 완료 후 사용자 승인 범위인 10,000원 잔액 한도에서 광고그룹을 ON으로 전환한다.
- [ ] 집행 후 24시간 동안 노출·클릭·비용·문의와 검색어를 확인하고 관련 없는 검색어는 제외 후보로 기록한다.

