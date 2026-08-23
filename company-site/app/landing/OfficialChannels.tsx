const PHONE_HREF = "tel:01065663606";

export default function OfficialChannels() {
  return (
    <section className="landing-channels" aria-labelledby="channels-title">
      <div className="landing-section-inner landing-channels-layout">
        <div className="landing-channel-intro">
          <span className="landing-channel-logo" aria-hidden="true" />
          <div className="landing-section-heading">
            <p>BRING CARE 공식 채널</p>
            <h2 id="channels-title">편한 채널에서 현장과 상담을 확인하세요.</h2>
            <span>확인된 공식 정보만 연결했습니다.</span>
          </div>
        </div>
        <div className="landing-channel-grid">
          <article className="landing-channel-card landing-channel-card-active">
            <span>01 · NAVER BLOG</span>
            <h3>현장기록 원문</h3>
            <p>건물관리의 실제 진행 과정과 유지보수 현장 기록을 확인하세요.</p>
            <a href="https://blog.naver.com/bringcare" target="_blank" rel="noreferrer">
              네이버 블로그에서 현장기록 보기 <span aria-hidden="true">↗</span>
            </a>
          </article>
          <article className="landing-channel-card">
            <span>02 · KAKAO TALK</span>
            <h3>민원 접수·상담 신청</h3>
            <p>카카오톡에서 BRING Care 검색 후 채널을 확인해 주세요.</p>
            <a href={PHONE_HREF}>채널 연결이 어려우면 전화 상담</a>
          </article>
          <article className="landing-channel-card landing-channel-card-pending">
            <span>03 · INSTAGRAM</span>
            <h3>현장 사진·새 소식</h3>
            <p>인스타그램 공식 계정 주소 확인 후 연결</p>
            <span className="landing-channel-status">직접 링크 확인 중</span>
          </article>
        </div>
      </div>
    </section>
  );
}
