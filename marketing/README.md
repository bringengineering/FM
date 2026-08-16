# BRING Marketing OS

브링 FM 저장소 안에서 독립 실행되는 YouTube·블로그 통합 마케팅 운영 프로그램입니다. 기존 FM 현장관리 화면과 Firebase 데이터에는 접근하지 않습니다.

## 현재 기능

- 통합 지휘실과 콘텐츠 캘린더
- YouTube TOP20 소재, 제작 대기열, QC, 100만 KPI
- 브링이슈 공개 YouTube 피드 연결
- 블로그 브랜드, 키워드·검색의도, 초안→검수→승인→예약발행 파이프라인
- 비용·알림·오류 재개 상태 관리용 SQLite 저장소
- `/api/health` 서버 상태 확인

## 실행

PowerShell에서 이 폴더로 이동한 뒤:

```powershell
.\run.ps1
```

스크립트 실행 정책으로 차단되면:

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

브라우저: `http://127.0.0.1:8766`

## Windows 실행 파일 만들기

```powershell
python -m pip install pyinstaller pywebview
python -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name "BRING Marketing OS" --add-data "app/web;app/web" windows_app.py
```

생성된 `dist/BRING Marketing OS.exe`는 Python이나 PowerShell 없이 더블클릭으로 실행됩니다.

## 운영 데이터와 비밀정보

- DB는 최초 실행 시 `data/marketing_os.db`에 자동 생성됩니다.
- OAuth 토큰과 API 키는 저장소에 커밋하지 않습니다.
- YouTube 토큰 경로 등은 `.env.example`의 이름을 참고해 사용자 환경변수로 설정합니다.
- 외부 서버 공개 시에는 인증·HTTPS·백업을 먼저 붙이고 `MARKETING_HOST=0.0.0.0`으로 실행합니다.

## 검사

```powershell
python -B -m unittest discover -s tests -v
```
