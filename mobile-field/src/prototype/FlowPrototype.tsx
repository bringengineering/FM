import React, { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { brandStyles, color } from '../theme';
import { BackIcon, BuildingIcon, CameraIcon, CheckIcon, NextIcon, NoticeIcon, PinIcon, SearchIcon, UserIcon } from '../icons';

/**
 * 새 화면 흐름 시안(맥 브라우저 미리보기 전용, http://localhost:8099/?proto).
 * 서버·로그인 없이 가상 데이터로 눌러 보며 흐름만 확인한다. 실제 발송은 일어나지 않는다.
 * 알림톡 문구는 실제와 같은 파일(desktop-crm/src/owner-notice-core.js)로 만든다.
 */
interface Field { key: string; label: string; type: string; placeholder?: string }
const core: {
  TURNOVER_FIELDS: Record<string, Field[]>; TURNOVER_STAGES: { id: string; label: string; stage: number }[];
  formatTurnoverValues(id: string, input: Record<string, string>): Record<string, string>; render(id: string, values: Record<string, string>): string;
  missingVariables(id: string, values: Record<string, string>): string[];
} = require('../../../desktop-crm/src/owner-notice-core.js');

const LOGO = require('../../assets/logo-mark.png');
const CUSTOMERS = [
  { id: 'c1', name: '햇살빌라', address: '원주시 단계로 101', kind: '정기 청소', last: '11월 5일 정기 청소', today: true },
  { id: 'c2', name: '푸른주택', address: '원주시 무실로 22', kind: '공용부 관리', last: '11월 3일 공용부 청소', today: true },
  { id: 'c3', name: '한빛맨션', address: '원주시 시청로 7', kind: '폐기물 처리', last: '기록 없음', today: false },
  { id: 'c4', name: '솔숲타운', address: '원주시 북원로 58', kind: '정기 청소', last: '10월 29일 정기 청소', today: false },
];
const ALL = ['owner_move_out', 'owner_broker_listed', 'owner_room_viewing', 'owner_lease_contract', 'owner_move_in_cleaning'];
const unitOf = (id: string, building: string, address: string, unit: string, owner: string, phone: string, done: string[]) => ({ id, building, address, unit, owner, phone, done });
const UNITS = [
  unitOf('u1', '햇살빌라', '원주시 단계로 101', '201', '김가상', '010-****-1234', ['owner_move_out']),
  unitOf('u2', '햇살빌라', '원주시 단계로 101', '305', '김가상', '010-****-1234', ALL.slice(0, 3)),
  unitOf('u3', '햇살빌라', '원주시 단계로 101', '402', '김가상', '010-****-1234', ALL),
  unitOf('u4', '푸른주택', '원주시 무실로 22', '102', '이시안', '010-****-5678', []),
  unitOf('u5', '푸른주택', '원주시 무실로 22', '203', '이시안', '010-****-5678', ALL.slice(0, 4)),
  unitOf('u6', '솔숲타운', '원주시 북원로 58', 'B01', '박예시', '010-****-9012', ALL.slice(0, 1)),
];
const AREAS = ['계단', '복도', '현관', '주차장', '분리수거장'];
type Customer = typeof CUSTOMERS[number]; type Unit = typeof UNITS[number];
type Tab = 'work' | 'notice' | 'me';

function Button({ label, onPress, kind = 'primary', disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'quiet'; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, kind === 'secondary' && s.buttonSecondary, kind === 'quiet' && s.buttonQuiet, disabled && s.disabled, pressed && s.pressed]}>
    <Text style={[s.buttonText, kind !== 'primary' && s.buttonTextAlt]}>{label}</Text></Pressable>;
}
function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <View style={s.search}><SearchIcon size={18} color={color.subtle} /><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={color.subtle} style={s.searchInput} /></View>;
}
function Header({ title, onBack, sub }: { title: string; onBack?: () => void; sub?: string }) {
  return <View style={s.header}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={onBack} style={s.back}><BackIcon size={24} color={color.ink} /></Pressable>
      : <View style={s.logoBox}><Image source={LOGO} style={s.logo} accessibilityLabel="브링케어" /></View>}
    <View style={s.flex}><Text style={s.headerTitle} numberOfLines={1}>{title}</Text>{!!sub && <Text style={s.headerSub} numberOfLines={1}>{sub}</Text>}</View>
  </View>;
}
function Steps({ step }: { step: number }) {
  return <View style={s.steps}>{['촬영', '보고서', '발송'].map((label, i) => <View key={label} style={s.stepItem}>
    <View style={[s.stepDot, i < step && s.stepDone, i === step && s.stepNow]}>{i < step ? <CheckIcon size={14} color={color.surface} strokeWidth={3} /> : <Text style={[s.stepNum, i === step && s.stepNumNow]}>{i + 1}</Text>}</View>
    <Text style={[s.stepLabel, i === step && s.stepLabelNow]}>{label}</Text>
    {i < 2 && <View style={[s.stepLine, i < step && s.stepLineDone]} />}
  </View>)}</View>;
}

/* ── 오늘 현장 ─────────────────────────────── */
function WorkTab() {
  const [query, setQuery] = useState(''); const [site, setSite] = useState<Customer>();
  const list = CUSTOMERS.filter(c => !query.trim() || (c.name + c.address).includes(query.trim()));
  if (site) return <WorkFlow site={site} onClose={() => setSite(undefined)} />;
  const today = list.filter(c => c.today), rest = list.filter(c => !c.today);
  const row = (c: Customer) => <Pressable key={c.id} accessibilityRole="button" onPress={() => setSite(c)} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
    <View style={s.rowIcon}><BuildingIcon size={20} color={color.primary} /></View>
    <View style={s.flex}><Text style={s.rowTitle}>{c.name} <Text style={s.rowKind}>· {c.kind}</Text></Text><Text style={s.rowSub}>{c.address}</Text><Text style={s.rowMeta}>최근 {c.last}</Text></View>
    <NextIcon size={20} color={color.subtle} /></Pressable>;
  return <><Header title="오늘 현장" sub="11월 11일 (화)" /><ScrollView contentContainerStyle={s.body}>
    <Search value={query} onChange={setQuery} placeholder="고객명 또는 건물주소" />
    {!!today.length && <><Text style={s.section}>오늘 일정</Text><View style={s.group}>{today.map(row)}</View></>}
    {!!rest.length && <><Text style={s.section}>다른 고객</Text><View style={s.group}>{rest.map(row)}</View></>}
    {!list.length && <Text style={s.empty}>일치하는 고객이 없습니다.</Text>}
  </ScrollView></>;
}
function WorkFlow({ site, onClose }: { site: Customer; onClose: () => void }) {
  const [step, setStep] = useState(0); const [area, setArea] = useState(AREAS[0]!);
  const [shots, setShots] = useState<Record<string, number>>({}); const [memo, setMemo] = useState(''); const [sent, setSent] = useState(false);
  const total = Object.values(shots).reduce((a, b) => a + b, 0);
  return <><Header title={site.name} sub={site.address} onBack={step === 0 || sent ? onClose : () => setStep(step - 1)} />
    <Steps step={sent ? 3 : step} />
    <ScrollView contentContainerStyle={s.body}>
      {step === 0 && <>
        <View style={s.chips}>{AREAS.map(a => <Pressable key={a} onPress={() => setArea(a)} style={[s.chip, area === a && s.chipOn]}>
          <Text style={[s.chipText, area === a && s.chipTextOn]}>{a}{shots[a] ? ` ${shots[a]}` : ''}</Text></Pressable>)}</View>
        <View style={s.camera}><CameraIcon size={48} color={color.onDarkAccent} strokeWidth={1.5} /><Text style={s.cameraText}>{area} 촬영 화면</Text><Text style={s.cameraSmall}>시안에서는 사진 대신 장수만 셉니다</Text></View>
        <Pressable accessibilityRole="button" onPress={() => setShots({ ...shots, [area]: (shots[area] ?? 0) + 1 })} style={({ pressed }) => [s.shutter, pressed && s.pressed]}>
          <Text style={s.shutterText}>{area} 찍기</Text></Pressable>
        <Text style={s.hint}>지금까지 {total}장 · 구역을 바꿔 가며 찍으세요</Text>
      </>}
      {step === 1 && <>
        <View style={s.card}><Text style={s.cardTitle}>사진 {total}장</Text>
          {AREAS.map(a => <View key={a} style={s.between}><Text style={s.text}>{a}</Text><Text style={shots[a] ? s.ok : s.missing}>{shots[a] ? `${shots[a]}장` : '사진 없음'}</Text></View>)}</View>
        <View style={s.card}><Text style={s.cardTitle}>특이사항</Text>
          <TextInput value={memo} onChangeText={setMemo} placeholder="예: 3층 복도 전등 교체 필요" placeholderTextColor={color.subtle} multiline style={[s.input, s.memo]} /></View>
      </>}
      {step === 2 && !sent && <View style={s.card}><Text style={s.cardTitle}>보내기 전 확인</Text>
        <View style={s.between}><Text style={s.text}>받는 분</Text><Text style={s.strong}>{site.name} 담당 · 010-****-0000</Text></View>
        <View style={s.between}><Text style={s.text}>보고서</Text><Text style={s.strong}>{site.kind} 결과보고서</Text></View>
        <View style={s.between}><Text style={s.text}>사진</Text><Text style={s.strong}>{total}장</Text></View>
        <Text style={s.hint}>카카오 알림톡으로 보고서 링크가 갑니다.</Text></View>}
      {sent && <View style={s.done}><CheckIcon size={36} color={color.success} strokeWidth={2.5} /><Text style={s.doneTitle}>발송 접수됨</Text><Text style={s.text}>카카오 전달 결과는 CRM 발송 내역에서도 확인할 수 있습니다.</Text></View>}
    </ScrollView>
    <View style={s.footer}>
      {step === 0 && <Button label={total ? `다음 · 보고서 확인 (${total}장)` : '사진을 한 장 이상 찍어 주세요'} disabled={!total} onPress={() => setStep(1)} />}
      {step === 1 && <Button label="다음 · 발송 확인" onPress={() => setStep(2)} />}
      {step === 2 && !sent && <Button label="카카오로 보고서 보내기" onPress={() => setSent(true)} />}
      {sent && <Button label="현장 목록으로" kind="secondary" onPress={onClose} />}
    </View></>;
}

/* ── 안내 알림톡 ─────────────────────────────── */
function NoticeTab() {
  const [query, setQuery] = useState(''); const [unit, setUnit] = useState<Unit>(); const [open, setOpen] = useState<Record<string, boolean>>({ '햇살빌라': true });
  if (unit) return <NoticeFlow unit={unit} onClose={() => setUnit(undefined)} />;
  const q = query.trim();
  const list = UNITS.filter(u => !q || (u.building + u.address + u.unit + u.owner).includes(q));
  const buildings = [...new Set(list.map(u => u.building))].map(name => ({ name, units: list.filter(u => u.building === name) }));
  return <><Header title="안내 알림톡" sub="건물주에게 퇴실~입주 단계 안내" /><ScrollView contentContainerStyle={s.body}>
    <Search value={query} onChange={setQuery} placeholder="건물명, 주소, 호실, 건물주" />
    {buildings.map(({ name, units }) => {
      const first = units[0]!, expanded = !!q || !!open[name];
      const active = units.filter(u => u.done.length && u.done.length < ALL.length).length;
      return <View key={name} style={s.group}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen({ ...open, [name]: !open[name] })} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
          <View style={s.rowIcon}><BuildingIcon size={20} color={color.primary} /></View>
          <View style={s.flex}><Text style={s.rowTitle}>{name}</Text><Text style={s.rowSub}>{first.address} · 건물주 {first.owner}</Text>
            <Text style={s.rowMeta}>호실 {units.length}개{active ? ` · 진행 중 ${active}` : ''}</Text></View>
          <View style={expanded ? s.chevronOpen : undefined}><NextIcon size={20} color={color.subtle} /></View></Pressable>
        {expanded && units.map(u => {
          const next = core.TURNOVER_STAGES.find(st => !u.done.includes(st.id));
          return <Pressable key={u.id} accessibilityRole="button" onPress={() => setUnit(u)} style={({ pressed }) => [s.unitRow, pressed && s.rowPressed]}>
            <Text style={s.unitNo}>{u.unit}호</Text>
            <View style={s.flex}><View style={[s.progress, s.progressTight]}>{core.TURNOVER_STAGES.map(st => <View key={st.id} style={[s.progressBar, u.done.includes(st.id) && s.progressOn]} />)}</View>
              <Text style={[s.rowMeta, !next && s.doneMeta]}>{next ? `다음: ${next.label}` : '입주청소까지 완료'}</Text></View>
            <NextIcon size={18} color={color.subtle} /></Pressable>;
        })}
      </View>;
    })}
    {!buildings.length && <Text style={s.empty}>일치하는 건물·호실이 없습니다.</Text>}
  </ScrollView></>;
}
function NoticeFlow({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const firstOpen = core.TURNOVER_STAGES.find(st => !unit.done.includes(st.id))?.id ?? core.TURNOVER_STAGES[0]!.id;
  const [stage, setStage] = useState(firstOpen); const [input, setInput] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false); const [sent, setSent] = useState(false);
  const fields = core.TURNOVER_FIELDS[stage] ?? [];
  const values = useMemo(() => ({ ...core.formatTurnoverValues(stage, input), 건물주소: unit.address, 호실: unit.unit }), [stage, input, unit]);
  const missing = core.missingVariables(stage, values); const preview = core.render(stage, values);
  const already = unit.done.includes(stage);
  return <><Header title={`${unit.building} ${unit.unit}호`} sub={`${unit.address} · 건물주 ${unit.owner}`} onBack={onClose} />
    <ScrollView contentContainerStyle={s.body}>
      {sent ? <View style={s.done}><CheckIcon size={36} color={color.success} strokeWidth={2.5} /><Text style={s.doneTitle}>발송 접수됨</Text><Text style={s.text}>{unit.owner}님({unit.phone})께 알림톡을 보냈습니다. 시안이라 실제로는 보내지 않았습니다.</Text></View> : <>
        <Text style={s.section}>단계</Text>
        <View style={s.stageList}>{core.TURNOVER_STAGES.map(st => {
          const done = unit.done.includes(st.id), on = st.id === stage;
          return <Pressable key={st.id} onPress={() => { setStage(st.id); setInput({}); }} style={[s.stage, on && s.stageOn]}>
            <View style={[s.stageNum, done && s.stepDone, on && !done && s.stepNow]}>{done ? <CheckIcon size={12} color={color.surface} strokeWidth={3} /> : <Text style={[s.stepNum, on && s.stepNumNow]}>{st.stage}</Text>}</View>
            <Text style={[s.stageText, on && s.stageTextOn]}>{st.label}</Text>{done && <Text style={s.stageSent}>보냄</Text>}</Pressable>;
        })}</View>
        {already && <Text style={s.warn}>이미 보낸 단계입니다. 다시 보내면 건물주님이 같은 안내를 한 번 더 받습니다.</Text>}
        <Text style={s.section}>입력</Text>
        <View style={s.card}>{fields.map(f => <View key={f.key} style={s.field}><Text style={s.label}>{f.label}</Text>
          <TextInput value={input[f.key] ?? ''} onChangeText={v => setInput({ ...input, [f.key]: v })} placeholderTextColor={color.subtle}
            placeholder={f.placeholder ?? (f.type === 'date' ? '2026-11-12' : f.type === 'time' ? '10:00' : '2026-11-12T14:00')} style={s.input} /></View>)}
          <Text style={s.hint}>앱에서는 날짜·시간을 달력으로 고릅니다.</Text></View>
        <Text style={s.section}>미리보기</Text>
        <View style={s.preview}><Text style={s.previewText}>{preview}</Text></View>
      </>}
    </ScrollView>
    <View style={s.footer}>{sent ? <Button label="호실 목록으로" kind="secondary" onPress={onClose} />
      : <Button label={missing.length ? `${missing.join(', ')} 입력 필요` : '보내기 전 확인'} disabled={!!missing.length} onPress={() => setConfirm(true)} />}</View>
    <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => setConfirm(false)}>
      <View style={s.sheetBack}><View style={s.sheet}>
        <Text style={s.cardTitle}>이 내용으로 보낼까요?</Text>
        <Text style={s.text}>받는 분: 건물주 {unit.owner} · {unit.phone}</Text>
        <ScrollView style={s.sheetPreview}><Text style={s.previewText}>{preview}</Text></ScrollView>
        <View style={s.sheetButtons}><View style={s.flex}><Button label="취소" kind="secondary" onPress={() => setConfirm(false)} /></View>
          <View style={s.flex}><Button label="보내기" onPress={() => { setConfirm(false); setSent(true); }} /></View></View>
      </View></View>
    </Modal></>;
}

/* ── 내 정보 ─────────────────────────────── */
function MeTab() {
  return <><Header title="내 정보" /><ScrollView contentContainerStyle={s.body}>
    <View style={s.card}><Text style={s.cardTitle}>가상 관리자</Text><Text style={s.text}>admin@example.test · 관리자</Text></View>
    <View style={s.group}>
      <View style={s.row}><Text style={[s.text, s.flex]}>고객 목록 새로고침</Text><NextIcon size={20} color={color.subtle} /></View>
      <View style={s.row}><Text style={[s.text, s.flex]}>앱 버전</Text><Text style={s.rowMeta}>0.1.18</Text></View>
      <View style={s.row}><Text style={[s.dangerText, s.flex]}>로그아웃</Text></View>
    </View>
  </ScrollView></>;
}

export function FlowPrototype() {
  const [tab, setTab] = useState<Tab>('work');
  const tabs: [Tab, string, typeof CameraIcon][] = [['work', '오늘 현장', BuildingIcon], ['notice', '안내 알림톡', NoticeIcon], ['me', '내 정보', UserIcon]];
  return <View style={s.page}><View style={s.phone}>
    <View style={s.proto}><Text style={s.protoText}>시안 · 가상 데이터 · 실제 발송 없음</Text></View>
    <View style={s.flex}>{tab === 'work' ? <WorkTab /> : tab === 'notice' ? <NoticeTab /> : <MeTab />}</View>
    <View style={s.tabs}>{tabs.map(([key, label, Icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={s.tab}>
      <Icon size={24} strokeWidth={tab === key ? 2.2 : 1.8} color={tab === key ? color.primary : color.subtle} />
      <Text style={[s.tabText, tab === key && s.tabTextOn]}>{label}</Text></Pressable>)}</View>
  </View></View>;
}

const s = brandStyles({
  page: { flex: 1, backgroundColor: '#E3E6EA', alignItems: 'center' },
  phone: { flex: 1, width: '100%', maxWidth: 420, backgroundColor: color.bg, overflow: 'hidden' },
  proto: { backgroundColor: color.warningSoft, paddingVertical: 6, alignItems: 'center' }, protoText: { fontSize: 11, fontWeight: '700', color: color.warning },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, backgroundColor: color.surface },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  logoBox: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, logo: { width: 36, height: 18, resizeMode: 'contain' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: color.ink }, headerSub: { fontSize: 13, color: color.subtle, marginTop: 2 },
  body: { padding: 16, gap: 12, paddingBottom: 28 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.surface, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: color.line },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: color.ink, paddingVertical: 12 },
  section: { fontSize: 13, fontWeight: '700', color: color.muted, marginTop: 6 },
  group: { backgroundColor: color.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: color.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: color.line, minHeight: 56 },
  rowPressed: { backgroundColor: color.fill },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: color.ink }, rowKind: { fontSize: 13, fontWeight: '600', color: color.primary },
  rowSub: { fontSize: 14, color: color.muted, marginTop: 2 }, rowMeta: { fontSize: 12, color: color.subtle, marginTop: 4 },
  empty: { fontSize: 14, color: color.subtle, textAlign: 'center', paddingVertical: 24 },
  steps: { flexDirection: 'row', backgroundColor: color.surface, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderColor: color.line },
  stepItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: color.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  stepNow: { borderColor: color.primary }, stepDone: { backgroundColor: color.primary, borderColor: color.primary },
  stepNum: { fontSize: 12, fontWeight: '700', color: color.subtle }, stepNumNow: { color: color.primary },
  stepLabel: { fontSize: 13, color: color.subtle, fontWeight: '600' }, stepLabelNow: { color: color.ink, fontWeight: '700' },
  stepLine: { flex: 1, height: 1.5, backgroundColor: color.line, marginHorizontal: 4 }, stepLineDone: { backgroundColor: color.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary }, chipText: { fontSize: 14, fontWeight: '600', color: color.text }, chipTextOn: { color: color.surface },
  camera: { aspectRatio: 4 / 3, borderRadius: 18, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', gap: 10 },
  cameraText: { fontSize: 15, fontWeight: '700', color: color.onDark }, cameraSmall: { fontSize: 12, color: color.onDarkMuted },
  shutter: { minHeight: 64, borderRadius: 18, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' }, shutterText: { fontSize: 18, fontWeight: '800', color: color.surface },
  hint: { fontSize: 13, lineHeight: 19, color: color.subtle },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: color.line },
  cardTitle: { fontSize: 17, fontWeight: '700', color: color.ink },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  text: { fontSize: 15, lineHeight: 22, color: color.muted }, strong: { fontSize: 15, fontWeight: '700', color: color.ink, flexShrink: 1, textAlign: 'right' },
  ok: { fontSize: 15, fontWeight: '700', color: color.primary }, missing: { fontSize: 14, color: color.subtle },
  input: { borderWidth: 1, borderColor: color.lineStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: color.ink, backgroundColor: color.surface },
  memo: { minHeight: 90, textAlignVertical: 'top' },
  field: { gap: 6 }, label: { fontSize: 14, fontWeight: '600', color: color.text },
  stageList: { backgroundColor: color.surface, borderRadius: 16, borderWidth: 1, borderColor: color.line, overflow: 'hidden' },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderColor: color.line },
  stageOn: { backgroundColor: color.primarySoft }, stageNum: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: color.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  stageText: { flex: 1, fontSize: 15, color: color.text }, stageTextOn: { fontWeight: '700', color: color.primaryDark }, stageSent: { fontSize: 12, color: color.subtle },
  progress: { flexDirection: 'row', gap: 3, marginTop: 8 }, progressTight: { marginTop: 0 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 68, paddingRight: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: color.line, backgroundColor: color.fill },
  unitNo: { width: 52, fontSize: 16, fontWeight: '700', color: color.ink }, doneMeta: { color: color.success },
  chevronOpen: { transform: [{ rotate: '90deg' }] }, progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line }, progressOn: { backgroundColor: color.primary },
  warn: { fontSize: 13, lineHeight: 19, color: color.warning, backgroundColor: color.warningSoft, padding: 12, borderRadius: 10 },
  preview: { backgroundColor: color.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: color.line },
  previewText: { fontSize: 14, lineHeight: 21, color: color.text },
  done: { alignItems: 'center', gap: 8, padding: 28, backgroundColor: color.surface, borderRadius: 16, borderWidth: 1, borderColor: color.line },
  doneTitle: { fontSize: 20, fontWeight: '800', color: color.ink },
  footer: { padding: 16, backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonSecondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.lineStrong }, buttonQuiet: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 16, fontWeight: '700', color: color.surface }, buttonTextAlt: { color: color.ink },
  disabled: { opacity: 0.4 }, pressed: { opacity: 0.75 },
  dangerText: { fontSize: 15, fontWeight: '600', color: color.danger },
  sheetBack: { flex: 1, backgroundColor: 'rgba(25,31,40,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  sheetPreview: { maxHeight: 260, backgroundColor: color.fill, borderRadius: 12, padding: 12 }, sheetButtons: { flexDirection: 'row', gap: 10 },
  tabs: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line, paddingVertical: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 54 },
  tabText: { fontSize: 11, fontWeight: '600', color: color.subtle }, tabTextOn: { color: color.primary, fontWeight: '700' },
});
