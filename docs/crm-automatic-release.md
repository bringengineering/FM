# BRING CRM 자동 배포·업데이트 운영

BRING CRM 운영 배포의 단일 기준은 `bringengineering/FM` 저장소의 보호 브랜치 `codex/bring-field-platform`입니다. CRM 정식 릴리스는 CRM AI Worker와 Windows 설치 파일을 다룹니다. Firebase Rules는 별도 Rules 워크플로에서 관리하며, Cloud Functions와 Hosting은 CRM 정식 릴리스에서 자동 배포하지 않습니다.

## 고정된 운영 경계

- 운영 Firebase/GCP 프로젝트: `bring-fm`
- 사용 금지 레거시 프로젝트: `bring-fm-hj`
- 운영 소스 ref: `refs/heads/codex/bring-field-platform`
- GitHub Environment: `bring-crm-production`
- 실제 워크플로: `.github/workflows/crm-release.yml`
- 실행 방식: 수동 `workflow_dispatch`만 허용. 브랜치 푸시만으로 정식 게시하지 않음.
- 자동 Firebase 대상: `release/firebase-targets.json`의 `crmAutomaticRelease.projectId`와 `crmAutomaticRelease.databaseRules`
- 허용 Firebase 명령: `--project bring-fm deploy --only database`

manifest 어디에도 `functionSelectors`가 없어야 합니다. `primary.functionsDeploymentAllowed`는 일반 Functions 전체 배포를 막기 위해 `false`로 고정합니다. `retiredLegacy`는 과거 `bring-fm-hj` 함수 이름을 보존하는 비배포 기록이며 `deploymentAllowed`가 `false`입니다. Cleaning Center 서버 API 세 개(`cleaningOrdersApi`, `cleaningPartnerApi`, `cleaningRefundsApi`)만 `release/cleaning-center-deployment.js`의 별도 수동 경로에서 명시적으로 배포할 수 있으며, 이 경로는 RTDB 규칙을 배포하지 않습니다. 자동 릴리스는 `bring-fm-hj`, Hosting, Functions 또는 범위 없는 `firebase deploy`를 절대 실행하지 않습니다.

## 최초 1회 WIF 연결

Firebase 토큰이나 서비스 계정 JSON 키를 만들지 않습니다. GitHub Actions의 OIDC 토큰을 Google Cloud의 짧은 수명 자격 증명으로 교환합니다.

1. `bring-fm` Owner인 `dpvld858@gmail.com`으로 Google Cloud CLI에 로그인합니다. 부트스트랩은 다른 관리자 계정을 허용하지 않습니다.

   ```powershell
   gcloud auth login dpvld858@gmail.com
   ```

2. 저장소 루트에서 기본 dry-run을 실행합니다. 이 모드에서는 `gcloud`를 호출하거나 클라우드를 변경하지 않습니다.

   ```powershell
   .\release\bootstrap-bring-fm-wif.ps1
   ```

3. 출력된 프로젝트, 저장소 숫자 ID, 소유자 숫자 ID, ref, Environment, workflow ref를 확인한 뒤 최초 1회만 적용합니다.

   ```powershell
   .\release\bootstrap-bring-fm-wif.ps1 -Apply
   ```

스크립트는 활성 계정이 정확히 `dpvld858@gmail.com`인지 확인하고 모든 명령을 `bring-fm`에 고정합니다. 기존 WIF 설정이나 권한이 예상과 다르면 자동으로 넓히거나 삭제하지 않고 실패합니다. `bring-fm-hj`는 명시적으로 거부됩니다.

## GitHub 설정

`-Apply` 완료 출력의 다음 세 값을 저장소의 **Settings → Secrets and variables → Actions → Variables**에 등록합니다. 모두 Repository variable이며 Secret이 아닙니다.

- `GCP_PROJECT_ID` (`bring-fm`)
- `GCP_WORKLOAD_IDENTITY_PROVIDER_BRING_FM`
- `GCP_RULES_DEPLOY_SERVICE_ACCOUNT_BRING_FM`

**Settings → Environments**에서 `bring-crm-production`을 만들고 다음처럼 제한합니다.

- Deployment branches and tags: Selected branches and tags
- 허용 브랜치: `codex/bring-field-platform`만
- Required reviewers: 없음(완전 자동 배포)
- 모든 Google 인증 job에 `environment: bring-crm-production` 지정

OIDC Provider는 저장소 `bringengineering/FM`, 저장소 숫자 ID `1276587874`, 소유자 숫자 ID `243367126`, 정확한 ref, Environment, 그리고 다음 workflow ref를 동시에 검사합니다.

```text
bringengineering/FM/.github/workflows/crm-release.yml@refs/heads/codex/bring-field-platform
```

복제 저장소, PR, 다른 브랜치, 다른 Environment 또는 다른 workflow 파일은 운영 자격 증명을 받을 수 없습니다.

## Spark 전용 최소 권한

자동 배포 계정은 `bring-crm-rules-deployer@bring-fm.iam.gserviceaccount.com` 하나뿐입니다. 이 계정에는 `release/wif-roles/bringCrmDatabaseRulesDeployer.yaml`의 custom role과 해당 서비스 계정에 대한 WIF 사용자 binding만 부여합니다.

Custom role은 Rules 릴리스 생성·조회·갱신과 대상 Realtime Database 인스턴스 조회·Rules 갱신에 필요한 권한만 포함합니다. Database 데이터 읽기·쓰기, Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Hosting, Storage 권한은 없습니다. `-Apply`는 각 permission이 해당 프로젝트의 운영 custom role에서 지원되는지 Google IAM으로 확인한 후 role을 생성하거나 갱신합니다.

기존 사용자 관리 키, 예상 밖 project role, 예상 밖 WIF provider 또는 예상 밖 `roles/iam.workloadIdentityUser` 주체가 발견되면 실패합니다. 스크립트는 그런 권한을 자동 삭제하지 않습니다.

## 충돌 방지와 배포 순서

워크플로는 `crm-production-release` concurrency 그룹에서 실행하며 진행 중인 배포를 취소하지 않습니다. 버전은 로컬 `package.json`만 보지 않고 원격 stable/draft 릴리스, `crm-v*` 태그와 `crm-release-reservations/v*` 예약 ref를 함께 확인합니다.

버전은 Semantic Versioning의 `major.minor.patch` 규칙으로 계산합니다. 마지막 stable 릴리스 이후의 Conventional Commit 중 가장 큰 변경을 적용합니다.

- `fix`, `perf`, `refactor`, `chore`와 알 수 없는 형식: patch (`1.8.21` → `1.8.22`)
- `feat`: minor (`1.8.21` → `1.9.0`)
- `type!:` 또는 본문의 `BREAKING CHANGE:`: major (`1.8.21` → `2.0.0`)
- 현재 소스 커밋의 `CRM-Release: patch|minor|major` footer는 자동 판정을 명시적으로 고정합니다.

버전 종류는 소스 SHA의 커밋 기록에만 묶이며 실행 시점의 외부 설정으로 바꿀 수 없습니다. 같은 소스 SHA의 예약이 아직 원격 최고 버전이면 그대로 재개하고, 더 높은 버전이 이미 점유됐다면 그 예약은 재사용하지 않으므로 배포 중단이나 재시도가 버전 의미를 바꾸지 않습니다.

1. 다른 실행 중인 CRM 정식 릴리스가 없는지 확인하고, 수동 실행한 소스 SHA가 최신 원격 브랜치와 같은지 확인합니다.
2. 기존 stable 릴리스가 이미 현재 소스를 게시했다면 no-op으로 종료합니다.
3. 변경 종류에 맞는 다음 semantic 버전을 계산하고 non-force 예약 ref로 원자적으로 선점합니다. 다른 PC가 먼저 예약했다면 원격 상태를 다시 읽고 이미 사용된 최고 버전의 patch를 올려 재시도합니다.
4. 버전 예약 후 CRM AI Worker 테스트와 데스크톱 테스트를 실행하고, Windows 설치 EXE·blockmap·`latest.yml`의 이름·크기·해시를 검증합니다.
5. 설치 파일 검증이 끝난 후에만 CRM AI Worker를 운영 배포하고 `/health`에서 서비스명 및 소스 버전이 일치하는지 확인합니다. 배포나 헬스체크가 실패하면 CRM 릴리스 게시를 중단합니다.
6. Worker 확인 성공 후 설치 EXE, EXE blockmap, `latest.yml`의 정확히 세 자산만 draft에 올려 파일명·크기·URL·해시를 검증합니다.
7. 검증된 draft만 stable로 게시하고 공개 updater 채널이 동일한 세 자산을 제공하는지 확인합니다.

## CRM AI Worker 운영 배포 자격 증명

GitHub Actions 저장소 Secret `CLOUDFLARE_API_TOKEN`이 필요합니다. 토큰은 `bring-crm-ai-gateway` Worker가 있는 회사 Cloudflare 계정의 Worker 배포에 필요한 최소 권한만 가져야 하며, Secret 이름 외의 값은 로그나 저장소에 남기지 않습니다. 이 GitHub 배포 토큰은 Worker에 저장되는 `GEMINI_API_KEY`와 별개입니다. Gemini 키 값은 Cloudflare Worker Secret에서만 관리하며, 릴리스 워크플로는 읽거나 출력하지 않습니다.

운영 배포 명령은 기존 Cloudflare 변수 값을 보존하고 `WALLBOARD_SCHEDULED_REFRESH_ENABLED:true`를 명시적으로 유지합니다. 이 옵션은 운영 설정을 로컬 `wrangler.toml`의 기본값 `false`로 덮어쓰지 않기 위해 필요합니다.

완성된 draft가 정확히 세 자산을 갖고 canonical URL·크기·`latest.yml`·EXE SHA512 검증을 모두 통과하면 재실행은 원격 바이트를 그대로 복구해 사용하며 같은 버전을 다시 빌드하지 않습니다. 자산이 일부뿐이거나 손상되었거나 404이면 해당 버전은 영구적으로 burn합니다. 그 draft나 버전을 삭제·재사용하지 않고 현재 최고 버전의 patch를 올려 새 번호를 원자적으로 예약합니다.

운영 브랜치가 실행 중 다른 commit으로 이동하거나 tag/draft/stable의 소스 SHA가 달라지면 게시를 멈춥니다. 이미 예약하거나 burn한 버전을 강제로 이동하거나 재사용하지 않습니다.

## 검증

클라우드를 변경하지 않는 WIF 정적·dry-run 계약 테스트:

```powershell
.\release\test\bootstrap-bring-fm-wif.test.ps1
```

릴리스와 Rules 검증:

```powershell
node --test desktop-crm/test/release-*.test.js
pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-fm emulators:exec --only database,storage "pnpm test:rules"
```

관련 공식 문서:

- [Google Cloud: deployment pipeline용 Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [Google Cloud: Workload Identity Federation 보안 권장사항](https://cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation)
- [Google Cloud: custom role 생성과 갱신](https://cloud.google.com/iam/docs/creating-custom-roles)
- [Firebase: Firebase 제품별 IAM 권한](https://firebase.google.com/docs/projects/iam/roles-predefined-product)
- [GitHub: Actions OIDC claim](https://docs.github.com/actions/reference/security/oidc)
