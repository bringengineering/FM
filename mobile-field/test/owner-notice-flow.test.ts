import { expect, it } from 'vitest';
import { afterSend, carried, groupByBuilding, stageNotice } from '../src/domain/owner-notice-flow';

const stages = [
  { id: 'owner_move_out', label: '퇴실 일정 안내', stage: 1 }, { id: 'owner_broker_listed', label: '중개 접수 안내', stage: 2 },
  { id: 'owner_room_viewing', label: '방 보기 안내', stage: 3 }, { id: 'owner_lease_contract', label: '신규 계약 안내', stage: 4 },
  { id: 'owner_move_in_cleaning', label: '입주청소 안내', stage: 5 },
];
const progress = (counts: number[]) => stages.map((s, i) => ({ id: s.id, count: counts[i]!, lastSentAt: counts[i] ? `2026-11-0${i + 1}T00:00:00Z` : '' }));

it('explains repeats, skips and new cycles before sending', () => {
  expect(stageNotice(stages, progress([0, 0, 0, 0, 0]), 'owner_move_out')).toBeNull();
  expect(stageNotice(stages, progress([1, 0, 0, 0, 0]), 'owner_broker_listed')).toBeNull();
  expect(stageNotice(stages, progress([1, 1, 2, 0, 0]), 'owner_room_viewing')).toMatchObject({ tone: 'info', text: expect.stringContaining('2회') });
  expect(stageNotice(stages, progress([1, 1, 0, 0, 0]), 'owner_broker_listed')).toMatchObject({ tone: 'warn', text: expect.stringContaining('11월 2일') });
  expect(stageNotice(stages, progress([1, 0, 0, 0, 0]), 'owner_lease_contract')).toMatchObject({ tone: 'warn', text: expect.stringContaining('중개 접수 안내') });
  expect(stageNotice(stages, progress([1, 0, 0, 0, 0]), 'owner_lease_contract')!.text).not.toContain('방 보기');
  expect(stageNotice(stages, progress([1, 1, 1, 1, 1]), 'owner_move_out')).toMatchObject({ tone: 'info', text: expect.stringContaining('새 세입자') });
  expect(stageNotice(stages, progress([1, 1, 1, 1, 1]), 'owner_lease_contract')).toMatchObject({ tone: 'warn' });
  expect(stageNotice(stages, progress([1, 1, 0, 0, 0]), 'owner_move_out')).toMatchObject({ tone: 'warn', text: expect.stringContaining('새 회차') });
});

it('updates progress right after sending and carries only reusable values', () => {
  const after = afterSend(progress([1, 0, 0, 0, 0]), 'owner_broker_listed', '2026-11-12T01:00:00Z');
  expect(after.map(p => p.count)).toEqual([1, 1, 0, 0, 0]);
  expect(afterSend(progress([1, 1, 1, 1, 1]), 'owner_move_out', '2026-11-12T01:00:00Z').map(p => p.count)).toEqual([1, 0, 0, 0, 0]);
  expect(carried({ 중개사무소: '단계공인중개사', 접수일: '2026-11-12', 입주일: '' })).toEqual({ 중개사무소: '단계공인중개사' });
});

it('groups units by building and filters by building name, unit and owner', () => {
  const unit = (id: string, buildingId: string, building: string, unitNo: string, counts: number[]) => ({ id, buildingId, building, address: `원주시 ${building}로 1`, unit: unitNo, owner: '건물주', progress: progress(counts) });
  const units = [unit('a', 'b1', '햇살빌라', '201', [1, 0, 0, 0, 0]), unit('b', 'b1', '햇살빌라', '402', [1, 1, 1, 1, 1]), unit('c', 'b2', '', '102', [0, 0, 0, 0, 0])];
  const groups = groupByBuilding(units, '');
  expect(groups.map(g => [g.name, g.units.length, g.active])).toEqual([['햇살빌라', 2, 1], ['원주시 로 1', 1, 0]]);
  expect(groupByBuilding(units, '402').map(g => g.units.map(u => u.id))).toEqual([['b']]);
});
