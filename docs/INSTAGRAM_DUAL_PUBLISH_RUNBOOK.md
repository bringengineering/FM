# Instagram·YouTube 동시 게시 운영 안내

## 현재 연결

- Facebook 페이지: 브링이슈
- Instagram: `@koala.12130628`
- 인증값: Windows 사용자 환경변수에만 저장
- 기본 승인: YouTube와 Instagram 동시 공개

## 매니페스트 필수 구조

```json
{
  "video": "C:/absolute/path/final.mp4",
  "target": "both",
  "approval": {
    "approved": true,
    "approved_at": "2026-08-20T01:00:00+09:00",
    "approved_by": "telegram-owner"
  },
  "qc": {
    "required_gates": ["audio", "captions", "aspect"],
    "audio": true,
    "captions": true,
    "aspect": true
  },
  "youtube": {
    "title": "제목",
    "description": "설명",
    "tags": ["기업이야기"],
    "privacy_status": "public"
  },
  "instagram": {
    "caption": "릴스 본문과 해시태그",
    "video_url": "https://temporary-media.example/random/final.mp4"
  }
}
```

## 안전 점검

1. `--dry-run`으로 승인, QC, 파일, 대상 플랫폼을 검사한다.
2. 실제 공개는 Telegram에서 `승인`, `유튜브만`, `인스타만` 중 하나를 받은 뒤 실행한다.
3. `automation/state/publish/<영상 SHA-256>.json`에서 플랫폼별 결과를 확인한다.
4. `published` 플랫폼은 재실행하지 않고 `failed_retryable`만 재시도한다.
5. 토큰은 Git, JSON 매니페스트, 로그, Telegram 메시지에 기록하지 않는다.

## 토큰 이상 징후

401·403 또는 권한 오류가 발생하면 자동 게시를 멈춘다. Meta Graph API 탐색기에서 다음 권한으로 토큰을 다시 승인하고 같은 Windows 환경변수 이름에 교체한다.

- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management`

## 실제 공개 테스트

테스트 공개도 외부 게시물이므로 별도 승인 후 한 편만 수행한다. 테스트 전에 영상 URL이 인터넷에서 HTTPS로 접근 가능한지 확인한다.
