"use client";

import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { auth } from "../field/lib/firebase.client";
import { advanceCleaningRework, advancePartnerProgress, loadCleaningReworkPhoto, loadPartnerOffers, respondToCleaningRework, respondToPartnerOffer, type PartnerOffer, type PartnerReworkRequest } from "../field/lib/cleaning-partner-api.client";

type Tab = "home" | "jobs" | "schedule" | "settlement" | "more";
type OfferApi = {
  load: typeof loadPartnerOffers;
  respond: typeof respondToPartnerOffer;
  progress?: typeof advancePartnerProgress;
  reworkRespond?: typeof respondToCleaningRework;
  reworkProgress?: typeof advanceCleaningRework;
  reworkPhoto?: typeof loadCleaningReworkPhoto;
};

const defaultApi: OfferApi = { load: loadPartnerOffers, respond: respondToPartnerOffer, progress: advancePartnerProgress, reworkRespond: respondToCleaningRework, reworkProgress: advanceCleaningRework, reworkPhoto: loadCleaningReworkPhoto };

function seoulDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function won(value: number): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function serviceLabel(type: string): string {
  return ({ move_in_cleaning: "입주청소", move_out_cleaning: "이사청소", common_cleaning: "거주청소", stair_cleaning: "계단청소", other: "기타" } as Record<string, string>)[type] || "청소 서비스";
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", weekday: "short" }).format(date);
}

function LoginScreen({ onLogin, error }: { onLogin: (email: string, password: string) => Promise<void>; error: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try { await onLogin(email.trim(), password); } finally { setBusy(false); }
  }
  return <main className="partner-login-page"><form className="partner-login-card" onSubmit={event => void submit(event)}>
    <div className="partner-brand-mark">B</div><p className="partner-eyebrow">BRING CLEANING CENTER</p>
    <h1>파트너 앱 로그인</h1><p>등록된 업체 계정으로 로그인해 주세요.</p>
    <label>이메일<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>비밀번호<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    {error ? <p className="partner-error" role="alert">{error}</p> : null}
    <button className="partner-primary" type="submit" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
    <small>계정 연결이나 로그인이 안 되면 BRING 운영팀에 문의해 주세요.</small>
  </form></main>;
}

export default function PartnerApp({ api = defaultApi }: { api?: OfferApi }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  const [reworkRequests, setReworkRequests] = useState<PartnerReworkRequest[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState<PartnerOffer | null>(null);
  const [declineReason, setDeclineReason] = useState("schedule_unavailable");
  const [busyOfferId, setBusyOfferId] = useState("");
  const [busyReworkId, setBusyReworkId] = useState("");
  const [decliningRework, setDecliningRework] = useState<PartnerReworkRequest | null>(null);
  const [reworkDeclineReason, setReworkDeclineReason] = useState("");
  const [reworkPhotos, setReworkPhotos] = useState<Record<string, string>>({});
  const [loadingReworkPhoto, setLoadingReworkPhoto] = useState("");

  useEffect(() => onAuthStateChanged(auth, next => { setUser(next); setAuthReady(true); }), []);
  useEffect(() => {
    if (!user) { setOffers([]); setReworkRequests([]); setReworkPhotos({}); setVendorId(""); return; }
    if (!user.emailVerified) { setError("이메일 인증을 완료한 계정으로 로그인해 주세요."); return; }
    let cancelled = false;
    setLoading(true); setError("");
    void api.load().then(result => {
      if (cancelled) return;
      setVendorId(result.vendorId); setOffers(result.offers); setReworkRequests(result.reworkRequests || []);
    }).catch(reason => {
      if (cancelled) return;
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "cleaning_partner_forbidden" ? "이 계정은 파트너 업체에 연결되어 있지 않습니다. 운영팀에 계정 연결을 요청해 주세요." : "작업 정보를 불러오지 못했습니다. 연결 상태를 확인해 주세요.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, api.load]);

  const today = seoulDate();
  const todaysOffers = useMemo(() => offers.filter(offer => offer.desiredDate === today && offer.status === "accepted"), [offers, today]);
  const expectedIncome = todaysOffers.reduce((sum, offer) => sum + offer.supplierAmount, 0);
  const newOffers = offers.filter(offer => offer.status === "offered");
  const activeJobs = offers.filter(offer => offer.status === "accepted" && offer.progress !== "completed");
  const schedule = [...todaysOffers].sort((a, b) => a.desiredDate.localeCompare(b.desiredDate));

  async function login(email: string, password: string) {
    setError("");
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch { setError("로그인 정보를 확인해 주세요."); }
  }

  async function decide(offer: PartnerOffer, action: "accept" | "decline", reason = "") {
    setBusyOfferId(offer.id); setError("");
    try {
      await api.respond({ offerId: offer.id, action, reason });
      const result = await api.load(); setOffers(result.offers); setVendorId(result.vendorId); setDeclining(null);
    } catch (reasonValue) {
      const code = reasonValue instanceof Error ? reasonValue.message : "";
      setError(code === "cleaning_partner_offer_expired" ? "응답 기한이 지나 이 제안은 만료되었습니다." : "처리하지 못했습니다. 새로고침한 뒤 다시 확인해 주세요.");
    } finally { setBusyOfferId(""); }
  }

  async function updateProgress(offer: PartnerOffer) {
    const next = ({ accepted: "departed", departed: "arrived", arrived: "started" } as Record<string, "departed" | "arrived" | "started">)[offer.progress];
    if (!next || !api.progress) return;
    setBusyOfferId(offer.id); setError("");
    try {
      await api.progress({ offerId: offer.id, nextProgress: next, expectedRevision: offer.revision });
      const result = await api.load(); setOffers(result.offers);
    } catch {
      setError("작업 단계를 저장하지 못했습니다. 상태를 새로고침해 주세요.");
    } finally { setBusyOfferId(""); }
  }

  async function decideRework(item: PartnerReworkRequest, action: "accept" | "decline", reason = "") {
    if (!api.reworkRespond) return setError("재작업 요청 처리 연결을 사용할 수 없습니다.");
    if (action === "decline" && reason.trim().length < 2) return setError("파트너 거절 사유를 입력해 주세요.");
    setBusyReworkId(item.requestId); setError("");
    try {
      await api.reworkRespond({ orderId: item.orderId, requestId: item.requestId, expectedRevision: item.revision, action, reason });
      const result = await api.load(); setOffers(result.offers); setReworkRequests(result.reworkRequests || []); setDecliningRework(null); setReworkDeclineReason("");
    } catch { setError("재작업 요청을 처리하지 못했습니다. 새로고침한 뒤 다시 확인해 주세요."); }
    finally { setBusyReworkId(""); }
  }

  async function progressRework(item: PartnerReworkRequest, nextStatus: "in_progress" | "awaiting_review") {
    if (!api.reworkProgress) return setError("재작업 진행 저장 연결을 사용할 수 없습니다.");
    setBusyReworkId(item.requestId); setError("");
    try {
      await api.reworkProgress({ orderId: item.orderId, requestId: item.requestId, expectedRevision: item.revision, nextStatus });
      const result = await api.load(); setOffers(result.offers); setReworkRequests(result.reworkRequests || []);
    } catch { setError("재작업 진행 상태를 저장하지 못했습니다. 새로고침해 주세요."); }
    finally { setBusyReworkId(""); }
  }

  async function showReworkPhoto(item: PartnerReworkRequest, photoIndex: number) {
    const key = `${item.orderId}:${item.requestId}:${photoIndex}`;
    if (reworkPhotos[key] || !api.reworkPhoto) return;
    setLoadingReworkPhoto(key); setError("");
    try {
      const photo = await api.reworkPhoto({ orderId: item.orderId, requestId: item.requestId, photoIndex });
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.mimeType) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(photo.base64)) throw new Error("invalid_photo");
      setReworkPhotos(current => ({ ...current, [key]: `data:${photo.mimeType};base64,${photo.base64}` }));
    } catch { setError("고객 첨부 사진을 불러오지 못했습니다. 권한과 연결 상태를 확인해 주세요."); }
    finally { setLoadingReworkPhoto(""); }
  }

  if (!authReady) return <main className="partner-loading" role="status">파트너 계정을 확인하고 있습니다…</main>;
  if (!user) return <LoginScreen onLogin={login} error={error} />;
  if (!user.emailVerified) return <main className="partner-login-page"><section className="partner-login-card"><div className="partner-brand-mark">B</div><h1>이메일 인증이 필요합니다</h1><p>계정 이메일을 인증한 뒤 다시 로그인해 주세요.</p><button className="partner-secondary" onClick={() => void signOut(auth)}>로그아웃</button></section></main>;

  return <main className="partner-app-shell">
    <header className="partner-topbar"><div className="partner-wordmark"><span className="partner-brand-mark">B</span><span><strong>BRING</strong><small>파트너앱 · Cleaning Center</small></span></div>
      <div className="partner-top-actions"><button aria-label="알림" className="partner-icon-button">♧</button><span className="partner-vendor-name">{vendorId || user.email}</span><button aria-label="로그아웃" className="partner-icon-button" onClick={() => void signOut(auth)}>⌄</button></div>
    </header>
    <section className="partner-dashboard">
      <div className="partner-kpi-row"><div className="partner-kpi"><span className="partner-kpi-icon">▣</span><div><span>오늘 작업</span><strong>{todaysOffers.length}건</strong><small>진행 중 {activeJobs.length} · 예정 {Math.max(0, todaysOffers.length - activeJobs.length)}</small></div></div>
        <div className="partner-kpi"><span className="partner-kpi-icon green">₩</span><div><span>예상 수익</span><strong>{won(expectedIncome)}</strong><small>오늘 수락한 작업 기준</small></div></div></div>

      {loading ? <div className="partner-info-banner" role="status">작업 정보를 불러오고 있습니다…</div> : null}
      {error ? <div className="partner-alert" role="alert">{error}<button onClick={() => window.location.reload()}>새로고침</button></div> : null}

      {newOffers.length > 0 ? <section className="partner-offer-section" aria-labelledby="partner-new-offer-heading">
        <div className="partner-offer-banner"><span>NEW</span><strong id="partner-new-offer-heading">새로운 작업 제안이 도착했습니다!</strong><small>확인 필요</small></div>
        {newOffers.map(offer => <article className="partner-offer-card" key={offer.id}>
          <div className="partner-offer-heading"><div><span className="partner-muted">주문번호</span><strong>{offer.orderId}</strong></div><div className="partner-offer-payout"><span>지급금액</span><strong>{won(offer.supplierAmount)}</strong></div></div>
          <div className="partner-offer-facts"><span>📍 {offer.region}</span><span>⌂ {serviceLabel(offer.serviceType)}</span><span>{dateLabel(offer.desiredDate)}</span></div>
          <p className="partner-privacy-note">고객의 상세 주소와 연락처는 작업 배정 후 필요한 시점에만 확인할 수 있습니다.</p>
          <div className="partner-offer-actions"><button className="partner-primary" disabled={busyOfferId === offer.id} onClick={() => void decide(offer, "accept")}>{busyOfferId === offer.id ? "처리 중…" : "수락"}</button><button className="partner-secondary" disabled={busyOfferId === offer.id} onClick={() => setDeclining(offer)}>거절</button></div>
        </article>)}
      </section> : <section className="partner-empty-offers"><span aria-hidden="true">✓</span><div><strong>새 작업 제안이 없습니다</strong><small>새 제안이 도착하면 이곳에서 확인할 수 있습니다.</small></div></section>}

      <section className="partner-panel partner-rework-panel"><div className="partner-section-title"><span className="partner-section-icon">↻</span><h2>재작업 요청</h2><span className="partner-count">{reworkRequests.length}건</span></div>
        {reworkRequests.length ? reworkRequests.map(item => <article className="partner-rework-card" key={item.requestId}>
          <div className="partner-rework-heading"><div><small>{item.orderId}</small><strong>{item.complaintTitle}</strong></div><span>{({ requested: "응답 대기", accepted: "수락", declined: "거절", in_progress: "재작업 중", awaiting_review: "검수 대기" } as Record<string, string>)[item.status] || "상태 확인"}</span></div>
          <p>{item.complaintDetail}</p><div className="partner-rework-facts"><span>요청 부위 · {item.areas.map(area => ({ window: "창틀", kitchen: "주방", bathroom: "화장실", floor: "바닥", other: "기타" } as Record<string, string>)[area] || "기타").join(" · ")}</span><span>희망 · {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.desiredAt))}</span></div><small className="partner-rework-note">운영팀 메모 · {item.partnerNote}</small>
          {item.customerPhotoCount > 0 ? <div className="partner-rework-photos" aria-label="고객 문제 사진">{Array.from({ length: item.customerPhotoCount }, (_, index) => { const key = `${item.orderId}:${item.requestId}:${index}`; const src = reworkPhotos[key]; return <div key={key}>{src ? <img src={src} alt={`고객 문제 사진 ${index + 1}`} /> : <button className="partner-secondary" disabled={!api.reworkPhoto || loadingReworkPhoto === key} onClick={() => void showReworkPhoto(item, index)}>{loadingReworkPhoto === key ? "불러오는 중…" : `고객 문제 사진 보기 ${index + 1}`}</button>}</div>; })}</div> : null}
          {item.status === "requested" ? <div className="partner-offer-actions"><button className="partner-primary" disabled={busyReworkId === item.requestId || !api.reworkRespond} onClick={() => void decideRework(item, "accept")}>수락</button><button className="partner-secondary" disabled={busyReworkId === item.requestId || !api.reworkRespond} onClick={() => { setDecliningRework(item); setReworkDeclineReason(""); }}>거절</button></div> : null}
          {item.status === "accepted" ? <button className="partner-primary" disabled={busyReworkId === item.requestId || !api.reworkProgress} onClick={() => void progressRework(item, "in_progress")}>재작업 시작</button> : null}
          {item.status === "in_progress" ? <button className="partner-primary" disabled={busyReworkId === item.requestId || !api.reworkProgress} onClick={() => void progressRework(item, "awaiting_review")}>완료 보고 · 검수 요청</button> : null}
          {item.status === "awaiting_review" ? <small className="partner-photo-note">운영팀의 작업 결과와 사진 검수를 기다리고 있습니다.</small> : null}
        </article>) : <p className="partner-empty-copy">재작업 요청이 없습니다.</p>}
      </section>

      <section className="partner-panel"><div className="partner-section-title"><span className="partner-section-icon">▤</span><h2>진행 중인 작업</h2><span className="partner-count">{activeJobs.length}건</span></div>
        {activeJobs.length ? activeJobs.map(offer => <article className="partner-job-row" key={offer.id}><div><strong>{offer.orderId}</strong><span>{offer.region} · {serviceLabel(offer.serviceType)} · {dateLabel(offer.desiredDate)}</span></div><div className="partner-progress"><Progress offer={offer} /></div>{offer.progress !== "started" ? <button className="partner-milestone-button" disabled={!api.progress || busyOfferId === offer.id} onClick={() => void updateProgress(offer)}>{busyOfferId === offer.id ? "저장 중…" : ({ accepted: "출발 처리", departed: "도착 처리", arrived: "작업 시작" } as Record<string, string>)[offer.progress] || "작업 진행"}</button> : <small className="partner-photo-note">사진 등록 및 완료 처리는 증빙 기능 연결 후 표시됩니다.</small>}</article>)
          : <p className="partner-empty-copy">수락한 작업이 여기에 표시됩니다.</p>}
      </section>

      <section className="partner-panel"><div className="partner-section-title"><span className="partner-section-icon">▦</span><h2>오늘의 일정</h2><button className="partner-text-button" onClick={() => setTab("schedule")}>전체보기 ›</button></div>
        {schedule.length ? schedule.map(offer => <div className="partner-schedule-row" key={offer.id}><strong>—</strong><span className="partner-schedule-dot"/><span>{offer.region}　|　{serviceLabel(offer.serviceType)}</span><b>{offer.status === "accepted" ? "수락 완료" : "예정"}</b></div>) : <p className="partner-empty-copy">오늘 확정된 일정이 없습니다.</p>}
      </section>

      <section className="partner-shortcuts" aria-label="빠른 메뉴"><Shortcut icon="₩" title="정산 내역" detail="정산 정보 미연결" onClick={() => setTab("settlement")} /><Shortcut icon="★" title="고객평가" detail="평점 데이터 미연결" onClick={() => setTab("more")} /><Shortcut icon="◉" title="1:1 문의" detail="운영팀 문의" onClick={() => setTab("more")} /><Shortcut icon="♧" title="공지사항" detail="새 소식 확인" onClick={() => setTab("more")} /></section>
      <div className="partner-security-banner"><span>▣</span><div><strong>고객님의 개인정보는 안전하게 보호됩니다.</strong><small>업무 수행에 필요한 정보만 권한에 따라 제공됩니다.</small></div><span>›</span></div>
    </section>
    <nav className="partner-tabbar" aria-label="하단 메뉴">{([ ["home", "⌂", "홈"], ["jobs", "▤", "내 작업"], ["schedule", "▦", "일정"], ["settlement", "₩", "정산"], ["more", "♙", "더보기"] ] as [Tab, string, string][]).map(([key, icon, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><span>{icon}</span>{label}</button>)}</nav>
    {declining ? <div className="partner-modal-backdrop" role="presentation"><section className="partner-decline-modal" role="dialog" aria-modal="true" aria-labelledby="partner-decline-title"><button className="partner-modal-close" aria-label="닫기" onClick={() => setDeclining(null)}>×</button><h2 id="partner-decline-title">작업 제안 거절</h2><p>{declining.orderId} 제안을 거절하는 사유를 선택해 주세요.</p><label>거절 사유<select value={declineReason} onChange={event => setDeclineReason(event.target.value)}><option value="schedule_unavailable">일정이 맞지 않음</option><option value="outside_service_area">서비스 지역 외</option><option value="staff_unavailable">작업 인원 부족</option><option value="price_unavailable">금액 조건</option><option value="other">기타</option></select></label><div className="partner-modal-actions"><button className="partner-secondary" onClick={() => setDeclining(null)}>취소</button><button className="partner-primary" disabled={busyOfferId === declining.id} onClick={() => void decide(declining, "decline", declineReason)}>거절 확정</button></div></section></div> : null}
    {decliningRework ? <div className="partner-modal-backdrop" role="presentation"><section className="partner-decline-modal" role="dialog" aria-modal="true" aria-labelledby="partner-rework-decline-title"><button className="partner-modal-close" aria-label="닫기" onClick={() => setDecliningRework(null)}>×</button><h2 id="partner-rework-decline-title">재작업 요청 거절</h2><p>{decliningRework.orderId} 요청을 거절하는 이유를 입력해 주세요.</p><label>거절 사유<textarea value={reworkDeclineReason} maxLength={500} onChange={event => setReworkDeclineReason(event.target.value)} required /></label><div className="partner-modal-actions"><button className="partner-secondary" onClick={() => setDecliningRework(null)}>취소</button><button className="partner-primary" disabled={busyReworkId === decliningRework.requestId || reworkDeclineReason.trim().length < 2} onClick={() => void decideRework(decliningRework, "decline", reworkDeclineReason)}>거절 확정</button></div></section></div> : null}
  </main>;
}

function Progress({ offer }: { offer: PartnerOffer }) {
  const steps = ["departed", "arrived", "started", "photos_submitted", "completed"] as const;
  const labels = ["출발", "도착", "작업 시작", "사진 등록", "작업 완료"];
  const current = steps.indexOf(offer.progress as typeof steps[number]);
  return <ol aria-label="작업 진행 단계">{labels.map((label, index) => <li key={label} className={index <= current ? "done" : ""}><span aria-hidden="true">{index <= current ? "✓" : ["▣", "●", "▶", "▧", "✓"][index]}</span><small>{label}</small></li>)}</ol>;
}

function Shortcut({ icon, title, detail, onClick }: { icon: string; title: string; detail: string; onClick: () => void }) {
  return <button className="partner-shortcut" onClick={onClick}><span>{icon}</span><strong>{title}</strong><small>{detail}</small><b>›</b></button>;
}
