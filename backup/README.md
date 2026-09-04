# Realtime Database 야간 백업

매일 새벽 3시 10분(한국시간)에 Realtime Database를 통째로 내보내
**GPG로 암호화한 뒤** GitHub Actions 아티팩트로 30일간 보관합니다.

* 워크플로: `.github/workflows/crm-backup.yml`
* 내보내기 스크립트: `backup/export-rtdb.js` (테스트: `backup/export-rtdb.test.js`)
* 기본 백업 경로: `workflow`, `cases`, `caseSettings`, `crmCompany`

평문 백업은 러너 밖으로 절대 나가지 않습니다. 압축 → 암호화 → 평문 삭제 순서로 처리하고,
암호가 설정돼 있지 않으면 백업 자체가 **실패**합니다(조용히 넘어가지 않음).

---

## 최초 1회 설정

설정이 끝나기 전까지 백업 잡은 무엇이 빠졌는지 알려주며 실패합니다.

### 1. 읽기 전용 서비스 계정 만들기

```bash
PROJECT_ID=bring-fm

# 1) 백업 전용 역할 생성
gcloud iam roles create bringCrmDatabaseBackupReader \
  --project "$PROJECT_ID" \
  --file release/wif-roles/bringCrmDatabaseBackupReader.yaml

# 2) 서비스 계정 생성
gcloud iam service-accounts create bring-crm-backup \
  --project "$PROJECT_ID" \
  --display-name "BRING CRM Backup Reader"

# 3) 역할 부여
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:bring-crm-backup@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role "projects/${PROJECT_ID}/roles/bringCrmDatabaseBackupReader"
```

> Realtime Database 읽기는 보안 규칙을 우회하는 관리자 접근으로 동작합니다.
> 이 서비스 계정에는 **쓰기 권한을 절대 부여하지 마세요.**

### 2. 기존 Workload Identity 풀에 연결

릴리스에서 쓰는 것과 같은 provider를 재사용합니다.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "bring-crm-backup@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/<WIF_POOL>/attribute.repository/bringengineering/FM"
```

### 3. GitHub 설정값 등록

`Settings → Secrets and variables → Actions`

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER_BRING_FM` | (릴리스에서 쓰던 값 그대로) |
| Variable | `GCP_BACKUP_SERVICE_ACCOUNT_BRING_FM` | `bring-crm-backup@bring-fm.iam.gserviceaccount.com` |
| Variable | `RTDB_URL` | `https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app` |
| Variable | `BACKUP_PATHS` *(선택)* | 기본값과 다르게 할 때만. 예: `workflow,cases` |
| Secret | `CRM_BACKUP_PASSPHRASE` | 충분히 긴 임의 문자열 (**따로 안전하게 보관**) |

> `CRM_BACKUP_PASSPHRASE`를 잃어버리면 백업을 열 수 없습니다.
> 비밀번호 관리자에 반드시 별도 보관하세요.

---

## 복구 방법

1. Actions → **CRM Nightly Backup** → 원하는 날짜의 실행 → 아티팩트 다운로드
2. 무결성 확인과 복호화:

```bash
sha256sum -c backup-<날짜>.sha256
gpg --batch --yes --decrypt --output backup.tar.gz backup-<날짜>.tar.gz.gpg
tar -xzf backup.tar.gz
cat manifest.json          # 경로별 크기·SHA-256 확인
```

3. 되돌릴 경로만 골라 Firebase 콘솔에서 가져오기(Import JSON) 하거나,
   확인 후 해당 경로에 다시 씁니다.

> ⚠️ 복구는 **덮어쓰기**입니다. 되돌리기 전에 현재 데이터를 먼저 한 번 더 내보내 두세요.

---

## 수동 실행

Actions → **CRM Nightly Backup** → *Run workflow*.
큰 변경 작업(대량 정리, 마이그레이션) 직전에 한 번 돌려두면 안전합니다.

## 점검 습관

한 달에 한 번은 아티팩트를 실제로 내려받아 복호화까지 해 보세요.
**열어보지 않은 백업은 백업이 아닙니다.**
