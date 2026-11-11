import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { brandStyles, color } from './theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {APP_VERSION} from './app-version';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { openVault } from './storage/open-vault';
import { canDeletePhoto, confirmVisit, editVisit, LIMITS, phaseLabel, stateLabel, type ItemStatus, type Job, type Phase, type Photo, type Vault, type Visit, type Workspace } from './domain/model';
import { catalog, reviewIssues, withCurrentZones } from './domain/report';
import { persistCapture } from './capture';
import { aiDraftState,reportFacts } from './domain/ai-report';
import { saveGroupedReport } from './domain/save-report';
import { archiveDocumentIds } from './domain/archive-lookup';
import { areaPhotoCount,beforeChoices,capturePhases,captureProgress,changeCaptureAreas,hasBeforePhase,startPhase,defaultReference,firstUncapturedArea,initialCaptureAreas,nextUncapturedArea } from './domain/capture-guide';
import { samplePhoto } from './sample-photo';
import { exifCapturedAt } from './domain/capture-time';
const GALLERY_BATCH = 20;
import { safeMessage } from './errors';
import { BuildingIcon, CameraIcon, ReportIcon, SendIcon, SettingsIcon } from './icons';
const LOGO = require('../assets/logo-mark.png');
import { FIELD_RETRY, SyncRunner } from './domain/sync';
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
function PhotoImage({ vault, photo, compact=false, fill=false }: { vault: Vault; photo: Photo; compact?:boolean; fill?:boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; uri: string; failed: boolean }>({ id: '', uri: '', failed: false });
  useEffect(() => { let current = true; void vault.readBytes(photo.id).then(bytes => {
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    if (current) setLoaded({ id: photo.id, uri: `data:image/jpeg;base64,${btoa(binary)}`, failed: false });
  }).catch(() => { if (current) setLoaded({ id: photo.id, uri: '', failed: true }); }); return () => { current = false; }; }, [vault, photo.id]);
  if (fill) return loaded.id === photo.id && loaded.uri ? <Image source={{ uri: loaded.uri }} style={s.ghostPhoto} accessible={false} /> : null;
  if (loaded.id === photo.id && loaded.failed) return <Note>사진을 읽지 못했습니다. 원본을 보존했습니다. 다른 사진을 선택한 뒤 다시 확인해 주세요.</Note>;
  return loaded.id === photo.id && loaded.uri ? <Image source={{ uri: loaded.uri }} style={[s.photo,compact&&s.referencePhoto]} accessibilityLabel={`${photo.caption || '작업사진'} ${phaseLabel[photo.phase]}`} /> : <Note>저장 사진을 확인하는 중입니다.</Note>;
}
export function FieldWorkspace({company,onClose,backRequest=0}:{company?:{uid:string;site:CustomerSite;api:CompanyRecordingApi};onClose?:()=>void;backRequest?:number}) {
  const jobs:Job[]=company?(['common','moveIn'] as const).map(kind=>({id:`${company.site.id}_${kind}`,customerId:company.site.id,buildingId:'',title:company.site.name,address:company.site.address,kind,workDate:today()})):sampleJobs;
  const controller=useRef(new AbortController()),runner=useRef<SyncRunner|undefined>(undefined);
  const [receipt,setReceipt]=useState<ArchiveReceipt>();
  const [recovered,setRecovered]=useState<{visitId:string;revision:number;documentId:string}>();
  const [delivery,setDelivery]=useState<DeliveryPreview>();
  const [vault, setVault] = useState<Vault>();
  const [workspace, setWorkspace] = useState<Workspace>(empty);
  const [selected, setSelected] = useState(''); const [screen, setScreen] = useState<Screen>('jobs');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [busyLabel,setBusyLabel]=useState('처리 중입니다.');
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const seenBackRequest=useRef(backRequest);
  const [notice, setNotice] = useState(''); const [problem, setProblem] = useState(false);
  const [area, setArea] = useState('entrance'); const [phase, setPhase] = useState<Phase>('before');
  const [plannedAreas,setPlannedAreas]=useState<string[]>([]),[lastArea,setLastArea]=useState('');
  const [permission, requestPermission] = useCameraPermissions(); const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false); const [foreground, setForeground] = useState(true);
  const [summary, setSummary] = useState(''); const [followUp, setFollowUp] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showAllAreas,setShowAllAreas]=useState(false);
  const [photoId, setPhotoId] = useState(''); const [caption, setCaption] = useState('');
  const [lastShotId, setLastShotId] = useState('');
  // The "before" photo overlaid while taking an "after" photo ('' = automatic).
  const [referenceId, setReferenceId] = useState(''); const [overlayOn, setOverlayOn] = useState(true);
  const visit = workspace.visits.find(v => v.id === selected);
  const photos = workspace.photos.filter(p => p.visitId === selected);
  const photo = photos.find(p => p.id === photoId);
  const areas=visit?.captureAreas||[];
  const documentId=visit&&(receipt?.revision===visit.revision?receipt.documentId:recovered?.visitId===visit.id&&recovered.revision===visit.revision?recovered.documentId:undefined);
  const dirty = !!visit && (summary !== visit.draft.summary || followUp !== visit.draft.followUp || JSON.stringify(notes) !== JSON.stringify(visit.draft.notes));
  const captionDirty = screen === 'photos' && !!photo && caption !== photo.caption;
  const issues = visit ? reviewIssues(visit, photos) : [];
  const notify = (message: string, error = false) => { setNotice(message); setProblem(error); };
  async function perform(task: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setNotice('');
    try { await task(); } catch (error) { notify(safeMessage(error), true); }
    finally { busyRef.current = false; setBusy(false); setBusyLabel('처리 중입니다.'); }
  }
  async function refresh(store = vault) { if (store) { const next = withCurrentZones(await store.load()); setWorkspace(next); return next; } }
  function navigate(next: Screen) {
    if (busyRef.current || next === screen) return;
    if (dirty || captionDirty) { notify('작성 중인 내용을 저장한 뒤 이동해 주세요.', true); return; }
    setNotice(''); setCameraReady(false);
    if(next==='capture'&&visit&&!visit.captureAreas?.length){setPlannedAreas(initialCaptureAreas(visit,photos));setScreen('capture-setup');return;}
    setScreen(next);
  }
  useEffect(()=>{
    if(seenBackRequest.current===backRequest)return;seenBackRequest.current=backRequest;
    if(busyRef.current){notify('처리가 끝나면 이전 화면으로 이동할 수 있습니다.',true);return;}
    if(dirty||captionDirty){notify('작성 중인 내용을 저장한 뒤 이동해 주세요.',true);return;}
    if(screen==='jobs'){onClose?.();return;}
    if(screen==='capture'&&visit){setPlannedAreas(initialCaptureAreas(visit,photos));setCameraReady(false);setScreen('capture-setup');return;}
    const previous:Record<Screen,Screen>={jobs:'jobs','capture-setup':'jobs',capture:'capture-setup',photos:'capture',report:'capture',pdf:'report',send:'pdf',sync:'jobs',settings:'jobs'};
    navigate(previous[screen]);
  },[backRequest]);
  // Staff switch to KakaoTalk or the dialer mid-report; Android may then kill the
  // app. Typed text lives only in memory until saved, so save it on the way out.
  const autosave = useRef<() => Promise<void>>(async () => undefined);
  autosave.current = async () => {
    if (!vault || !visit || !dirty || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await vault.saveVisit(editVisit(visit, { summary, followUp, notes }, new Date().toISOString()), visit.revision); await refresh(); notify('작성 중인 내용을 자동으로 저장했습니다.'); }
    catch { /* keep the in-memory text; the explicit save button still works */ }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => { const listener = AppState.addEventListener('change', next => {
    if (next === 'background') void autosave.current();
    setForeground(next === 'active');
    if (next !== 'active') setCameraReady(false);
  }); return () => listener.remove(); }, []);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [screen, selected]);
  useEffect(() => { if (!visit) return; setSummary(visit.draft.summary); setFollowUp(visit.draft.followUp); setNotes(visit.draft.notes); }, [selected, visit?.draft.summary, visit?.draft.followUp, visit?.draft.notes]);
  async function enterDevelopment() {
    const store = await openVault('development-sample');
    try { const loaded = withCurrentZones(await store.load()); setVault(store); setWorkspace(loaded); setScreen('jobs'); }
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
    beginVisit(target,workspace.photos.filter(p=>p.visitId===target!.id));
  }
  // Every way into a visit resets the capture guide to that visit's own areas.
  // A stale area from another visit (or another job kind) would be rejected by
  // the vault and lose the shot.
  function beginVisit(target:Visit,visitPhotos:Photo[],next?:Screen){
    const plan=initialCaptureAreas(target,visitPhotos);
    setReceipt(undefined);setRecovered(undefined);setDelivery(undefined);setShowAllAreas(false);setSelected(target.id);setPlannedAreas(plan);setPhase(startPhase(target.job.kind));setLastArea('');setArea(firstUncapturedArea(target.captureAreas?.length?target.captureAreas:plan,visitPhotos,startPhase(target.job.kind)));setPhotoId('');setCaption('');setLastShotId('');
    setScreen(next??(target.draft.confirmedRevision===target.revision?'report':target.captureAreas?.length?'capture':'capture-setup'));
  }
  async function saveCaptureAreas(){
    if(!visit||!vault)return;
    const ordered=catalog(visit.job.kind).map(item=>item.key).filter(key=>plannedAreas.includes(key));
    if(!ordered.length)throw new FieldError('CAPTURE_AREAS_INVALID');
    if(JSON.stringify(ordered)!==JSON.stringify(visit.captureAreas)){
      const next=changeCaptureAreas(visit,photos,ordered,new Date().toISOString());await vault.saveVisit(next,visit.revision);await refresh();
    }
    setPhase(startPhase(visit.job.kind));setLastArea('');setArea(firstUncapturedArea(ordered,photos,startPhase(visit.job.kind)));setScreen('capture');
  }
  useEffect(()=>{if(screen==='capture'&&areas.length&&!areas.includes(area))setArea(firstUncapturedArea(areas,photos,phase));},[screen,selected,areas.join(','),area]);
  function switchPhase(next:Phase){setPhase(next);setLastArea('');setArea(firstUncapturedArea(areas,photos,next));setNotice('');}
  useEffect(()=>{
    if(!company)return;
    controller.current=new AbortController();
    let active=true,opened:Vault|undefined;
    void perform(async()=>{await company.api.recordingContext(controller.current.signal);opened=await openVault(company.uid);const loaded=withCurrentZones(await opened.load());if(!active){await opened.close();return;}setVault(opened);setWorkspace(loaded);setScreen('jobs');});
    return()=>{active=false;controller.current.abort();runner.current?.stop();void opened?.close();};
  },[company?.uid]);
  async function syncCurrent(current=visit, currentPhotos=photos, draftSaved=false){
    if(!company||!vault||!current||!vault.linkRevision)throw new FieldError('SERVER_UNAVAILABLE');
    if((dirty&&!draftSaved)||captionDirty)throw new FieldError('UNSAVED_CHANGES');
    setBusyLabel('사진 보관을 준비하고 있습니다.');await company.api.storageStatus(controller.current.signal);
    // Mark first: if the reply is lost the server may already hold these photos.
    await vault.markSubmitted?.(current.id,current.revision);
    const linked=await company.api.reconcile(current,currentPhotos,controller.current.signal);
    await vault.linkRevision(current.id,linked.revision,linked.photoIds);
    runner.current?.stop();runner.current=new SyncRunner(vault,company.api,current.id,(ready,total)=>setBusyLabel(`사진 보관 ${ready}/${total}장 · 앱을 켜 두세요.`),FIELD_RETRY,attempt=>setBusyLabel(`연결이 불안정해 다시 보내는 중입니다 (${attempt+1}/${FIELD_RETRY.attempts}회) · 앱을 켜 두세요.`));await runner.current.run();
    const latest=await refresh();const failed=latest?.photos.find(p=>p.visitId===current.id&&p.state!=='ready');
    if(failed)throw new FieldError(failed.errorCode||'PHOTOS_NOT_READY');
    notify('현재 작업의 사진을 Drive 활동사진에 보관했습니다.');
  }
  async function archiveCurrent(){
    if(!company||!visit||dirty||captionDirty)return;
    if(visit.draft.confirmedRevision!==visit.revision)throw new FieldError('REPORT_REVIEW_REQUIRED');
    await syncCurrent();setBusyLabel('보고서 PDF를 만들고 보관하고 있습니다.');const result=await company.api.archive(visit,controller.current.signal);setReceipt(result);setRecovered(undefined);setDelivery(undefined);notify('작업 결과보고서 PDF를 Drive 문서함과 CRM에 보관했습니다.');
  }
  async function savePhotosAndReport(){
    if(!company||!vault||!visit)return;
    if(captionDirty)throw new FieldError('UNSAVED_CHANGES');
    const result=await saveGroupedReport({vault,visit,photos,summary,followUp,notes,onLocalSave:async()=>{await refresh();},
      sync:(current,currentPhotos)=>syncCurrent(current,currentPhotos,true),archive:current=>{setBusyLabel('보고서 PDF를 만들고 보관하고 있습니다.');return company.api.archive(current,controller.current.signal);}});
    if(!result.ok){notify(result.issues.join('\n'),true);return;}
    setReceipt(result.receipt);setRecovered(undefined);setDelivery(undefined);setScreen('pdf');notify('구역별 사진과 작업 결과보고서 PDF를 Drive와 CRM에 보관했습니다.');
  }
  async function checkDelivery(){
    if(!company||!visit||dirty||captionDirty)throw new FieldError('REPORT_REVIEW_REQUIRED');
    const ids=documentId?[documentId]:await archiveDocumentIds(visit,company.uid,value=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value));
    let id='',value:Awaited<ReturnType<typeof company.api.deliveryStatus>>|undefined,lastError:unknown;
    for(const candidate of ids){try{value=await company.api.deliveryStatus(candidate,controller.current.signal);id=candidate;break;}catch(error){lastError=error;}}
    if(!value)throw lastError;
    setRecovered({visitId:visit.id,revision:visit.revision,documentId:id});setDelivery(value);
  }
  function confirmDelivery(){
    if(!delivery||!company||!visit||!documentId||delivery.documentId!==documentId||dirty||captionDirty)return;
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
    const target=areas.includes(area)?area:firstUncapturedArea(areas,photos,phase);
    if(!target)throw new FieldError('CAPTURE_AREAS_INVALID');
    if(target!==area)setArea(target);
    // Only a single camera shot is lined up with the overlaid before photo; gallery imports stay unpaired.
    const pairWith=phase==='after'&&hasBeforePhase(visit.job.kind)?(beforeChoices(photos,target).find(p=>p.id===referenceId)?.id??defaultReference(photos,target))||undefined:undefined;
    let savedId = '';
    if (Platform.OS === 'web') { savedId = await persistCapture(vault, visit, samplePhoto(), target, phase, undefined, pairWith); setReferenceId(''); }
    else if (gallery) {
      // exif is read only for the original capture time; the stored JPEG is re-encoded without EXIF.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: GALLERY_BATCH, orderedSelection: true, exif: true, quality: 1 });
      if (result.canceled || !result.assets.length) return;
      const room = LIMITS.photos - photos.length;
      if (room <= 0) throw new FieldError('PHOTO_LIMIT');
      const assets = result.assets.slice(0, room);
      let current = visit, saved = 0;
      try {
        for (const asset of assets) {
          setBusyLabel(`사진첩 사진을 저장하고 있습니다 ${saved + 1}/${assets.length}장`);
          savedId = await persistCapture(vault, current, asset, target, phase, exifCapturedAt(asset.exif));
          saved++; setLastShotId(savedId);
          // Each saved photo advances the visit revision; the next save must expect it.
          current = (await vault.load()).visits.find(v => v.id === visit.id) ?? current;
        }
      } catch (error) {
        await refresh();
        if (!saved) throw error;
        notify(`${saved}장을 저장했고 ${assets.length - saved}장은 저장하지 못했습니다. ${safeMessage(error)}`, true); return;
      }
      if (assets.length > 1 || result.assets.length > assets.length) {
        await refresh(); setLastArea(target);
        notify(`사진첩 사진 ${saved}장을 ${catalog(visit.job.kind).find(item => item.key === target)?.label || '현재 구역'} ${phaseLabel[phase]}에 저장했습니다.${result.assets.length > assets.length ? ` 한 작업은 ${LIMITS.photos}장까지라 ${result.assets.length - assets.length}장은 넣지 않았습니다.` : ''}`, result.assets.length > assets.length);
        return;
      }
    } else {
      if (!cameraReady || !camera.current) return;
      const result = await camera.current.takePictureAsync({ quality: 1, exif: false, shutterSound: true });
      if (!result) return;
      savedId = await persistCapture(vault, visit, result, target, phase, undefined, pairWith); setReferenceId('');
    }
    const updated=await refresh();setLastArea(target);setLastShotId(savedId);
    const next=nextUncapturedArea(areas,updated?.photos.filter(p=>p.visitId===visit.id)||photos,phase,target);
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
  function finishCaptureRequested(){
    if(!visit||busy)return;
    const included=photos.filter(p=>p.included),before=hasBeforePhase(visit.job.kind)?areas.filter(key=>!included.some(p=>p.itemKey===key&&p.phase==='before')):[],
      after=areas.filter(key=>!included.some(p=>p.itemKey===key&&p.phase==='after'));
    if((before.length||after.length)&&Platform.OS!=='web'){
      const label=(keys:string[])=>keys.map(key=>catalog(visit.job.kind).find(item=>item.key===key)?.label||key).join(', ');
      const missing=[before.length?`작업 전: ${label(before)}`:'',after.length?`작업 후: ${label(after)}`:''].filter(Boolean).join('\n');
      Alert.alert('촬영하지 않은 구역이 있어요',`${missing}\n\n사진이 없는 상태로 보고서를 작성할까요?`,[{text:'촬영 계속',style:'cancel'},{text:'보고서 작성',onPress:()=>void perform(finishCapture)}]);return;
    }
    void perform(finishCapture);
  }
  async function updatePhoto(patch: Partial<Photo>) {
    if (!vault || !visit || !photo) return;
    const next = { ...photo, ...patch };
    // A pairing only means something for an "after" photo in the same area.
    if (next.itemKey !== photo.itemKey || next.phase !== photo.phase) delete next.pairWith;
    await vault.editPhoto(next, visit.revision); await refresh(); notify('사진 분류를 저장했습니다. 보고서 검토는 다시 확인해 주세요.');
  }
  async function undoLastShot() {
    const target = photos.find(p => p.id === lastShotId);
    if (!vault || !visit || !target || !canDeletePhoto(target)) return;
    await vault.deletePhoto(target.id, visit.revision); setLastShotId(''); setLastArea('');
    setArea(target.itemKey); await refresh(); notify('방금 찍은 사진을 지웠습니다. 같은 구역에서 다시 찍어 주세요.');
  }
  function confirmDelete(target: Photo) {
    const run = () => void perform(async () => {
      if (!vault || !visit) return;
      await vault.deletePhoto(target.id, visit.revision); setPhotoId(''); setCaption(''); await refresh(); notify('사진을 기기에서 삭제했습니다. 보고서 검토는 다시 확인해 주세요.');
    });
    if (Platform.OS === 'web') { run(); return; }
    Alert.alert('사진 삭제', '이 사진을 기기에서 지울까요? 아직 서버로 보내지 않은 사진이라 되돌릴 수 없습니다.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: run }]);
  }
  function choosePhoto(p: Photo) { if (captionDirty) { notify('사진 설명을 저장한 뒤 다른 사진을 선택해 주세요.', true); return; } setPhotoId(p.id); setCaption(p.caption); }
  const pending = workspace.photos.filter(p => p.state !== 'ready').length;
  const title: Record<Screen, string> = { jobs: '오늘의 현장', 'capture-setup':'촬영할 구역 선택', capture: '작업사진 촬영', photos: '사진 확인', report: '작업 결과보고서', pdf: '보고서 내용 확인', send: '보고서 발송', sync: '기기 보관함', settings: '설정·연결' };
  if(company&&!foreground)return <SafeAreaView style={s.safe}><Note>회사 정보를 보호하고 있습니다.</Note></SafeAreaView>;
  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.shell}>
    {screen!=='capture'&&<><View style={s.header}><View style={s.brandRow}><Image source={LOGO} style={s.logo} accessibilityLabel="브링케어" /><View><Text style={s.brand}>BRING CARE</Text><Text style={s.headerTitle}>현장노트</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel="설정 열기" onPress={() => navigate('settings')} style={s.icon}><SettingsIcon size={22} color={color.muted} strokeWidth={2} /></Pressable></View>
    <View style={s.devStrip}><Text style={s.devText}>{company?`회사 연결 · 개발 ${APP_VERSION}`:'가상 현장 · 고객 발송 없음'}</Text>{onClose&&<Pressable accessibilityRole="button" accessibilityLabel="고객 목록으로" accessibilityState={{disabled:busy}} disabled={busy} style={[s.backLink,busy&&s.disabled]} onPress={()=>{if(dirty||captionDirty){notify('작성 중인 내용을 저장한 뒤 이동해 주세요.',true);return;}onClose();}}><Text style={s.backLinkText}>고객 목록</Text></Pressable>}</View>
    {vault && <Pressable accessibilityRole="button" onPress={() => navigate('sync')} style={s.syncStrip}><Text style={s.syncText}>기기 보관 {workspace.photos.length}장  ·  전송 대기 {pending}장</Text><Text style={s.blue}>확인 →</Text></Pressable>}</>}
    {screen==='capture'&&visit&&<View style={s.captureHeader}><Text style={s.captureSite} numberOfLines={1}>{visit.job.title}</Text><Text style={s.captureSiteSmall}>구역별 사진 촬영</Text></View>}
    {notice !== '' && <View accessibilityRole="alert" style={[s.toast, problem && s.error]}><Text style={s.toastText}>{notice}</Text></View>}
    {busy && <View accessibilityRole="progressbar" accessibilityLabel={busyLabel} style={s.progress}><ActivityIndicator /><Text style={s.progressText}>{busyLabel}</Text></View>}
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
        {screen === 'jobs' && <><Text style={s.subtitle}>현장을 열고 작업 사진을 남겨 주세요. 공용부는 작업 후 사진만 찍습니다.</Text>{jobs.map(job => <View key={job.id} style={s.card}>
          <Text style={s.tag}>{job.kind === 'common' ? '공용부청소' : '입주청소'}</Text><Text style={s.cardTitle}>{job.title}</Text><Text style={s.muted}>{job.address}</Text>
          {(()=>{const v=workspace.visits.find(row=>row.job.id===job.id&&row.job.workDate===job.workDate);if(!v)return <Text style={s.body}>아직 시작하지 않았습니다.</Text>;
            const own=workspace.photos.filter(p=>p.visitId===v.id),planned=v.captureAreas||[],b=captureProgress(planned,own,'before'),a=captureProgress(planned,own,'after'),ready=own.filter(p=>p.state==='ready').length;
            return <Text style={s.body}>{planned.length?(hasBeforePhase(v.job.kind)?`작업 전 ${b.done}/${b.total}구역 · `:'')+`작업 후 ${a.done}/${a.total}구역`:'촬영 구역 선택 전'}{'\n'}사진 {own.length}장{company?` · 서버 보관 ${ready}/${own.length}장`:''}{v.draft.confirmedRevision===v.revision?' · 보고서 검토 완료':''}</Text>;})()}
          <Button label={workspace.visits.some(v => v.job.id === job.id && v.job.workDate===job.workDate) ? '오늘 작업 이어하기' : '오늘 작업 시작'} onPress={() => void perform(() => openJob(job))} disabled={busy} />
        </View>)}{company&&workspace.visits.filter(v=>v.job.customerId===company.site.id&&v.job.workDate!==today()).map(v=><View key={v.id} style={s.card}><Text style={s.cardTitle}>{v.job.workDate} · {v.job.kind==='common'?'공용부청소':'입주청소'}</Text><Button label="이전 작업 이어하기" disabled={busy} onPress={()=>beginVisit(v,workspace.photos.filter(p=>p.visitId===v.id),'report')}/></View>)}{!company&&<Note>가상 현장은 CRM에 등록되거나 실제 고객에게 연결되지 않습니다.</Note>}</>}
        {['capture-setup', 'capture', 'photos', 'report', 'pdf', 'send'].includes(screen) && !visit && <Note>먼저 현장 탭에서 작업할 현장을 선택해 주세요.</Note>}
        {screen === 'capture-setup' && visit && <>
          <Text style={s.subtitle}>이 현장에서 촬영할 구역을 골라 주세요. {hasBeforePhase(visit.job.kind)?'선택한 구역을 차례대로 작업 전과 후에 각각 촬영합니다.':'선택한 구역을 차례대로 작업 후 사진으로 촬영합니다.'}</Text>
          <View style={s.card}><Text style={s.cardTitle}>촬영 구역 · {plannedAreas.length}곳</Text>
            <View style={s.wrap}>{catalog(visit.job.kind).map(item=><Chip key={item.key} label={`${item.label}${photos.some(p=>p.itemKey===item.key)?' · 사진 있음':''}`} active={plannedAreas.includes(item.key)} disabled={busy} onPress={()=>{
              if(plannedAreas.includes(item.key)&&photos.some(p=>p.itemKey===item.key)){notify('사진이 있는 구역은 촬영 목록에 남겨 둡니다.',true);return;}
              setNotice('');setPlannedAreas(current=>current.includes(item.key)?current.filter(key=>key!==item.key):[...current,item.key]);
            }}/>)}</View>
          </View>
          <Note>현장에 없는 구역은 선택 해제할 수 있습니다. 한 구역에서 여러 장을 찍을 수도 있습니다.</Note>
          <Button label={hasBeforePhase(visit.job.kind)?'작업 전 촬영 시작':'작업 후 촬영 시작'} disabled={busy||!plannedAreas.length} onPress={()=>void perform(saveCaptureAreas)} />
          {!!visit.captureAreas?.length&&<Button label="촬영 화면으로 돌아가기" secondary disabled={busy} onPress={()=>setScreen('capture')} />}
        </>}
        {screen === 'capture' && visit && (()=>{
          const label=(key:string)=>catalog(visit.job.kind).find(item=>item.key===key)?.label||key;
          const before=captureProgress(areas,photos,'before'),after=captureProgress(areas,photos,'after');
          const beforeDone=areas.length>0&&before.done===before.total,afterDone=areas.length>0&&after.done===after.total;
          const choices=phase==='after'&&hasBeforePhase(visit.job.kind)?beforeChoices(photos,area):[];
          const referencePhoto=choices.find(p=>p.id===referenceId)??choices.find(p=>p.id===defaultReference(photos,area));
          const lastShot=photos.find(p=>p.id===lastShotId);
          const shutterOff=busy || (Platform.OS !== 'web' && (!permission?.granted || !cameraReady));
          return <>
          <View style={s.wrap}>{capturePhases(visit.job.kind).map(p=>{
            const progress=captureProgress(areas,photos,p);return <Chip key={p} label={`${phaseLabel[p]} ${progress.done}/${progress.total}`} active={phase===p} disabled={busy} onPress={()=>switchPhase(p)}/>;
          })}</View>
          <View style={s.guideCard}><Text style={s.guideStep}>{phaseLabel[phase]} · {Math.max(areas.indexOf(area)+1,1)} / {areas.length} 구역 · 이 구역 {areaPhotoCount(photos,area,phase)}장</Text>
            <Text style={s.guideTitle}>{label(area) || '촬영 구역'}</Text>
            <Text style={s.guideDetail}>{catalog(visit.job.kind).find(item=>item.key===area)?.detail}</Text>
          </View>
          <View style={s.cameraFrame}>{Platform.OS === 'web' ? <View style={s.cameraPlaceholder}><CameraIcon size={52} color={color.onDarkAccent} strokeWidth={1.5} /><Text style={s.cameraText}>브라우저에서는 합성 사진으로 확인합니다</Text><Text style={s.cameraSmall}>실제 카메라는 Android·iPhone 개발 앱에서</Text></View>
            : permission?.granted && foreground ? <CameraView ref={camera} style={s.camera} facing="back" mode="picture" onCameraReady={() => setCameraReady(true)} onMountError={() => { setCameraReady(false); notify('카메라를 열 수 없습니다. 사진첩에서 선택으로 이어갈 수 있습니다.', true); }} />
            : <View style={s.card}><Text style={s.body}>작업사진을 촬영하려면 카메라 접근이 필요합니다.</Text><Button label="카메라 권한 허용" onPress={() => void requestPermission()} /></View>}
            {referencePhoto&&overlayOn&&<View style={s.ghost} pointerEvents="none"><PhotoImage vault={vault} photo={referencePhoto} fill/></View>}
            {referencePhoto&&<View style={s.referenceOverlay} pointerEvents="none"><Text style={s.referenceLabel}>작업 전</Text><PhotoImage vault={vault} photo={referencePhoto} compact/></View>}
          </View>
          {referencePhoto&&<View style={s.wrap}>
            {choices.length>1&&choices.map((p,index)=><Chip key={p.id} label={`작업 전 ${index+1}${photos.some(a=>a.phase==='after'&&a.pairWith===p.id)?' ✓':''}`} active={p.id===referencePhoto.id} disabled={busy} onPress={()=>setReferenceId(p.id)}/>)}
            <Chip label={overlayOn?'겹쳐 보기 켬':'겹쳐 보기 끔'} active={overlayOn} disabled={busy} onPress={()=>setOverlayOn(!overlayOn)}/>
          </View>}
          {referencePhoto&&<Note>흐릿하게 보이는 작업 전 사진과 같은 자리·각도로 맞춰 찍으면 보고서에 전·후가 나란히 실립니다.</Note>}
          <Pressable accessibilityRole="button" accessibilityLabel={`${label(area)} ${phaseLabel[phase]} 촬영`} accessibilityState={{disabled:shutterOff}} disabled={shutterOff} onPress={() => void perform(() => capture())}
            style={({pressed})=>[s.shutter,shutterOff&&s.disabled,pressed&&s.pressed]}>
            <Text style={s.shutterText}>{Platform.OS === 'web' ? '합성 작업사진 추가' : `${phaseLabel[phase]} 촬영`}</Text><Text style={s.shutterSub}>{label(area)}</Text>
          </Pressable>
          {lastShot&&<View style={s.lastShot}><PhotoImage vault={vault} photo={lastShot} compact/><View style={s.flex}><Text style={s.rowTitle}>방금 찍은 사진</Text><Text style={s.muted}>{label(lastShot.itemKey)} · {phaseLabel[lastShot.phase]}</Text>
            {!!lastArea&&lastArea!==area&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setArea(lastArea);setLastArea('');}}><Text style={s.link}>{label(lastArea)} 한 장 더 찍기</Text></Pressable>}</View>
            {canDeletePhoto(lastShot)&&<Pressable accessibilityRole="button" accessibilityLabel="방금 찍은 사진 지우기" disabled={busy} onPress={()=>void perform(undoLastShot)} style={s.undo}><Text style={s.undoText}>지우기</Text></Pressable>}</View>}
          {phase==='before'&&beforeDone&&<View style={s.doneCard}><Text style={s.doneTitle}>작업 전 사진을 모든 구역에서 찍었어요</Text><Text style={s.doneBody}>청소를 마친 뒤 같은 구역을 작업 후로 찍어 주세요.</Text><Button label="작업 후 촬영 시작" disabled={busy} onPress={()=>switchPhase('after')} /></View>}
          {phase==='after'&&afterDone&&<View style={s.doneCard}><Text style={s.doneTitle}>작업 후 사진까지 모두 찍었어요</Text><Text style={s.doneBody}>이제 보고서를 확인하고 저장하면 됩니다.</Text><Button label={company?'촬영 완료 · AI 보고서 작성':'촬영 완료 · 보고서 작성'} disabled={busy} onPress={finishCaptureRequested} /></View>}
          {phase==='after'&&!referencePhoto&&hasBeforePhase(visit.job.kind)&&<Note>이 구역의 작업 전 사진이 없습니다.</Note>}
          <View style={s.wrap}>{areas.map((key,index)=>{const count=areaPhotoCount(photos,key,phase);return <Chip key={key} label={`${count?'✓ ':''}${index+1}. ${label(key)} · ${count}장`} active={area===key} disabled={busy} onPress={()=>{setArea(key);setLastArea('');}} />;})}</View>
          <View style={s.grid}>
            {phase==='before'&&!beforeDone&&<View style={s.gridItem}><Button label="작업 후로 넘어가기" secondary disabled={busy} onPress={()=>switchPhase('after')} /></View>}
            {Platform.OS !== 'web' && <View style={s.gridItem}><Button label={`사진첩 (최대 ${GALLERY_BATCH}장)`} secondary disabled={busy} onPress={() => void perform(() => capture(true))} /></View>}
            <View style={s.gridItem}><Button label={`사진 ${photos.length}장 보기`} secondary disabled={busy} onPress={() => navigate('photos')} /></View>
            <View style={s.gridItem}><Button label="촬영 구역 변경" secondary disabled={busy} onPress={()=>{setPlannedAreas(initialCaptureAreas(visit,photos));setCameraReady(false);setScreen('capture-setup');}} /></View>
          </View>
          {!(phase==='after'&&afterDone)&&<Button label={company?'촬영 완료 · AI 보고서 작성':'촬영 완료 · 보고서 작성'} secondary disabled={!photos.length||busy} onPress={finishCaptureRequested} />}
          <Note>사진을 찍으면 다음 미촬영 구역으로 넘어갑니다. 구역을 다시 누르면 여러 장을 찍을 수 있습니다.</Note>
        </>;})()}
        {screen === 'photos' && visit && <>
          {!photos.length && <Note>아직 사진이 없습니다. 촬영 탭에서 사진을 추가해 주세요.</Note>}
          {photos.length>0&&<Text style={s.muted}>보고서 포함 {photos.filter(p=>p.included).length}장 · 제외 {photos.filter(p=>!p.included).length}장 · 사진을 눌러 {hasBeforePhase(visit.job.kind)?'구역·전후·설명':'구역·단계·설명'}을 고칠 수 있습니다.</Text>}
          {catalog(visit.job.kind).filter(item=>photos.some(p=>p.itemKey===item.key)).map(item=><View key={item.key} style={s.group}>
            <Text style={s.label}>{item.label}</Text>
            <View style={s.wrap}>{photos.filter(p=>p.itemKey===item.key).map(p => <Chip key={p.id} label={`${photos.indexOf(p) + 1} · ${phaseLabel[p.phase]}${p.included?'':' · 제외'}`} active={photoId === p.id} onPress={() => choosePhoto(p)} />)}</View>
          </View>)}
          {photo&&<View style={s.stepper}>
            <View style={s.flex}><Button label="◀ 이전" secondary disabled={busy||photos.indexOf(photo)<=0} onPress={()=>choosePhoto(photos[photos.indexOf(photo)-1]!)} /></View>
            <Text style={s.stepperText}>{photos.indexOf(photo)+1} / {photos.length}</Text>
            <View style={s.flex}><Button label="다음 ▶" secondary disabled={busy||photos.indexOf(photo)>=photos.length-1} onPress={()=>choosePhoto(photos[photos.indexOf(photo)+1]!)} /></View>
          </View>}
          {!photo&&photos.length>0&&<Note>위에서 확인할 사진을 눌러 주세요.</Note>}
          {photo && <View style={s.card}><PhotoImage vault={vault} photo={photo} /><Text style={s.tag}>{catalog(visit.job.kind).find(item=>item.key===photo.itemKey)?.label} · {phaseLabel[photo.phase]} · {stateLabel[photo.state]}</Text>
            <Text style={s.label}>구역</Text><View style={s.wrap}>{catalog(visit.job.kind).map(item => <Chip key={item.key} label={item.label} active={photo.itemKey === item.key} onPress={() => void perform(() => updatePhoto({ itemKey: item.key }))} />)}</View>
            <View style={s.wrap}>{(['before', 'during', 'after'] as Phase[]).filter(p => p !== 'before' || hasBeforePhase(visit.job.kind) || photo.phase === 'before').map(p => <Chip key={p} label={phaseLabel[p]} active={photo.phase === p} onPress={() => void perform(() => updatePhoto({ phase: p }))} />)}</View>
            <View style={s.between}><Text style={s.label}>보고서에 포함</Text><Switch accessibilityLabel="보고서에 사진 포함" value={photo.included} onValueChange={included => void perform(() => updatePhoto({ included }))} /></View>
            <TextInput accessibilityLabel="사진 설명" editable={!busy} placeholder="고객에게 보여도 되는 사진 설명" value={caption} onChangeText={setCaption} maxLength={120} style={s.input} />
            <Button label="사진 설명 저장" secondary disabled={busy} onPress={() => void perform(() => updatePhoto({ caption }))} />
            {canDeletePhoto(photo) ? <Button label="이 사진 삭제" secondary disabled={busy} onPress={() => confirmDelete(photo)} /> : <Note>서버로 보내기 시작한 사진은 지울 수 없습니다. 필요 없으면 '보고서에 포함'을 끄세요.</Note>}
          </View>}<Button label="촬영 계속하기" secondary onPress={() => navigate('capture')} />
        </>}
        {screen === 'report' && visit && <>
          <Note>{company?'초안을 저장하고 내용을 검토한 뒤, PDF를 Drive와 CRM에 보관하세요.':'작성한 내용은 기기에 보관됩니다. 고객 PDF·Drive 보관은 서버 연결 후 사용할 수 있습니다.'}</Note>
          {areas.length>0&&<Note>촬영 현황 · {hasBeforePhase(visit.job.kind)?`작업 전 ${captureProgress(areas,photos,'before').done}/${areas.length}구역 · `:''}작업 후 {captureProgress(areas,photos,'after').done}/{areas.length}구역. 미촬영 구역은 사진이 없는 상태로 보고서에 남습니다.</Note>}
          <Text style={s.h2}>이번 작업 요약</Text><Text style={s.label}>작업 내용</Text><TextInput accessibilityLabel="작업 내용" editable={!busy} multiline maxLength={2000} value={summary} onChangeText={setSummary} style={[s.input, s.textarea]} placeholder="직접 확인한 작업과 결과를 적어 주세요." />
          {company&&<><Note>AI는 촬영 구역과 사진 수만 이용합니다. 사진과 고객 정보는 AI에 보내지 않습니다. 초안의 실제 작업 내용을 확인하고 필요한 내용을 수정해 주세요.</Note>{['stale','edited_stale'].includes(aiDraftState(visit,photos))&&<Note>사진 구역 또는 사진 수가 바뀌었습니다. 작성한 내용을 확인해 주세요.</Note>}{(!summary.trim()||aiDraftState(visit,photos)==='stale')&&<Button label={summary.trim()?'AI 초안 다시 만들기':'AI 보고서 초안 만들기'} secondary disabled={busy||dirty||!photos.length} onPress={()=>void perform(generateAiDraft)} />}</>}
          <View style={s.card}><Text style={s.cardTitle}>작업 정보</Text><Text style={s.body}>작업일 · {visit.job.workDate}{'\n'}작업 종류 · {visit.job.kind==='common'?'공용부청소':'입주청소'}{'\n'}현장 주소 · {visit.job.address || '주소 미기재'}</Text></View>
          <View style={s.card}><Text style={s.cardTitle}>사진 기록 요약</Text><Text style={s.body}>작업 구역 · {areas.length}곳{'\n'}{hasBeforePhase(visit.job.kind)?`작업 전 · ${photos.filter(p=>p.included&&p.phase==='before').length}장　 `:''}작업 중 · {photos.filter(p=>p.included&&p.phase==='during').length}장　 작업 후 · {photos.filter(p=>p.included&&p.phase==='after').length}장</Text></View>
          <Text style={s.h2}>구역별 작업 기록</Text>{areas.length>0&&<Button label={showAllAreas?'촬영 구역만 보기':'다른 구역도 보기'} secondary disabled={busy} onPress={()=>setShowAllAreas(!showAllAreas)}/>}{catalog(visit.job.kind).filter(item=>showAllAreas||!areas.length||areas.includes(item.key)||(visit.draft.statuses[item.key]&&visit.draft.statuses[item.key]!=='recorded')||!!notes[item.key]?.trim()).map(item => <View key={item.key} style={s.card}>
            <Text style={s.cardTitle}>{item.label}</Text><Text style={s.muted}>{hasBeforePhase(visit.job.kind)?`전 ${photos.filter(p=>p.itemKey===item.key&&p.phase==='before'&&p.included).length}장 · `:''}중 {photos.filter(p=>p.itemKey===item.key&&p.phase==='during'&&p.included).length}장 · 후 {photos.filter(p=>p.itemKey===item.key&&p.phase==='after'&&p.included).length}장</Text>
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
          <Note>{documentId?'현재 검토한 내용의 PDF가 Drive·CRM에 보관됐습니다.':'내용 검토 화면입니다. 아래 저장 버튼에서 PDF를 생성하고 보관합니다.'}</Note>
          <View style={s.paper}><Text style={s.brand}>BRING CARE</Text><Text style={s.h1}>{hasBeforePhase(visit.job.kind)?'작업 결과보고서':'공용부 활동 결과보고서'}</Text>{!company&&<Text style={s.paperTag}>TEST · 실제 작업 보고서 아님</Text>}
            <Text style={s.cardTitle}>{visit.job.title}</Text><Text style={s.muted}>{visit.job.workDate} · {visit.job.kind === 'common' ? '공용부청소' : '입주청소'}</Text>
            {hasBeforePhase(visit.job.kind)?<><Text style={s.h2}>작업 내용</Text><Text style={s.body}>{visit.draft.summary || '미기재'}</Text><Text style={s.h2}>후속 조치</Text><Text style={s.body}>{visit.draft.followUp || '미기재'}</Text></>:<><Text style={s.h2}>구역별 사진</Text><Text style={s.body}>{catalog(visit.job.kind).filter(item=>photos.some(p=>p.included&&p.itemKey===item.key)).map(item=>`${item.label} ${photos.filter(p=>p.included&&p.itemKey===item.key).length}장`).join(' · ')||'없음'}</Text><Note>공용부 PDF는 표지·현장 기록 개요·사진 기록(한 쪽에 9장)으로 만들어집니다. 작업 내용·후속 조치는 PDF에 실리지 않습니다.</Note></>}
            <Text style={s.h2}>선택 사진</Text><Text style={s.body}>{photos.filter(p => p.included).length}장 · 기기 보관</Text>
            <Text style={s.footerText}>문의 1551-3873</Text></View>
          {company&&documentId&&<Button label="고객에게 발송하기" disabled={busy||dirty} onPress={()=>navigate('send')}/>}<Button label={company?'PDF 생성 · Drive·CRM 보관':'서버 연결 후 PDF 보관 가능'} disabled={!company||busy||dirty||issues.length>0||visit.draft.confirmedRevision!==visit.revision} onPress={()=>void perform(archiveCurrent)} /><Button label="보고서 편집으로 돌아가기" secondary onPress={() => navigate('report')} />
        </>}
        {screen === 'send' && visit && <><View style={s.card}><Text style={s.cardTitle}>작업 결과보고서 발송</Text><Text style={s.body}>저장된 PDF와 CRM의 고객 연락처를 확인한 뒤 카카오 알림톡으로 보냅니다.</Text><Text style={s.footerText}>문의 1551-3873</Text></View>
          {!company?<Note>가상 현장에서는 고객에게 발송하지 않습니다.</Note>:visit.draft.confirmedRevision!==visit.revision?<><Note>현재 보고서를 먼저 저장해 주세요.</Note><Button label="보고서 작성 화면으로" onPress={()=>navigate('report')} /></>:<>
          {!documentId&&<Note>보관된 보고서를 다시 저장하지 않고 불러옵니다. 아직 보관하지 않은 보고서는 먼저 저장해 주세요.</Note>}
          <Button label={delivery?'수신자·전달 상태 새로 확인':'수신자와 보고서 확인'} secondary disabled={busy} onPress={()=>void perform(checkDelivery)}/>
          {delivery&&delivery.documentId===documentId&&<View style={s.card}><Text style={s.cardTitle}>{delivery.customer}</Text><Text style={s.body}>{delivery.address} · {delivery.workName}</Text><Text style={s.body}>수신 {delivery.recipient}</Text><Text style={s.body}>상태: {({ready:'발송 가능',sending:'발송 처리 중',requested:'발송 요청됨',delivered:'전달 완료',failed:'발송 실패',unknown:'접수 여부 확인 필요'})[delivery.status]}</Text>
            <Text style={s.body}>[BRING CARE 작업 결과보고서 안내]{'\n'}{delivery.address} 건물주님, {delivery.workName} 결과 보고서가 발행되었습니다.{'\n\n'}작업명: {delivery.address} {delivery.workName} 결과보고서{'\n'}열람기한: 발송일로부터 7일{'\n\n'}아래 버튼에서 결과보고서를 확인해 주세요.{'\n'}문의: 1551-3873</Text></View>}
          <Button label="고객에게 카카오톡 발송" disabled={busy||!delivery||!documentId||delivery.documentId!==documentId||!['ready','failed'].includes(delivery.status)} onPress={confirmDelivery} />
          {!documentId&&<Button label="보고서 저장 화면으로" secondary disabled={busy} onPress={()=>navigate('report')}/>}
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
    {vault && <View style={s.tabs}>{([['jobs', '현장', BuildingIcon], ['capture', '촬영', CameraIcon], ['report', '보고서', ReportIcon], ['send', '발송', SendIcon]] as [Screen, string, typeof CameraIcon][]).map(([key, label, Icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: screen === key }} onPress={() => navigate(key)} style={s.tab}><Icon size={24} strokeWidth={screen === key ? 2.2 : 1.8} color={screen === key ? color.primary : color.subtle} /><Text style={[s.tabText, screen === key && s.blue]}>{label}</Text></Pressable>)}</View>}
  </View></SafeAreaView>;
}
const s = brandStyles({
  safe: { flex: 1, backgroundColor: color.bg }, shell: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center', backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 17, backgroundColor: color.surface }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, logo: { width: 44, height: 20, resizeMode: 'contain' }, brand: { fontSize: 11, letterSpacing: 2, color: color.primary, fontWeight: '800' }, headerTitle: { fontSize: 22, fontWeight: '800', color: color.ink, marginTop: 4 }, icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: color.primarySoft }, iconText: { fontSize: 13, color: color.primaryDark, fontWeight: '700' },
  devStrip: { backgroundColor: color.primarySoft, paddingHorizontal: 24, flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:44 }, devText: { fontSize: 12, color: color.primaryDark, fontWeight: '600',flexShrink:1 },backLink:{minHeight:44,justifyContent:'center',paddingHorizontal:8},backLinkText:{fontSize:12,color:color.primary,fontWeight:'700'}, syncStrip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, minHeight: 46, backgroundColor: color.surface, borderBottomWidth: 1, borderColor: color.line }, syncText: { color: color.muted, fontSize: 12 },
  content: { padding: 24, paddingBottom: 42, gap: 16 },captureContent:{paddingHorizontal:16,paddingTop:10,gap:9},captureHeader:{paddingHorizontal:18,paddingVertical:10,backgroundColor:color.surface,flexDirection:'row',justifyContent:'space-between',gap:8},captureSite:{fontSize:13,fontWeight:'700',color:color.ink,flexShrink:1},captureSiteSmall:{fontSize:12,color:color.subtle}, eyebrow: { fontSize: 11, letterSpacing: 1.3, fontWeight: '700', color: color.subtle }, hero: { fontSize: 33, lineHeight: 46, letterSpacing: -1, fontWeight: '800', color: color.ink, marginTop: 20 }, subtitle: { fontSize: 15, lineHeight: 24, color: color.subtle }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, h1: { fontSize: 26, color: color.ink, fontWeight: '800', marginTop: 8 }, h2: { fontSize: 18, color: color.ink, fontWeight: '700', marginTop: 12 },
  card: { backgroundColor: color.surface, borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: color.line }, cardTitle: { fontSize: 17, fontWeight: '700', color: color.ink }, body: { fontSize: 14, lineHeight: 24, color: color.muted }, muted: { fontSize: 12, lineHeight: 19, color: color.subtle }, small: { fontSize: 12, lineHeight: 22, color: color.muted }, tag: { fontSize: 12, fontWeight: '700', color: color.success },
  button: { minHeight: 50, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: color.primary, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, secondary: { backgroundColor: color.primarySoft, borderWidth: 1, borderColor: color.primaryLine }, buttonText: { fontSize: 14, fontWeight: '700', color: color.surface }, secondaryText: { color: color.primaryDark }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 }, note: { borderRadius: 14, backgroundColor: color.fill, padding: 16 }, noteText: { fontSize: 12, lineHeight: 21, color: color.muted },
  progress:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:18,paddingVertical:10,backgroundColor:color.primarySoft},progressText:{color:color.primaryDark,fontSize:13,fontWeight:'600',flexShrink:1},
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, borderRadius: 12, justifyContent: 'center' }, chipActive: { backgroundColor: color.primarySoft, borderColor: color.primary }, chipText: { fontSize: 12, color: color.subtle }, chipTextActive: { color: color.primaryDark, fontWeight: '700' }, phaseRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: color.text }, input: { borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: 14, fontSize: 14, lineHeight: 22, backgroundColor: color.surface, color: color.text, minHeight: 48 }, textarea: { minHeight: 150, textAlignVertical: 'top' }, textareaSmall: { minHeight: 96, textAlignVertical: 'top' },
  siteBar: { padding: 15, backgroundColor: color.fill, borderRadius: 14, gap: 4 }, siteTitle: { fontSize: 13, fontWeight: '700', color: color.text }, guideCard:{backgroundColor:color.ink,borderRadius:14,padding:13,gap:3},guideStep:{color:color.onDarkAccent,fontSize:12,fontWeight:'700'},guideTitle:{color:color.surface,fontSize:20,fontWeight:'800'},guideDetail:{color:color.onDark,fontSize:12,lineHeight:17},cameraFrame:{position:'relative'}, camera: { width: '100%', aspectRatio: 1, maxHeight: 460, borderRadius: 18, overflow: 'hidden' }, cameraPlaceholder: { width: '100%', aspectRatio: 1, maxHeight: 460, backgroundColor: color.ink, borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 15 }, cameraMark: { fontSize: 55, color: color.onDarkAccent, fontWeight: '200' }, cameraText: { fontSize: 13, color: color.onDark }, cameraSmall: { fontSize: 11, color: color.onDarkMuted }, photo: { height: 240, width: '100%', borderRadius: 12, resizeMode: 'contain', backgroundColor: color.fill },referencePhoto:{height:80,width:100},ghost:{position:'absolute',left:0,right:0,top:0,bottom:0,opacity:0.4,borderRadius:18,overflow:'hidden'},ghostPhoto:{width:'100%',height:'100%',resizeMode:'cover'},referenceOverlay:{position:'absolute',right:10,top:10,backgroundColor:color.surface,borderRadius:10,padding:6,gap:3},referenceLabel:{color:color.text,fontSize:11,fontWeight:'700'},
  shutter:{minHeight:68,borderRadius:18,backgroundColor:color.primary,alignItems:'center',justifyContent:'center',paddingVertical:10,gap:2},shutterText:{color:color.surface,fontSize:18,fontWeight:'800'},shutterSub:{color:color.onDark,fontSize:12,fontWeight:'600'},
  lastShot:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:color.surface,borderRadius:14,padding:10,borderWidth:1,borderColor:color.line},undo:{minHeight:44,minWidth:64,borderRadius:12,borderWidth:1,borderColor:color.dangerLine,backgroundColor:color.dangerSoft,alignItems:'center',justifyContent:'center',paddingHorizontal:10},undoText:{color:color.danger,fontWeight:'700',fontSize:13},link:{color:color.primary,fontSize:12,fontWeight:'700',paddingVertical:6},
  doneCard:{backgroundColor:color.successSoft,borderRadius:16,padding:16,gap:8,borderWidth:1,borderColor:color.successLine},doneTitle:{fontSize:15,fontWeight:'800',color:color.success},doneBody:{fontSize:12,lineHeight:19,color:color.success},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:8},gridItem:{flexBasis:'48%',flexGrow:1},group:{gap:8},stepper:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},stepperText:{fontSize:13,fontWeight:'700',color:color.text},
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }, flex: { flex: 1 }, row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: color.line }, rowTitle: { fontSize: 14, fontWeight: '700', color: color.text, marginBottom: 5 }, paper: { backgroundColor: color.surface, padding: 26, borderWidth: 1, borderColor: color.line, gap: 12 }, paperTag: { fontSize: 11, color: color.warning, backgroundColor: color.warningSoft, padding: 10 }, footerText: { fontSize: 12, color: color.muted, paddingTop: 10, lineHeight: 23 }, metrics: { alignItems: 'center', padding: 22, backgroundColor: color.surface, borderRadius: 18 }, metric: { fontSize: 44, color: color.primary, fontWeight: '800' }, metricUnit: { fontSize: 17, fontWeight: '500' },
  tabs: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line, paddingTop: 8, paddingBottom: 8 }, tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }, tabIcon: { fontSize: 23, color: color.subtle }, tabText: { fontSize: 11, color: color.subtle, fontWeight: '700' }, blue: { color: color.primary }, loading: { padding: 5 }, toast: { backgroundColor: color.successSoft, padding: 14 }, error: { backgroundColor: color.dangerSoft }, toastText: { fontSize: 13, lineHeight: 21, color: color.success },
});
