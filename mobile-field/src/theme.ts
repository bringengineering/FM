import { Platform, StyleSheet } from 'react-native';
import { brandFont } from './brand-font';

/**
 * 브링케어 현장앱 디자인 기준.
 * - 색: BR 로고 파랑(#0C57A5)을 기본 색으로, 회색·경고색은 CRM 화면과 같은 계열.
 * - 글꼴: Pretendard(OFL-1.1, github.com/orioncactus/pretendard). app.config.ts 의
 *   expo-font 플러그인이 APK 안에 넣으므로 앱 시작 때 따로 불러오지 않는다.
 */
export const color = {
  primary: '#0C57A5', primaryDark: '#08447F', primarySoft: '#EAF2FB', primaryLine: '#C7DBF1',
  ink: '#191F28', text: '#333D4B', muted: '#4E5968', subtle: '#8B95A1',
  line: '#E5E8EB', lineStrong: '#D1D6DB', bg: '#F2F4F6', fill: '#F9FAFB', surface: '#FFFFFF',
  onDark: '#E5E8EB', onDarkAccent: '#9CC3EE', onDarkMuted: '#A7B0BB',
  danger: '#D22030', dangerSoft: '#FFEFF0', dangerLine: '#FFCDD1',
  success: '#027A48', successSoft: '#E6F8F0', successLine: '#B5EBD3',
  warning: '#B4690E', warningSoft: '#FFF6E5',
} as const;

/** StyleSheet.create 대신 쓴다: 모든 글자 스타일에 브랜드 글꼴을 입힌다. */
type Styles = Parameters<typeof StyleSheet.create>[0];
export function brandStyles<S extends Styles>(styles: S & Styles): Readonly<S> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(styles)) out[key] = brandFont(value as Record<string, any>, Platform.OS);
  return StyleSheet.create(out as S);
}
