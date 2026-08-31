'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Policy = require('../src/mutation-policy');
const {
  FirebaseRemoteClient,
  OFFICE_ATTACHMENT_RESPONSE_MAX_BYTES,
  readBoundedJsonResponse,
} = require('../src/remote');

const source = name => fs.readFile(path.join(__dirname, '..', 'src', name), 'utf8');

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: name => normalized[String(name).toLowerCase()] || null };
}

test('attachment picker has exactly the send mutation permission while open stays control-only', () => {
  assert.equal(Policy.classification('crm:office-attachment-pick'), 'mutation');
  assert.equal(Policy.classification('crm:office-attachment-pick'), Policy.classification('crm:office-message-send'));
  assert.equal(Policy.classification('crm:office-attachment-open'), 'control');
  const marketingOnly = { accessRole: 'member', role: 'member', marketingRole: 'marketing' };
  assert.throws(
    () => Policy.assertChannelAllowed('crm:office-attachment-pick', marketingOnly),
    error => error && error.code === 'MARKETING_ONLY_FORBIDDEN',
  );
});

test('bounded JSON reader accepts an exact canonical JSON response', async () => {
  const body = Buffer.from(JSON.stringify({ id: 'msg_abcdefgh', bodyBase64: 'YWJj' }));
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length) },
  });
  assert.deepEqual(await readBoundedJsonResponse(response, body.length), { id: 'msg_abcdefgh', bodyBase64: 'YWJj' });
});

test('bounded JSON reader rejects an oversized declaration before reading its body', async () => {
  let canceled = false;
  let requestedReader = false;
  const response = {
    ok: true,
    status: 200,
    headers: headers({ 'content-type': 'application/json', 'content-length': OFFICE_ATTACHMENT_RESPONSE_MAX_BYTES + 1 }),
    body: {
      cancel: async () => { canceled = true; },
      getReader: () => { requestedReader = true; throw new Error('must not allocate'); },
    },
  };
  await assert.rejects(
    readBoundedJsonResponse(response, OFFICE_ATTACHMENT_RESPONSE_MAX_BYTES),
    error => error && error.code === 'DATABASE_RESPONSE_TOO_LARGE',
  );
  assert.equal(canceled, true);
  assert.equal(requestedReader, false);
});

test('bounded JSON reader cancels a chunked response as soon as its limit is exceeded', async () => {
  const chunks = [Buffer.from('1234'), Buffer.from('5678')];
  let index = 0;
  let canceled = false;
  const response = {
    ok: true,
    status: 200,
    headers: headers({ 'content-type': 'application/json' }),
    body: {
      getReader: () => ({
        read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
        cancel: async () => { canceled = true; },
        releaseLock: () => {},
      }),
    },
  };
  await assert.rejects(
    readBoundedJsonResponse(response, 6),
    error => error && error.code === 'DATABASE_RESPONSE_TOO_LARGE',
  );
  assert.equal(canceled, true);
});

test('office file loader performs one exact, bounded Firebase record GET', async () => {
  const messageId = 'msg_abcdefgh';
  const record = {
    id: messageId,
    senderId: 'uid-sender',
    receiverId: 'uid-current',
    fileName: 'sample.txt',
    extension: 'txt',
    mimeType: 'text/plain',
    size: 3,
    sha256: 'a'.repeat(64),
    bodyBase64: 'YWJj',
  };
  const bytes = Buffer.from(JSON.stringify(record));
  const requests = [];
  const client = new FirebaseRemoteClient({
    firebaseConfig: { apiKey: 'public-client-id', databaseUrl: 'https://example.invalid', authPageUrl: 'https://example.invalid/auth' },
    databaseRoot: 'crmCompany',
    Core: {},
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: '',
    pendingFile: '',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) },
      });
    },
  });
  client.session = {
    uid: 'uid-current',
    email: 'current@example.test',
    role: 'member',
    idToken: 'session-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
  };

  assert.deepEqual(await client.loadOfficeMessageFile({ messageId }), record);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].url, `https://example.invalid/crmCompany/officeMessageFiles/${messageId}.json?auth=session-token`);
});

test('main attachment lifecycle is TOCTOU-aware, warns by default, applies MOTW, and cleans only its cache', async () => {
  const main = await source('main.js');
  assert.match(main, /officeAttachmentStatsMatch\(before, opened\)/);
  assert.match(main, /const afterPath = await fs\.lstat\(selectedPath\)/);
  assert.match(main, /officeAttachmentStatsMatch\(afterHandle, afterPath\)/);
  assert.match(main, /buttons: \["취소", "검증된 파일 열기"\]/);
  assert.match(main, /defaultId: 0/);
  assert.match(main, /Zone\.Identifier/);
  assert.match(main, /ZoneId=3/);
  assert.match(main, /try \{\s*await writeOfficeAttachmentMotw\(outputPath\);\s*\} catch \(_motwError\) \{\s*throw new Error\("Windows 보안 표시를 적용하지 못해 첨부파일을 열지 않았습니다\."\);/);
  assert.ok(main.indexOf('await writeOfficeAttachmentMotw(outputPath)') < main.indexOf('await shell.openPath(outputPath)'));
  assert.match(main, /OFFICE_ATTACHMENT_CACHE_DIRECTORY = "bring-crm-office-attachments"/);
  assert.match(main, /fs\.rm\(cacheRoot, \{ recursive: true, force: false/);
  assert.match(main, /fs\.rm\(outputDirectory, \{ recursive: true, force: true \}\)/);
  assert.match(main, /await cleanupOfficeAttachmentCache\(\)/);
  assert.match(main, /BRING_CRM_SCREENSHOT_ACTION === "office-messenger-smoke"/);
});

test('startup cleanup removes only stale inactive direct session directories without following links', async () => {
  const main = await source('main.js');
  const cleanup = main.slice(
    main.indexOf('async function cleanupStaleOfficeAttachmentCaches'),
    main.indexOf('async function ensureOfficeAttachmentCacheRoot'),
  );
  const startup = main.slice(main.indexOf('app.whenReady().then(async () => {'));

  assert.match(main, /OFFICE_ATTACHMENT_CACHE_STALE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(main, /function officeAttachmentDirectChild\(cacheParent, childName\)/);
  assert.match(main, /\^session-\(\\d\{1,10\}\)-\(\[0-9a-f\]\{16\}\)\$/);
  assert.match(cleanup, /parentBefore = await fs\.lstat\(cacheParent\)/);
  assert.match(cleanup, /entries = await fs\.opendir\(cacheParent\)/);
  assert.match(cleanup, /if \(childName === OFFICE_ATTACHMENT_CACHE_SESSION\) continue/);
  assert.match(cleanup, /officeAttachmentCacheProcessIsActive\(match\[1\]\)/);
  assert.match(cleanup, /const first = await fs\.lstat\(target\)/);
  assert.match(cleanup, /first\.isSymbolicLink\(\) \|\| !first\.isDirectory\(\)/);
  assert.match(cleanup, /now - touchedAt <= OFFICE_ATTACHMENT_CACHE_STALE_MS/);
  assert.match(cleanup, /officeAttachmentDirectoryIdentityMatches\(parentBefore, parentFinal\)/);
  assert.match(cleanup, /officeAttachmentDirectoryIdentityMatches\(first, second\)/);
  assert.match(cleanup, /fs\.rm\(target, \{ recursive: true, force: false/);
  assert.doesNotMatch(cleanup, /fs\.rm\(cacheParent/);
  assert.ok(startup.indexOf('await cleanupStaleOfficeAttachmentCaches()') < startup.indexOf('await initializeRemote()'));
  assert.doesNotMatch(cleanup, /error\.message/);
});

test('stale cache cleanup behavior deletes only an old dead session and preserves current, live, fresh, and link entries', async () => {
  const main = await source('main.js');
  const helperStart = main.indexOf('function officeAttachmentCachePaths');
  const helperEnd = main.indexOf('async function ensureOfficeAttachmentCacheRoot');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = main.slice(helperStart, helperEnd);
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bring-crm-cache-test-'));
  const cacheParent = path.join(testRoot, 'bring-crm-office-attachments');
  const currentName = 'session-999-aaaaaaaaaaaaaaaa';
  const staleDeadName = 'session-111-bbbbbbbbbbbbbbbb';
  const staleLiveName = 'session-222-cccccccccccccccc';
  const freshDeadName = 'session-333-dddddddddddddddd';
  const staleLinkName = 'session-444-eeeeeeeeeeeeeeee';
  const staleFileName = 'session-555-ffffffffffffffff';
  const oldNames = new Set([currentName, staleDeadName, staleLiveName, staleLinkName, staleFileName]);
  const now = Date.now();
  const oldTimestamp = now - (25 * 60 * 60 * 1000);
  const logs = [];
  let linkCreated = false;

  const exists = async target => {
    try { await fs.lstat(target); return true; } catch (error) { if (error && error.code === 'ENOENT') return false; throw error; }
  };
  const staleStats = stats => new Proxy(stats, {
    get(target, property) {
      if (['mtimeMs', 'ctimeMs', 'birthtimeMs'].includes(property)) return oldTimestamp;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const fakeFs = Object.assign(Object.create(fs), {
    lstat: async target => {
      const stats = await fs.lstat(target);
      return oldNames.has(path.basename(String(target))) ? staleStats(stats) : stats;
    },
  });
  const deadProcess = () => {
    const error = new Error('not running');
    error.code = 'ESRCH';
    throw error;
  };

  try {
    await fs.mkdir(cacheParent, { recursive: true });
    for (const name of [currentName, staleDeadName, staleLiveName, freshDeadName]) {
      await fs.mkdir(path.join(cacheParent, name));
    }
    await fs.writeFile(path.join(cacheParent, staleFileName), 'not a directory', 'utf8');
    const outsideDirectory = path.join(testRoot, 'outside-target');
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, 'keep.txt'), 'keep', 'utf8');
    try {
      await fs.symlink(outsideDirectory, path.join(cacheParent, staleLinkName), process.platform === 'win32' ? 'junction' : 'dir');
      linkCreated = true;
    } catch (error) {
      if (!error || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }

    const context = vm.createContext({
      app: { getPath: name => { assert.equal(name, 'temp'); return testRoot; } },
      console: { warn: (...args) => logs.push(args) },
      fs: fakeFs,
      path,
      process: {
        pid: 999,
        kill: pid => { if (pid === 222) return; deadProcess(); },
      },
    });
    vm.runInContext(`
      'use strict';
      const OFFICE_ATTACHMENT_CACHE_DIRECTORY = 'bring-crm-office-attachments';
      const OFFICE_ATTACHMENT_CACHE_SESSION = '${currentName}';
      const OFFICE_ATTACHMENT_CACHE_STALE_MS = 24 * 60 * 60 * 1000;
      ${helperSource}
      globalThis.runCleanup = cleanupStaleOfficeAttachmentCaches;
    `, context);

    assert.equal(await context.runCleanup(now), true);
    assert.equal(await exists(path.join(cacheParent, staleDeadName)), false);
    assert.equal(await exists(path.join(cacheParent, currentName)), true);
    assert.equal(await exists(path.join(cacheParent, staleLiveName)), true);
    assert.equal(await exists(path.join(cacheParent, freshDeadName)), true);
    assert.equal(await exists(path.join(cacheParent, staleFileName)), true);
    if (linkCreated) assert.equal(await exists(path.join(cacheParent, staleLinkName)), true);
    assert.equal(await fs.readFile(path.join(outsideDirectory, 'keep.txt'), 'utf8'), 'keep');
    assert.deepEqual(logs, []);
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});
