import {
  isDesktopHandoffBootstrapUrl,
  isExactCrmEmbeddedUrl,
} from "./desktop-handoff.client";

/**
 * 현장앱 진입 유형.
 *
 * 진입점(page.tsx)이 어떤 앱을 띄울지 정하는 데 쓰므로, 두 앱 중 어느 쪽도
 * 끌어오지 않는 가벼운 모듈로 따로 둔다. (여기서 v2 를 import 하면 지연 로드가
 * 무의미해져 현장 직원 폰이 쓰지도 않는 CRM 셸 코드를 내려받게 된다.)
 */
export type FieldV2EntryKind = "standalone" | "embedded" | "bootstrap" | "invalid-embedded";

export function classifyFieldV2EntryUrl(url: URL): FieldV2EntryKind {
  if (isExactCrmEmbeddedUrl(url)) return "embedded";
  if (isDesktopHandoffBootstrapUrl(url)) return "bootstrap";
  if (url.searchParams.has("embedded") || url.searchParams.has("desktop_handoff")) {
    return "invalid-embedded";
  }
  return "standalone";
}
