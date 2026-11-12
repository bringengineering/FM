import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SessionScreen } from '../CompanyScreen';
import { k } from '../ui/kit';

/**
 * 실제 앱 화면을 맥 브라우저에서 보는 미리보기(http://localhost:8099/?real).
 * 서버 대신 가상 데이터를 돌려주는 가짜 세션을 붙인다. 실제 발송·저장은 일어나지 않는다.
 */
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const sites = [
  { id: 's1', name: '햇살빌라', address: '강원 원주시 단계로 101' }, { id: 's2', name: '푸른주택', address: '강원 원주시 무실로 22' },
  { id: 's3', name: '한빛맨션', address: '' }, { id: 's4', name: '솔숲타운', address: '강원 원주시 북원로 58' },
];
const stage = ['owner_move_out', 'owner_broker_listed', 'owner_room_viewing', 'owner_lease_contract', 'owner_move_in_cleaning'];
const progress = (counts: number[]) => stage.map((id, i) => ({ id, count: counts[i] ?? 0, lastSentAt: counts[i] ? `2026-11-0${i + 1}T01:00:00Z` : '' }));
const next = (counts: number[]) => !counts.some(Boolean) || counts[4] ? stage[0]! : stage[counts.findIndex(c => !c)] ?? stage[0]!;
const unit = (id: string, buildingId: string, building: string, address: string, no: string, owner: string, counts: number[]) =>
  ({ id, buildingId, building, address, unit: no, owner, recipient: '010-****-1234', nextStage: next(counts), progress: progress(counts) });
const units = [
  unit('u1', 'b1', '햇살빌라', '원주시 단계로 101', '201', '김가상', [1, 0, 0, 0, 0]),
  unit('u2', 'b1', '햇살빌라', '원주시 단계로 101', '305', '김가상', [1, 1, 2, 0, 0]),
  unit('u3', 'b1', '햇살빌라', '원주시 단계로 101', '402', '김가상', [1, 1, 1, 1, 1]),
  unit('u4', 'b2', '푸른주택', '원주시 무실로 22', '102', '이시안', [0, 0, 0, 0, 0]),
  unit('u5', 'b2', '푸른주택', '원주시 무실로 22', '203', '이시안', [1, 1, 1, 1, 0]),
];
const api = {
  ownerNoticeUnits: async () => { await wait(300); return { units, truncated: false }; },
  sendOwnerNotice: async (input: { requestId: string }) => { await wait(600); return { requestId: input.requestId, status: 'accepted', recipient: '010-****-1234' }; },
  ownerNoticeStatus: async (requestId: string) => { await wait(300); return { requestId, status: 'delivered' }; },
};
function fakeSession() {
  const listeners = new Set<() => void>();
  let state: any = { phase: 'ready', context: { schemaVersion: 1, actor: { uid: 'preview-admin', role: 'admin' } }, page: { sites, nextCursor: null } };
  const publish = (next: any) => { state = next; listeners.forEach(l => l()); };
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
    snapshot: () => state,
    login: async () => undefined, revalidate: async () => undefined,
    logout: async () => publish({ phase: 'signedOut' }),
    refresh: async () => { const prev = state; publish({ phase: 'loading' }); await wait(400); publish({ ...prev, phase: 'ready' }); return true; },
    select: async (id: string) => { const prev = state; publish({ phase: 'loading' }); await wait(300); publish({ ...prev, phase: 'ready', selected: sites.find(s => s.id === id) }); },
    searchSites: async (q: string) => { await wait(300); return { sites: sites.filter(s => (s.name + s.address).includes(q.trim())), incomplete: false, nextCursor: null }; },
    recordingApi: () => api,
  };
}
const session = fakeSession();
export function RealPreview() {
  return <SafeAreaView style={k.page}><SessionScreen session={session as never} /></SafeAreaView>;
}
