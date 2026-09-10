import FieldApp from "./FieldApp";

// v2(FieldV2App)는 fieldPlatform/v2/config/release 와 crmCompany 계정 연결이
// 준비되기 전까지 대기 상태다. 코드는 그대로 두고 진입점만 v1 을 가리킨다.
// 되돌릴 때는 아래 한 줄을 FieldV2App 으로 바꾸면 된다.
export default function FieldPage() {
  return <FieldApp />;
}
