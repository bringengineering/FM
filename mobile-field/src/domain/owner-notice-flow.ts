// 건물주 퇴실~입주 안내 화면의 판단 규칙(화면과 분리해 테스트한다).
// 단계별 발송 수(progress)는 서버가 '이번 회차' 기준으로 준다(owner-notice-core turnoverProgress).

export interface StageProgress { id: string; count: number; lastSentAt: string }
export interface Stage { id: string; label: string; stage: number }
export interface NoticeUnitLike { id: string; buildingId: string; building: string; address: string; owner: string; progress: StageProgress[] }

export const MOVE_OUT = 'owner_move_out', ROOM_VIEWING = 'owner_room_viewing', CLEANING = 'owner_move_in_cleaning';

export const dayLabel = (iso: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : '';
};

export function cycleState(progress: StageProgress[]) {
  const started = progress.some(p => p.count > 0);
  const complete = progress.some(p => p.id === CLEANING && p.count > 0);
  return { started, complete, active: started && !complete };
}

/** 선택한 단계에 대해 보내기 전에 알려 줄 말. warn 은 확인 창에도 다시 보여 준다. */
export function stageNotice(stages: Stage[], progress: StageProgress[], stageId: string): { tone: 'info' | 'warn'; text: string } | null {
  const { started, complete } = cycleState(progress);
  const at = (id: string) => progress.find(p => p.id === id) ?? { id, count: 0, lastSentAt: '' };
  const current = at(stageId), stage = stages.find(s => s.id === stageId);
  if (!stage) return null;
  if (stageId === MOVE_OUT && (complete || (started && current.count > 0))) {
    return complete
      ? { tone: 'info', text: '새 세입자 회차를 시작합니다. 지난 회차 발송 기록은 CRM에 그대로 남습니다.' }
      : { tone: 'warn', text: `${dayLabel(current.lastSentAt) || '이전'}에 퇴실 안내를 이미 보냈습니다. 다시 보내면 새 회차로 시작되어 이번 회차 진행 표시가 처음부터 다시 셉니다.` };
  }
  if (complete) return { tone: 'warn', text: '이번 회차는 입주청소 안내까지 보냈습니다. 새로 퇴실하는 세입자라면 1단계 퇴실 일정 안내부터 보내 주세요.' };
  if (stageId === ROOM_VIEWING && current.count > 0) {
    return { tone: 'info', text: `방 보기 안내 ${current.count}회 보냄${current.lastSentAt ? ` (마지막 ${dayLabel(current.lastSentAt)})` : ''}. 방 보기 일정이 잡힐 때마다 보내면 됩니다.` };
  }
  if (current.count > 0) return { tone: 'warn', text: `${dayLabel(current.lastSentAt) || '이전'}에 이미 보낸 단계입니다. 다시 보내면 건물주님이 같은 안내를 한 번 더 받습니다.` };
  const skipped = stages.filter(s => s.stage < stage.stage && s.id !== ROOM_VIEWING && !at(s.id).count);
  if (skipped.length) return { tone: 'warn', text: `앞 단계(${skipped.map(s => s.label).join(', ')})를 아직 보내지 않았습니다. 건너뛰고 보낼 수는 있습니다.` };
  return null;
}

/** 보낸 직후 화면에 반영할 진행 현황(서버 목록을 다시 받기 전까지). 퇴실 안내는 새 회차를 연다. */
export function afterSend(progress: StageProgress[], stageId: string, nowIso: string): StageProgress[] {
  return progress.map(p => p.id === stageId ? { ...p, count: stageId === MOVE_OUT ? 1 : p.count + 1, lastSentAt: nowIso }
    : stageId === MOVE_OUT ? { ...p, count: 0, lastSentAt: '' } : p);
}

/** 앞 단계에서 넣은 값 중 다음 단계에서 다시 쓰는 것(중개사무소·입주일)만 이 기기 안에서 기억한다. */
export const CARRIED_KEYS = ['중개사무소', '입주일'] as const;
export function carried(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(CARRIED_KEYS.filter(key => input[key]).map(key => [key, input[key]!]));
}

/** 호실 목록을 건물별로 묶는다(건물 순서·호실 순서는 서버 정렬을 따른다). */
export function groupByBuilding<T extends NoticeUnitLike>(units: T[], query: string) {
  const q = query.trim();
  const list = units.filter(u => !q || `${u.building} ${u.address} ${(u as any).unit ?? ''} ${u.owner}`.includes(q));
  const groups = new Map<string, T[]>();
  for (const unit of list) groups.set(unit.buildingId, [...(groups.get(unit.buildingId) ?? []), unit]);
  return [...groups.values()].map(rows => ({
    buildingId: rows[0]!.buildingId, name: rows[0]!.building || rows[0]!.address, address: rows[0]!.address, owner: rows[0]!.owner,
    units: rows, active: rows.filter(u => cycleState(u.progress).active).length,
  }));
}
