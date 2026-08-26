import Image from "next/image";
import Link from "next/link";
import { KAKAO_CHAT_HREF, PHONE_HREF, PHONE_LABEL } from "./contact";
import { QuickEstimateTrigger } from "./QuickEstimateExperience";
import type { LandingService } from "./services";

type TurnoverIntroProps = {
  service: LandingService;
};

const turnoverProcess = [
  {
    label: "D-14",
    title: "D-14 사전 접수",
    copy: "퇴실 일정과 출입 정보를 미리 맞춥니다.",
  },
  {
    label: "CHECK",
    title: "퇴실 상태 확인",
    copy: "오염, 잔존물과 필요한 조치를 기록합니다.",
  },
  {
    label: "CARE",
    title: "직영 청소·조치",
    copy: "승인된 범위의 청소와 경미한 정리를 이어갑니다.",
  },
  {
    label: "REPORT",
    title: "완료 사진 전달",
    copy: "다음 임대 안내에 쓸 현장 상태를 공유합니다.",
  },
];

export default function TurnoverIntro({ service }: TurnoverIntroProps) {
  return (
    <div className="turnover-intro">
      <header className="turnover-intro-header">
        <Link className="landing-brand" href="/" aria-label="BRING CARE 홈으로 이동">
          <span className="brand-image" aria-hidden="true" />
          <span className="brand-engineering">
            BRING <strong>ENGINEERING</strong>
          </span>
        </Link>
        <nav
          className="turnover-intro-nav"
          aria-label="24H 입·퇴실 관리 페이지 이동"
        >
          <a href="#turnover-standard">24H 입·퇴실 관리</a>
          <a href="#cleaning-results">청소 서비스</a>
          <a href="#field-records">현장 기록</a>
          <QuickEstimateTrigger className="turnover-nav-cta">
            30초 견적
          </QuickEstimateTrigger>
        </nav>
      </header>

      <section className="turnover-intro-hero" aria-labelledby="landing-title">
        <Image
          src={service.heroImage}
          alt={service.heroAlt}
          width={900}
          height={720}
          priority
          unoptimized
          sizes="(max-width: 760px) 100vw, 1240px"
        />
        <div className="turnover-intro-overlay" aria-hidden="true" />
        <div className="turnover-intro-copy">
          <p>BRING CARE 24H 입·퇴실 관리</p>
          <h1 id="landing-title">퇴실 다음 날, 바로 보여줄 수 있는 방으로.</h1>
          <span>
            퇴실 확인부터 직영 청소, 필요한 조치와 완료 사진까지. 다음 임대를
            준비하는 과정을 하나로 연결합니다.
          </span>
          <div className="turnover-intro-actions">
            <QuickEstimateTrigger className="turnover-primary-action">
              퇴실 일정 상담하기
            </QuickEstimateTrigger>
            <a
              className="turnover-secondary-action"
              href={KAKAO_CHAT_HREF}
              target="_blank"
              rel="noreferrer"
            >
              카카오톡 상담
            </a>
          </div>
          <div className="turnover-intro-meta">
            <small>
              퇴실 14일 전 접수 · 출입 및 작업 승인 · 중대한 추가 수리 없음
            </small>
            <a className="turnover-intro-phone" href={PHONE_HREF}>
              {PHONE_LABEL}
            </a>
          </div>
        </div>
      </section>

      <section
        className="turnover-intro-process"
        aria-labelledby="turnover-intro-process-title"
      >
        <h2 className="landing-sr-only" id="turnover-intro-process-title">
          24H 입·퇴실 관리 운영 과정
        </h2>
        <ol>
          {turnoverProcess.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
