import Image from "next/image";
import type { ReactNode } from "react";
import "./landing-brand-intro.css";

type LandingBrandIntroProps = {
  serviceHref: string;
  estimateHref?: string;
  estimateAction?: ReactNode;
};

export default function LandingBrandIntro({
  serviceHref,
  estimateHref = "#quick-estimate",
  estimateAction,
}: LandingBrandIntroProps) {
  return (
    <section className="landing-brand-intro" aria-labelledby="landing-brand-intro-title">
      <div className="landing-brand-intro-copy">
        <p>BRING CARE · BUILDING MANAGEMENT</p>
        <h2 id="landing-brand-intro-title">
          우리는 건물을 관리하며, {" "}
          <span>청소까지 책임지는 회사입니다.</span>
        </h2>
        <span>
          관리에는 현장을 직접 살피는 일이 포함되어 있으니까. 청소부터 시설 확인,
          공실과 입·퇴실 관리까지 BRING CARE가 직접 살피고 기록합니다.
        </span>
        <div className="landing-brand-intro-actions">
          <a href={serviceHref}>서비스 알아보기</a>
          {estimateAction ?? <a href={estimateHref}>무료 견적 신청</a>}
        </div>
      </div>
      <div className="landing-brand-intro-photo">
        <Image
          src="/brand-campaign/bringcare-suited-team-building-v3.png"
          alt="건물 앞에 선 BRING CARE 건물관리 운영팀"
          width={1376}
          height={768}
          priority
          unoptimized
          sizes="(max-width: 820px) 100vw, 56vw"
        />
      </div>
    </section>
  );
}
