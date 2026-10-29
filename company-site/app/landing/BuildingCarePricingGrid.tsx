export default function BuildingCarePricingGrid() {
  return <div className="bc-price-grid">
    <article className="bc-price-product bc-price-product-featured">
      <div className="bc-price-product-top"><span>기본 건물관리</span><b>관리</b></div>
      <h3>월 69,000원부터</h3>
      <p className="bc-price-frequency">주 2회 정기 방문</p>
      <ul><li>공실·공용부 상태 확인</li><li>민원·업체 연결</li><li>월간 관리보고</li></ul>
      <small>부가세 별도</small>
    </article>

    <article className="bc-price-product">
      <div className="bc-price-product-top"><span>계단·공용부 청소</span><b>청소</b></div>
      <h3>월 4회 정기청소</h3>
      <dl><div><dt>3층 60,000원</dt></div><div><dt>4층 70,000원</dt></div><div><dt>5층 80,000원</dt></div></dl>
      <small>부가세 별도</small>
    </article>

    <article className="bc-price-product">
      <div className="bc-price-product-top"><span>입·퇴실 청소</span><b>공실</b></div>
      <h3>관리 건물 100,000원부터</h3>
      <p className="bc-price-frequency">일반 청소 120,000원부터</p>
      <ul><li>퇴실 확인 후 일정 조율</li><li>청소 완료 상태 기록</li></ul>
      <small>부가세 별도</small>
    </article>

    <article className="bc-price-product">
      <div className="bc-price-product-top"><span>전문 작업 조율</span><b>연결</b></div>
      <h3>승인 작업금액의 5%</h3>
      <p className="bc-price-frequency">수리·보수·전문 시공</p>
      <ul><li>작업 범위와 견적 정리</li><li>일정·완료 상태 확인</li></ul>
      <small>부가세 별도</small>
    </article>

    <p className="bc-price-separation">건물관리비와 청소·수리 비용은 별도로 구분하고, 추가 작업은 범위와 금액을 먼저 안내한 뒤 승인 후 진행합니다.</p>
  </div>;
}
