# BRING CRM 자동 배포·업데이트 운영

BRING CRM 운영 배포의 단일 기준은 `bringengineering/FM` 저장소의 보호 브랜치 `codex/bring-field-platform`입니다. 이 자동 릴리스는 Firebase Spark 요금제에서 동작하도록 Realtime Database Rules와 Windows 설치 파일만 다룹니다. Cloud Functions와 Hosting은 자동 배포하지 않습니다.

## 고정된 운영 경계

- 운영 Firebase/GCP 프로젝트: `bring-fm`
- 사용 금지 레거시 프로젝트: `bring-fm-hj`
- 운영 소스 ref: `refs/heads/codex/bring-field-platform`
- GitHub Environment: `bring-crm-production`
- 실제 워크플로: `.github/workflows/crm-release.yml`
- 자동 Firebase 대상: `release/firebase-targets.json`의 `crmAutomaticRelease.projectId`와 `crmAutomaticRelease.databaseRules`
- 허용 Firebase 명령: `--project bring-fm deploy --only database`

manifest 어디에도 `functionSelectors`가 없어야 합니다. `primary.functionsDeploymentAllowed`는 `false`로 고정되고, `primary.archivedFunctionNames`는 과거 `bring-fm` 함수 이름을 실행 불가능한 기록으로만 보존합니다. `retiredLegacy`도 과거 `bring-fm-hj` 함수 이름을 보존하는 비배포 기록이며 `deploymentAllowed`가 `false`입니다. 따라서 CRM의 자동·수동 운영 모두 Cloud Functions를 배포하지 않습니다. `functions/src`에 남아 있는 구현은 이력 확인용일 뿐 배포 대상이 아닙니다. 자동 릴리스는 `bring-fm-hj`, Hosting, Functions 또는 범위 없는 `firebase deploy`를 절대 실행하지 않습니다.

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

1. 트리거된 소스 SHA와 최신 원격 브랜치가 같은지 확인합니다.
2. 기존 stable 릴리스가 이미 현재 소스를 게시했다면 no-op으로 종료합니다.
3. 다음 patch 버전을 계산하고 non-force 예약 ref로 원자적으로 선점합니다. 다른 PC가 먼저 예약했다면 원격 상태를 다시 읽고 다음 patch로 재시도합니다.
4. 데스크톱 테스트·패키징과 Realtime Database/Storage Emulator 기반 Rules 테스트를 통과합니다.
5. 설치 EXE, EXE blockmap, `latest.yml`의 정확히 세 자산만 draft에 올리고 파일명·크기·URL·해시를 검증합니다.
6. 실제 게시 내용이 있는 모든 릴리스에서 검증된 Rules를 Rules 전용 계정으로 `--project bring-fm --only database` 배포합니다. 이 단계는 매번 멱등적으로 실행되어 이전 중단으로 생긴 운영 Rules drift도 수렴시킵니다.
7. Rules 성공 후에만 draft를 stable로 게시하고 공개 updater 채널이 동일한 세 자산을 제공하는지 확인합니다.

완성된 draft가 정확히 세 자산을 갖고 canonical URL·크기·`latest.yml`·EXE SHA512 검증을 모두 통과하면 재실행은 원격 바이트를 그대로 복구해 사용하며 같은 버전을 다시 빌드하지 않습니다. 자산이 일부뿐이거나 손상되었거나 404이면 해당 버전은 영구적으로 burn합니다. 그 draft나 버전을 삭제·재사용하지 않고 다음 patch를 원자적으로 예약합니다.

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
