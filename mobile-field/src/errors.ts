import { FieldError } from './domain/model';
const messages: Record<string, string> = {
  ENCRYPTED_BUILD_REQUIRED: '암호화 저장을 지원하는 개발 앱을 설치해 주세요. Expo Go에서는 사진을 저장하지 않습니다.',
  VAULT_KEY_MISSING: '기기 보관함의 키를 찾을 수 없습니다. 기존 자료를 보존한 채 관리자에게 문의해 주세요.',
  VAULT_KEY_INVALID: '기기 보관함을 열 수 없습니다. 기존 자료는 변경하지 않았습니다.',
  REVISION_CONFLICT: '다른 변경 내용이 먼저 저장됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.',
  PHOTO_LIMIT: '한 작업에는 사진을 100장까지 보관할 수 있습니다.',
  PHOTO_INVALID: '사진 형식이나 크기를 확인해 주세요. JPEG 20MB까지 보관할 수 있습니다.',
  PHOTO_DIMENSIONS: '4천만 화소 이하의 사진을 선택해 주세요.',
  NATIVE_BUILD_REQUIRED: '이 기능은 설치된 Android·iPhone 개발 앱에서 사용할 수 있습니다.',
  PHOTO_INTEGRITY_FAILED: '저장 사진의 무결성을 확인하지 못했습니다. 원본을 삭제하지 않고 보존합니다.',
  OWNER_MISMATCH: '현재 계정의 작업만 열 수 있습니다.',
  PHOTO_EDIT_REQUIRES_SERVER: '전송이 시작된 사진의 수정은 서버 연결 후 진행할 수 있습니다.',
};
export function safeMessage(error: unknown): string {
  return error instanceof FieldError && messages[error.code] ? messages[error.code]! : '저장하지 못했습니다. 기기 공간과 권한을 확인한 뒤 다시 시도해 주세요.';
}
