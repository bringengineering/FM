"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  companyAwardsAndEducation,
  officialCompanyCredentials,
  type TrustItem,
} from "./buildingCareTrustData";

export default function BuildingCareCredentials() {
  const [selected, setSelected] = useState<TrustItem | null>(null);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  return <>
    <section id="company-credentials" className="bc-section bc-credentials-section">
      <div className="bc-shell">
        <header className="bc-heading bc-credentials-heading">
          <p className="bc-kicker">COMPANY CREDENTIALS</p>
          <h2>현장을 관리하고,<br />더 나은 방식을 연구합니다.</h2>
          <p>BRING CARE를 운영하는 브링엔지니어링의 공식 기업 인증과 수상·교육 이력입니다.</p>
        </header>

        <CredentialGroup title="공식 기업 인증" items={officialCompanyCredentials} onSelect={setSelected} />
        <CredentialGroup title="수상·교육 이력" items={companyAwardsAndEducation} onSelect={setSelected} />

        <p className="bc-credentials-disclaimer">아래 자료는 기업의 연구·운영 기반을 보여주는 자료이며, 개별 건물관리 서비스의 자격 또는 결과를 보장하는 표시는 아닙니다.</p>
      </div>
    </section>

    {selected && <div className="bc-document-modal" role="dialog" aria-modal="true" aria-label={selected.title}>
      <button className="bc-document-backdrop" type="button" aria-label="배경을 눌러 닫기" onClick={() => setSelected(null)} />
      <div className="bc-document-panel">
        <header><div><span>{selected.year}</span><h3>{selected.title}</h3><p>{selected.issuer}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="닫기">×</button></header>
        <div className="bc-document-image"><Image src={selected.image} alt={`${selected.title} 확인서`} fill unoptimized sizes="(max-width: 700px) 92vw, 680px" /></div>
      </div>
    </div>}
  </>;
}

function CredentialGroup({ title, items, onSelect }: { title: string; items: readonly TrustItem[]; onSelect: (item: TrustItem) => void }) {
  return <section className="bc-credential-group" aria-label={title}>
    <div className="bc-credential-group-heading"><h3>{title}</h3><span>{items.length}건</span></div>
    <div className={`bc-credential-grid ${items[0]?.group === "certification" ? "bc-credential-grid-official" : "bc-credential-grid-awards"}`}>
      {items.map((item) => <button className="bc-credential-card" type="button" key={item.id} onClick={() => onSelect(item)} aria-label={`${item.title} 원본 보기`}>
        <div className="bc-credential-thumb"><Image src={item.image} alt={item.alt} fill unoptimized sizes="(max-width: 700px) 42vw, 220px" /></div>
        <div><span>{item.year}</span><strong>{item.title}</strong><small>{item.issuer}</small><b>원본 보기 ↗</b></div>
      </button>)}
    </div>
  </section>;
}
