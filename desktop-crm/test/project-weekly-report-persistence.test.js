const test = require('node:test');
const assert = require('node:assert/strict');
const { FirebaseRemoteClient } = require('../src/remote');
const fs = require('node:fs');
const path = require('node:path');

const sourceOrders = {
  w1: { projectId: 'p1', assigneeUid: 'u1', status: 'done', startDate: '2026-09-21', dueDate: '2026-09-25', updatedAt: '2026-09-23T09:00:00Z' },
};

function client(role = 'member', uid = 'u1', existing = null) {
  const remote = Object.create(FirebaseRemoteClient.prototype);
  remote.requireOfficeSession = () => ({ role, uid });
  remote.captureSessionGuard = () => 1;
  remote.assertSessionGuardActive = () => {};
  remote.dbReadWithEtag = async location => ({ value: location.startsWith('projectWeeklyReportReviews/') ? null : existing, etag: 'etag-1' });
  remote.dbRequest = async (location) => location === 'workOrders' ? sourceOrders : null;
  remote.dbConditionalPut = async (location, value) => { remote.written = { location, value }; };
  return remote;
}

test('직원 보고 초안은 서버 업무로 근거를 다시 계산하고 작성자만 저장한다', async () => {
  const remote = client();
  const saved = await remote.saveProjectWeeklyReport({
    id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft',
    summary: '누수 확인 완료', snapshot: { counts: { total: 999 } },
  });
  assert.equal(saved.status, 'draft');
  assert.equal(saved.authorUid, 'u1');
  assert.equal(saved.snapshot.counts.total, 1);
  assert.deepEqual(saved.snapshot.sources.map(item => item.id), ['w1']);
  assert.equal(remote.written.location, 'projectWeeklyReports/r1');
  assert.equal(remote.written.value.summary, '누수 확인 완료');
  const other = client('member', 'u2', saved);
  await assert.rejects(other.saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft' }), error => error.code === 'REPORT_NOT_AUTHOR');
});

test('잘못된 서버 보고서를 빈 목록처럼 숨기지 않는다', async () => {
  const remote = client();
  remote.dbRequest = async () => ({ bad: { id: 'bad', status: 'approved' } });
  await assert.rejects(remote.loadProjectWeeklyReports(), error => error.code === 'REPORT_DATA_INVALID');
});

test('관리자 승인 뒤 같은 보고 ID는 수정할 수 없다', async () => {
  const draft = await client().saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft' });
  const submitted = await client('member', 'u1', draft).saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'submit', summary: '현장 확인', nextActions: '다음 주 재점검' });
  const approved = await client('admin', 'admin', submitted).saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', action: 'approve' });
  assert.equal(approved.status, 'approved');
  const reviewer = client('admin', 'admin', submitted);
  await reviewer.saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', action: 'approve' });
  assert.equal(reviewer.written.location, 'projectWeeklyReportReviews/r1');
  assert.equal(reviewer.written.value.reviewerUid, 'admin');
  await assert.rejects(client('admin', 'admin', approved).saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', action: 'saveDraft' }), error => error.code === 'REPORT_APPROVED_LOCKED');
});

test('조회는 불변 제출본과 별도 검수 결정을 결합한다', async () => {
  const submitted = await client().saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'submit', summary: '완료', nextActions: '재점검' });
  const remote = client();
  remote.dbRequest = async location => location === 'projectWeeklyReports' ? { r1: submitted }
    : location === 'projectWeeklyReportReviews' ? { r1: { status: 'approved', projectId: 'p1', authorUid: 'u1', reviewerUid: 'admin', reviewedAt: '2026-09-24T12:00:00.000Z' } } : null;
  const result = await remote.loadProjectWeeklyReports();
  assert.equal(result.reports[0].status, 'approved');
  assert.deepEqual(result.reports[0].snapshot, submitted.snapshot);
});
test('잘못된 검수 시각은 승인으로 표시하지 않는다',async()=>{
  const submitted=await client().saveProjectWeeklyReport({id:'r1',projectId:'p1',asOf:'2026-09-24',action:'submit',summary:'완료',nextActions:'재점검'});
  const remote=client();
  remote.dbRequest=async location=>location==='projectWeeklyReports'?{r1:submitted}:location==='projectWeeklyReportReviews'?{r1:{status:'approved',projectId:'p1',authorUid:'u1',reviewerUid:'admin',reviewedAt:'zzz'}}:null;
  await assert.rejects(remote.loadProjectWeeklyReports(),error=>error.code==='REPORT_REVIEW_INVALID');
});

test('검수 요청에는 실제 결과와 다음 행동을 직접 확인해 적어야 한다', async () => {
  const remote = client();
  await assert.rejects(remote.saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'submit' }),
    error => error.code === 'REPORT_NARRATIVE_REQUIRED');
  const saved = await remote.saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'submit', summary: '현장 사진 확인', nextActions: '다음 주 재점검' });
  assert.equal(saved.status, 'submitted');
});

test('승인본 정정은 원본을 유지하고 새 ID에 이전 승인본 링크를 남긴다', async () => {
  const original = await client().saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'submit', summary: '완료', nextActions: '재점검' });
  const remote = client();
  remote.dbRequest = async location => location === 'workOrders' ? sourceOrders : location === 'projectWeeklyReports/r1' ? original
    : location === 'projectWeeklyReportReviews/r1' ? { status: 'approved', projectId: 'p1', authorUid: 'u1', reviewerUid: 'admin', reviewedAt: '2026-09-24T12:00:00.000Z' } : null;
  const revised = await remote.saveProjectWeeklyReport({ id: 'r2', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft', supersedesId: 'r1' });
  assert.equal(revised.status, 'draft');
  assert.equal(revised.supersedesId, 'r1');
  assert.equal(original.status, 'submitted');
  await assert.rejects(remote.saveProjectWeeklyReport({ id: 'r3', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft', supersedesId: 'missing' }),
    error => error.code === 'REPORT_REVISION_INVALID');
});

test('서버 규칙은 승인본 수정·삭제와 다른 사람의 보고서 수정을 막는다', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8')).rules.crmCompany.projectWeeklyReports;
  assert.equal(rules['.write'], false);
  assert.match(rules['.read'], /email_verified/u);
  const write = rules.$reportId['.write'];
  assert.match(write, /data\.child\('status'\)\.val\(\) === 'draft'/u);
  assert.match(write, /newData\.exists\(\)/u);
  assert.match(write, /data\.child\('authorUid'\)\.val\(\) === auth\.uid/u);
  assert.match(write, /'admin'/u);
  assert.match(rules.$reportId['.validate'], /newData\.child\('summary'\)/u);
  assert.equal(rules.$reportId.$other['.validate'], false);
  const reviewRules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8')).rules.crmCompany.projectWeeklyReportReviews;
  assert.match(reviewRules.$reportId['.write'], /!data\.exists\(\)/u);
});

test('주간 보고 조회·저장은 제한된 Electron 통로로만 노출한다', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const main = read('main.js');
  const preload = read('preload.js');
  const policy = require('../src/mutation-policy');
  assert.equal(policy.classification('crm:project-weekly-reports-load'), 'control');
  assert.equal(policy.classification('crm:project-weekly-report-save'), 'mutation');
  assert.match(main, /secureHandle\("crm:project-weekly-reports-load"/u);
  assert.match(main, /secureCanonicalHandle\("crm:project-weekly-report-save"/u);
  assert.match(preload, /loadProjectWeeklyReports:.*crm:project-weekly-reports-load/u);
  assert.match(preload, /saveProjectWeeklyReport:.*crm:project-weekly-report-save/u);
});

test('프로젝트 보고 탭은 서버 보고서를 불러오고 제출·검수 입력을 노출한다', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /async function loadProjectWeeklyReports\(/u);
  assert.match(app, /api\.loadProjectWeeklyReports\(/u);
  assert.match(app, /data-project-weekly-report-form/u);
  assert.match(app, /api\.saveProjectWeeklyReport\(/u);
  assert.match(app, /data-project-weekly-review/u);
  const css = fs.readFileSync(path.join(__dirname, '../src/toss.css'), 'utf8');
  assert.match(css, /\.project-weekly-report-entry\{/u);
});

test('반려된 제출본도 수정하지 않고 새 보완본으로 연결한다', async () => {
  const submitted = await client().saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'submit', summary: '완료', nextActions: '재점검' });
  const admin = client('admin', 'admin', submitted);
  const returned = await admin.saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', action: 'return', reviewNote: '사진 보완' });
  assert.equal(admin.written.location, 'projectWeeklyReportReviews/r1');
  assert.equal(returned.status, 'returned');
  const remote = client();
  remote.dbRequest = async location => location === 'workOrders' ? sourceOrders : location === 'projectWeeklyReports/r1' ? submitted
    : location === 'projectWeeklyReportReviews/r1' ? admin.written.value : null;
  const revised = await remote.saveProjectWeeklyReport({ id: 'r2', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft', supersedesId: 'r1' });
  assert.equal(revised.supersedesId, 'r1');
  assert.equal(remote.written.location, 'projectWeeklyReports/r2');
  await assert.rejects(client('member', 'u1', submitted).saveProjectWeeklyReport({ id: 'r1', projectId: 'p1', asOf: '2026-09-24', action: 'saveDraft' }),
    error => error.code === 'REPORT_APPROVED_LOCKED');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /\["approved", "returned"\]\.includes\(item\.status\)/u);
});
