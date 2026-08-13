# BRING CRM Desktop

이 디렉터리는 GitHub Release `crm-v1.4.9`의 설치된 `app.asar`에서 복구한 BRING CRM 데스크톱 소스와 이후 변경사항을 관리한다.

## 검증과 Windows 패키지

```powershell
npm.cmd install
npm.cmd test
npm.cmd run smoke
npm.cmd run build:win
```

Firebase, CRM 데이터와 사용자 캐시는 빌드 산출물에 포함하지 않는다. `kr.co.bringengineering.crm` 앱 ID와 `bring-crm-desktop` 패키지 이름은 기존 설치본의 업데이트 호환성을 위해 변경하지 않는다.
