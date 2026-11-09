import { expect, it } from 'vitest';
import { photoInput, recordingInput, zoneFor } from '../src/field-mobile/recording-model.js';

// 공용부 구역을 양식의 9개로 줄이기 전(앱 0.1.15 이하)에 찍은 사진·상태·메모도 받아서 지금 구역으로 옮긴다.
const photo = { id: 'photo-a', itemKey: 'handrail', phase: 'after', caption: '', included: true, capturedAt: '2026-11-09T01:00:00Z', mime: 'image/jpeg', bytes: 10, sha256: 'a'.repeat(64), width: 10, height: 10 };

it('maps legacy common zone keys and leaves other kinds alone', () => {
  expect(photoInput(photo, 'common').itemKey).toBe('stairs');
  expect(zoneFor('common', 'lighting')).toBe('fixtures');
  expect(zoneFor('moveIn', 'handrail')).toBe('handrail');
  expect(() => photoInput({ ...photo, itemKey: 'unknown' }, 'common')).toThrow();
});

it('merges legacy statuses and notes into the current zone', () => {
  const input = recordingInput({ customerId: 'customer-a', kind: 'common', workDate: '2026-11-09', revision: 1, photos: [photo],
    draft: { summary: '', followUp: '', statuses: { handrail: 'done', stairs: 'recorded' }, notes: { handrail: '난간', stairs: '계단', final: '마감' } } });
  expect(input.photos[0]!.itemKey).toBe('stairs');
  expect(input.draft.statuses).toEqual({ stairs: 'done' });
  expect(input.draft.notes).toEqual({ corridor: '마감', stairs: '난간 / 계단' });
});
