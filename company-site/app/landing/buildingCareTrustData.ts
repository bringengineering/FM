export type TrustItem = {
  id: string;
  group: "certification" | "award";
  title: string;
  issuer: string;
  year: string;
  image: string;
  alt: string;
};

export const buildingCareTrustItems: readonly TrustItem[] = [
  {
    id: "rnd-department",
    group: "certification",
    title: "연구개발전담부서 인정",
    issuer: "과학기술정보통신부 · 한국산업기술진흥협회",
    year: "2024",
    image: "/landing/certifications/rnd-department.webp",
    alt: "브링엔지니어링 연구개발전담부서 인정서",
  },
  {
    id: "venture",
    group: "certification",
    title: "벤처기업 확인",
    issuer: "벤처기업확인기관",
    year: "2024",
    image: "/landing/certifications/venture.webp",
    alt: "브링엔지니어링 벤처기업 확인서",
  },
  {
    id: "startup",
    group: "certification",
    title: "창업기업 확인",
    issuer: "강원지방중소벤처기업청",
    year: "2025",
    image: "/landing/certifications/startup.webp",
    alt: "브링엔지니어링 창업기업 확인서",
  },
  {
    id: "small-business",
    group: "certification",
    title: "중소기업 확인",
    issuer: "중소벤처기업부",
    year: "2026",
    image: "/landing/credentials/certifications/small-business.webp",
    alt: "브링엔지니어링 중소기업 확인서",
  },
  {
    id: "solverthon-excellence",
    group: "award",
    title: "2026 지역 창업 솔버톤 우수상",
    issuer: "서울대학교 대학연대 지역인재양성 사업단",
    year: "2026",
    image: "/landing/credentials/awards/solverthon-excellence.webp",
    alt: "2026 지역 창업 솔버톤 우수상 상장",
  },
  {
    id: "solverthon-impact",
    group: "award",
    title: "2026 지역 창업 솔버톤 임팩트상",
    issuer: "서울대학교 대학연대 지역인재양성 사업단",
    year: "2026",
    image: "/landing/credentials/awards/solverthon-impact.webp",
    alt: "2026 지역 창업 솔버톤 임팩트상 상장",
  },
  {
    id: "prestartup-excellent-founder",
    group: "award",
    title: "예비창업패키지 우수청년창업가상",
    issuer: "한국창업지도사협회",
    year: "2025",
    image: "/landing/credentials/awards/prestartup-excellent-founder.webp",
    alt: "예비창업패키지 우수청년창업가상 상장",
  },
  {
    id: "knu-innovation-league",
    group: "award",
    title: "창업중심대학 혁신창업리그 우수상",
    issuer: "강원대학교 KNU창업혁신원",
    year: "2025",
    image: "/landing/credentials/awards/knu-innovation-league.webp",
    alt: "강원대학교 창업중심대학 혁신창업리그 우수상 상장",
  },
  {
    id: "gangwon-bi-cooperation",
    group: "award",
    title: "강원BI 스타트업 피칭데이 협력가치상",
    issuer: "강원지역 창업보육센터",
    year: "2025",
    image: "/landing/credentials/awards/gangwon-bi-cooperation.webp",
    alt: "2025 강원BI 스타트업 피칭데이 협력가치상",
  },
  {
    id: "wonju-founder-accelerator",
    group: "award",
    title: "원주시 창업가 양성 가속화 과정 수료",
    issuer: "한라대학교 산학협력단",
    year: "2025",
    image: "/landing/credentials/awards/wonju-founder-accelerator.webp",
    alt: "한라대학교 원주시 창업가 양성 가속화 과정 수료증",
  },
] as const;

export const officialCompanyCredentials = buildingCareTrustItems.filter(
  (item) => item.group === "certification",
);

export const companyAwardsAndEducation = buildingCareTrustItems.filter(
  (item) => item.group === "award",
);
