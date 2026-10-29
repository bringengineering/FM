# BRING TV Integrated Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing BRING TV Windows kiosk installer with a reusable troubleshooting prompt, publish it as v1.0.3, and resend one verified download link by email.

**Architecture:** Keep the verified v1.0.2 installer scripts unchanged and assemble a new versioned distribution directory. Add a plain-text recovery prompt and extend the focused package test so the archive cannot be published without the required user-facing files. Publish a new immutable GitHub Release and verify the public bytes before sending the link.

**Tech Stack:** PowerShell, Windows CMD, Node.js built-in test runner, GitHub CLI, GitHub Releases, Gmail web UI

---

### Task 1: Define the recovery prompt contract

**Files:**
- Modify: `desktop-crm/test/tv-web-kiosk-scripts.test.js`
- Create: `release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치복구-프롬프트.txt`

- [ ] **Step 1: Write the failing package-content test**

Add a test that reads the prompt and verifies that it includes the error log filename, the TV URL, and the secret-sharing prohibition:

```js
test('integrated TV package includes a safe recovery prompt',()=>{
 const promptPath=path.join(root,'release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치복구-프롬프트.txt');
 const source=fs.readFileSync(promptPath,'utf8');
 assert.match(source,/BRING-TV-설치-오류\.txt/);
 assert.match(source,/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\/tv/);
 assert.match(source,/비밀번호.*인증코드.*공유하지/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
node --test .\desktop-crm\test\tv-web-kiosk-scripts.test.js
```

Expected: FAIL because `release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치복구-프롬프트.txt` does not exist.

- [ ] **Step 3: Create the recovery prompt**

Create the text file with this complete content:

```text
아래 BRING TV 설치 오류를 진단하고, 사용자 자료를 삭제하지 않는 안전한 해결 방법을 안내해 주세요.

[환경]
- Windows 컴퓨터
- TV 운영보드 주소: https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv
- 설치 파일: BRING-TV-설치.cmd
- 오류 기록: 바탕화면의 BRING-TV-설치-오류.txt

[요청]
1. 오류 기록에서 직접 확인되는 원인을 먼저 설명해 주세요.
2. Edge 또는 Chrome 설치 여부와 시작프로그램 폴더 접근 상태를 확인해 주세요.
3. 기존 TV 등록 정보와 브라우저 프로필은 삭제하지 마세요.
4. 필요한 조치만 번호 순서로 안내해 주세요.
5. 비밀번호, 인증코드, 쿠키, API 키는 요청하거나 공유하지 마세요.

[오류 기록]
여기에 BRING-TV-설치-오류.txt 내용을 붙여넣으세요.
```

- [ ] **Step 4: Run the focused test and verify success**

Run:

```powershell
node --test .\desktop-crm\test\tv-web-kiosk-scripts.test.js
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the prompt contract**

```powershell
git add desktop-crm/test/tv-web-kiosk-scripts.test.js release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치복구-프롬프트.txt
git commit -m "test: define TV recovery prompt package"
```

### Task 2: Assemble and validate the v1.0.3 archive

**Files:**
- Create: `release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치.cmd`
- Create: `release/tv-web-kiosk-package-v1.0.3/BRING-TV-삭제.cmd`
- Create: `release/tv-web-kiosk-package-v1.0.3/install-bring-tv-web-kiosk.ps1`
- Create: `release/tv-web-kiosk-package-v1.0.3/uninstall-bring-tv-web-kiosk.ps1`
- Create: `release/tv-web-kiosk-package-v1.0.3/사용방법.txt`
- Create: `release/tv-web-kiosk-package-v1.0.3/README.txt`
- Create: `release/BRING-TV-통합설치-v1.0.3.zip`

- [ ] **Step 1: Copy the verified installer files into the versioned package**

Run:

```powershell
Copy-Item release\tv-web-kiosk-package-v1.0.2\BRING-TV-설치.cmd release\tv-web-kiosk-package-v1.0.3\BRING-TV-설치.cmd
Copy-Item release\tv-web-kiosk-package-v1.0.2\BRING-TV-삭제.cmd release\tv-web-kiosk-package-v1.0.3\BRING-TV-삭제.cmd
Copy-Item release\tv-web-kiosk-package-v1.0.2\install-bring-tv-web-kiosk.ps1 release\tv-web-kiosk-package-v1.0.3\install-bring-tv-web-kiosk.ps1
Copy-Item release\tv-web-kiosk-package-v1.0.2\uninstall-bring-tv-web-kiosk.ps1 release\tv-web-kiosk-package-v1.0.3\uninstall-bring-tv-web-kiosk.ps1
Copy-Item release\tv-web-kiosk-package-v1.0.2\사용방법.txt release\tv-web-kiosk-package-v1.0.3\사용방법.txt
```

Expected: all five commands complete without errors.

- [ ] **Step 2: Create the package README**

Create `README.txt` with the version, TV URL, install entry point, removal entry point, error-log path, and a statement that the package contains no passwords, authentication codes, cookies, or API keys.

- [ ] **Step 3: Validate PowerShell syntax and focused tests**

Run:

```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'release\tv-web-kiosk-package-v1.0.3\install-bring-tv-web-kiosk.ps1'), [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { $errors | Format-List; exit 1 }
node --test .\desktop-crm\test\tv-web-kiosk-scripts.test.js
```

Expected: no parser errors and 3 tests pass.

- [ ] **Step 4: Build the ZIP and inspect its contents**

Run:

```powershell
Compress-Archive -Path release\tv-web-kiosk-package-v1.0.3\* -DestinationPath release\BRING-TV-통합설치-v1.0.3.zip -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::OpenRead((Resolve-Path 'release\BRING-TV-통합설치-v1.0.3.zip')).Entries.FullName
Get-FileHash release\BRING-TV-통합설치-v1.0.3.zip -Algorithm SHA256
```

Expected: seven required files are listed and one SHA-256 value is printed.

- [ ] **Step 5: Commit the integrated package source**

```powershell
git add desktop-crm/test/tv-web-kiosk-scripts.test.js release/tv-web-kiosk-package-v1.0.3
git commit -m "feat: add integrated BRING TV installer package"
```

The generated ZIP remains a release artifact and is not added to Git history.

### Task 3: Publish and verify the immutable GitHub Release

**Files:**
- Read: `release/BRING-TV-통합설치-v1.0.3.zip`

- [ ] **Step 1: Push the implementation commits**

```powershell
git push origin codex/free-web-tv-kiosk
```

Expected: remote branch advances without force push.

- [ ] **Step 2: Create the new release and upload the archive**

```powershell
gh release create bring-tv-web-kiosk-v1.0.3 release\BRING-TV-통합설치-v1.0.3.zip --repo bringengineering/FM --title "BRING TV Web Kiosk v1.0.3" --notes "Windows TV installer, user guide, and safe recovery prompt in one archive."
```

Expected: GitHub prints the new release URL. Do not move or reuse v1.0.2.

- [ ] **Step 3: Verify public download integrity**

Download the release asset without GitHub credentials, calculate SHA-256, and compare it with the local archive hash.

Expected: byte count is greater than zero and both SHA-256 values are identical.

### Task 4: Resend the verified package by email

**Files:**
- Read: `release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치복구-프롬프트.txt`

- [ ] **Step 1: Compose the email from the existing company Gmail session**

Use subject:

```text
[BRING] TV 운영보드 통합 설치 프로그램 v1.0.3 — 프롬프트 포함
```

The email body must contain the single direct-download link, four installation steps, the error-log instruction, and the complete recovery prompt.

- [ ] **Step 2: Send to the same verified company recipient**

Expected: Gmail shows the message in Sent and the recipient inbox shows the v1.0.3 subject.

- [ ] **Step 3: Record the final handoff**

Report the release URL, direct-download URL, archive SHA-256, email subject, and the exact filename the user should open.
