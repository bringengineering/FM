# BRING Care MinerU quote analyzer

이 폴더는 ⑥ 견적 파일 업로드에서 사용할 `MinerU 문서 분석 서버` 템플릿입니다.

## API

- `POST /analyze-quote`
- 입력: `fileName`, `mimeType`, `fileBase64`, `caseId`
- 출력: `markdown`, `json`, `tables`, `vendorName`, `items`, `supplyAmount`, `vatAmount`, `totalAmount`, `confidence`, `warnings`

Apps Script에는 서버 주소를 `MINERU_API_URL` 스크립트 속성으로 넣습니다. 예: `https://your-mineru-server.example.com`

API 키를 쓰려면 서버 환경변수와 Apps Script 스크립트 속성에 같은 값을 넣습니다.

- 서버: `MINERU_API_KEY=...`
- Apps Script: `MINERU_API_KEY=...`

## Run locally

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
```

MinerU CLI가 설치된 환경에서는 기본적으로 `mineru` 명령을 호출합니다. 다른 명령 경로를 쓰려면:

```bash
MINERU_COMMAND=/path/to/mineru uvicorn app:app --host 0.0.0.0 --port 8080
```

## Notes

- PDF, JPG, PNG, DOCX, XLSX는 MinerU CLI로 분석합니다.
- HWPX는 서버에서 zip XML 텍스트를 먼저 추출합니다.
- HWP는 v1에서 수동 확인으로 남깁니다.
- MinerU가 실패하면 Apps Script가 기존 추출 방식으로 fallback합니다.
