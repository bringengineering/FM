# Firebase Hosting 상시 운영 설계

## 목표

브링케어 공개 페이지를 로컬 개발 서버나 담당자 PC의 실행 상태와 무관하게 항상 제공하고, 저장소의 운영 브랜치 변경 시 Firebase Hosting에 자동 반영한다.

## 확인된 원인

- Firebase Hosting 자체는 정상 동작했지만 최신 배포에 `/building-care`, `/stair-cleaning`, `/move-in-cleaning` 정적 페이지가 포함되지 않아 404가 발생했다.
- 로컬 `company-site/firebase-public`에는 세 경로의 `index.html`이 모두 존재했다.
- 저장소에는 회사 사이트를 Firebase Hosting에 자동 배포하는 GitHub Actions가 없었다.

## 설계

1. 현재 검증된 `company-site/firebase-public`을 Firebase Hosting `bring-fm` 사이트에 즉시 배포한다.
2. GitHub Actions가 운영 브랜치 변경을 감지하면 Node.js와 pnpm을 설정하고, 회사 사이트를 빌드한 뒤 `export:firebase`로 정적 산출물을 새로 만든다.
3. 빌드된 주요 네 경로의 HTML 존재 여부를 검사한 다음 Firebase Hosting에 배포한다.
4. 배포 인증 정보는 GitHub Actions secret으로만 저장하며 저장소 파일에는 포함하지 않는다.
5. 배포 동시 실행은 하나로 제한하고 진행 중인 이전 배포는 최신 변경으로 대체한다.

## 검증

- 워크플로 정적 테스트로 운영 브랜치 트리거, 빌드·내보내기·경로 검사·Hosting 배포 명령을 확인한다.
- 실제 배포 후 공개 URL 네 개가 모두 HTTP 200을 반환하는지 확인한다.

