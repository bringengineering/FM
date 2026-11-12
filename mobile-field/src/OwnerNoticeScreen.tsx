import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { brandStyles, color } from './theme';
import { BuildingIcon, CheckIcon, NextIcon } from './icons';
import { Button, Callout, ConfirmSheet, k, ScreenHeader, SearchBox, Section } from './ui/kit';
import { safeMessage } from './errors';
import { afterSend, carried, cycleState, dayLabel, groupByBuilding, MOVE_OUT, stageNotice } from './domain/owner-notice-flow';
import type { CompanyRecordingApi, OwnerNoticeReceipt, OwnerNoticeUnit } from './api/recording';

// CRM과 같은 문구·입력칸 규칙(desktop-crm/src/owner-notice-core.js). 서버가 같은 파일로 문구를 다시 만들어
// 확인 창에 보여 준 문구와 한 글자라도 다르면 보내지 않는다.
interface Field { key: string; label: string; type: 'date' | 'time' | 'datetime-local' | 'text'; placeholder?: string }
interface Core {
  TEMPLATES: Record<string, { id: string; label: string; stage?: number; repeatable?: boolean }>;
  TURNOVER_FIELDS: Record<string, Field[]>;
  TURNOVER_STAGES: { id: string; label: string; stage: number }[];
  formatTurnoverValues(templateId: string, input: Record<string, string>): Record<string, string>;
  render(templateId: string, values: Record<string, string>): string;
  missingVariables(templateId: string, values: Record<string, string>): string[];
  nextTurnoverStage(progress: { id: string; count: number }[]): string;
}
const core: Core = require('../../desktop-crm/src/owner-notice-core.js');

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeKey = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function parse(type: Field['type'], value: string): Date {
  const now = new Date();
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value), time = /(\d{2}):(\d{2})$/.exec(value);
  if (date) now.setFullYear(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
  if (time && type !== 'date') now.setHours(Number(time[1]), Number(time[2]), 0, 0);
  return now;
}
const label = (id: string) => core.TEMPLATES[id]?.label ?? id;
const deliveryLabel: Record<OwnerNoticeReceipt['status'], string> = { accepted: '발송 접수됨 · 전달 확인 중', delivered: '카카오 전달 완료', failed: '전달 실패', unknown: '접수 여부 확인 필요' };
const defaults = (stage: string): Record<string, string> => stage === 'owner_broker_listed' ? { 접수일: dateKey(new Date()) } : {};

function FieldInput({ field, value, onChange, carriedValue }: { field: Field; value: string; onChange: (value: string) => void; carriedValue: boolean }) {
  const [open, setOpen] = useState<'date' | 'time' | ''>('');
  const title = <Text style={s.label}>{field.label}{carriedValue ? <Text style={s.carried}>  · 앞 단계 값</Text> : null}</Text>;
  if (field.type === 'text') return <View style={s.field}>{title}
    <TextInput accessibilityLabel={field.label} value={value} onChangeText={onChange} placeholder={field.placeholder} placeholderTextColor={color.subtle} maxLength={60} style={k.input} /></View>;
  const current = parse(field.type, value);
  const shown = value ? value.replace('T', ' ') : '눌러서 고르기';
  function picked(event: DateTimePickerEvent, date?: Date) {
    const mode = open; if (Platform.OS === 'android') setOpen('');
    if (event.type !== 'set' || !date) return;
    if (field.type === 'date') onChange(dateKey(date));
    else if (field.type === 'time') onChange(timeKey(date));
    else if (mode === 'date') { onChange(`${dateKey(date)}T${value ? timeKey(current) : '10:00'}`); if (Platform.OS === 'android') setOpen('time'); }
    else onChange(`${dateKey(current)}T${timeKey(date)}`);
  }
  return <View style={s.field}>{title}
    <Pressable accessibilityRole="button" accessibilityLabel={`${field.label} ${shown}`} onPress={() => setOpen(field.type === 'time' ? 'time' : 'date')} style={k.input}>
      <Text style={[s.inputText, !value && s.placeholder]}>{shown}</Text></Pressable>
    {field.type === 'datetime-local' && !!value && <Pressable accessibilityRole="button" onPress={() => setOpen('time')}><Text style={s.link}>시각 바꾸기</Text></Pressable>}
    {!!open && <DateTimePicker value={current} mode={open} is24Hour display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={picked} />}
    {Platform.OS === 'ios' && !!open && <Button kind="secondary" label="선택 완료" onPress={() => setOpen('')} />}
  </View>;
}

/** 하단 '안내 알림톡' 탭: 건물별 호실 목록 → 호실 → 단계·입력·미리보기 → 확인 → 발송. */
export function OwnerNoticeScreen({ api }: { api: CompanyRecordingApi }) {
  const controller = useRef(new AbortController());
  const [units, setUnits] = useState<OwnerNoticeUnit[]>(), [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [unitId, setUnitId] = useState(''), [stage, setStage] = useState(''), [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  // 응답을 잃어버린 뒤 다시 누르면 같은 요청 ID로 보내서 서버가 두 번 보내지 않게 한다.
  const [pending, setPending] = useState<{ key: string; requestId: string }>();
  const [receipt, setReceipt] = useState<OwnerNoticeReceipt & { stage: string }>();
  // 앞 단계에서 넣은 중개사무소·입주일(이 기기, 앱을 켜 둔 동안만).
  const memory = useRef(new Map<string, Record<string, string>>());
  useEffect(() => () => controller.current.abort(), []);

  async function load() {
    setLoading(true); setError('');
    try { const result = await api.ownerNoticeUnits(controller.current.signal); setUnits(result.units); setTruncated(result.truncated); }
    catch (e) { setError(safeMessage(e)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const unit = units?.find(u => u.id === unitId);
  const fields = stage ? core.TURNOVER_FIELDS[stage] ?? [] : [];
  const filled = useMemo(() => unit && stage ? { ...core.formatTurnoverValues(stage, values), 건물주소: unit.address, 호실: unit.unit } : {}, [unit, stage, values]);
  const preview = unit && stage ? core.render(stage, filled) : '';
  const missing = unit && stage ? core.missingVariables(stage, filled).map(key => fields.find(f => f.key === key)?.label ?? key) : [];
  const notice = unit && stage ? stageNotice(core.TURNOVER_STAGES, unit.progress, stage) : null;
  const remembered = memory.current.get(unitId) ?? {};

  function pick(next: string, id = unitId) { setStage(next); setValues({ ...defaults(next), ...(memory.current.get(id) ?? {}) }); setReceipt(undefined); setPending(undefined); }
  function openUnit(next: OwnerNoticeUnit) { setUnitId(next.id); setError(''); pick(next.nextStage, next.id); }
  function close() { setUnitId(''); setStage(''); setReceipt(undefined); setPending(undefined); setError(''); }

  async function send() {
    setConfirm(false);
    if (!unit || !stage || busy) return;
    const key = JSON.stringify([unit.id, stage, preview]);
    const requestId = pending?.key === key ? pending.requestId : Crypto.randomUUID().toLowerCase();
    setPending({ key, requestId }); setBusy(true); setError('');
    try {
      const result = await api.sendOwnerNotice({ requestId, unitId: unit.id, templateId: stage, input: values, preview }, controller.current.signal);
      memory.current.set(unit.id, { ...(memory.current.get(unit.id) ?? {}), ...carried(values) });
      setUnits(list => list?.map(u => u.id === unit.id ? { ...u, progress: afterSend(u.progress, stage, new Date().toISOString()) } : u));
      setReceipt({ ...result, stage }); setPending(undefined);
    } catch (e) { setError(safeMessage(e)); } finally { setBusy(false); }
  }
  async function check() {
    if (!receipt || busy) return;
    setBusy(true); setError('');
    try { const result = await api.ownerNoticeStatus(receipt.requestId, controller.current.signal); setReceipt({ ...receipt, ...result }); }
    catch (e) { setError(safeMessage(e)); } finally { setBusy(false); }
  }

  if (!unit) {
    const groups = groupByBuilding(units ?? [], query);
    return <View style={k.flex}>
      <ScreenHeader title="안내 알림톡" sub="건물주에게 퇴실~입주 단계 안내" />
      <ScrollView contentContainerStyle={k.body} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading && !!units} onRefresh={() => void load()} />}>
        <SearchBox value={query} onChange={setQuery} placeholder="건물명, 주소, 호실, 건물주" />
        {!!error && <Callout tone="error" text={error} />}
        {!units && loading && <ActivityIndicator accessibilityLabel="호실 불러오는 중" style={s.spinner} />}
        {!units && !loading && <Button kind="secondary" label="다시 불러오기" onPress={() => void load()} />}
        {truncated && <Text style={k.small}>호실이 많아 앞쪽 250개만 보입니다. 검색어로 좁혀 주세요.</Text>}
        {groups.map(group => {
          const expanded = !!query.trim() || !!open[group.buildingId] || groups.length === 1;
          return <View key={group.buildingId} style={k.group}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen({ ...open, [group.buildingId]: !open[group.buildingId] })} style={({ pressed }) => [k.row, pressed && k.rowPressed]}>
              <View style={k.rowIcon}><BuildingIcon size={20} color={color.primary} /></View>
              <View style={k.flex}><Text style={k.rowTitle} numberOfLines={1}>{group.name}</Text><Text style={k.rowSub} numberOfLines={1}>{group.name !== group.address ? `${group.address} · ` : ''}건물주 {group.owner}</Text>
                <Text style={k.rowMeta}>호실 {group.units.length}개{group.active ? ` · 공실 진행 중 ${group.active}` : ''}</Text></View>
              <View style={expanded ? s.chevronOpen : undefined}><NextIcon size={20} color={color.subtle} /></View></Pressable>
            {expanded && group.units.map(u => {
              const cycle = cycleState(u.progress);
              const meta = !cycle.started ? '보낸 안내 없음 · 퇴실 일정이 잡히면 시작' : cycle.complete ? '입주청소까지 완료' : `다음: ${label(u.nextStage)}`;
              return <Pressable key={u.id} accessibilityRole="button" accessibilityLabel={`${u.unit}호 ${meta}`} onPress={() => openUnit(u)} style={({ pressed }) => [s.unitRow, pressed && k.rowPressed]}>
                <Text style={s.unitNo} numberOfLines={1}>{u.unit}호</Text>
                <View style={k.flex}><View style={s.progress}>{core.TURNOVER_STAGES.map(st => <View key={st.id} style={[s.bar, (u.progress.find(p => p.id === st.id)?.count ?? 0) > 0 && s.barOn]} />)}</View>
                  <Text style={[k.rowMeta, cycle.complete && s.doneMeta]}>{meta}</Text></View>
                <NextIcon size={18} color={color.subtle} /></Pressable>;
            })}
          </View>;
        })}
        {units && !groups.length && <Text style={k.empty}>{units.length ? '일치하는 건물·호실이 없습니다.' : '보낼 수 있는 호실이 없습니다. CRM에서 호실과 건물주(휴대전화 포함)를 확인해 주세요.'}</Text>}
      </ScrollView>
    </View>;
  }

  const startingNewCycle = stage === MOVE_OUT && cycleState(unit.progress).complete;
  const following = receipt && receipt.status !== 'failed' ? core.nextTurnoverStage(unit.progress) : '';
  return <View style={k.flex}>
    <ScreenHeader title={`${unit.building || unit.address} ${unit.unit}호`} sub={`${unit.building ? `${unit.address} · ` : ''}건물주 ${unit.owner}`} onBack={close} />
    <ScrollView contentContainerStyle={k.body} keyboardShouldPersistTaps="handled">
      {!!error && <Callout tone="error" text={error} />}
      {receipt ? <View style={s.done}>
        <CheckIcon size={36} color={receipt.status === 'failed' ? color.danger : color.success} strokeWidth={2.5} />
        <Text style={s.doneTitle}>{deliveryLabel[receipt.status]}</Text>
        <Text style={[k.text, s.center]}>{label(receipt.stage)}를 건물주 {unit.owner}님({receipt.recipient ?? unit.recipient})께 보냈습니다.</Text>
        {receipt.status !== 'delivered' && <Button kind="secondary" label="전달 상태 확인" busy={busy} onPress={() => void check()} />}
      </View> : <>
        <Section title={cycleState(unit.progress).active ? '이번 회차 단계' : '단계'} />
        <View style={k.group}>{core.TURNOVER_STAGES.map(st => {
          const p = unit.progress.find(item => item.id === st.id), done = !!p?.count && !startingNewCycle, on = st.id === stage;
          return <Pressable key={st.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => pick(st.id)} style={[s.stage, on && s.stageOn]}>
            <View style={[s.dot, done && s.dotDone, on && !done && s.dotNow]}>{done ? <CheckIcon size={12} color={color.surface} strokeWidth={3} /> : <Text style={[s.dotNum, on && s.dotNumNow]}>{st.stage}</Text>}</View>
            <Text style={[s.stageText, on && s.stageTextOn]}>{st.label}</Text>
            {done && <Text style={k.small}>{dayLabel(p!.lastSentAt)}{p!.count > 1 ? ` · ${p!.count}회` : ''}</Text>}</Pressable>;
        })}</View>
        {notice && <Callout tone={notice.tone} text={notice.text} />}
        <Section title="입력" />
        <View style={k.card}>{fields.map(field => <FieldInput key={`${stage}-${field.key}`} field={field} value={values[field.key] ?? ''}
          carriedValue={!!remembered[field.key] && values[field.key] === remembered[field.key]}
          onChange={value => { setValues(prev => ({ ...prev, [field.key]: value })); setPending(undefined); }} />)}</View>
        <Section title="미리보기" />
        <View style={k.card}><Text style={s.previewText}>{preview}</Text></View>
        {pending && !busy && <Callout tone="warn" text="발송 접수를 확인하지 못했습니다. 다시 누르면 같은 요청으로 확인하며 두 번 보내지 않습니다." />}
      </>}
    </ScrollView>
    <View style={k.footer}>{receipt ? <>
        {!!following && following !== MOVE_OUT && <Button label={`이어서 · ${label(following)}`} onPress={() => pick(following)} />}
        <Button kind="secondary" label="호실 목록으로" onPress={close} /></>
      : <Button label={missing.length ? `${missing.join(', ')} 입력 필요` : '보내기 전 확인'} busy={busy} disabled={!!missing.length} onPress={() => setConfirm(true)} />}</View>
    <ConfirmSheet visible={confirm} title={`${label(stage)}를 보낼까요?`} confirmLabel="알림톡 보내기" onConfirm={() => void send()} onCancel={() => setConfirm(false)}>
      <Text style={k.text}>받는 분: 건물주 {unit.owner} · {unit.recipient}</Text>
      {notice?.tone === 'warn' && <Callout tone="warn" text={notice.text} />}
      <View style={s.sheetPreview}><Text style={s.previewText}>{preview}</Text></View>
    </ConfirmSheet>
  </View>;
}

const s = brandStyles({
  spinner: { paddingVertical: 24 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 68, paddingRight: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: color.line, backgroundColor: color.fill, minHeight: 56 },
  unitNo: { width: 60, fontSize: 16, fontWeight: '700', color: color.ink }, doneMeta: { color: color.success },
  progress: { flexDirection: 'row', gap: 3 }, bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line }, barOn: { backgroundColor: color.primary },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderColor: color.line, minHeight: 50 },
  stageOn: { backgroundColor: color.primarySoft },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: color.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  dotNow: { borderColor: color.primary }, dotDone: { backgroundColor: color.primary, borderColor: color.primary },
  dotNum: { fontSize: 12, fontWeight: '700', color: color.subtle }, dotNumNow: { color: color.primary },
  stageText: { flex: 1, fontSize: 15, color: color.text }, stageTextOn: { fontWeight: '700', color: color.primaryDark },
  field: { gap: 6 }, label: { fontSize: 14, fontWeight: '600', color: color.text }, carried: { fontSize: 12, fontWeight: '400', color: color.primary },
  inputText: { fontSize: 16, color: color.ink }, placeholder: { color: color.subtle }, link: { fontSize: 13, fontWeight: '700', color: color.primary, paddingVertical: 4 },
  previewText: { fontSize: 14, lineHeight: 21, color: color.text },
  sheetPreview: { backgroundColor: color.fill, borderRadius: 12, padding: 12 },
  done: { alignItems: 'center', gap: 10, padding: 24, backgroundColor: color.surface, borderRadius: 16, borderWidth: 1, borderColor: color.line },
  doneTitle: { fontSize: 20, fontWeight: '800', color: color.ink }, center: { textAlign: 'center' },
});
