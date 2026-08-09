"use client";

const EMBEDDED_MAP_URL = "/wonju-map.html?embedded=field&mode=managed";
const FULL_MAP_URL = "/wonju-map.html?mode=managed";

export default function FieldMapPanel() {
  return (
    <section className="field-map-panel" aria-labelledby="field-map-heading">
      <div className="field-map-toolbar">
        <div>
          <p className="field-eyebrow">BRING MAP</p>
          <h1 id="field-map-heading">원주 건물·공실 통합지도</h1>
          <p>유지보수 업체와 BRING 관리 건물을 분리된 지도 업무 화면에서 확인합니다.</p>
        </div>
        <div className="field-map-actions">
          <span className="field-map-status"><i /> 서버 지도 연결됨</span>
          <a href={FULL_MAP_URL} target="_blank" rel="noreferrer">
            전체 화면으로 열기
          </a>
        </div>
      </div>
      <div className="field-map-frame-wrap">
        <iframe
          className="field-map-frame"
          src={EMBEDDED_MAP_URL}
          title="BRING 원주 건물 유지보수 지도"
          loading="eager"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="field-map-footnote">
        같은 서버의 내부 지도에서 승인된 관리 건물 투영 데이터만 안전하게 불러옵니다.
      </p>
    </section>
  );
}
