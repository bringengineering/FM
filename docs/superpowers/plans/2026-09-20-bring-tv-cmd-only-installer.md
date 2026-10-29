# BRING TV CMD-Only Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, publish, and email a Windows TV-board installer that uses CMD only and never invokes PowerShell.

**Architecture:** A versioned release directory contains three focused batch files: installer, startup launcher, and uninstaller. The installer copies the launcher into the current user's Startup folder; the launcher detects Edge or Chrome on every run and opens the fixed BRING TV HTTPS URL with a persistent dedicated profile. Node tests inspect the real package contents and a packaging script creates and validates the ZIP.

**Tech Stack:** Windows CMD, Node.js built-in test runner, PowerShell only as the developer-side packaging shell (never included or invoked by the customer package), GitHub Releases, Gmail.

---

### Task 1: Define the CMD-only package contract

**Files:**
- Modify: `desktop-crm/test/tv-web-kiosk-scripts.test.js`
- Test: `desktop-crm/test/tv-web-kiosk-scripts.test.js`

- [ ] **Step 1: Write failing tests for the v1.0.4 package**

Add tests that load `release/tv-web-kiosk-package-v1.0.4`, require the six documented files, reject `powershell`, `pwsh`, `.ps1`, and verify the fixed HTTPS URL, current-user Startup path, Edge/Chrome detection, dedicated profile, exact uninstaller target, and safe recovery prompt.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/tv-web-kiosk-scripts.test.js`

Expected: FAIL because `release/tv-web-kiosk-package-v1.0.4` does not exist.

- [ ] **Step 3: Commit the failing contract**

```powershell
git add desktop-crm/test/tv-web-kiosk-scripts.test.js
git commit -m "test: define CMD-only TV installer contract"
```

### Task 2: Implement the package

**Files:**
- Create: `release/tv-web-kiosk-package-v1.0.4/BRING-TV-설치.cmd`
- Create: `release/tv-web-kiosk-package-v1.0.4/BRING-TV-자동실행.cmd`
- Create: `release/tv-web-kiosk-package-v1.0.4/BRING-TV-삭제.cmd`
- Create: `release/tv-web-kiosk-package-v1.0.4/사용방법.txt`
- Create: `release/tv-web-kiosk-package-v1.0.4/BRING-TV-설치복구-프롬프트.txt`
- Create: `release/tv-web-kiosk-package-v1.0.4/README.md`

- [ ] **Step 1: Implement the startup launcher**

The launcher must detect Edge first and Chrome second in machine and current-user locations, create `%LOCALAPPDATA%\BRING-TV\BrowserProfile`, and run:

```bat
start "" "%BROWSER%" --kiosk --no-first-run --disable-session-crashed-bubble --user-data-dir="%PROFILE_DIR%" "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv"
```

If no supported browser is found, write `BRING-TV-CMD-설치-오류.txt` to the user Desktop, OneDrive Desktop, or `%TEMP%` fallback and exit nonzero.

- [ ] **Step 2: Implement the installer**

Use `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` as `STARTUP_DIR`, copy only `BRING-TV-자동실행.cmd` into that directory, verify the copy, and immediately start the copied launcher. Do not request elevation or invoke another shell.

- [ ] **Step 3: Implement the uninstaller**

Delete only `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BRING-TV-자동실행.cmd`. Do not remove `%LOCALAPPDATA%\BRING-TV`, browser data, cookies, or pairing information.

- [ ] **Step 4: Add Korean user guidance and recovery prompt**

Document unzip → double-click install, startup behavior, supported browsers, safe removal, fixed URL, and the exact error-log sharing procedure. Explicitly state that passwords, verification codes, cookies, and API keys must not be shared.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test test/tv-web-kiosk-scripts.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit the package**

```powershell
git add desktop-crm/test/tv-web-kiosk-scripts.test.js release/tv-web-kiosk-package-v1.0.4
git commit -m "feat: add CMD-only BRING TV installer"
```

### Task 3: Build and validate the immutable ZIP

**Files:**
- Create: `release/BRING-TV-CMD-Installer-v1.0.4.zip`

- [ ] **Step 1: Scan source files for forbidden PowerShell references**

Run a case-insensitive scan across the three CMD files and assert there are no matches for `powershell`, `pwsh`, or `.ps1`.

- [ ] **Step 2: Create the ZIP from the versioned package directory**

Use `Compress-Archive` only on the developer workstation to archive the six package files. PowerShell is not placed inside the archive and is not called by any customer-facing file.

- [ ] **Step 3: Inspect the ZIP manifest**

Open the archive and assert it contains exactly the six expected files and no `.ps1` entry.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/tv-web-kiosk-scripts.test.js
npm test
```

Expected: zero failures.

- [ ] **Step 5: Record the local SHA-256 and commit the archive**

```powershell
Get-FileHash release/BRING-TV-CMD-Installer-v1.0.4.zip -Algorithm SHA256
git add release/BRING-TV-CMD-Installer-v1.0.4.zip
git commit -m "build: package BRING TV CMD installer v1.0.4"
```

### Task 4: Publish and deliver v1.0.4

**Files:**
- Modify: GitHub pull request branch and release metadata only

- [ ] **Step 1: Push the branch without force**

Run: `git push origin codex/free-web-tv-kiosk`

- [ ] **Step 2: Verify pull-request checks**

Confirm all required checks for PR `#122` finish successfully before release publication.

- [ ] **Step 3: Create a new immutable release**

Create tag `bring-tv-web-kiosk-v1.0.4`, title `BRING TV CMD Installer v1.0.4`, attach `BRING-TV-CMD-Installer-v1.0.4.zip`, and describe that it requires no PowerShell or administrator rights. Do not move or reuse an existing tag.

- [ ] **Step 4: Verify the public download**

Download the asset from the unauthenticated direct release URL and verify its SHA-256 equals the local archive hash.

- [ ] **Step 5: Send the requested Gmail message**

Send `dpvld858@gmail.com` an email titled `[BRING] TV 운영보드 CMD 전용 설치 프로그램 v1.0.4 — PowerShell 없음`, containing the direct download link, three-step usage instructions, SHA-256, and the recovery prompt as an attachment or clearly named included file.

- [ ] **Step 6: Verify delivery evidence**

Confirm the message is present in Sent and report the immutable release URL, direct asset URL, hash, test counts, and the exact one-time action required on the TV computer.

