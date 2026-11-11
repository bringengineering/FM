// 굵기별 Pretendard 파일 이름 고르기(react-native 없이 테스트할 수 있게 분리).
const FAMILY: Record<string, string> = {
  '100': 'Pretendard-Regular', '200': 'Pretendard-Regular', '300': 'Pretendard-Regular', '400': 'Pretendard-Regular', normal: 'Pretendard-Regular',
  '500': 'Pretendard-SemiBold', '600': 'Pretendard-SemiBold', '700': 'Pretendard-Bold', bold: 'Pretendard-Bold', '800': 'Pretendard-ExtraBold', '900': 'Pretendard-ExtraBold',
};

/** 글자 스타일(fontSize·fontWeight 가 있는 것)에 굵기별 Pretendard 파일을 지정한다.
 *  안드로이드는 굵기마다 다른 파일을 쓰므로 fontWeight 를 지워 이중 굵게 처리를 막는다. */
export function brandFont<T extends Record<string, any>>(style: T, os: string): T {
  if (os === 'web' || style.fontFamily || (style.fontSize === undefined && style.fontWeight === undefined)) return style;
  const family = FAMILY[String(style.fontWeight ?? '400')] ?? FAMILY['400']!;
  if (os !== 'android') return { ...style, fontFamily: family };
  const { fontWeight: _dropped, ...rest } = style;
  return { ...rest, fontFamily: family } as unknown as T;
}
