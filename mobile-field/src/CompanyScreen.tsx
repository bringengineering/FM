import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { brandStyles, color } from './theme';
import { APP_VERSION } from './app-version';
import { companyConnectionEnabled, createCompanySession } from './auth/runtime';
import type { CompanySession, CompanyState } from './auth/session';
import { FieldWorkspace } from './FieldWorkspace';
import { OwnerNoticeScreen } from './OwnerNoticeScreen';
import { BuildingIcon, NextIcon, NoticeIcon, UserIcon } from './icons';
import { Button, Callout, k, ScreenHeader, SearchBox, Section } from './ui/kit';
import type { CustomerSite } from './api/sites';
import type { CompanyRecordingApi } from './api/recording';

const LOGO = require('../assets/logo-mark.png');
const messages: Record<string, string> = {
  AUTH_REQUIRED: '회사 계정 인증이나 앱 인증을 확인하지 못했습니다. 다시 로그인해 주세요.',
  LOGIN_FAILED: '이메일 또는 비밀번호를 확인해 주세요. PC CRM에서 사용하는 이메일을 입력해 주세요.',
  EMAIL_VERIFICATION_REQUIRED: '이메일 인증이 완료되지 않았습니다. CRM의 계정 설정과 이메일 인증을 완료해 주세요.',
  LOGIN_ACCOUNT_DISABLED: '사용 중지된 계정입니다. 회사 관리자에게 계정 상태 확인을 요청해 주세요.',
  LOGIN_PROVIDER_DISABLED: '회사 서버의 이메일 로그인 설정을 확인해야 합니다. 관리자에게 LOGIN_PROVIDER_DISABLED를 알려 주세요.',
  LOGIN_APP_NOT_AUTHORIZED: '이 Android 설치본의 로그인 등록 설정을 확인해야 합니다. 관리자에게 LOGIN_APP_NOT_AUTHORIZED를 알려 주세요.',
  LOGIN_PROVIDER_ERROR: '인증 서버에서 로그인을 처리하지 못했습니다. 관리자에게 LOGIN_PROVIDER_ERROR를 알려 주세요.',
  APP_ATTESTATION_FAILED: 'Android 기기·앱 인증에 실패했습니다. 관리자에게 APP_ATTESTATION_FAILED를 알려 주세요.',
  NATIVE_APP_NOT_CONFIGURED: '이 설치본의 회사 연결 설정이 준비되지 않았습니다.',
  SERVER_UNAVAILABLE: '회사 서버 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  NETWORK_UNCERTAIN: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 많습니다. 1분 후 다시 시도해 주세요.',
  RESOURCE_NOT_FOUND: '고객정보가 삭제되거나 보관되었습니다. 목록을 새로 확인해 주세요.',
  SERVER_RESPONSE_INVALID: '서버와 앱의 연결 규격이 맞지 않습니다. 관리자에게 문의해 주세요.',
};

/** 로그인 전·준비 중 화면(브랜드 머리글 + 카드). */
function Landing({ children }: { children: React.ReactNode }) {
  return <ScrollView contentContainerStyle={s.landing} keyboardShouldPersistTaps="handled">
    <View style={s.brandRow}><Image source={LOGO} style={s.logo} accessibilityLabel="브링케어" /><Text style={s.brand}>BRING CARE · 현장노트</Text></View>
    <Text style={s.title}>내 현장, 내 작업 기록</Text>
    <Text style={k.text}>직원 개인 CRM 계정으로 회사에 연결합니다.</Text>
    {children}
    <Text style={k.small}>개발 {APP_VERSION} · 직원 전용 · 활동사진·보고서 보관</Text>
  </ScrollView>;
}

export function CompanyScreen({ openSample }: { openSample: () => void }) {
  const [session, setSession] = useState<CompanySession>(); const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!companyConnectionEnabled || Platform.OS === 'web') return;
    let active = true; let created: CompanySession | undefined;
    void createCompanySession().then(value => {
      created = value; if (!active) { value.dispose(); return; } setSession(value); void value.restore();
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; created?.dispose(); };
  }, []);
  return <SafeAreaView style={k.page} edges={['top', 'left', 'right', 'bottom']}>
    {session ? <SessionScreen session={session} /> : <Landing>
      <View style={k.card}>
        <Text style={k.cardTitle}>회사 계정 로그인</Text>
        <Text style={k.text}>{failed ? messages.NATIVE_APP_NOT_CONFIGURED : companyConnectionEnabled && Platform.OS !== 'web' ? '회사 연결을 준비하고 있습니다.' : '직원 로그인과 현장 조회는 회사 연결 설정이 포함된 Android·iPhone 개발 앱에서 사용할 수 있습니다.'}</Text>
        {companyConnectionEnabled && Platform.OS !== 'web' && !failed && <ActivityIndicator accessibilityLabel="회사 연결 준비 중" />}
      </View>
      {!companyConnectionEnabled && <View style={k.card}><Text style={k.cardTitle}>기능 미리보기</Text><Text style={k.text}>가상 현장에서 촬영·분류·보고서 작성 흐름을 확인하세요.</Text><Button label="개발용 가상 현장 열기" onPress={openSample} /></View>}
    </Landing>}
  </SafeAreaView>;
}

type Tab = 'work' | 'notice' | 'me';
type Ready = CompanyState & { phase: 'ready' };

export function SessionScreen({ session }: { session: CompanySession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [hidden, setHidden] = useState(AppState.currentState !== 'active');
  const [recording, setRecording] = useState<{ uid: string; site: CustomerSite; api: CompanyRecordingApi }>();
  const [backRequest, setBackRequest] = useState(0);
  const [tab, setTab] = useState<Tab>('work');
  // 고객 선택·새로고침 동안 세션이 잠깐 'loading'이 되어도 탭 화면을 그대로 두고 위쪽에 진행 표시만 한다.
  const lastReady = useRef<Ready | undefined>(undefined);
  if (state.phase === 'ready') lastReady.current = state as Ready;
  if (state.phase === 'signedOut' || state.phase === 'error') lastReady.current = undefined;
  const view = state.phase === 'ready' ? state as Ready : state.phase === 'loading' ? lastReady.current : undefined;
  const uid = view?.context?.actor.uid ?? '';
  const admin = view?.context?.actor.role === 'admin';
  const api = useMemo(() => uid ? session.recordingApi() : undefined, [session, uid]);

  useEffect(() => { if (state.phase === 'signedOut' || state.phase === 'error') { setRecording(undefined); setTab('work'); } }, [state.phase]);
  useEffect(() => { if (!admin && tab === 'notice') setTab('work'); }, [admin, tab]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') { setPassword(''); setHidden(true); }
      else { void session.revalidate().finally(() => setHidden(false)); }
    }); return () => listener.remove();
  }, [session]);

  if (hidden && !recording) return <Landing><View style={k.card}><Text style={k.text}>회사 정보를 보호하고 있습니다.</Text></View></Landing>;
  if (!view) {
    if (state.phase === 'loading') return <Landing><View style={k.card}><ActivityIndicator accessibilityLabel="회사 권한·현장 확인 중" /><Text style={k.text}>회사 권한과 현장을 확인하고 있습니다.</Text></View></Landing>;
    return <Landing><View style={k.card}>
      <Text style={k.cardTitle}>회사 계정 로그인</Text>
      {state.error && <Callout tone="error" text={messages[state.error] ?? messages.LOGIN_FAILED!} />}
      <Text style={s.label}>이메일</Text><TextInput accessibilityLabel="직원 계정 이메일" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" maxLength={254} style={k.input} />
      <Text style={s.label}>비밀번호</Text><TextInput accessibilityLabel="직원 계정 비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" maxLength={1024} style={k.input} />
      <Button label="로그인" disabled={!email.trim() || !password} onPress={() => { const input = password; setPassword(''); void session.login(email, input); }} />
      <Text style={k.small}>CRM에서 초대·계정 설정을 완료한 직원만 이용할 수 있습니다.</Text>
    </View></Landing>;
  }

  const tabs: [Tab, string, typeof BuildingIcon][] = [['work', '오늘 현장', BuildingIcon], ...(admin ? [['notice', '안내 알림톡', NoticeIcon] as [Tab, string, typeof BuildingIcon]] : []), ['me', '내 정보', UserIcon]];
  return <View style={k.flex}>
    <View style={k.flex}>
      {tab === 'work' && <WorkTab session={session} view={view} busy={state.phase === 'loading'} onOpen={site => api && setRecording({ uid, site, api })} />}
      {tab === 'notice' && admin && api && <OwnerNoticeScreen api={api} />}
      {tab === 'me' && <MeTab admin={admin} busy={state.phase === 'loading'} onRefresh={() => void session.refresh()} onLogout={() => { setEmail(''); setPassword(''); void session.logout().catch(() => undefined); }} />}
    </View>
    <View style={s.tabs}>{tabs.map(([key, name, Icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} accessibilityLabel={name} onPress={() => setTab(key)} style={s.tab}>
      <Icon size={24} strokeWidth={tab === key ? 2.2 : 1.8} color={tab === key ? color.primary : color.subtle} />
      <Text style={[s.tabText, tab === key && s.tabTextOn]}>{name}</Text></Pressable>)}</View>
    {recording && <Modal visible animationType="slide" onRequestClose={() => setBackRequest(value => value + 1)}><FieldWorkspace company={recording} backRequest={backRequest} onClose={() => setRecording(undefined)} /></Modal>}
  </View>;
}

/** 오늘 현장: 고객을 한 번 누르면 바로 촬영·보고서 화면이 열린다. */
function WorkTab({ session, view, busy, onOpen }: { session: CompanySession; view: Ready; busy: boolean; onOpen: (site: CustomerSite) => void }) {
  const [query, setQuery] = useState(''), [result, setResult] = useState<{ sites: CustomerSite[]; incomplete: boolean; nextCursor: string | null }>();
  const [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [pages, setPages] = useState<(string | null)[]>([null]), [searchPages, setSearchPages] = useState<(string | null)[]>([null]);
  const [opening, setOpening] = useState('');
  const lock = useRef(false);

  async function find(cursor: string | null = null, history: (string | null)[] = [null]) {
    if (lock.current || !query.trim()) return; lock.current = true; setSearching(true); setError('');
    try { const found = await session.searchSites(query, cursor); if (session.snapshot().phase === 'ready') { setResult(found); setSearchPages(history); } }
    catch { if (session.snapshot().phase === 'ready') setError('검색하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'); }
    finally { lock.current = false; setSearching(false); }
  }
  async function open(site: CustomerSite) {
    if (busy || opening) return;
    setOpening(site.id); setError('');
    try {
      await session.select(site.id);
      const now = session.snapshot();
      if (now.phase !== 'ready' || now.selected?.id !== site.id) return;
      if (!now.selected.address) { setError(`${now.selected.name}: CRM 고객정보에 건물주소가 없습니다. 주소를 입력한 뒤 목록을 새로고침해 주세요.`); return; }
      onOpen(now.selected);
    } finally { setOpening(''); }
  }
  function refresh(cursor: string | null, next: (string | null)[]) { void session.refresh(cursor).then(ok => { if (ok) setPages(next); }); }

  const sites = result?.sites ?? view.page?.sites ?? [];
  return <View style={k.flex}>
    <ScreenHeader title="오늘 현장" sub="고객을 누르면 바로 촬영을 시작합니다" right={busy || searching ? <ActivityIndicator accessibilityLabel="불러오는 중" /> : undefined} />
    <ScrollView contentContainerStyle={k.body} keyboardShouldPersistTaps="handled">
      <SearchBox value={query} editable={!searching} placeholder="고객명 또는 건물주소" onSubmit={() => void find()}
        onChange={value => { setQuery(value); setResult(undefined); setError(''); }} />
      {!!query.trim() && !result && <Button kind="secondary" label={searching ? '검색 중…' : `'${query.trim()}' 전체 고객에서 찾기`} disabled={searching} onPress={() => void find()} />}
      {!!(view.error || error) && <Callout tone="error" text={error || messages[view.error!] || messages.SERVER_UNAVAILABLE!} />}
      {result && <Text style={k.small}>검색 결과 {result.sites.length}명{result.incomplete ? ' · 아래에서 다음 범위를 더 찾을 수 있습니다' : ''}</Text>}
      {!!sites.length && <><Section title={result ? '검색 결과' : '고객'} /><View style={k.group}>{sites.map(site => <Pressable key={site.id} accessibilityRole="button" accessibilityLabel={`${site.name} 촬영 시작`}
        disabled={busy || !!opening} onPress={() => void open(site)} style={({ pressed }) => [k.row, pressed && k.rowPressed]}>
        <View style={k.rowIcon}><BuildingIcon size={20} color={color.primary} /></View>
        <View style={k.flex}><Text style={k.rowTitle} numberOfLines={1}>{site.name}</Text><Text style={[k.rowSub, !site.address && s.missing]} numberOfLines={1}>{site.address || '주소 미입력'}</Text></View>
        {opening === site.id ? <ActivityIndicator /> : <NextIcon size={20} color={color.subtle} />}</Pressable>)}</View></>}
      {!sites.length && <Text style={k.empty}>{result ? (result.incomplete ? '이 범위에는 일치하는 고객이 없습니다. 다음 범위를 찾아 주세요.' : '일치하는 고객이 없습니다. 이름이나 주소를 다시 확인해 주세요.') : '표시할 고객이 없습니다. CRM 고객정보에 등록된 고객을 확인해 주세요.'}</Text>}
      <View style={s.pager}>
        {result ? <>
          {searchPages.length > 1 && <View style={k.flex}><Button kind="secondary" label="이전 범위" disabled={searching} onPress={() => { const prev = searchPages.slice(0, -1); void find(prev[prev.length - 1] ?? null, prev); }} /></View>}
          {result.nextCursor && <View style={k.flex}><Button kind="secondary" label="다음 범위 찾기" disabled={searching} onPress={() => void find(result.nextCursor, [...searchPages, result.nextCursor])} /></View>}
        </> : <>
          {pages.length > 1 && <View style={k.flex}><Button kind="secondary" label="이전 고객" disabled={busy} onPress={() => { const prev = pages.slice(0, -1); refresh(prev[prev.length - 1] ?? null, prev); }} /></View>}
          {view.page?.nextCursor && <View style={k.flex}><Button kind="secondary" label="다음 고객" disabled={busy} onPress={() => refresh(view.page!.nextCursor!, [...pages, view.page!.nextCursor!])} /></View>}
        </>}
      </View>
    </ScrollView>
  </View>;
}

function MeTab({ admin, busy, onRefresh, onLogout }: { admin: boolean; busy: boolean; onRefresh: () => void; onLogout: () => void }) {
  return <View style={k.flex}>
    <ScreenHeader title="내 정보" />
    <ScrollView contentContainerStyle={k.body}>
      <View style={k.card}><Text style={k.cardTitle}>로그인한 직원 계정</Text><Text style={k.text}>{admin ? '관리자 · 건물주 안내 알림톡을 보낼 수 있습니다' : '직원 · 현장 촬영과 보고서를 작성할 수 있습니다'}</Text></View>
      <View style={k.group}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onRefresh} style={({ pressed }) => [k.row, pressed && k.rowPressed]}>
          <Text style={[k.text, k.flex]}>고객 목록 새로고침</Text>{busy ? <ActivityIndicator /> : <NextIcon size={20} color={color.subtle} />}</Pressable>
        <View style={k.row}><Text style={[k.text, k.flex]}>앱 버전</Text><Text style={k.small}>{APP_VERSION}</Text></View>
        <Pressable accessibilityRole="button" onPress={onLogout} style={({ pressed }) => [k.row, pressed && k.rowPressed]}><Text style={[s.logout, k.flex]}>로그아웃</Text></Pressable>
      </View>
    </ScrollView>
  </View>;
}

const s = brandStyles({
  landing: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 22, gap: 16 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }, logo: { width: 48, height: 22, resizeMode: 'contain' },
  brand: { fontSize: 13, fontWeight: '700', color: color.primary }, title: { fontSize: 29, fontWeight: '800', color: color.ink },
  label: { fontSize: 14, fontWeight: '600', color: color.text },
  missing: { color: color.warning },
  pager: { flexDirection: 'row', gap: 10 },
  logout: { fontSize: 15, fontWeight: '600', color: color.danger },
  tabs: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line, paddingVertical: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 54 },
  tabText: { fontSize: 11, fontWeight: '600', color: color.subtle }, tabTextOn: { color: color.primary, fontWeight: '700' },
});
