import Image from "next/image";

export type RelatedServiceSlug =
  | "building-care"
  | "stair-cleaning"
  | "move-in-cleaning";

const relatedServices = {
  "building-care": {
    eyebrow: "BUILDING & TURNOVER CARE",
    title: "건물관리·입퇴실 통합관리",
    copy: "공실, 입퇴실, 시설 확인과 민원 대응을 한 흐름으로 관리합니다.",
    href: "/building-care",
    image: "/landing/records/tenancy-check.jpg",
    imageAlt: "BRING CARE가 확인한 입퇴실 관리 현장",
  },
  "stair-cleaning": {
    eyebrow: "COMMON AREA CLEANING",
    title: "계단·공용부 정기청소",
    copy: "계단, 복도와 공동현관을 정기적으로 청소하고 작업 결과를 공유합니다.",
    href: "/stair-cleaning",
    image: "/landing/cleaning/bringcare-stair-mop-down.png",
    imageAlt: "BRING CARE 작업자의 계단 공용부 청소",
  },
  "move-in-cleaning": {
    eyebrow: "MOVE-IN CLEANING",
    title: "입주·이사청소",
    copy: "주방, 욕실, 창틀과 바닥을 구역별로 청소하고 완료 상태를 확인합니다.",
    href: "/move-in-cleaning",
    image: "/landing/movein-campaign/suit-kitchen-hood.png",
    imageAlt: "BRING CARE 작업자의 입주 이사청소",
  },
} satisfies Record<
  RelatedServiceSlug,
  {
    eyebrow: string;
    title: string;
    copy: string;
    href: string;
    image: string;
    imageAlt: string;
  }
>;

type RelatedServicesProps = {
  current: RelatedServiceSlug;
};

export default function RelatedServices({ current }: RelatedServicesProps) {
  const services = (Object.entries(relatedServices) as Array<
    [RelatedServiceSlug, (typeof relatedServices)[RelatedServiceSlug]]
  >).filter(([slug]) => slug !== current);
  const titleId = `related-services-${current}-title`;

  return (
    <section
      className="related-services"
      id={`related-services-${current}`}
      aria-labelledby={titleId}
    >
      <div className="related-services-inner">
        <header className="related-services-heading">
          <p>BRING CARE SERVICES</p>
          <h2 id={titleId}>
            필요한 관리와 청소를
            <br />한 곳에서 이어가세요.
          </h2>
          <span>
            지금 보고 계신 서비스 외에도 건물 운영에 필요한 BRING CARE 서비스를
            함께 이용할 수 있습니다.
          </span>
        </header>

        <div className="related-services-grid">
          {services.map(([slug, service]) => (
            <a
              className="related-service-card"
              href={service.href}
              key={slug}
              aria-label={`${service.title} 살펴보기`}
            >
              <div className="related-service-image">
                <Image
                  src={service.image}
                  alt={service.imageAlt}
                  fill
                  unoptimized
                  sizes="(max-width: 760px) 100vw, 50vw"
                />
              </div>
              <div className="related-service-copy">
                <p>{service.eyebrow}</p>
                <h3>{service.title}</h3>
                <span>{service.copy}</span>
                <strong>
                  서비스 자세히 보기 <b aria-hidden="true">→</b>
                </strong>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
