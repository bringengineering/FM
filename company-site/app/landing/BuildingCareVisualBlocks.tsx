import Image from "next/image";
import {
  activeCertifications,
  directVsBringRows,
  managementCycle,
  managementScopeRows,
  serviceVisuals,
} from "./buildingCareVisualData";

export function CertificationStrip() {
  return <div className="bc-certifications"><div className="bc-cert-heading"><div><p className="bc-kicker">CERTIFICATION &amp; AWARDS</p><h2>공식 인증으로,<br />운영 기반을 증명합니다.</h2></div><p>연구개발 조직부터 벤처·창업기업 확인까지,<br />BRING CARE는 기업 운영 기반을 공식 문서로 확인받았습니다.</p></div><div className="bc-cert-grid">{activeCertifications.map(cert => <details className="bc-cert-card" key={cert.id}><summary><div className="bc-cert-thumb"><Image src={cert.image} alt={`${cert.title} 개인정보 보호 처리 썸네일`} fill unoptimized sizes="220px" /></div><div><small>{cert.issuer}</small><strong>{cert.title}</strong>{cert.validUntil && <span>{cert.validUntil}까지</span>}</div><b>확인서 보기 ＋</b></summary><div className="bc-cert-expanded"><Image src={cert.image} alt={`${cert.title} 공개용 확인서`} width={640} height={820} unoptimized /><p>개인정보 보호를 위해 공개용 이미지의 식별정보를 흐림 처리했습니다.</p></div></details>)}</div><p className="bc-cert-note">현재 공개 중인 자료는 공식 인증 3건입니다. 인증은 기업의 운영 기반을 나타내며 개별 건물관리 서비스의 품질 보증을 의미하지 않습니다.</p></div>;
}

export function ServiceVisualMenu() {
  return <div className="bc-visual-block"><VisualHeading eyebrow="MANAGEMENT MENU" title="건물관리, 필요한 일을 한눈에." copy="공실부터 입·퇴실, 공용부와 시설까지 한 곳에서 연결합니다." /><div className="bc-service-visual-grid">{serviceVisuals.map((item, index) => <article className="bc-service-visual" key={item.title}><span>{item.icon}</span><small>{String(index + 1).padStart(2, "0")}</small><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></div>;
}

export function ManagementComparison() {
  return <div className="bc-visual-block"><VisualHeading eyebrow="WHY BRING CARE" title="직접 관리와 이렇게 다릅니다." copy="흩어진 연락과 확인을 BRING CARE 한 곳으로 모읍니다." /><div className="bc-management-comparison" role="table" aria-label="건물주 직접 관리와 BRING CARE 관리 비교"><div className="bc-compare-row bc-compare-head" role="row"><strong role="columnheader">관리 항목</strong><strong role="columnheader">건물주 직접 관리</strong><strong role="columnheader">BRING CARE</strong></div>{directVsBringRows.map(row => <div className="bc-compare-row" role="row" key={row.label}><strong role="cell">{row.label}</strong><span role="cell">{row.direct}</span><b role="cell">{row.bring}</b></div>)}</div></div>;
}

export function ManagementCycle() {
  return <div className="bc-visual-block"><VisualHeading eyebrow="MANAGEMENT FLOW" title="확인부터 보고까지, 한 흐름으로." copy="현장을 보고 끝내지 않고 처리 과정과 결과까지 기록합니다." /><div className="bc-cycle-grid">{managementCycle.map((item, index) => <article className="bc-cycle-step" key={item.title}><div><Image src={item.image} alt={`BRING CARE 실제 ${item.title} 관리기록`} fill unoptimized sizes="(max-width: 760px) 100vw, 25vw" /></div><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></div>;
}

export function ManagementScopeTable() {
  return <div className="bc-visual-block"><VisualHeading eyebrow="SERVICE SCOPE" title="월 관리비에 무엇이 포함되나요?" copy="기본 관리와 별도 작업을 시작 전에 분명하게 구분합니다." /><div className="bc-scope-table" role="table" aria-label="월 관리비 포함 범위와 별도 작업"><div className="bc-scope-row bc-scope-head" role="row"><strong role="columnheader">관리 항목</strong><strong role="columnheader">월 관리비 포함</strong><strong role="columnheader">별도 작업비</strong></div>{managementScopeRows.map(row => <div className="bc-scope-row" role="row" key={row.label}><strong role="cell">{row.label}</strong><span role="cell">{row.included ? "● 포함" : "－"}</span><b role="cell">{row.separate ? "● 별도" : "－"}</b></div>)}<p>별도 비용이 필요한 작업은 범위와 금액을 먼저 안내하고 승인 후 진행합니다.</p></div></div>;
}

export function OperatingStandardComparison() {
  const rows = [
    ["연락", "여러 업체에 각각 요청", "BRING CARE 한 곳에 요청"],
    ["확인", "완료 여부를 직접 확인", "완료 사진과 기록으로 확인"],
    ["비용", "작업 후 비용 확인", "사전 안내·승인 후 진행"],
    ["기록", "문자와 사진에 분산", "월간 관리보고로 정리"],
  ] as const;
  return <div className="bc-visual-block"><VisualHeading eyebrow="OPERATING STANDARD" title="관리 방식부터 다릅니다." copy="연락·확인·비용·기록의 기준을 투명하게 정리합니다." /><div className="bc-standard-stack"><article className="bc-standard-back"><h3>일반 개별관리</h3>{rows.map(([label, direct]) => <p key={label}><span>{label}</span>{direct}</p>)}</article><article className="bc-standard-front"><small>BRING CARE STANDARD</small><h3>BRING CARE 운영 기준</h3>{rows.map(([label,, bring]) => <p key={label}><span>{label}</span><b>{bring}</b></p>)}</article></div></div>;
}

function VisualHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="bc-visual-heading"><p>{eyebrow}</p><h2>{title}</h2><span>{copy}</span></div>;
}
