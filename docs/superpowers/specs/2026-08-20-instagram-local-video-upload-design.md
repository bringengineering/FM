# Instagram 로컬 영상 직접 업로드 설계

## 목표

Marketing OS가 완성된 로컬 MP4를 별도 공개 호스팅 없이 Meta의 공식 resumable upload 경로로 전송하고, 기존 YouTube·Instagram 동시 게시 흐름에서 Instagram Reel을 발행할 수 있게 한다.

## 범위

- 입력: 로컬 MP4 절대 경로, Instagram 캡션, 승인·QC가 포함된 게시 매니페스트
- 출력: Instagram 미디어 ID와 permalink
- 유지: 기존 외부 `video_url` 방식과 YouTube 업로드 방식
- 제외: 영상 생성·편집, 공개 웹 호스팅, Instagram 예약 게시, 게시물 삭제

## 구조

`InstagramClient`에 로컬 파일용 세 단계를 추가한다.

1. `create_resumable_reel(caption)`이 `media_type=REELS`, `upload_type=resumable`로 컨테이너를 만든다.
2. `upload_local_video(creation_id, video_path)`가 파일 크기를 확인하고 Meta의 resumable upload 주소에 MP4 바이트를 전송한다.
3. 기존 `wait_until_ready()`와 `publish()`를 재사용해 처리 완료를 기다리고 공개한다.

매니페스트의 Instagram 입력은 `video_url` 또는 `video_path` 중 정확히 하나를 허용한다. `video_path`가 없으면 최상위 `video` 경로를 사용한다. 기존 매니페스트는 수정 없이 계속 동작한다.

## 데이터 흐름

텔레그램 승인 → QC 확인 → 게시 상태의 영상 SHA-256 확인 → YouTube 업로드 → Instagram 컨테이너 생성 → 로컬 MP4 전송 → 처리 상태 폴링 → Reel 공개 → 플랫폼별 URL과 상태 저장.

플랫폼은 독립적으로 기록한다. YouTube가 성공하고 Instagram이 실패하면 YouTube를 다시 올리지 않고 Instagram의 재시도 가능한 단계만 재개한다.

## 안전장치

- 실제 공개는 승인 필드와 명시적 공개 옵션이 모두 있을 때만 허용한다.
- 토큰·앱 시크릿은 Windows 사용자 환경변수에서만 읽고 로그·매니페스트에 쓰지 않는다.
- 파일 존재, MP4 확장자, 비어 있지 않은 파일, HTTPS upload endpoint를 공개 전 검사한다.
- 동일 영상 SHA-256의 `published` 결과는 재게시하지 않는다.
- 인증·권한·형식 오류는 재시도 불가, 네트워크·429·5xx·처리 지연은 재시도 가능으로 구분한다.
- 실전 테스트는 한 편만 대상으로 하며 공개 호출 직전에 제목·본문·플랫폼을 다시 확인받는다.

## 테스트

- 컨테이너 생성 요청이 resumable upload 파라미터를 포함하는지 검사
- 로컬 MP4 바이트와 파일 크기 헤더가 upload endpoint로 전달되는지 검사
- 누락·빈 파일·잘못된 확장자·비 HTTPS endpoint 차단 검사
- `video_url` 기존 경로의 회귀 검사
- YouTube 성공 후 Instagram 실패 시 중복 YouTube 업로드 방지 검사
- 토큰과 시크릿이 오류·상태 파일에 노출되지 않는지 검사
- 실제 API에서는 공개 직전까지 계정·권한과 컨테이너 생성 전 입력만 검증하고, 공개 호출은 사용자 최종 승인 뒤 한 번만 수행

## 완료 기준

관련 자동 테스트가 모두 통과하고, 추적 테스트 전체가 통과하며, 승인된 단일 MP4가 YouTube와 Instagram에 각각 한 번만 게시되고 두 permalink가 상태 파일에 기록되면 완료다.
