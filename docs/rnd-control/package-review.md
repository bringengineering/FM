# CRM 통합 소스 전달 검증

PACKAGE_MANIFEST.json은 모든 전달 파일의 상대 경로·크기·SHA-256과 BASE_COMMIT을 기록합니다. Python 표준 라이브러리로 verify-source-package.py에 ZIP 경로를 전달해 검증합니다. manifest는 무결성 목록이며 전자서명·작성자 인증은 아닙니다.

기준 commit 976cc5f33bcb87f4ed5e0e304016782df702af48의 깨끗한 별도 체크아웃에서 CRM-RND.patch의 git apply --check를 확인했습니다. 적용 담당자는 실제 대상 저장소에서도 BASE_COMMIT을 확인하고 git apply --check를 먼저 실행해야 합니다. 기준이 다르면 자동 덮어쓰기 대신 차이를 검토하세요.

패키지는 검토용 소스와 시험 근거입니다. 운영 설치·Firebase/Drive 배포를 수행하지 않습니다. 기존 개발기획의 61개 검수와 release-readiness.json을 참고하고 실제 계정·원본 복구·운영 검수를 완료해야 합니다.
