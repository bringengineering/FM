import React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { brandStyles, color } from '../theme';
import { BackIcon, SearchIcon } from '../icons';

// 현장앱 공통 화면 부품. 화면마다 버튼·머리글 모양이 달라지지 않게 여기서만 만든다.
const LOGO = require('../../assets/logo-mark.png');

export function Button({ label, onPress, kind = 'primary', disabled, busy }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; disabled?: boolean; busy?: boolean }) {
  const off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => [k.button, kind === 'secondary' && k.buttonSecondary, off && k.disabled, pressed && k.pressed]}>
    {busy ? <ActivityIndicator color={kind === 'primary' ? color.surface : color.primary} /> : <Text style={[k.buttonText, kind === 'secondary' && k.buttonTextSecondary]}>{label}</Text>}
  </Pressable>;
}

export function ScreenHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  return <View style={k.header}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={onBack} style={k.back}><BackIcon size={24} color={color.ink} /></Pressable>
      : <View style={k.logoBox}><Image source={LOGO} style={k.logo} accessibilityLabel="브링케어" /></View>}
    <View style={k.flex}><Text style={k.headerTitle} numberOfLines={1}>{title}</Text>{!!sub && <Text style={k.headerSub} numberOfLines={1}>{sub}</Text>}</View>
    {right}
  </View>;
}

export function SearchBox({ value, onChange, placeholder, onSubmit, editable = true }: { value: string; onChange: (v: string) => void; placeholder: string; onSubmit?: () => void; editable?: boolean }) {
  return <View style={k.search}><SearchIcon size={18} color={color.subtle} />
    <TextInput accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={color.subtle} editable={editable}
      returnKeyType="search" onSubmitEditing={onSubmit} maxLength={100} style={k.searchInput} /></View>;
}

export function Callout({ tone, text }: { tone: 'info' | 'warn' | 'error'; text: string }) {
  return <Text accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[k.callout, tone === 'warn' && k.warn, tone === 'error' && k.error]}>{text}</Text>;
}

export function Section({ title }: { title: string }) { return <Text style={k.section}>{title}</Text>; }

/** 아래에서 올라오는 확인 창. 발송처럼 되돌릴 수 없는 일에 쓴다. */
export function ConfirmSheet({ visible, title, children, confirmLabel, onConfirm, onCancel }: { visible: boolean; title: string; children: React.ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={k.sheetBack}><View style={k.sheet}>
      <Text style={k.sheetTitle}>{title}</Text>
      <ScrollView style={k.sheetBody} contentContainerStyle={k.sheetBodyContent}>{children}</ScrollView>
      <View style={k.sheetButtons}><View style={k.flex}><Button label="취소" kind="secondary" onPress={onCancel} /></View>
        <View style={k.flex}><Button label={confirmLabel} onPress={onConfirm} /></View></View>
    </View></View>
  </Modal>;
}

export const k = brandStyles({
  flex: { flex: 1, minWidth: 0 },
  page: { flex: 1, backgroundColor: color.bg },
  body: { padding: 16, gap: 12, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: color.surface, borderBottomWidth: 1, borderColor: color.line },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  logoBox: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, logo: { width: 36, height: 18, resizeMode: 'contain' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: color.ink }, headerSub: { fontSize: 13, color: color.subtle, marginTop: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.surface, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: color.line },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: color.ink, paddingVertical: 12 },
  section: { fontSize: 13, fontWeight: '700', color: color.muted, marginTop: 6 },
  group: { backgroundColor: color.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: color.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: color.line, minHeight: 56 },
  rowPressed: { backgroundColor: color.fill },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: color.ink }, rowSub: { fontSize: 14, color: color.muted, marginTop: 2 }, rowMeta: { fontSize: 12, color: color.subtle, marginTop: 4 },
  empty: { fontSize: 14, lineHeight: 21, color: color.subtle, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  card: { backgroundColor: color.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: color.line },
  cardTitle: { fontSize: 17, fontWeight: '700', color: color.ink },
  text: { fontSize: 15, lineHeight: 22, color: color.muted }, small: { fontSize: 13, lineHeight: 19, color: color.subtle },
  input: { borderWidth: 1, borderColor: color.lineStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: color.ink, backgroundColor: color.surface },
  footer: { padding: 16, gap: 8, backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonSecondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.lineStrong },
  buttonText: { fontSize: 16, fontWeight: '700', color: color.surface }, buttonTextSecondary: { color: color.ink },
  disabled: { opacity: 0.4 }, pressed: { opacity: 0.75 },
  callout: { fontSize: 13, lineHeight: 19, color: color.primaryDark, backgroundColor: color.primarySoft, padding: 12, borderRadius: 10, overflow: 'hidden' },
  warn: { color: color.warning, backgroundColor: color.warningSoft }, error: { color: color.danger, backgroundColor: color.dangerSoft },
  sheetBack: { flex: 1, backgroundColor: 'rgba(25,31,40,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '88%', backgroundColor: color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: color.ink }, sheetBody: { flexGrow: 0 }, sheetBodyContent: { gap: 10 },
  sheetButtons: { flexDirection: 'row', gap: 10 },
});
