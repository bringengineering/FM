# BRING CRM Desktop

이 디렉터리는 BRING CRM 데스크톱 소스와 이후 변경사항을 관리한다. `v1.7.0`부터 기존 로그인과 공유 저장소 안에서 건물 중심 영업 관리, 13단계 퍼널, 영업 표준, 완료 증거 기반 지표를 함께 제공한다.

## 검증과 Windows 패키지

```powershell
npm.cmd install
npm.cmd test
npm.cmd run smoke
npm.cmd run build:win
```

Firebase, CRM 데이터와 사용자 캐시는 빌드 산출물에 포함하지 않는다. `kr.co.bringengineering.crm` 앱 ID와 `bring-crm-desktop` 패키지 이름은 기존 설치본의 업데이트 호환성을 위해 변경하지 않는다.
