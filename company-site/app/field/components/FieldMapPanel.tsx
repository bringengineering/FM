"use client";

import { useEffect, useState } from "react";

const LOCAL_MAP_URL = "/wonju-map.html?embedded=field";
const DEPLOYED_MAP_URL =
  "https://bringengineering.github.io/FM/wonju-map.html?embedded=field";

export default function FieldMapPanel() {
  const [mapUrl, setMapUrl] = useState(LOCAL_MAP_URL);

  useEffect(() => {
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setMapUrl(DEPLOYED_MAP_URL);
    }
  }, []);

  return (
    <section className="field-map-panel" aria-labelledby="field-map-heading">
      <div className="field-map-toolbar">
        <div>
          <p className="field-eyebrow">BRING MAP</p>
          <h1 id="field-map-heading">원주 건물·공실 통합지도</h1>
          <p>유지보수 업체와 내부 건물·공실 현황을 한 지도에서 확인합니다.</p>
        </div>
        <div className="field-map-actions">
          <span className="field-map-status"><i /> 서버 지도 연결됨</span>
          <a href={mapUrl} target="_blank" rel="noreferrer">
            전체 화면으로 열기
          </a>
        </div>
      </div>
      <div className="field-map-frame-wrap">
        <iframe
          className="field-map-frame"
          src={mapUrl}
          title="BRING 원주 건물 유지보수 지도"
          loading="eager"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="field-map-footnote">
        로컬 미리보기는 네이버 지도 인증이 완료된 운영 지도를 사용하며, 배포 후에는 같은 서버의 최신 지도와 Firebase 데이터를 사용합니다.
      </p>
    </section>
  );
}
