import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SyncRunner, FIELD_RETRY, TRANSIENT_SYNC_CODES, type RetryPolicy } from '../src/domain/sync';
import { FieldError, orderPhotos, orderVisits } from '../src/domain/model';
import { FieldApiClient, type UploadApi, type UploadStatus } from '../src/api/client';
import { safeMessage } from '../src/errors';
import { jpeg, makeVault, photo, visit } from './helpers';

async function setup() {
  const { vault } = await makeVault(); const p = await photo(); await vault.saveVisit(visit(), null); await vault.savePhoto(p, jpeg, 1);
  let state: UploadStatus = { uploadId: 'upload-a', photoId: p.id, sha256: p.sha256, totalBytes: jpeg.length, receivedBytes: 0, state: 'uploading', crmLinked: false, driveVerified: false };
  const api: UploadApi = {
    reserve: vi.fn(async () => ({ ...state })), status: vi.fn(async () => ({ ...state })),
    chunk: vi.fn(async (_id, offset, _total, bytes) => { state = { ...state, receivedBytes: offset + bytes.length }; return { ...state }; }),
    complete: vi.fn(async (): Promise<UploadStatus> => { state = { ...state, state: 'ready', driveVerified: true, crmLinked: true }; return { ...state }; }),
  };
  return { vault, api };
}
const instant = (attempts = 3): RetryPolicy & { waits: number[] } => {
  const waits: number[] = [];
  return { attempts, waits, delayMs: (attempt, code) => FIELD_RETRY.delayMs(attempt, code), wait: async ms => { waits.push(ms); } };
};

describe('사진은 찍은 순서대로 보인다', () => {
  it('보관함은 무작위 ID가 아니라 촬영 시각 순서로 사진을 돌려준다', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null);
    // ID 순서(z→a)와 촬영 순서(a→z)를 반대로 둔다.
    const shots = [['zz-first', '2026-10-26T00:01:00Z'], ['mm-second', '2026-10-26T00:02:00Z'], ['aa-third', '2026-10-26T00:03:00Z']] as const;
    let revision = 1;
    for (const [id, capturedAt] of shots) { await vault.savePhoto({ ...(await photo()), id, capturedAt }, jpeg, revision); revision++; }
    expect((await vault.load()).photos.map(p => p.id)).toEqual(['zz-first', 'mm-second', 'aa-third']);
    await vault.close();
  });
  it('이전 작업은 최근 작업일이 위로 온다', () => {
    const a = visit(), old = { ...a, id: 'v-old', job: { ...a.job, workDate: '2026-10-01' } }, recent = { ...a, id: 'v-new', job: { ...a.job, workDate: '2026-10-28' } };
    expect(orderVisits([old, recent]).map(v => v.id)).toEqual(['v-new', 'v-old']);
    expect(orderPhotos([]).length).toBe(0);
  });
});

describe('잠깐 끊긴 연결은 같은 업로드로 다시 보낸다', () => {
  it.each([...TRANSIENT_SYNC_CODES])('%s 한 번은 한 번의 업로드 안에서 이어 보내 보관을 끝낸다', async code => {
    const { vault, api } = await setup(); const policy = instant(), retried = vi.fn();
    api.complete = vi.fn().mockRejectedValueOnce(new FieldError(code)).mockImplementation(async () => ({ ...(await api.status('upload-a', new AbortController().signal)), state: 'ready', driveVerified: true, crmLinked: true }));
    await new SyncRunner(vault, api, 'visit-a', undefined, policy, retried).run();
    expect((await vault.load()).photos[0]?.state).toBe('ready');
    // 다시 보낼 때 새 예약을 만들지 않고, 이미 보낸 조각도 다시 보내지 않는다.
    expect(api.reserve).toHaveBeenCalledTimes(1); expect(api.chunk).toHaveBeenCalledTimes(1);
    expect(retried).toHaveBeenCalledWith(1, code);
    expect(policy.waits).toEqual([code === 'RATE_LIMITED' ? 15_000 : 3_000]);
    await vault.close();
  });
  it('정해진 횟수만 시도하고 원본을 남긴 채 확인 필요로 둔다', async () => {
    const { vault, api } = await setup(); const policy = instant(3);
    api.reserve = vi.fn(async () => { throw new FieldError('NETWORK_UNCERTAIN'); });
    await new SyncRunner(vault, api, 'visit-a', undefined, policy).run();
    expect(api.reserve).toHaveBeenCalledTimes(3); expect(policy.waits).toEqual([3_000, 6_000]);
    const stored = (await vault.load()).photos[0]; expect(stored?.state).toBe('failed'); expect(stored?.errorCode).toBe('NETWORK_UNCERTAIN');
    expect(await vault.readBytes('photo-a')).toEqual(jpeg); await vault.close();
  });
  it.each(['PHOTO_INVALID', 'UPLOAD_BINDING_INVALID', 'DRIVE_FOLDER_ACCESS_REQUIRED'])('%s 는 다시 보내도 같으므로 재시도하지 않는다', async code => {
    const { vault, api } = await setup(); const policy = instant();
    api.reserve = vi.fn(async () => { throw new FieldError(code); });
    await new SyncRunner(vault, api, 'visit-a', undefined, policy).run();
    expect(api.reserve).toHaveBeenCalledTimes(1); expect(policy.waits).toEqual([]); await vault.close();
  });
  it('기다리는 중에 화면을 닫으면 더 보내지 않는다', async () => {
    const { vault, api } = await setup(); let runner!: SyncRunner;
    const policy: RetryPolicy = { attempts: 3, delayMs: () => 60_000, wait: async () => { runner.stop(); } };
    api.reserve = vi.fn(async () => { throw new FieldError('SERVER_UNAVAILABLE'); });
    runner = new SyncRunner(vault, api, 'visit-a', undefined, policy); await runner.run();
    expect(api.reserve).toHaveBeenCalledTimes(1); await vault.close();
  });
  it('실제 대기는 화면을 닫으면 바로 끝난다', async () => {
    const { vault, api } = await setup(); let runner!: SyncRunner;
    api.reserve = vi.fn(async () => { setTimeout(() => runner.stop(), 10); throw new FieldError('SERVER_UNAVAILABLE'); });
    runner = new SyncRunner(vault, api, 'visit-a', undefined, { attempts: 3, delayMs: () => 60_000 });
    const started = Date.now(); await runner.run();
    expect(Date.now() - started).toBeLessThan(5_000); expect(api.reserve).toHaveBeenCalledTimes(1); await vault.close();
  });
});

describe('서버가 거절한 사진은 연결 실패로 바꾸지 않는다', () => {
  it.each(['PHOTO_INVALID', 'REPORT_PDF_INVALID'])('422 %s 코드를 그대로 전달한다', async code => {
    const client = new FieldApiClient('https://test.invalid/v1/field-app', 'staff-a', async () => ({ uid: 'staff-a', idToken: 't', appCheckToken: 'c' }),
      async () => Response.json({ error: { code } }, { status: 422 }));
    await expect(client.status('upload-a', new AbortController().signal)).rejects.toMatchObject({ code });
  });
});

describe('오류 안내', () => {
  it('처음 보는 오류는 엉뚱한 안내 대신 오류 코드를 보여 준다', () => {
    const message = safeMessage(new FieldError('UPLOAD_OFFSET_INVALID'));
    expect(message).toContain('UPLOAD_OFFSET_INVALID'); expect(message).not.toContain('기기 공간');
    expect(safeMessage(new FieldError('RESOURCE_NOT_FOUND'))).toContain('작업을 다시 연');
    expect(safeMessage(new Error('raw server text'))).not.toContain('raw server text');
  });
});

describe('화면 연결', () => {
  const source = readFileSync(new URL('../src/FieldWorkspace.tsx', import.meta.url), 'utf8');
  it('이전 작업도 새 작업과 같은 방법으로 열어 촬영 구역을 그 작업 것으로 맞춘다', () => {
    expect(source).toMatch(/label="이전 작업 이어하기"[^\n]*beginVisit\(v,/u);
    expect(source).toMatch(/beginVisit\(target,workspace\.photos/u);
  });
  it('촬영은 현재 작업의 촬영 구역에 있는 구역으로만 저장한다', () => {
    expect(source).toMatch(/const target=areas\.includes\(area\)\?area:firstUncapturedArea/u);
    expect(source.match(/persistCapture\(vault, (?:visit|current), [a-zA-Z()]+, target, phase[,)]/gu)?.length).toBe(3);
  });
  it('앱의 업로드는 재시도 정책을 쓴다', () => {
    expect(source).toMatch(/new SyncRunner\(vault,company\.api,current\.id,[^\n]*FIELD_RETRY/u);
  });
});

import { exifCapturedAt } from '../src/domain/capture-time';
import { canDeletePhoto } from '../src/domain/model';

describe('사진첩 사진은 실제 촬영 시각으로 기록한다', () => {
  const now = new Date('2026-10-30T09:00:00Z');
  it('시간대가 적힌 원본 시각을 UTC로 바꾼다', () => {
    expect(exifCapturedAt({ DateTimeOriginal: '2026:10:29 14:05:09', OffsetTimeOriginal: '+09:00' }, now)).toBe('2026-10-29T05:05:09.000Z');
    expect(exifCapturedAt({ DateTimeDigitized: '2026:10:29 14:05:09', OffsetTime: '+09:00' }, now)).toBe('2026-10-29T05:05:09.000Z');
  });
  it('시간대가 없으면 휴대폰 현지 시각으로 읽는다', () => {
    expect(exifCapturedAt({ DateTimeOriginal: '2026:10:29 14:05:09' }, now)).toBe(new Date(2026, 9, 29, 14, 5, 9).toISOString());
  });
  it.each([
    ['정보 없음', undefined], ['날짜 태그 없음', { Make: 'phone' }], ['형식 오류', { DateTimeOriginal: '2026-10-29' }],
    ['없는 날짜', { DateTimeOriginal: '2026:02:31 10:00:00', OffsetTimeOriginal: '+09:00' }], ['없는 시각', { DateTimeOriginal: '2026:10:29 25:00:00' }],
    ['미래', { DateTimeOriginal: '2026:11:30 10:00:00', OffsetTimeOriginal: '+09:00' }], ['너무 오래됨', { DateTimeOriginal: '2020:01:01 10:00:00', OffsetTimeOriginal: '+09:00' }],
  ])('%s 이면 지금 시각을 쓴다', (_label, exif) => {
    expect(exifCapturedAt(exif, now)).toBe(now.toISOString());
  });
});

describe('잘못 찍은 사진 지우기', () => {
  it('서버로 보내기 전 사진만 지우고, 지우면 보고서 검토를 다시 하게 한다', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null); await vault.savePhoto(await photo(), jpeg, 1);
    const before = (await vault.load()).visits[0]!;
    await vault.deletePhoto('photo-a', before.revision);
    const after = await vault.load();
    expect(after.photos).toEqual([]); expect(after.visits[0]!.revision).toBe(before.revision + 1);
    await expect(vault.readBytes('photo-a')).rejects.toThrow('PHOTO_NOT_FOUND');
    await vault.close();
  });
  it('서버가 사진 목록을 받은 뒤에는 지우지 못한다', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null); await vault.savePhoto(await photo(), jpeg, 1);
    const current = (await vault.load()).visits[0]!;
    await vault.linkRevision!('visit-a', current.revision, ['photo-a']);
    const linked = (await vault.load()).photos[0]!;
    expect(canDeletePhoto(linked)).toBe(false);
    await expect(vault.deletePhoto('photo-a', current.revision)).rejects.toThrow('PHOTO_DELETE_REQUIRES_SERVER');
    expect((await vault.load()).photos.length).toBe(1); await vault.close();
  });
  it('오래된 화면의 버전으로는 지우지 못한다', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null); await vault.savePhoto(await photo(), jpeg, 1);
    await expect(vault.deletePhoto('photo-a', 1)).rejects.toThrow('REVISION_CONFLICT'); await vault.close();
  });
  it.each([{ state: 'uploading' as const }, { uploadId: 'u' }, { receivedBytes: 4 }, { reservationRevision: 2 }])('%o 상태는 지울 수 없다', async patch => {
    expect(canDeletePhoto({ ...(await photo()), ...patch })).toBe(false);
  });
});

describe('현장 편의 기능 연결', () => {
  const source = readFileSync(new URL('../src/FieldWorkspace.tsx', import.meta.url), 'utf8');
  it('사진첩은 여러 장을 고르고 저장할 때마다 최신 작업 버전을 쓴다', () => {
    expect(source).toMatch(/allowsMultipleSelection: true, selectionLimit: GALLERY_BATCH/u);
    expect(source).toMatch(/persistCapture\(vault, current, asset, target, phase, exifCapturedAt\(asset\.exif\)\)/u);
    expect(source).toMatch(/current = \(await vault\.load\(\)\)\.visits\.find/u);
  });
  it('삭제 버튼은 지울 수 있는 사진에만 보이고 확인을 거친다', () => {
    expect(source).toMatch(/canDeletePhoto\(photo\) \? <Button label="이 사진 삭제"/u);
    expect(source).toMatch(/Alert\.alert\('사진 삭제'/u);
  });
  it('다른 앱으로 넘어가면 작성 중인 내용을 저장한다', () => {
    expect(source).toMatch(/if \(next === 'background'\) void autosave\.current\(\)/u);
    expect(source).toMatch(/if \(!vault \|\| !visit \|\| !dirty \|\| busyRef\.current\) return;/u);
  });
});
