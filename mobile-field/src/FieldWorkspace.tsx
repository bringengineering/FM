import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { openVault } from './storage/open-vault';
import { confirmVisit, editVisit, phaseLabel, stateLabel, type ItemStatus, type Job, type Phase, type Photo, type Vault, type Visit, type Workspace } from './domain/model';
import { catalog, reviewIssues } from './domain/report';
import { persistCapture } from './capture';
import { aiDraftState,reportFacts } from './domain/ai-report';
import { saveGroupedReport } from './domain/save-report';
import { areaPhotoCount,captureProgress,changeCaptureAreas,firstUncapturedArea,initialCaptureAreas,nextUncapturedArea } from './domain/capture-guide';
import { samplePhoto } from './sample-photo';
import { safeMessage } from './errors';
import { SyncRunner } from './domain/sync';
import { FieldError } from './domain/model';
import type { CustomerSite } from './api/sites';
import type { ArchiveReceipt, CompanyRecordingApi, DeliveryPreview } from './api/recording';

type Screen = 'jobs' | 'capture-setup' | 'capture' | 'photos' | 'report' | 'pdf' | 'send' | 'sync' | 'settings';
const empty: Workspace = { visits: [], photos: [] };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const sampleJobs: Job[] = [
  { id: 'sample-work-a', buildingId: 'sample-building-a', title: '[TEST] 브링 가상 현장 A', address: '개발 검증용 가상 현장 · 실제 주소 아님', kind: 'common', workDate: today() },
  { id: 'sample-work-b', buildingId: 'sample-building-b', title: '[TEST] 브링 가상 현장 B', address: '개발 검증용 입주청소 · 실제 주소 아님', kind: 'moveIn', workDate: today() },
];
function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, disabled && s.disabled, pressed && s.pressed]}><Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}
function Chip({ label, active, onPress, disabled=false }: { label: string; active: boolean; onPress: () => void; disabled?:boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active,disabled }} disabled={disabled} onPress={onPress} style={[s.chip, active && s.chipActive,disabled&&s.disabled]}><Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text></Pressable>;
}
function Note({ children }: { children: React.ReactNode }) { return <View style={s.note}><Text style={s.noteText}>{children}</Text></View>; }
function PhotoImage({ vault, photo, compact=false }: { vault: Vault; photo: Photo; compact?:boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; uri: string; failed: boolean }>({ id: '', uri: '', failed: false });
  useEffect(() => { let current = true; void vault.readBytes(photo.id).then(bytes => {
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    if (current) setLoaded({ id: photo.id, uri: `data:image/jpeg;base64,${btoa(binary)}`, failed: false });
  }).catch(() => { if (current) setLoaded({ id: photo.id, uri: '', failed: true }); }); return () => { current = false; }; }, [vault, photo.id]);
  if (loaded.id === photo.id && loaded.failed) return <Note>사진을 읽지 못했습니다. 원본을 보존했습니다. 다른 사진을 선택한 뒤 다시 확인해 주세요.</Note>;
  return loaded.id === photo.id && loaded.uri ? <Image source={{ uri: loaded.uri }} style={[s.photo,compact&&s.referencePhoto]} accessibilityLabel={`${photo.caption || '작업사진'} ${phaseLabel[photo.phase]}`} /> : <Note>저장 사진을 확인하는 중입니다.</Note>;
}
export function FieldWorkspace({company,onClose}:{company?:{uid:string;site:CustomerSite;api:CompanyRecordingApi};onClose?:()=>void}) {
  const jobs:Job[]=company?(['common','moveIn'] as const).map(kind=>({id:`${company.site.id}_${kind}`,customerId:company.site.id,buildingId:'',title:company.site.name,address:company.site.address,kind,workDate:today()})):sampleJobs;
  const controller=useRef(new AbortController()),runner=useRef<SyncRunner|undefined>(undefined);
  const [receipt,setReceipt]=useState<ArchiveReceipt>();
  const [delivery,setDelivery]=useState<DeliveryPreview>();
  const [vault, setVault] = useState<Vault>();
  const [workspace, setWorkspace] = useState<Workspace>(empty);
  const [selected, setSelected] = useState(''); const [screen, setScreen] = useState<Screen>('jobs');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [notice, setNotice] = useState(''); const [problem, setProblem] = useState(false);
  const [area, setArea] = useState('entrance'); const [phase, setPhase] = useState<Phase>('before');
  const [plannedAreas,setPlannedAreas]=useState<string[]>([]),[lastArea,setLastArea]=useState('');
  const [permission, requestPermission] = useCameraPermissions(); const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false); const [foreground, setForeground] = useState(true);
  const [summary, setSummary] = useState(''); const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photoId, setPhotoId] = useState(''); const [caption, setCaption] = useState('');
  const visit = workspace.visits.find(v => v.id === selected);
  const photos = workspace.photos.filter(p => p.visitId === selected);
  const photo = photos.find(p => p.id === photoId);
  const areas=visit?.captureAreas||[];
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
    setNotice(''); setCameraReady(false);
    if(next==='capture'&&visit&&!visit.captureAreas?.length){setPlannedAreas(initialCaptureAreas(visit,photos));setScreen('capture-setup');return;}
    setScreen(next);
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
    } else if (!target.job.address && job.address) {
      const previous=target.revision;
      target={...target,job:{...target.job,address:job.address},revision:previous+1,updatedAt:new Date().toISOString(),draft:{...target.draft,confirmedRevision:undefined}};
      await vault.saveVisit(target,previous);await refresh();
    }
    const oldPhotos=workspace.photos.filter(p=>p.visitId===target!.id),plan=initialCaptureAreas(target,oldPhotos);
    setReceipt(undefined);setDelivery(undefined);setSelected(target.id);setPlannedAreas(plan);setPhase('before');setLastArea('');setArea(firstUncapturedArea(plan,oldPhotos,'before'));setPhotoId('');setScreen(target.captureAreas?.length?'capture':'capture-setup');
  }
  async function saveCaptureAreas(){
    if(!visit||!vault)return;
    const ordered=catalog(visit.job.kind).map(item=>item.key).filter(key=>plannedAreas.includes(key));
    if(!ordered.length)throw new FieldError('CAPTURE_AREAS_INVALID');
    if(JSON.stringify(ordered)!==JSON.stringify(visit.captureAreas)){
      const next=changeCaptureAreas(visit,photos,ordered,new Date().toISOString());await vault.saveVisit(next,visit.revision);await refresh();
    }
    setPhase('before');setLastArea('');setArea(firstUncapturedArea(ordered,photos,'before'));setScreen('capture');
  }
  function switchPhase(next:Phase){setPhase(next);setLastArea('');setArea(firstUncapturedArea(areas,photos,next));setNotice('');}
  useEffect(()=>{
    if(!company)return;
    controller.current=new AbortController();
    let active=true,opened:Vault|undefined;
    void perform(async()=>{await company.api.recordingContext(controller.current.signal);opened=await openVault(company.uid);const loaded=await opened.load();if(!active){await opened.close();return;}setVault(opened);setWorkspace(loaded);setScreen('jobs');});
    return()=>{active=false;controller.current.abort();runner.current?.stop();void opened?.close();};
  },[company?.uid]);
  async function syncCurrent(current=visit, currentPhotos=photos, draftSaved=false){
    if(!company||!vault||!current||!vault.linkRevision)throw new FieldError('SERVER_UNAVAILABLE');
    if((dirty&&!draftSaved)||captionDirty)throw new FieldError('UNSAVED_CHANGES');
    await company.api.storageStatus(controller.current.signal);
    const linked=await company.api.reconcile(current,currentPhotos,controller.current.signal);
    await vault.linkRevision(current.id,linked.revision,linked.photoIds);
    runner.current?.stop();runner.current=new SyncRunner(vault,company.api,current.id);await runner.current.run();
    const latest=await refresh();const failed=latest?.photos.find(p=>p.visitId===current.id&&p.state!=='ready');
    if(failed)throw new FieldError(failed.errorCode||'PHOTOS_NOT_READY');
    notify('현재 작업의 사진을 Drive 활동사진에 보관했습니다.');
  }
  async function archiveCurrent(){
    if(!company||!visit||dirty||captionDirty)return;
    if(visit.draft.confirmedRevision!==visit.revision)throw new FieldError('REPORT_REVIEW_REQUIRED');
    await syncCurrent();const result=await company.api.archive(visit,controller.current.signal);setReceipt(result);notify('작업 결과보고서 PDF를 Drive 문서함과 CRM에 보관했습니다.');
  }
  async function savePhotosAndReport(){
    if(!company||!vault||!visit)return;
    if(captionDirty)throw new FieldError('UNSAVED_CHANGES');
    const result=await saveGroupedReport({vault,visit,photos,summary,followUp,notes,onLocalSave:async()=>{await refresh();},
      sync:(current,currentPhotos)=>syncCurrent(current,currentPhotos,true),archive:current=>company.api.archive(current,controller.current.signal)});
    if(!result.ok){notify(result.issues.join('\n'),true);return;}
    setReceipt(result.receipt);setDelivery(undefined);setScreen('pdf');notify('구역별 사진과 작업 결과보고서 PDF를 Drive와 CRM에 보관했습니다.');
  }
  async function checkDelivery(){
    if(!company||!visit||!receipt||receipt.revision!==visit.revision||dirty||captionDirty)throw new FieldError('REPORT_REVIEW_REQUIRED');
    const value=await company.api.deliveryStatus(receipt.documentId,controller.current.signal);setDelivery(value);
  }
  function confirmDelivery(){
    if(!delivery||!company||!visit||!receipt||receipt.revision!==visit.revision||dirty||captionDirty)return;
    Alert.alert('고객에게 보고서 발송',`${delivery.customer}\n${delivery.address} · ${delivery.workName}\n수신 ${delivery.recipient}\n\n저장된 작업 결과보고서를 카카오 알림톡으로 보내시겠습니까?`,[
      {text:'취소',style:'cancel'}, {text:'발송',onPress:()=>{void perform(async()=>{
        setDelivery({...delivery,status:'sending'});
        try{const result=await company.api.sendReport(delivery,controller.current.signal);setDelivery(result);notify(result.status==='delivered'?'고객에게 전달됐습니다.':'발송을 요청했습니다. 전달 상태를 확인해 주세요.');}
        catch(error){setDelivery({...delivery,status:'unknown'});throw error instanceof FieldError && error.code!=='NETWORK_UNCERTAIN'?error:new FieldError('DELIVERY_STATUS_UNKNOWN');}
      });}},
    ]);
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
    const updated=await refresh();setLastArea(area);
    const next=nextUncapturedArea(areas,updated?.photos.filter(p=>p.visitId===visit.id)||photos,phase,area);
    if(next)setArea(next);
    notify(Platform.OS === 'web' ? '합성 사진을 추가했습니다. 브라우저를 새로고침하면 초기화됩니다.' : next?'사진을 저장하고 다음 구역으로 이동했습니다.':'사진을 기기에 저장했습니다.');
  }
  async function saveDraft(patch = {}) {
    if (!visit || !vault) return;
    await vault.saveVisit(editVisit(visit, { summary, followUp, notes, ...patch }, new Date().toISOString()), visit.revision); await refresh(); notify('초안을 저장했습니다.');
  }
  async function generateAiDraft(){
    if(!company||!visit||!vault)return;
    const state=aiDraftState(visit,photos);
    if(dirty||captionDirty||(summary.trim()&&state!=='stale'))throw new FieldError('UNSAVED_CHANGES');
    const facts=JSON.stringify(reportFacts(visit,photos));
    const text=await company.api.aiReport(visit,photos,controller.current.signal);
    await vault.saveVisit({...editVisit(visit,{summary:text},new Date().toISOString()),aiDraft:{summary:text,facts}},visit.revision);
    await refresh();notify('AI 초안을 만들었습니다. 사진은 AI에 전송되지 않았습니다. 내용을 확인하고 수정해 주세요.');
  }
  async function finishCapture(){
    if(dirty||captionDirty)throw new FieldError('UNSAVED_CHANGES');
    setCameraReady(false);setScreen('report');
    if(company&&visit&&(!visit.draft.summary.trim()||aiDraftState(visit,photos)==='stale'))await generateAiDraft();
  }
  async function updatePhoto(patch: Partial<Photo>) {
    if (!vault || !visit || !photo) return;
    await vault.editPhoto({ ...photo, ...patch }, visit.revision); await refresh(); notify('사진 분류를 저장했습니다. 보고서 검토는 다시 확인해 주세요.');
  }
  function choosePhoto(p: Photo) { if (captionDirty) { notify('사진 설명을 저장한 뒤 다른 사진을 선택해 주세요.', true); return; } setPhotoId(p.id); setCaption(p.caption); }
  const pending = workspace.photos.filter(p => p.state !== 'ready').length;
  const title: Record<Screen, string> = { jobs: '오늘의 현장', 'capture-setup':'촬영할 구역 선택', capture: '작업사진 촬영', photos: '사진 확인', report: '작업 결과보고서', pdf: '보고서 내용 확인', send: '보고서 발송', sync: '기기 보관함', settings: '설정·연결' };
  if(company&&!foreground)return <SafeAreaView style={s.safe}><Note>회사 정보를 보호하고 있습니다.</Note></SafeAreaView>;
  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.shell}>
    {screen!=='capture'&&<><View style={s.header}><View><Text style={s.brand}>BRING CARE</Text><Text style={s.headerTitle}>현장노트</Text></View><Pressable accessibilityRole="button" accessibilityLabel="설정 열기" onPress={() => navigate('settings')} style={s.icon}><Text style={s.iconText}>설정</Text></Pressable></View>
    <View style={s.devStrip}><Text style={s.devText}>{company?'회사 연결 · 고객주소 기준 · 개발 0.1.10':'개발 버전 · 가상 현장 · 고객 발송 없음'}</Text>{onClose&&<Button label="고객 목록으로" secondary disabled={busy} onPress={()=>{if(dirty||captionDirty){notify('작성 중인 내용을 저장한 뒤 이동해 주세요.',true);return;}onClose();}}/>}</View>
    {vault && <Pressable accessibilityRole="button" onPress={() => navigate('sync')} style={s.syncStrip}><Text style={s.syncText}>기기 보관 {workspace.photos.length}장  ·  전송 대기 {pending}장</Text><Text style={s.blue}>확인 →</Text></Pressable>}</>}
    {screen==='capture'&&visit&&<View style={s.captureHeader}><Text style={s.captureSite} numberOfLines={1}>{visit.job.title}</Text><Text style={s.captureSiteSmall}>구역별 사진 촬영</Text></View>}
    {notice !== '' && <View accessibilityRole="alert" style={[s.toast, problem && s.error]}><Text style={s.toastText}>{notice}</Text></View>}
    {busy && <ActivityIndicator style={s.loading} accessibilityLabel="기기 보관 처리 중" />}
    <ScrollView ref={scroll} contentContainerStyle={[s.content,screen==='capture'&&s.captureContent]} keyboardShouldPersistTaps="handled">
      {!vault && company ? <Note>고객 작업 보관함을 준비하고 있습니다. 오류가 표시되면 고객 목록으로 돌아가 다시 열어 주세요.</Note> : !vault ? <>
        <Text style={s.eyebrow}>직원 전용 현장 업무</Text><Text style={s.hero}>사진을 찍고,{ '\n' }보고서까지 현장에서.</Text>
        <Text style={s.subtitle}>작업 전후 기록을 한곳에 모으고{ '\n' }고객에게 전달할 내용을 확인하세요.</Text>
        <View style={s.card}><Text style={s.cardTitle}>회사 계정 연결 준비 중</Text><Text style={s.body}>직원별 로그인과 허용 현장 조회는 서버 연결 후 사용할 수 있습니다. 현재 개발 앱에서는 가상 현장으로 촬영·기기 보관·보고서 작성을 확인합니다.</Text>
          <Button label="개발용 가상 현장 열기" onPress={() => void perform(enterDevelopment)} disabled={busy} />
        </View><Note>{Platform.OS === 'web' ? '웹에서는 합성 사진만 추가합니다. 새로고침하면 자료가 초기화됩니다.' : '실제 사진은 SQLCipher가 포함된 개발 앱에서 암호화해 보관합니다. 재실행하면 이어서 작성할 수 있습니다.'}</Note>
      </> : <>
        {screen!=='capture'&&<View style={s.sectionHead}><View><Text style={s.eyebrow}>{today()} · BRING FIELD</Text><Text style={s.h1}>{title[screen]}</Text></View></View>}
        {visit && screen !== 'jobs' && screen!=='capture' && <View style={s.siteBar}><Text style={s.siteTitle}>{visit.job.title}</Text><Text style={s.muted}>{visit.job.address}</Text></View>}
        {screen === 'jobs' && <><Text style={s.subtitle}>현장을 열고 작업 전 사진부터 남겨 주세요.</Text>{jobs.map(job => <View key={job.id} style={s.card}>
          <Text style={s.tag}>{job.kind === 'common' ? '공용부청소' : '입주청소'}</Text><Text style={s.cardTitle}>{job.title}</Text><Text style={s.muted}>{job.address}</Text>
          <Text style={s.body}>보관 사진 {workspace.photos.filter(p => workspace.visits.find(v => v.id === p.visitId)?.job.id === job.id).length}장</Text>
          <Button label={workspace.visits.some(v => v.job.id === job.id) ? '작업 이어하기' : '현장 열기'} onPress={() => void perform(() => openJob(job))} disabled={busy} />
        </View>)}{company&&workspace.visits.filter(v=>v.job.customerId===company.site.id&&v.job.workDate!==today()).map(v=><View key={v.id} style={s.card}><Text style={s.cardTitle}>{v.job.workDate} · {v.job.kind==='common'?'공용부청소':'입주청소'}</Text><Button label="이전 작업 이어하기" disabled={busy} onPress={()=>{setSelected(v.id);setScreen('report');setReceipt(undefined);}}/></View>)}{!company&&<Note>가상 현장은 CRM에 등록되거나 실제 고객에게 연결되지 않습니다.</Note>}</>}
        {['capture-setup', 'capture', 'photos', 'report', 'pdf', 'send'].includes(screen) && !visit && <Note>먼저 현장 탭에서 작업할 현장을 선택해 주세요.</Note>}
        {screen === 'capture-setup' && visit && <>
          <Text style={s.subtitle}>이 현장에서 촬영할 구역을 골라 주세요. 선택한 구역을 차례대로 작업 전과 후에 각각 촬영합니다.</Text>
          <View style={s.card}><Text style={s.cardTitle}>촬영 구역 · {plannedAreas.length}곳</Text>
            <View style={s.wrap}>{catalog(visit.job.kind).map(item=><Chip key={item.key} label={`${item.label}${photos.some(p=>p.itemKey===item.key)?' · 사진 있음':''}`} active={plannedAreas.includes(item.key)} disabled={busy} onPress={()=>{
              if(plannedAreas.includes(item.key)&&photos.some(p=>p.itemKey===item.key)){notify('사진이 있는 구역은 촬영 목록에 남겨 둡니다.',true);return;}
              setNotice('');setPlannedAreas(current=>current.includes(item.key)?current.filter(key=>key!==item.key):[...current,item.key]);
            }}/>)}</View>
          </View>
          <Note>현장에 없는 구역은 선택 해제할 수 있습니다. 한 구역에서 여러 장을 찍을 수도 있습니다.</Note>
          <Button label="작업 전 촬영 시작" disabled={busy||!plannedAreas.length} onPress={()=>void perform(saveCaptureAreas)} />
          {visit.captureAreas?.length&&<Button label="촬영 화면으로 돌아가기" secondary disabled={busy} onPress={()=>setScreen('capture')} />}
        </>}
        {screen === 'capture' && visit && <>
          <View style={s.wrap}>{(['before','after','during'] as Phase[]).map(p=>{
            const progress=captureProgress(areas,photos,p);return <Chip key={p} label={`${phaseLabel[p]} ${progress.done}/${progress.total}`} active={phase===p} disabled={busy} onPress={()=>switchPhase(p)}/>;
          })}</View>
          <View style={s.guideCard}><Text style={s.guideStep}>{phaseLabel[phase]} · {Math.max(areas.indexOf(area)+1,1)} / {areas.length} 구역</Text>
            <Text style={s.guideTitle}>{catalog(visit.job.kind).find(item=>item.key===area)?.label || '촬영 구역'}</Text>
            <Text style={s.guideDetail}>{catalog(visit.job.kind).find(item=>item.key===area)?.detail}</Text>
            <Text style={s.guideDetail}>이 구역 {phaseLabel[phase]} 사진 {areaPhotoCount(photos,area,phase)}장</Text>
          </View>
          <View style={s.cameraFrame}>{Platform.OS === 'web' ? <View style={s.cameraPlaceholder}><Text style={s.cameraMark}>＋</Text><Text style={s.cameraText}>브라우저에서는 합성 사진으로 확인합니다</Text><Text style={s.cameraSmall}>실제 카메라는 Android·iPhone 개발 앱에서</Text></View>
            : permission?.granted && foreground ? <CameraView ref={camera} style={s.camera} facing="back" mode="picture" onCameraReady={() => setCameraReady(true)} onMountError={() => { setCameraReady(false); notify('카메라를 열 수 없습니다. 사진 선택으로 이어갈 수 있습니다.', true); }} />
            : <View style={s.card}><Text style={s.body}>작업사진을 촬영하려면 카메라 접근이 필요합니다.</Text><Button label="카메라 권한 허용" onPress={() => void requestPermission()} /></View>}
            {phase==='after'&&photos.find(p=>p.itemKey===area&&p.phase==='before')&&<View style={s.referenceOverlay} pointerEvents="none"><Text style={s.referenceLabel}>작업 전</Text><PhotoImage vault={vault} photo={photos.find(p=>p.itemKey===area&&p.phase==='before')!} compact/></View>}
          </View>
          <Button label={Platform.OS === 'web' ? '합성 작업사진 추가' : `${phaseLabel[phase]} 촬영`} disabled={busy || (Platform.OS !== 'web' && (!permission?.granted || !cameraReady))} onPress={() => void perform(() => capture())} />
          {lastArea&&lastArea!==area&&<Button label={`${catalog(visit.job.kind).find(item=>item.key===lastArea)?.label || '직전 구역'} 추가 촬영`} secondary disabled={busy} onPress={()=>{setArea(lastArea);setLastArea('');}} />}
          <View style={s.wrap}>{areas.map((key,index)=><Chip key={key} label={`${index+1}. ${catalog(visit.job.kind).find(item=>item.key===key)?.label || key} · ${areaPhotoCount(photos,key,phase)}장`} active={area===key} disabled={busy} onPress={()=>{setArea(key);setLastArea('');}} />)}</View>
          <Note>사진을 찍으면 다음 미촬영 구역으로 이동합니다. 구역을 다시 선택하면 여러 장을 찍을 수 있습니다. 미촬영 구역은 그대로 표시됩니다.</Note>
          {phase==='after'&&!photos.some(p=>p.itemKey===area&&p.phase==='before')&&<Note>이 구역의 작업 전 사진이 없습니다.</Note>}
          {phase==='before'&&<Button label="작업 후 촬영 시작" secondary disabled={busy} onPress={()=>switchPhase('after')} />}
          <Button label="촬영 구역 변경" secondary disabled={busy} onPress={()=>{setPlannedAreas(initialCaptureAreas(visit,photos));setCameraReady(false);setScreen('capture-setup');}} />
          {Platform.OS !== 'web' && <Button label="사진첩에서 한 장 선택" secondary disabled={busy} onPress={() => void perform(() => capture(true))} />}
          <Button label={`사진 ${photos.length}장 확인`} secondary onPress={() => navigate('photos')} />
          <Button label={company?'촬영 완료 · AI 보고서 작성':'촬영 완료 · 보고서 작성'} secondary disabled={!photos.length||busy} onPress={()=>void perform(finishCapture)} />
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
          <Note>{company?'초안을 저장하고 내용을 검토한 뒤, PDF를 Drive와 CRM에 보관하세요.':'작성한 내용은 기기에 보관됩니다. 고객 PDF·Drive 보관은 서버 연결 후 사용할 수 있습니다.'}</Note>
          {areas.length>0&&<Note>촬영 현황 · 작업 전 {captureProgress(areas,photos,'before').done}/{areas.length}구역 · 작업 후 {captureProgress(areas,photos,'after').done}/{areas.length}구역. 미촬영 구역은 사진이 없는 상태로 보고서에 남습니다.</Note>}
          <Text style={s.h2}>이번 작업 요약</Text><Text style={s.label}>작업 내용</Text><TextInput accessibilityLabel="작업 내용" editable={!busy} multiline maxLength={2000} value={summary} onChangeText={setSummary} style={[s.input, s.textarea]} placeholder="직접 확인한 작업과 결과를 적어 주세요." />
          {company&&<><Note>AI는 촬영 구역과 사진 수만 이용합니다. 사진과 고객 정보는 AI에 보내지 않습니다. 초안의 실제 작업 내용을 확인하고 필요한 내용을 수정해 주세요.</Note>{['stale','edited_stale'].includes(aiDraftState(visit,photos))&&<Note>사진 구역 또는 사진 수가 바뀌었습니다. 작성한 내용을 확인해 주세요.</Note>}{(!summary.trim()||aiDraftState(visit,photos)==='stale')&&<Button label={summary.trim()?'AI 초안 다시 만들기':'AI 보고서 초안 만들기'} secondary disabled={busy||dirty||!photos.length} onPress={()=>void perform(generateAiDraft)} />}</>}
          <View style={s.card}><Text style={s.cardTitle}>작업 정보</Text><Text style={s.body}>작업일 · {visit.job.workDate}{'\n'}작업 종류 · {visit.job.kind==='common'?'공용부청소':'입주청소'}{'\n'}현장 주소 · {visit.job.address || '주소 미기재'}</Text></View>
          <View style={s.card}><Text style={s.cardTitle}>사진 기록 요약</Text><Text style={s.body}>작업 구역 · {areas.length}곳{'\n'}작업 전 · {photos.filter(p=>p.included&&p.phase==='before').length}장　 작업 중 · {photos.filter(p=>p.included&&p.phase==='during').length}장　 작업 후 · {photos.filter(p=>p.included&&p.phase==='after').length}장</Text></View>
          <Text style={s.h2}>구역별 작업 기록</Text>{catalog(visit.job.kind).map(item => <View key={item.key} style={s.card}>
            <Text style={s.cardTitle}>{item.label}</Text><Text style={s.muted}>전 {photos.filter(p=>p.itemKey===item.key&&p.phase==='before'&&p.included).length}장 · 중 {photos.filter(p=>p.itemKey===item.key&&p.phase==='during'&&p.included).length}장 · 후 {photos.filter(p=>p.itemKey===item.key&&p.phase==='after'&&p.included).length}장</Text>
            <View style={s.wrap}>{([['recorded', '기록'], ['done', '완료'], ['partial', '일부'], ['skipped', '못 함']] as [ItemStatus, string][]).map(([status, label]) => <Chip key={status} label={label} active={(visit.draft.statuses[item.key] ?? 'recorded') === status} onPress={() => void perform(() => saveDraft({ statuses: { ...visit.draft.statuses, [item.key]: status } }))} />)}</View>
            {visit.draft.statuses[item.key] === 'skipped' && <><TextInput accessibilityLabel={`${item.label} 못 한 이유`} editable={!busy} value={notes[item.key] ?? ''} onChangeText={value => setNotes({ ...notes, [item.key]: value })} maxLength={500} style={s.input} placeholder="작업하지 못한 이유" /><Button secondary label="사유 저장" disabled={busy} onPress={() => void perform(() => saveDraft())} /></>}
          </View>)}
          <Text style={s.h2}>추가 안내</Text><Text style={s.label}>후속 조치</Text><TextInput accessibilityLabel="후속 조치" editable={!busy} multiline maxLength={2000} value={followUp} onChangeText={setFollowUp} style={[s.input, s.textareaSmall]} placeholder="추가 작업이나 확인할 내용" />
          <Button label={dirty ? '작성 중인 초안 저장' : '초안 저장'} disabled={busy} onPress={() => void perform(() => saveDraft())} />
          {company&&<><Note>현재 구역별 사진과 작성한 내용으로 PDF를 만들고 Drive와 CRM에 보관합니다.</Note><Button label="사진·보고서 저장" disabled={busy||photos.length===0} onPress={()=>void perform(savePhotosAndReport)} /></>}
          {issues.length > 0 && <Note>{issues.join('\n')}</Note>}
          <Button label={visit.draft.confirmedRevision === visit.revision ? '내용 검토 완료' : '내용을 검토했습니다'} disabled={busy || dirty || issues.length > 0 || visit.draft.confirmedRevision === visit.revision} onPress={() => void perform(async () => { await vault.saveVisit(confirmVisit(visit), visit.revision); await refresh(); notify('현재 내용 검토를 기록했습니다.'); })} />
          <Button label="보고서 내용 미리보기" secondary disabled={dirty} onPress={() => navigate('pdf')} />
        </>}
        {screen === 'pdf' && visit && <>
          <Note>{receipt?.revision===visit.revision?'현재 검토한 내용의 PDF가 Drive·CRM에 보관됐습니다.':'내용 검토 화면입니다. 아래 저장 버튼에서 PDF를 생성하고 보관합니다.'}</Note>
          <View style={s.paper}><Text style={s.brand}>BRING CARE</Text><Text style={s.h1}>작업 결과보고서</Text>{!company&&<Text style={s.paperTag}>TEST · 실제 작업 보고서 아님</Text>}
            <Text style={s.cardTitle}>{visit.job.title}</Text><Text style={s.muted}>{visit.job.workDate} · {visit.job.kind === 'common' ? '공용부청소' : '입주청소'}</Text>
            <Text style={s.h2}>작업 내용</Text><Text style={s.body}>{visit.draft.summary || '미기재'}</Text><Text style={s.h2}>후속 조치</Text><Text style={s.body}>{visit.draft.followUp || '미기재'}</Text>
            <Text style={s.h2}>선택 사진</Text><Text style={s.body}>{photos.filter(p => p.included).length}장 · 기기 보관</Text>
            <Text style={s.footerText}>문의 1551-3873</Text></View>
          <Button label={company?'PDF 생성 · Drive·CRM 보관':'서버 연결 후 PDF 보관 가능'} disabled={!company||busy||dirty||issues.length>0||visit.draft.confirmedRevision!==visit.revision} onPress={()=>void perform(archiveCurrent)} /><Button label="보고서 편집으로 돌아가기" secondary onPress={() => navigate('report')} />
        </>}
        {screen === 'send' && visit && <><View style={s.card}><Text style={s.cardTitle}>작업 결과보고서 발송</Text><Text style={s.body}>저장된 PDF와 CRM의 고객 연락처를 확인한 뒤 카카오 알림톡으로 보냅니다.</Text><Text style={s.footerText}>문의 1551-3873</Text></View>
          {!company?<Note>가상 현장에서는 고객에게 발송하지 않습니다.</Note>:!receipt||receipt.revision!==visit.revision?<><Note>현재 보고서를 먼저 저장해 주세요. 앱을 다시 열었다면 같은 내용을 다시 저장하면 기존 보관본을 확인합니다.</Note><Button label="보고서 보관 화면으로" onPress={()=>navigate('pdf')} /></>:<>
          <Button label={delivery?'수신자·전달 상태 새로 확인':'수신자와 보고서 확인'} secondary disabled={busy} onPress={()=>void perform(checkDelivery)}/>
          {delivery&&delivery.documentId===receipt.documentId&&<View style={s.card}><Text style={s.cardTitle}>{delivery.customer}</Text><Text style={s.body}>{delivery.address} · {delivery.workName}</Text><Text style={s.body}>수신 {delivery.recipient}</Text><Text style={s.body}>상태: {({ready:'발송 가능',sending:'발송 처리 중',requested:'발송 요청됨',delivered:'전달 완료',failed:'발송 실패',unknown:'접수 여부 확인 필요'})[delivery.status]}</Text>
            <Text style={s.body}>[BRING CARE 작업 결과보고서 안내]{'\n'}{delivery.address} 건물주님, {delivery.workName} 결과 보고서가 발행되었습니다.{'\n\n'}작업명: {delivery.address} {delivery.workName} 결과보고서{'\n'}열람기한: 발송일로부터 7일{'\n\n'}아래 버튼에서 결과보고서를 확인해 주세요.{'\n'}문의: 1551-3873</Text></View>}
          <Button label="고객에게 카카오톡 발송" disabled={busy||!delivery||delivery.documentId!==receipt.documentId||!['ready','failed'].includes(delivery.status)} onPress={confirmDelivery} />
          <Note>발송이 처리 중이거나 결과가 불확실하면 다시 보내지 않고 상태만 확인합니다.</Note></>}</>}
        {screen === 'sync' && <><View style={s.metrics}><Text style={s.metric}>{workspace.photos.length}<Text style={s.metricUnit}> 장</Text></Text><Text style={s.body}>{Platform.OS === 'web' ? '브라우저 임시 보관' : '암호화된 기기 보관'}</Text></View>
          <Note>{company?'전송 중단 시 기기 사진을 유지합니다. 현재 작업의 업로드를 다시 누르면 저장된 지점부터 이어집니다.':'회사 서버가 연결되면 여기에서 업로드를 이어갑니다. 지금은 Drive 업로드 완료로 표시하지 않습니다.'}</Note>{company&&<Button label="현재 작업 사진 Drive에 올리기" disabled={!visit||busy||dirty||captionDirty} onPress={()=>void perform(syncCurrent)}/>}
          {workspace.photos.map((p, i) => <View key={p.id} style={s.row}><View style={s.flex}><Text style={s.rowTitle}>사진 {i + 1} · {phaseLabel[p.phase]}</Text><Text style={s.muted}>{workspace.visits.find(v => v.id === p.visitId)?.job.title}</Text><Text style={s.small}>{stateLabel[p.state]}</Text></View><Text style={s.blue}>{Math.ceil(p.bytes / 1024)} KB</Text></View>)}
        </>}
        {screen === 'settings' && <><View style={s.card}><Text style={s.cardTitle}>{company?'회사 연결':'개발용 격리 환경'}</Text><Text style={s.body}>{company?'직원 개인 계정으로 로그인했습니다. 사진은 활동사진에, 보고서 PDF는 건물 문서함에 보관합니다.':'실제 직원 로그인: 연결 준비 중\n회사 Drive: 연결 전\nCRM 보고서 보관: 연결 전\n고객 알림톡: 사용 안 함'}</Text></View><Note>{Platform.OS === 'web' ? '이 브라우저 검토용 자료는 새로고침하면 초기화됩니다.' : '기기 보관함은 앱을 닫아도 유지됩니다. 앱 삭제 시 기기 자료가 사라질 수 있습니다. Drive 보관 완료를 확인해 주세요.'}</Note>
          <Button label="기기 자료를 유지하고 닫기" secondary disabled={busy} onPress={() => void perform(async () => {if(dirty||captionDirty)throw new FieldError('UNSAVED_CHANGES');await vault.close(); setVault(undefined); setWorkspace(empty); setSelected(''); setSummary(''); setFollowUp(''); setNotes({});onClose?.();})} />
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
  content: { padding: 24, paddingBottom: 42, gap: 16 },captureContent:{paddingHorizontal:16,paddingTop:10,gap:9},captureHeader:{paddingHorizontal:18,paddingVertical:10,backgroundColor:'#fff',flexDirection:'row',justifyContent:'space-between',gap:8},captureSite:{fontSize:13,fontWeight:'700',color:'#223b55',flexShrink:1},captureSiteSmall:{fontSize:12,color:'#64809d'}, eyebrow: { fontSize: 11, letterSpacing: 1.3, fontWeight: '700', color: '#64809d' }, hero: { fontSize: 33, lineHeight: 46, letterSpacing: -1, fontWeight: '800', color: '#152c44', marginTop: 20 }, subtitle: { fontSize: 15, lineHeight: 24, color: '#6b7e92' }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, h1: { fontSize: 26, color: '#192e46', fontWeight: '800', marginTop: 8 }, h2: { fontSize: 18, color: '#20354d', fontWeight: '700', marginTop: 12 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: '#e5ecf3' }, cardTitle: { fontSize: 17, fontWeight: '700', color: '#223b55' }, body: { fontSize: 14, lineHeight: 24, color: '#516a82' }, muted: { fontSize: 12, lineHeight: 19, color: '#74869a' }, small: { fontSize: 12, lineHeight: 22, color: '#587693' }, tag: { fontSize: 12, fontWeight: '700', color: '#167466' },
  button: { minHeight: 50, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: '#276ce4', borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, secondary: { backgroundColor: '#edf3fb', borderWidth: 1, borderColor: '#dee8f4' }, buttonText: { fontSize: 14, fontWeight: '700', color: '#fff' }, secondaryText: { color: '#365c87' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 }, note: { borderRadius: 14, backgroundColor: '#eef3f9', padding: 16 }, noteText: { fontSize: 12, lineHeight: 21, color: '#5b738d' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderColor: '#dce6f1', backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center' }, chipActive: { backgroundColor: '#e9f1ff', borderColor: '#5c94ef' }, chipText: { fontSize: 12, color: '#667e94' }, chipTextActive: { color: '#245fb5', fontWeight: '700' }, phaseRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: '#36506b' }, input: { borderWidth: 1, borderColor: '#dbe4ee', borderRadius: 12, padding: 14, fontSize: 14, lineHeight: 22, backgroundColor: '#fff', color: '#263f59', minHeight: 48 }, textarea: { minHeight: 150, textAlignVertical: 'top' }, textareaSmall: { minHeight: 96, textAlignVertical: 'top' },
  siteBar: { padding: 15, backgroundColor: '#eaf0f7', borderRadius: 14, gap: 4 }, siteTitle: { fontSize: 13, fontWeight: '700', color: '#3c5874' }, guideCard:{backgroundColor:'#173657',borderRadius:14,padding:13,gap:3},guideStep:{color:'#a9d1ff',fontSize:12,fontWeight:'700'},guideTitle:{color:'#fff',fontSize:20,fontWeight:'800'},guideDetail:{color:'#d4e4f5',fontSize:12,lineHeight:17},cameraFrame:{position:'relative'}, camera: { height: 240, borderRadius: 18, overflow: 'hidden' }, cameraPlaceholder: { height: 240, backgroundColor: '#1b3249', borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 15 }, cameraMark: { fontSize: 55, color: '#8fb8ea', fontWeight: '200' }, cameraText: { fontSize: 13, color: '#dbe7f5' }, cameraSmall: { fontSize: 11, color: '#8daac7' }, photo: { height: 240, width: '100%', borderRadius: 12, resizeMode: 'contain', backgroundColor: '#e9f0f6' },referencePhoto:{height:80,width:100},referenceOverlay:{position:'absolute',right:10,top:10,backgroundColor:'#fff',borderRadius:10,padding:6,gap:3},referenceLabel:{color:'#36506b',fontSize:11,fontWeight:'700'},
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }, flex: { flex: 1 }, row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#e0e8f0' }, rowTitle: { fontSize: 14, fontWeight: '700', color: '#34506c', marginBottom: 5 }, paper: { backgroundColor: '#fff', padding: 26, borderWidth: 1, borderColor: '#e1e8f0', gap: 12 }, paperTag: { fontSize: 11, color: '#b26b36', backgroundColor: '#fff7e8', padding: 10 }, footerText: { fontSize: 12, color: '#567697', paddingTop: 10, lineHeight: 23 }, metrics: { alignItems: 'center', padding: 22, backgroundColor: '#fff', borderRadius: 18 }, metric: { fontSize: 44, color: '#276ce4', fontWeight: '800' }, metricUnit: { fontSize: 17, fontWeight: '500' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#e0e8f1', paddingTop: 8, paddingBottom: 8 }, tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }, tabIcon: { fontSize: 23, color: '#92a2b3' }, tabText: { fontSize: 11, color: '#8294a7', fontWeight: '700' }, blue: { color: '#276ce4' }, loading: { padding: 5 }, toast: { backgroundColor: '#e7f5ed', padding: 14 }, error: { backgroundColor: '#fff0e8' }, toastText: { fontSize: 13, lineHeight: 21, color: '#294c48' },
});
