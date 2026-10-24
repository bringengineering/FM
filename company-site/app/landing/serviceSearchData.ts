export const serviceSearchData = {
  "building-care": {
    name: "원주 원룸·다가구 건물관리",
    description: "시설관리, 임차인 응대, 유지관리, 입퇴실·공실 관리와 관리기록을 한 곳에서 제공합니다.",
    faq: [
      ["기본 건물관리는 얼마나 자주 방문하나요?", "기본관리는 월 69,000원부터이며 주 2회 정기관리와 월 1회 관리보고를 기준으로 합니다."],
      ["공용부 청소도 포함되나요?", "공용부 청소는 월 4회 진행하는 별도 상품으로, 건물관리와 함께 또는 따로 신청할 수 있습니다."],
      ["공실과 입퇴실도 관리하나요?", "퇴실 접수, 현장 확인, 청소·수리 조율, 공실 정보 정리와 다음 입실 준비까지 통합 관리합니다."],
    ],
  },
  "stair-cleaning": {
    name: "원주 건물 계단·공용부 청소",
    description: "계단, 복도, 현관과 공용부를 월 4회 정기 청소하고 작업 내용을 기록합니다.",
    faq: [
      ["정기청소는 한 달에 몇 번 방문하나요?", "기본 정기청소는 월 4회 방문합니다. 주 2회 또는 주 3회 방문은 별도로 협의할 수 있습니다."],
      ["가격은 어떻게 정해지나요?", "기본 월 4회 기준 3층 60,000원, 4층 70,000원, 5층 80,000원부터이며 부가세는 별도입니다."],
      ["청소 외 시설 이상도 확인하나요?", "작업 중 발견한 조명, 누수 흔적, 적치물 등 공용부 이상 사항을 확인해 안내합니다."],
    ],
  },
  "move-in-cleaning": {
    name: "원주 입주·이사청소",
    description: "창문, 욕실, 주방, 수납장과 바닥 등 입주 전 필요한 구역을 청소하고 완료 상태를 확인합니다.",
    faq: [
      ["입주청소 가격은 얼마부터인가요?", "관리 건물은 100,000원부터, 일반 단건 입·퇴실청소는 120,000원부터이며 부가세와 옵션은 별도입니다."],
      ["어떤 구역을 청소하나요?", "창문·창틀, 욕실·배수구, 주방·후드, 수납장 안쪽, 바닥과 모서리 등 상담 시 정한 범위를 청소합니다."],
      ["작업이 끝난 뒤 확인도 하나요?", "요청 범위와 주요 구역의 완료 상태를 다시 확인하고 추가 확인 사항이 있으면 안내합니다."],
    ],
  },
} as const;

export type ServiceSlug = keyof typeof serviceSearchData;

export function buildServiceStructuredData(slug: ServiceSlug) {
  const service = serviceSearchData[slug];
  const url = `https://bring-fm.web.app/${slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://bring-fm.web.app/#organization", name: "BRING CARE", url: "https://bring-fm.web.app/" },
      { "@type": "LocalBusiness", "@id": "https://bring-fm.web.app/#localbusiness", name: "BRING CARE", url: "https://bring-fm.web.app/", telephone: "010-6566-3603", areaServed: "원주시" },
      { "@type": "Service", name: service.name, description: service.description, url, provider: { "@id": "https://bring-fm.web.app/#organization" } },
      { "@type": "FAQPage", mainEntity: service.faq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "BRING CARE", item: "https://bring-fm.web.app/" }, { "@type": "ListItem", position: 2, name: service.name, item: url }] },
    ],
  };
}
