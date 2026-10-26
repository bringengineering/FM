import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { openVault } from './storage/open-vault';
import { confirmVisit, editVisit, phaseLabel, stateLabel, type ItemStatus, type Job, type Phase, type Photo, type Vault, type Visit, type Workspace } from './domain/model';
import { catalog, reviewIssues } from './domain/report';
import { persistCapture } from './capture';
import { samplePhoto } from './sample-photo';
import { safeMessage } from './errors';
import { CompanyScreen } from './CompanyScreen';

type Screen = 'jobs' | 'capture' | 'photos' | 'report' | 'pdf' | 'send' | 'sync' | 'settings';
const empty: Workspace = { visits: [], photos: [] };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const jobs: Job[] = [
  { id: 'sample-work-a', buildingId: 'sample-building-a', title: '[TEST] 브링 가상 현장 A', address: '개발 검증용 가상 현장 · 실제 주소 아님', kind: 'common', workDate: today() },
  { id: 'sample-work-b', buildingId: 'sample-building-b', title: '[TEST] 브링 가상 현장 B', address: '개발 검증용 입주청소 · 실제 주소 아님', kind: 'moveIn', workDate: today() },
];
function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, disabled && s.disabled, pressed && s.pressed]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[s.chip, active && s.chipActive]}><Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text></Pressable>;
}
function Note({ children }: { children: React.ReactNode }) { return <View style={s.note}><Text style={s.noteText}>{children}</Text></View>; }
function PhotoImage({ vault, photo }: { vault: Vault; photo: Photo }) {
  const [loaded, setLoaded] = useState<{ id: string; uri: string; failed: boolean }>({ id: '', uri: '', failed: false });
  useEffect(() => { let current = true; void vault.readBytes(photo.id).then(bytes => {
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    if (current) setLoaded({ id: photo.id, uri: `data:image/jpeg;base64,${btoa(binary)}`, failed: false });
  }).catch(() => { if (current) setLoaded({ id: photo.id, uri: '', failed: true }); }); return () => { current = false; }; }, [vault, photo.id]);
  if (loaded.id === photo.id && loaded.failed) return <Note>사진을 읽지 못했습니다. 원본을 보존했습니다. 다른 사진을 선택한 뒤 다시 확인해 주세요.</Note>;
  return loaded.id === photo.id && loaded.uri ? <Image source={{ uri: loaded.uri }} style={s.photo} accessibilityLabel={`${photo.caption || '작업사진'} ${phaseLabel[photo.phase]}`} /> : <Note>저장 사진을 확인하는 중입니다.</Note>;
}
export default function App() {
  const [sample, setSample] = useState(false);
  return <SafeAreaProvider>{sample ? <FieldApp /> : <CompanyScreen openSample={() => setSample(true)} />}</SafeAreaProvider>;
}
function FieldApp() {
  const [vault, setVault] = useState<Vault>();
  const [workspace, setWorkspace] = useState<Workspace>(empty);
  const [selected, setSelected] = useState(''); const [screen, setScreen] = useState<Screen>('jobs');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [notice, setNotice] = useState(''); const [problem, setProblem] = useState(false);
  const [area, setArea] = useState('entrance'); const [phase, setPhase] = useState<Phase>('before');
  const [permission, requestPermission] = useCameraPermissions(); const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false); const [foreground, setForeground] = useState(true);
  const [summary, setSummary] = useState(''); const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photoId, setPhotoId] = useState(''); const [caption, setCaption] = useState('');
  const visit = workspace.visits.find(v => v.id === selected);
  const photos = workspace.photos.filter(p => p.visitId === selected);
  const photo = photos.find(p => p.id === photoId);
  const dirty = !!visit && (summary !== visit.draft.summary || followUp !== visit.draft.followUp || JSON.stringify(notes) !== JSON.stringify(visit.draft.notes));
  const captionDirty = screen === 'photos' && !!photo && caption !== photo.caption;
  const issues = visit ? reviewIssues(visit, photos) : [];
  const notify = (message: string, error = false) => { setNotice(message); setProblem(error); };
  async function perform(task: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setNotice('');
    try { await task(); } catch (error) { notify(safeMessage(error), true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function refresh(store = vault) { if (store) { const next = await store.load(); setWorkspace(next); return next; } }
  function navigate(next: Screen) {
    if (busyRef.current || next === screen) return;
    if (dirty || captionDirty) { notify('작성 중인 내용을 저장한 뒤 이동해 주세요.', true); return; }
    setNotice(''); setCameraReady(false); setScreen(next);
  }
  useEffect(() => { const listener = AppState.addEventListener('change', next => {
    setForeground(next === 'active');
    if (next !== 'active') setCameraReady(false);
  }); return () => listener.remove(); }, []);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [screen, selected]);
  useEffect(() => { if (!visit) return; setSummary(visit.draft.summary); setFollowUp(visit.draft.followUp); setNotes(visit.draft.notes); }, [selected, visit?.draft.summary, visit?.draft.followUp, visit?.draft.notes]);
  async function enterDevelopment() {
    const store = await openVault('development-sample');
    try { const loaded = await store.load(); setVault(store); setWorkspace(loaded); setScreen('jobs'); }
    catch (error) { await store.close(); throw error; }
  }
  async function openJob(job: Job) {
    if (!vault) return;
    let target = workspace.visits.find(v => v.job.id === job.id && v.job.workDate === job.workDate);
    if (!target) {
      target = { id: Crypto.randomUUID(), ownerUid: vault.uid, job, revision: 1, updatedAt: new Date().toISOString(), draft: { summary: '', followUp: '', statuses: {}, notes: {} } };
      await vault.saveVisit(target, null); await refresh();
    }
    setSelected(target.id); setArea(catalog(job.kind)[0]?.key ?? 'entrance'); setPhotoId(''); setScreen('capture');
  }
  async function capture(gallery = false) {
    if (!vault || !visit) return;
    if (Platform.OS === 'web') { await persistCapture(vault, visit, samplePhoto(), area, phase); }
    else if (gallery) {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, exif: false, quality: 1 });
      if (result.canceled) return;
      const asset = result.assets[0]; if (!asset) return;
      await persistCapture(vault, visit, asset, area, phase);
    } else {
      if (!cameraReady || !camera.current) return;
      const result = await camera.current.takePictureAsync({ quality: 1, exif: false, shutterSound: true });
      if (!result) return;
      await persistCapture(vault, visit, result, area, phase);
    }
    await refresh(); notify(Platform.OS === 'web' ? '합성 사진을 추가했습니다. 브라우저를 새로고침하면 초기화됩니다.' : '사진을 암호화된 기기 보관함에 저장했습니다.');
  }
  async function saveDraft(patch = {}) {
    if (!visit || !vault) return;
    await vault.saveVisit(editVisit(visit, { summary, followUp, notes, ...patch }, new Date().toISOString()), visit.revision); await refresh(); notify('초안을 저장했습니다.');
  }
  async function updatePhoto(patch: Partial<Photo>) {
    if (!vault || !visit || !photo) return;
    await vault.editPhoto({ ...photo, ...patch }, visit.revision); await refresh(); notify('사진 분류를 저장했습니다. 보고서 검토는 다시 확인해 주세요.');
  }
  function choosePhoto(p: Photo) { if (captionDirty) { notify('사진 설명을 저장한 뒤 다른 사진을 선택해 주세요.', true); return; } setPhotoId(p.id); setCaption(p.caption); }
  const pending = workspace.photos.filter(p => p.state !== 'ready').length;
  const title: Record<Screen, string> = { jobs: '오늘의 현장', capture: '작업사진 촬영', photos: '사진 확인', report: '작업 결과보고서', pdf: '보고서 내용 확인', send: '보고서 발송', sync: '기기 보관함', settings: '설정·연결' };
  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.shell}>
    <View style={s.header}><View><Text style={s.brand}>BRING CARE</Text><Text style={s.headerTitle}>현장노트</Text></View><Pressable accessibilityRole="button" accessibilityLabel="설정 열기" onPress={() => navigate('settings')} style={s.icon}><Text style={s.iconText}>설정</Text></Pressable></View>
    <View style={s.devStrip}><Text style={s.devText}>개발 버전 · 가상 현장 · 고객 발송 없음</Text></View>
    {vault && <Pressable accessibilityRole="button" onPress={() => navigate('sync')} style={s.syncStrip}><Text style={s.syncText}>기기 보관 {workspace.photos.length}장  ·  전송 대기 {pending}장</Text><Text style={s.blue}>확인 →</Text></Pressable>}
    {notice !== '' && <View accessibilityRole="alert" style={[s.toast, problem && s.error]}><Text style={s.toastText}>{notice}</Text></View>}
    {busy && <ActivityIndicator style={s.loading} accessibilityLabel="기기 보관 처리 중" />}
    <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {!vault ? <>
        <Text style={s.eyebrow}>직원 전용 현장 업무</Text><Text style={s.hero}>사진을 찍고,{ '\n' }보고서까지 현장에서.</Text>
        <Text style={s.subtitle}>작업 전후 기록을 한곳에 모으고{ '\n' }고객에게 전달할 내용을 확인하세요.</Text>
        <View style={s.card}><Text style={s.cardTitle}>회사 계정 연결 준비 중</Text><Text style={s.body}>직원별 로그인과 허용 현장 조회는 서버 연결 후 사용할 수 있습니다. 현재 개발 앱에서는 가상 현장으로 촬영·기기 보관·보고서 작성을 확인합니다.</Text>
          <Button label="개발용 가상 현장 열기" onPress={() => void perform(enterDevelopment)} disabled={busy} />
        </View><Note>{Platform.OS === 'web' ? '웹에서는 합성 사진만 추가합니다. 새로고침하면 자료가 초기화됩니다.' : '실제 사진은 SQLCipher가 포함된 개발 앱에서 암호화해 보관합니다. 재실행하면 이어서 작성할 수 있습니다.'}</Note>
      </> : <>
        <View style={s.sectionHead}><View><Text style={s.eyebrow}>{today()} · BRING FIELD</Text><Text style={s.h1}>{title[screen]}</Text></View></View>
        {visit && screen !== 'jobs' && <View style={s.siteBar}><Text style={s.siteTitle}>{visit.job.title}</Text><Text style={s.muted}>{visit.job.address}</Text></View>}
        {screen === 'jobs' && <><Text style={s.subtitle}>현장을 열고 작업 전 사진부터 남겨 주세요.</Text>{jobs.map(job => <View key={job.id} style={s.card}>
          <Text style={s.tag}>{job.kind === 'common' ? '공용부청소' : '입주청소'}</Text><Text style={s.cardTitle}>{job.title}</Text><Text style={s.muted}>{job.address}</Text>
          <Text style={s.body}>보관 사진 {workspace.photos.filter(p => workspace.visits.find(v => v.id === p.visitId)?.job.id === job.id).length}장</Text>
          <Button label={workspace.visits.some(v => v.job.id === job.id) ? '작업 이어하기' : '현장 열기'} onPress={() => void perform(() => openJob(job))} disabled={busy} />
        </View>)}<Note>가상 현장은 CRM에 등록되거나 실제 고객에게 연결되지 않습니다.</Note></>}
        {['capture', 'photos', 'report', 'pdf', 'send'].includes(screen) && !visit && <Note>먼저 현장 탭에서 작업할 현장을 선택해 주세요.</Note>}
        {screen === 'capture' && visit && <>
          <Text style={s.label}>촬영 구역</Text><View style={s.wrap}>{catalog(visit.job.kind).map(item => <Chip key={item.key} label={item.label} active={area === item.key} onPress={() => setArea(item.key)} />)}</View>
          <View style={s.phaseRow}>{(['before', 'during', 'after'] as Phase[]).map(p => <Chip key={p} label={phaseLabel[p]} active={phase === p} onPress={() => setPhase(p)} />)}</View>
          {Platform.OS === 'web' ? <View style={s.cameraPlaceholder}><Text style={s.cameraMark}>＋</Text><Text style={s.cameraText}>브라우저에서는 합성 사진으로 확인합니다</Text><Text style={s.cameraSmall}>실제 카메라는 Android·iPhone 개발 앱에서</Text></View>
            : permission?.granted && foreground ? <CameraView ref={camera} style={s.camera} facing="back" mode="picture" onCameraReady={() => setCameraReady(true)} onMountError={() => { setCameraReady(false); notify('카메라를 열 수 없습니다. 사진 선택으로 이어갈 수 있습니다.', true); }} />
            : <View style={s.card}><Text style={s.body}>작업사진을 촬영하려면 카메라 접근이 필요합니다.</Text><Button label="카메라 권한 허용" onPress={() => void requestPermission()} /></View>}
          <Button label={Platform.OS === 'web' ? '합성 작업사진 추가' : `${phaseLabel[phase]} 촬영`} disabled={busy || (Platform.OS !== 'web' && (!permission?.granted || !cameraReady))} onPress={() => void perform(() => capture())} />
          {Platform.OS !== 'web' && <Button label="사진첩에서 한 장 선택" secondary disabled={busy} onPress={() => void perform(() => capture(true))} />}
          <Button label={`사진 ${photos.length}장 확인`} secondary onPress={() => navigate('photos')} />
          <Note>사진을 찍어도 작업 완료로 처리하지 않습니다. 촬영 후 보고서에서 항목 상태를 확인해 주세요.</Note>
        </>}
        {screen === 'photos' && visit && <>
          {!photos.length && <Note>아직 사진이 없습니다. 촬영 탭에서 사진을 추가해 주세요.</Note>}
          <View style={s.wrap}>{photos.map((p, i) => <Chip key={p.id} label={`${i + 1} · ${phaseLabel[p.phase]}`} active={photoId === p.id} onPress={() => choosePhoto(p)} />)}</View>
          {photo && <View style={s.card}><PhotoImage vault={vault} photo={photo} /><Text style={s.tag}>{stateLabel[photo.state]}</Text>
            <Text style={s.label}>구역</Text><View style={s.wrap}>{catalog(visit.job.kind).map(item => <Chip key={item.key} label={item.label} active={photo.itemKey === item.key} onPress={() => void perform(() => updatePhoto({ itemKey: item.key }))} />)}</View>
            <View style={s.wrap}>{(['before', 'during', 'after'] as Phase[]).map(p => <Chip key={p} label={phaseLabel[p]} active={photo.phase === p} onPress={() => void perform(() => updatePhoto({ phase: p }))} />)}</View>
            <View style={s.between}><Text style={s.label}>보고서에 포함</Text><Switch accessibilityLabel="보고서에 사진 포함" value={photo.included} onValueChange={included => void perform(() => updatePhoto({ included }))} /></View>
            <TextInput accessibilityLabel="사진 설명" editable={!busy} placeholder="고객에게 보여도 되는 사진 설명" value={caption} onChangeText={setCaption} maxLength={120} style={s.input} />
            <Button label="사진 설명 저장" secondary disabled={busy} onPress={() => void perform(() => updatePhoto({ caption }))} />
          </View>}<Button label="촬영 계속하기" secondary onPress={() => navigate('capture')} />
        </>}
        {screen === 'report' && visit && <>
          <Note>작성한 내용은 기기에 보관됩니다. 고객 PDF·Drive 보관은 서버 연결 후 사용할 수 있습니다.</Note>
          <Text style={s.label}>작업 내용</Text><TextInput accessibilityLabel="작업 내용" editable={!busy} multiline maxLength={2000} value={summary} onChangeText={setSummary} style={[s.input, s.textarea]} placeholder="직접 확인한 작업과 결과를 적어 주세요." />
          <Text style={s.label}>후속 조치</Text><TextInput accessibilityLabel="후속 조치" editable={!busy} multiline maxLength={2000} value={followUp} onChangeText={setFollowUp} style={[s.input, s.textareaSmall]} placeholder="추가 작업이나 확인할 내용" />
          <Button label={dirty ? '작성 중인 초안 저장' : '초안 저장'} disabled={busy} onPress={() => void perform(() => saveDraft())} />
          <Text style={s.h2}>작업 항목 확인</Text>{catalog(visit.job.kind).map(item => <View key={item.key} style={s.card}>
            <Text style={s.cardTitle}>{item.label}</Text><Text style={s.muted}>{photos.filter(p => p.itemKey === item.key && p.included).length}장 포함</Text>
            <View style={s.wrap}>{([['recorded', '기록'], ['done', '완료'], ['partial', '일부'], ['skipped', '못 함']] as [ItemStatus, string][]).map(([status, label]) => <Chip key={status} label={label} active={(visit.draft.statuses[item.key] ?? 'recorded') === status} onPress={() => void perform(() => saveDraft({ statuses: { ...visit.draft.statuses, [item.key]: status } }))} />)}</View>
            {visit.draft.statuses[item.key] === 'skipped' && <><TextInput accessibilityLabel={`${item.label} 못 한 이유`} editable={!busy} value={notes[item.key] ?? ''} onChangeText={value => setNotes({ ...notes, [item.key]: value })} maxLength={500} style={s.input} placeholder="작업하지 못한 이유" /><Button secondary label="사유 저장" disabled={busy} onPress={() => void perform(() => saveDraft())} /></>}
          </View>)}
          {issues.length > 0 && <Note>{issues.join('\n')}</Note>}
          <Button label={visit.draft.confirmedRevision === visit.revision ? '내용 검토 완료' : '내용을 검토했습니다'} disabled={busy || dirty || issues.length > 0 || visit.draft.confirmedRevision === visit.revision} onPress={() => void perform(async () => { await vault.saveVisit(confirmVisit(visit), visit.revision); await refresh(); notify('현재 내용 검토를 기록했습니다.'); })} />
          <Button label="보고서 내용 미리보기" secondary disabled={dirty} onPress={() => navigate('pdf')} />
        </>}
        {screen === 'pdf' && visit && <>
          <Note>내용 검토 화면입니다. 발송용 PDF는 아직 생성하지 않았습니다.</Note>
          <View style={s.paper}><Text style={s.brand}>BRING CARE</Text><Text style={s.h1}>작업 결과보고서</Text><Text style={s.paperTag}>TEST · 실제 작업 보고서 아님</Text>
            <Text style={s.cardTitle}>{visit.job.title}</Text><Text style={s.muted}>{visit.job.workDate} · {visit.job.kind === 'common' ? '공용부청소' : '입주청소'}</Text>
            <Text style={s.h2}>작업 내용</Text><Text style={s.body}>{visit.draft.summary || '미기재'}</Text><Text style={s.h2}>후속 조치</Text><Text style={s.body}>{visit.draft.followUp || '미기재'}</Text>
            <Text style={s.h2}>선택 사진</Text><Text style={s.body}>{photos.filter(p => p.included).length}장 · 기기 보관</Text>
            <Text style={s.footerText}>문의 1551-3873</Text></View>
          <Button label="서버 연결 후 PDF 보관 가능" disabled onPress={() => undefined} /><Button label="보고서 편집으로 돌아가기" secondary onPress={() => navigate('report')} />
        </>}
        {screen === 'send' && visit && <><View style={s.card}><Text style={s.cardTitle}>고객에게 보내기 전</Text><Text style={s.body}>사진의 Drive 보관, CRM 연결, 고객용 PDF 저장이 확인되면 관리자가 수신자와 문구를 확인할 수 있습니다.</Text><Text style={s.footerText}>문의 1551-3873</Text></View>
          <Note>현재는 기기 작성 단계입니다. 수신 번호를 입력하거나 실제 발송을 요청하지 않습니다.</Note><Button label="CRM·PDF 연결 대기" disabled onPress={() => undefined} /></>}
        {screen === 'sync' && <><View style={s.metrics}><Text style={s.metric}>{workspace.photos.length}<Text style={s.metricUnit}> 장</Text></Text><Text style={s.body}>{Platform.OS === 'web' ? '브라우저 임시 보관' : '암호화된 기기 보관'}</Text></View>
          <Note>회사 서버가 연결되면 여기에서 업로드를 이어갑니다. 지금은 Drive 업로드 완료로 표시하지 않습니다.</Note>
          {workspace.photos.map((p, i) => <View key={p.id} style={s.row}><View style={s.flex}><Text style={s.rowTitle}>사진 {i + 1} · {phaseLabel[p.phase]}</Text><Text style={s.muted}>{workspace.visits.find(v => v.id === p.visitId)?.job.title}</Text><Text style={s.small}>{stateLabel[p.state]}</Text></View><Text style={s.blue}>{Math.ceil(p.bytes / 1024)} KB</Text></View>)}
        </>}
        {screen === 'settings' && <><View style={s.card}><Text style={s.cardTitle}>개발용 격리 환경</Text><Text style={s.body}>실제 직원 로그인: 연결 준비 중{ '\n' }회사 Drive: 연결 전{ '\n' }CRM 보고서 보관: 연결 전{ '\n' }고객 알림톡: 사용 안 함</Text></View><Note>{Platform.OS === 'web' ? '이 브라우저 검토용 자료는 새로고침하면 초기화됩니다.' : '기기 보관함은 앱을 닫아도 유지됩니다. 앱 삭제 시 기기 자료가 사라질 수 있습니다. 실기기 복구 검증 전에는 실제 현장 자료를 보관하지 마세요.'}</Note>
          <Button label="기기 자료를 유지하고 닫기" secondary disabled={busy} onPress={() => void perform(async () => { await vault.close(); setVault(undefined); setWorkspace(empty); setSelected(''); setSummary(''); setFollowUp(''); setNotes({}); })} />
        </>}
      </>}
    </ScrollView>
    {vault && <View style={s.tabs}>{([['jobs', '현장', '▦'], ['capture', '촬영', '◎'], ['report', '보고서', '▤'], ['send', '발송', '↗']] as [Screen, string, string][]).map(([key, label, icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: screen === key }} onPress={() => navigate(key)} style={s.tab}><Text style={[s.tabIcon, screen === key && s.blue]}>{icon}</Text><Text style={[s.tabText, screen === key && s.blue]}>{label}</Text></Pressable>)}</View>}
  </View></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#edf2f7' }, shell: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center', backgroundColor: '#f7f9fc' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 17, backgroundColor: '#fff' }, brand: { fontSize: 11, letterSpacing: 2, color: '#1f68dc', fontWeight: '800' }, headerTitle: { fontSize: 22, fontWeight: '800', color: '#172b42', marginTop: 4 }, icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#f0f5fc' }, iconText: { fontSize: 13, color: '#416184', fontWeight: '700' },
  devStrip: { backgroundColor: '#edf4ff', paddingHorizontal: 24, paddingVertical: 9 }, devText: { fontSize: 12, color: '#335c92', fontWeight: '600' }, syncStrip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, minHeight: 46, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#e6edf5' }, syncText: { color: '#57718b', fontSize: 12 },
  content: { padding: 24, paddingBottom: 42, gap: 16 }, eyebrow: { fontSize: 11, letterSpacing: 1.3, fontWeight: '700', color: '#64809d' }, hero: { fontSize: 33, lineHeight: 46, letterSpacing: -1, fontWeight: '800', color: '#152c44', marginTop: 20 }, subtitle: { fontSize: 15, lineHeight: 24, color: '#6b7e92' }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, h1: { fontSize: 26, color: '#192e46', fontWeight: '800', marginTop: 8 }, h2: { fontSize: 18, color: '#20354d', fontWeight: '700', marginTop: 12 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: '#e5ecf3' }, cardTitle: { fontSize: 17, fontWeight: '700', color: '#223b55' }, body: { fontSize: 14, lineHeight: 24, color: '#516a82' }, muted: { fontSize: 12, lineHeight: 19, color: '#74869a' }, small: { fontSize: 12, lineHeight: 22, color: '#587693' }, tag: { fontSize: 12, fontWeight: '700', color: '#167466' },
  button: { minHeight: 50, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: '#276ce4', borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, secondary: { backgroundColor: '#edf3fb', borderWidth: 1, borderColor: '#dee8f4' }, buttonText: { fontSize: 14, fontWeight: '700', color: '#fff' }, secondaryText: { color: '#365c87' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 }, note: { borderRadius: 14, backgroundColor: '#eef3f9', padding: 16 }, noteText: { fontSize: 12, lineHeight: 21, color: '#5b738d' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderColor: '#dce6f1', backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center' }, chipActive: { backgroundColor: '#e9f1ff', borderColor: '#5c94ef' }, chipText: { fontSize: 12, color: '#667e94' }, chipTextActive: { color: '#245fb5', fontWeight: '700' }, phaseRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: '#36506b' }, input: { borderWidth: 1, borderColor: '#dbe4ee', borderRadius: 12, padding: 14, fontSize: 14, lineHeight: 22, backgroundColor: '#fff', color: '#263f59', minHeight: 48 }, textarea: { minHeight: 150, textAlignVertical: 'top' }, textareaSmall: { minHeight: 96, textAlignVertical: 'top' },
  siteBar: { padding: 15, backgroundColor: '#eaf0f7', borderRadius: 14, gap: 4 }, siteTitle: { fontSize: 13, fontWeight: '700', color: '#3c5874' }, camera: { height: 300, borderRadius: 18, overflow: 'hidden' }, cameraPlaceholder: { height: 270, backgroundColor: '#1b3249', borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 15 }, cameraMark: { fontSize: 55, color: '#8fb8ea', fontWeight: '200' }, cameraText: { fontSize: 13, color: '#dbe7f5' }, cameraSmall: { fontSize: 11, color: '#8daac7' }, photo: { height: 240, width: '100%', borderRadius: 12, resizeMode: 'contain', backgroundColor: '#e9f0f6' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }, flex: { flex: 1 }, row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#e0e8f0' }, rowTitle: { fontSize: 14, fontWeight: '700', color: '#34506c', marginBottom: 5 }, paper: { backgroundColor: '#fff', padding: 26, borderWidth: 1, borderColor: '#e1e8f0', gap: 12 }, paperTag: { fontSize: 11, color: '#b26b36', backgroundColor: '#fff7e8', padding: 10 }, footerText: { fontSize: 12, color: '#567697', paddingTop: 10, lineHeight: 23 }, metrics: { alignItems: 'center', padding: 22, backgroundColor: '#fff', borderRadius: 18 }, metric: { fontSize: 44, color: '#276ce4', fontWeight: '800' }, metricUnit: { fontSize: 17, fontWeight: '500' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#e0e8f1', paddingTop: 8, paddingBottom: 8 }, tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }, tabIcon: { fontSize: 23, color: '#92a2b3' }, tabText: { fontSize: 11, color: '#8294a7', fontWeight: '700' }, blue: { color: '#276ce4' }, loading: { padding: 5 }, toast: { backgroundColor: '#e7f5ed', padding: 14 }, error: { backgroundColor: '#fff0e8' }, toastText: { fontSize: 13, lineHeight: 21, color: '#294c48' },
});
