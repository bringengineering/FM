import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { companyConnectionEnabled, createCompanySession } from './auth/runtime';
import type { CompanySession } from './auth/session';
import { FieldWorkspace } from './FieldWorkspace';
import type { CustomerSite } from './api/sites';
import type { CompanyRecordingApi } from './api/recording';

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
  SERVER_UNAVAILABLE: '회사 서버 연결을 확인하지 못했습니다. 잠시 후 다시 로그인해 주세요.',
  NETWORK_UNCERTAIN: '네트워크 연결을 확인한 뒤 다시 로그인해 주세요.',
  RATE_LIMITED: '요청이 많습니다. 1분 후 다시 시도해 주세요.',
  RESOURCE_NOT_FOUND: '고객정보가 삭제되거나 보관되었습니다. 목록을 새로 확인해 주세요.',
  SERVER_RESPONSE_INVALID: '서버와 앱의 연결 규격이 맞지 않습니다. 관리자에게 문의해 주세요.',
};
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[styles.button, disabled && { opacity: 0.45 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
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
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>BRING CARE · 현장노트</Text><Text style={styles.title}>내 현장, 내 작업 기록</Text>
    <Text style={styles.copy}>직원 개인 CRM 계정으로 회사에 연결합니다.</Text>
    {session ? <SessionScreen session={session} /> : <View style={styles.card}>
      <Text style={styles.heading}>회사 계정 로그인</Text>
      <Text style={styles.copy}>{failed ? messages.NATIVE_APP_NOT_CONFIGURED : companyConnectionEnabled && Platform.OS !== 'web' ? '회사 연결을 준비하고 있습니다.' : '직원 로그인과 현장 조회는 회사 연결 설정이 포함된 Android·iPhone 개발 앱에서 사용할 수 있습니다.'}</Text>
      {companyConnectionEnabled && Platform.OS !== 'web' && !failed && <ActivityIndicator accessibilityLabel="회사 연결 준비 중" />}
      <Action label="직원 계정으로 로그인" disabled onPress={() => undefined} />
    </View>}
    {!companyConnectionEnabled && <View style={styles.card}><Text style={styles.heading}>기능 미리보기</Text><Text style={styles.copy}>가상 현장에서 촬영·분류·보고서 작성 흐름을 확인하세요.</Text><Action label="개발용 가상 현장 열기" onPress={openSample} /></View>}
    <Text style={styles.small}>개발 0.1.6 · 직원 전용 · 활동사진·보고서 보관</Text>
  </ScrollView></SafeAreaView>;
}
function SessionScreen({ session }: { session: CompanySession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [hidden, setHidden] = useState(AppState.currentState !== 'active');
  const [recording,setRecording]=useState<{uid:string;site:CustomerSite;api:CompanyRecordingApi}>();
  useEffect(()=>{if(state.phase==='signedOut'||state.phase==='error')setRecording(undefined);},[state.phase]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') { setPassword(''); setHidden(true); }
      else { void session.revalidate().finally(() => setHidden(false)); }
    }); return () => listener.remove();
  }, [session]);
  if (hidden&&!recording) return <View style={styles.card}><Text style={styles.copy}>회사 정보를 보호하고 있습니다.</Text></View>;
  if (state.phase === 'loading') return <View style={styles.card}><ActivityIndicator accessibilityLabel="회사 권한·현장 확인 중" /><Text style={styles.copy}>회사 권한과 현장을 확인하고 있습니다.</Text></View>;
  if (state.phase !== 'ready') return <View style={styles.card}>
    <Text style={styles.heading}>회사 계정 로그인</Text>
    {state.error && <Text accessibilityRole="alert" style={styles.error}>{messages[state.error] ?? messages.LOGIN_FAILED}</Text>}
    <Text style={styles.copy}>이메일</Text><TextInput accessibilityLabel="직원 계정 이메일" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" maxLength={254} style={styles.input} />
    <Text style={styles.copy}>비밀번호</Text><TextInput accessibilityLabel="직원 계정 비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" maxLength={1024} style={styles.input} />
    <Action label="로그인" disabled={!email.trim() || !password} onPress={() => { const input = password; setPassword(''); void session.login(email, input); }} />
    <Text style={styles.small}>CRM에서 초대·계정 설정을 완료한 직원만 이용할 수 있습니다.</Text>
  </View>;
  const selected = state.selected;
  return <>
    <View style={styles.card}><Text style={styles.heading}>CRM 고객 현장</Text><Text style={styles.copy}>작업할 고객을 선택하세요. 고객정보에 입력한 건물주소를 불러옵니다.</Text><Action label="목록 새로고침" onPress={() => void session.refresh()} /><Action label="로그아웃" onPress={() => { setEmail(''); setPassword(''); void session.logout().catch(() => undefined); }} /></View>
    {selected ? <View style={styles.card}><Text style={styles.heading}>{selected.name}</Text><Text style={styles.small}>건물주소</Text><Text style={styles.copy}>{selected.address || '주소 미입력'}</Text>{!selected.address && <Text style={styles.copy}>CRM 고객정보에서 건물주소를 입력한 뒤 목록을 새로고침해 주세요.</Text>}<Action label="사진 촬영·보고서 작성" onPress={()=>setRecording({uid:state.context!.actor.uid,site:selected,api:session.recordingApi()})}/><Action label="고객 목록으로" onPress={() => void session.refresh()} /></View> : <>
      {!state.page?.sites.length && <View style={styles.card}><Text style={styles.copy}>이 페이지에 표시할 고객이 없습니다. CRM 고객정보에 등록된 고객을 확인해 주세요.</Text></View>}
      {state.page?.sites.map(site => <View style={styles.card} key={site.id}><Text style={styles.heading}>{site.name}</Text><Text style={styles.copy}>{site.address || '주소 미입력'}</Text><Action label="고객 선택" onPress={() => void session.select(site.id)} /></View>)}
      {state.page?.nextCursor && <Action label="다음 고객 보기" onPress={() => void session.refresh(state.page!.nextCursor)} />}
    </>}
    {recording&&<Modal visible animationType="slide" onRequestClose={()=>undefined}><FieldWorkspace company={recording} onClose={()=>setRecording(undefined)}/></Modal>}
  </>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7fb' }, content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 22, gap: 16 },
  brand: { fontSize: 13, fontWeight: '700', color: '#2367d1', marginTop: 20 }, title: { fontSize: 29, fontWeight: '800', color: '#182334' },
  heading: { fontSize: 19, fontWeight: '700', color: '#182334' }, copy: { fontSize: 15, lineHeight: 23, color: '#435167' }, small: { fontSize: 12, lineHeight: 19, color: '#637086' },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 20, gap: 12, borderWidth: 1, borderColor: '#e0e7f1' },
  input: { borderWidth: 1, borderColor: '#c4cfdf', borderRadius: 10, padding: 13, fontSize: 16, color: '#182334', backgroundColor: '#fff' },
  button: { backgroundColor: '#2367d1', borderRadius: 11, padding: 14, alignItems: 'center' }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' }, error: { color: '#b3293b', lineHeight: 22 },
});
