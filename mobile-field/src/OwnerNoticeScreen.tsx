import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { brandStyles, color } from './theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { safeMessage } from './errors';
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
const deliveryLabel: Record<OwnerNoticeReceipt['status'], string> = { accepted: '발송 접수됨 · 전달 확인 중', delivered: '카카오 전달 완료', failed: '전달 실패', unknown: '접수 여부 확인 필요' };

function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
}
function Chip({ label, active, onPress, done }: { label: string; active: boolean; onPress: () => void; done: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{done ? '✓ ' : ''}{label}</Text></Pressable>;
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState<'date' | 'time' | ''>('');
  if (field.type === 'text') return <View style={styles.field}><Text style={styles.label}>{field.label}</Text>
    <TextInput accessibilityLabel={field.label} value={value} onChangeText={onChange} placeholder={field.placeholder} maxLength={60} style={styles.input} /></View>;
  const current = parse(field.type, value);
  const shown = value ? (field.type === 'date' ? value : field.type === 'time' ? value : value.replace('T', ' ')) : '선택해 주세요';
  function picked(event: DateTimePickerEvent, date?: Date) {
    const mode = open; if (Platform.OS === 'android') setOpen('');
    if (event.type !== 'set' || !date) return;
    if (field.type === 'date') onChange(dateKey(date));
    else if (field.type === 'time') onChange(timeKey(date));
    else if (mode === 'date') { onChange(`${dateKey(date)}T${value ? timeKey(current) : '10:00'}`); if (Platform.OS === 'android') setOpen('time'); }
    else onChange(`${dateKey(current)}T${timeKey(date)}`);
  }
  return <View style={styles.field}><Text style={styles.label}>{field.label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${field.label} ${shown}`} onPress={() => setOpen(field.type === 'time' ? 'time' : 'date')} style={styles.input}>
      <Text style={[styles.inputText, !value && styles.placeholder]}>{shown}</Text></Pressable>
    {field.type === 'datetime-local' && !!value && <Action secondary label="시각 바꾸기" onPress={() => setOpen('time')} />}
    {!!open && <DateTimePicker value={current} mode={open} is24Hour display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={picked} />}
    {Platform.OS === 'ios' && !!open && <Action secondary label="선택 완료" onPress={() => setOpen('')} />}
  </View>;
}

export function OwnerNoticeScreen({ api, onClose }: { api: CompanyRecordingApi; onClose: () => void }) {
  const controller = useRef(new AbortController());
  const [units, setUnits] = useState<OwnerNoticeUnit[]>(), [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('');
  const [unit, setUnit] = useState<OwnerNoticeUnit>(), [stage, setStage] = useState(''), [values, setValues] = useState<Record<string, string>>({});
  // 응답을 잃어버린 뒤 다시 누르면 같은 요청 ID로 보내서 서버가 두 번 보내지 않게 한다.
  const [pending, setPending] = useState<{ key: string; requestId: string }>();
  const [receipt, setReceipt] = useState<OwnerNoticeReceipt>();
  useEffect(() => () => controller.current.abort(), []);
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined; setBusy(true); setError('');
    try { return await work(); } catch (e) { setError(safeMessage(e)); return undefined; } finally { setBusy(false); }
  }
  const load = () => run(async () => { const result = await api.ownerNoticeUnits(controller.current.signal); setUnits(result.units); setTruncated(result.truncated); });
  useEffect(() => { void load(); }, []);

  const fields = stage ? core.TURNOVER_FIELDS[stage] ?? [] : [];
  const formatted = useMemo(() => stage ? core.formatTurnoverValues(stage, values) : {}, [stage, values]);
  const preview = useMemo(() => unit && stage ? core.render(stage, { ...formatted, 건물주소: unit.address, 호실: unit.unit }) : '', [unit, stage, formatted]);
  const missing = unit && stage ? core.missingVariables(stage, { ...formatted, 건물주소: unit.address, 호실: unit.unit }) : [];
  const filtered = (units ?? []).filter(u => !query.trim() || `${u.address} ${u.unit} ${u.owner}`.includes(query.trim()));

  function choose(next: OwnerNoticeUnit) {
    setUnit(next); setStage(next.nextStage); setReceipt(undefined); setPending(undefined);
    setValues(next.nextStage === 'owner_broker_listed' ? { 접수일: dateKey(new Date()) } : {});
  }
  function changeStage(next: string) { setStage(next); setValues(next === 'owner_broker_listed' ? { 접수일: dateKey(new Date()) } : {}); setReceipt(undefined); }
  function confirm() {
    if (!unit || !stage || missing.length) return;
    const template = core.TEMPLATES[stage]!, sent = unit.progress.find(p => p.id === stage);
    const warning = sent?.count && !template.repeatable ? '\n\n※ 이 단계는 이미 보낸 기록이 있습니다. 내용이 바뀐 경우에만 다시 보내 주세요.' : '';
    Alert.alert(`건물주에게 '${template.label}'을 보낼까요?`, `받는 분: ${unit.owner} · ${unit.recipient}\n\n${preview}${warning}`, [
      { text: '취소', style: 'cancel' },
      { text: '알림톡 발송', onPress: () => void send() },
    ]);
  }
  async function send() {
    if (!unit || !stage) return;
    const key = JSON.stringify([unit.id, stage, preview]);
    const requestId = pending?.key === key ? pending.requestId : Crypto.randomUUID().toLowerCase();
    setPending({ key, requestId });
    const result = await run(() => api.sendOwnerNotice({ requestId, unitId: unit.id, templateId: stage, input: values, preview }, controller.current.signal));
    if (result) { setReceipt(result); setPending(undefined); void load(); }
  }
  async function check() {
    if (!receipt) return;
    const result = await run(() => api.ownerNoticeStatus(receipt.requestId, controller.current.signal));
    if (result) setReceipt({ ...receipt, ...result });
  }

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Text style={styles.brand}>건물주 안내 알림톡</Text><Action secondary label="닫기" onPress={onClose} /></View>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!unit ? <>
      <View style={styles.card}><Text style={styles.heading}>호실 찾기</Text>
        <Text style={styles.copy}>퇴실부터 입주까지 단계별 안내를 CRM과 같은 승인 문구로 건물주에게 보냅니다.</Text>
        <TextInput accessibilityLabel="건물 주소·호실·건물주 검색" value={query} onChangeText={setQuery} placeholder="주소, 호실, 건물주 이름" maxLength={60} style={styles.input} />
        <Action secondary label={busy ? '불러오는 중…' : '목록 새로고침'} disabled={busy} onPress={() => void load()} />
        {truncated && <Text style={styles.small}>호실이 많아 앞쪽 250개만 보입니다. 검색어로 좁혀 주세요.</Text>}
      </View>
      {!units && busy && <ActivityIndicator accessibilityLabel="호실 불러오는 중" />}
      {units && !filtered.length && <View style={styles.card}><Text style={styles.copy}>{units.length ? '검색 결과가 없습니다.' : '보낼 수 있는 호실이 없습니다. CRM에서 호실과 건물주(휴대전화 포함)를 확인해 주세요.'}</Text></View>}
      {filtered.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => choose(item)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <Text style={styles.heading}>{item.address} {item.unit}호</Text>
        <Text style={styles.copy}>건물주 {item.owner} · {item.recipient}</Text>
        <Text style={styles.small}>다음 안내: {core.TEMPLATES[item.nextStage]?.label ?? '-'} · 보낸 단계 {item.progress.filter(p => p.count).length}/5</Text>
      </Pressable>)}
    </> : <>
      <View style={styles.card}>
        <Text style={styles.heading}>{unit.address} {unit.unit}호</Text>
        <Text style={styles.copy}>받는 분: 건물주 {unit.owner} · {unit.recipient}</Text>
        <Action secondary label="다른 호실 고르기" disabled={busy} onPress={() => { setUnit(undefined); setReceipt(undefined); }} />
      </View>
      <View style={styles.card}><Text style={styles.heading}>안내 단계</Text>
        <View style={styles.chips}>{core.TURNOVER_STAGES.map(item => {
          const sent = unit.progress.find(p => p.id === item.id);
          return <Chip key={item.id} label={`${item.stage}. ${item.label}`} active={stage === item.id} done={!!sent?.count} onPress={() => changeStage(item.id)} />;
        })}</View>
        {(() => { const sent = unit.progress.find(p => p.id === stage); return sent?.count ? <Text style={styles.small}>이 단계는 {sent.count}번 보냈습니다{sent.lastSentAt ? ` · 마지막 ${sent.lastSentAt.slice(0, 10)}` : ''}.</Text> : null; })()}
      </View>
      <View style={styles.card}><Text style={styles.heading}>입력</Text>
        {fields.map(field => <FieldInput key={`${stage}-${field.key}`} field={field} value={values[field.key] ?? ''} onChange={value => { setValues(prev => ({ ...prev, [field.key]: value })); setReceipt(undefined); }} />)}
      </View>
      <View style={styles.card}><Text style={styles.heading}>보낼 문구</Text>
        <View style={styles.preview}><Text style={styles.previewText}>{preview}</Text></View>
        {!!missing.length && <Text style={styles.small}>입력 필요: {missing.join(', ')}</Text>}
        {!receipt ? <Action label={busy ? '보내는 중…' : '알림톡 보내기'} disabled={busy || !!missing.length} onPress={confirm} />
          : <><Text style={styles.status}>{deliveryLabel[receipt.status]}</Text>
            <Action secondary label={busy ? '확인 중…' : '전달 상태 확인'} disabled={busy} onPress={() => void check()} /></>}
        {pending && !receipt && !busy && <Text style={styles.small}>발송 접수를 확인하지 못했습니다. 다시 누르면 같은 요청으로 확인하며 두 번 보내지 않습니다.</Text>}
      </View>
    </>}
  </ScrollView></SafeAreaView>;
}

const styles = brandStyles({
  page: { flex: 1, backgroundColor: color.bg }, content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 22, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  brand: { fontSize: 22, fontWeight: '800', color: color.ink, flexShrink: 1 },
  heading: { fontSize: 18, fontWeight: '700', color: color.ink }, copy: { fontSize: 15, lineHeight: 23, color: color.muted }, small: { fontSize: 13, lineHeight: 19, color: color.subtle },
  card: { backgroundColor: color.surface, borderRadius: 18, padding: 20, gap: 12, borderWidth: 1, borderColor: color.line },
  field: { gap: 6 }, label: { fontSize: 14, fontWeight: '600', color: color.text },
  input: { borderWidth: 1, borderColor: color.lineStrong, borderRadius: 10, padding: 13, fontSize: 16, color: color.ink, backgroundColor: color.surface },
  inputText: { fontSize: 16, color: color.ink }, placeholder: { color: color.subtle },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: color.lineStrong, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: color.surface },
  chipActive: { backgroundColor: color.primary, borderColor: color.primary }, chipText: { fontSize: 14, color: color.text }, chipTextActive: { color: color.surface, fontWeight: '700' },
  preview: { backgroundColor: color.fill, borderRadius: 12, padding: 14 }, previewText: { fontSize: 14, lineHeight: 21, color: color.text },
  status: { fontSize: 16, fontWeight: '700', color: color.success },
  button: { backgroundColor: color.primary, borderRadius: 11, padding: 14, alignItems: 'center' }, buttonText: { color: color.surface, fontSize: 15, fontWeight: '700' },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.lineStrong }, secondaryText: { color: color.primary },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.8 }, error: { color: color.danger, lineHeight: 22 },
});
