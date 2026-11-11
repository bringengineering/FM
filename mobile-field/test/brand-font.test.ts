import { expect, it } from 'vitest';
import { brandFont } from '../src/brand-font';

it('picks the Pretendard file for each weight and leaves layout styles alone', () => {
  expect(brandFont({ fontSize: 15, fontWeight: '700' }, 'ios')).toEqual({ fontSize: 15, fontWeight: '700', fontFamily: 'Pretendard-Bold' });
  expect(brandFont({ fontSize: 15 }, 'ios')).toEqual({ fontSize: 15, fontFamily: 'Pretendard-Regular' });
  expect(brandFont({ color: 'red', fontWeight: '800' }, 'android')).toEqual({ color: 'red', fontFamily: 'Pretendard-ExtraBold' });
  expect(brandFont({ fontSize: 12, fontWeight: '600' }, 'android')).toEqual({ fontSize: 12, fontFamily: 'Pretendard-SemiBold' });
  const box = { padding: 4, backgroundColor: '#fff' };
  expect(brandFont(box, 'android')).toBe(box);
  expect(brandFont({ fontSize: 12, fontWeight: '700' }, 'web')).toEqual({ fontSize: 12, fontWeight: '700', fontFamily: 'Pretendard-Bold' });
});
