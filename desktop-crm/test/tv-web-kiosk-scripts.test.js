const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'../..');
test('Windows installer creates only a current-user browser kiosk startup shortcut',()=>{
 const source=fs.readFileSync(path.join(root,'release/install-bring-tv-web-kiosk.ps1'),'utf8');
 assert.match(source,/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\/tv/);
 assert.match(source,/Startup/);assert.match(source,/--kiosk/);assert.match(source,/WScript\.Shell/);
 assert.match(source,/BRING-TV[\\/]EdgeProfile/);assert.match(source,/--user-data-dir/);
 assert.match(source,/New-Item[^\r\n]*-ItemType Directory/);
 assert.doesNotMatch(source,/param\s*\([^)]*Url/i);assert.doesNotMatch(source,/RunAs|AllUsers|CommonStartup/i);
 assert.match(source,/if \(\$env:ProgramFiles\)/);assert.match(source,/if \(\$\{env:ProgramFiles\(x86\)\}\)/);
 assert.match(source,/Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe/);
 assert.match(source,/SpecialFolders\.Item\('Startup'\)/);
 assert.match(source,/BRING-TV-설치-오류\.txt/);
 assert.match(source,/Start-Process/);
});
test('Windows uninstaller removes only the named BRING TV shortcut',()=>{
 const source=fs.readFileSync(path.join(root,'release/uninstall-bring-tv-web-kiosk.ps1'),'utf8');
 assert.match(source,/BRING TV 운영보드\.lnk/);assert.match(source,/Remove-Item\s+-LiteralPath/);
 assert.doesNotMatch(source,/Remove-Item[^\r\n]*-Recurse|Cookies|User Data|Downloads/i);
});
test('integrated TV package includes a safe recovery prompt',()=>{
 const promptPath=path.join(root,'release/tv-web-kiosk-package-v1.0.3/BRING-TV-설치복구-프롬프트.txt');
 const source=fs.readFileSync(promptPath,'utf8');
 assert.match(source,/BRING-TV-설치-오류\.txt/);
 assert.match(source,/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\/tv/);
 assert.match(source,/비밀번호.*인증코드.*공유하지/);
});

const cmdOnlyPackage=path.join(root,'release/tv-web-kiosk-package-v1.0.4');
const cmdOnlyFiles=[
 'BRING-TV-설치.cmd',
 'BRING-TV-자동실행.cmd',
 'BRING-TV-삭제.cmd',
 '사용방법.txt',
 'BRING-TV-설치복구-프롬프트.txt',
 'README.md',
];

test('CMD-only TV package contains exactly the documented customer files',()=>{
 const files=fs.readdirSync(cmdOnlyPackage).sort();
 assert.deepEqual(files,[...cmdOnlyFiles].sort());
});

test('CMD-only TV package never invokes or ships PowerShell',()=>{
 const combined=cmdOnlyFiles
  .map(file=>fs.readFileSync(path.join(cmdOnlyPackage,file),'utf8'))
  .join('\n');
 assert.doesNotMatch(combined,/powershell|pwsh|\.ps1/i);
 assert.equal(cmdOnlyFiles.some(file=>/\.ps1$/i.test(file)),false);
});

test('CMD-only TV installer registers the launcher for the current user and starts it',()=>{
 const source=fs.readFileSync(path.join(cmdOnlyPackage,'BRING-TV-설치.cmd'),'utf8');
 assert.match(source,/%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup/i);
 assert.match(source,/copy \/Y .*BRING-TV-자동실행\.cmd/i);
 assert.match(source,/start "" "%LAUNCHER%"/i);
 assert.match(source,/BRING-TV-CMD-설치-오류\.txt/i);
 assert.doesNotMatch(source,/RunAs|CommonStartup|AllUsers/i);
});

test('CMD-only TV launcher detects supported browsers and preserves its profile',()=>{
 const source=fs.readFileSync(path.join(cmdOnlyPackage,'BRING-TV-자동실행.cmd'),'utf8');
 assert.match(source,/Microsoft\\Edge\\Application\\msedge\.exe/i);
 assert.match(source,/Google\\Chrome\\Application\\chrome\.exe/i);
 assert.match(source,/%LOCALAPPDATA%\\BRING-TV\\BrowserProfile/i);
 assert.match(source,/--kiosk/i);
 assert.match(source,/--user-data-dir=/i);
 assert.match(source,/https:\/\/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\/tv/i);
 assert.match(source,/BRING-TV-CMD-설치-오류\.txt/i);
});

test('CMD-only TV uninstaller removes only the named Startup launcher',()=>{
 const source=fs.readFileSync(path.join(cmdOnlyPackage,'BRING-TV-삭제.cmd'),'utf8');
 assert.match(source,/%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\BRING-TV-자동실행\.cmd/i);
 assert.match(source,/del \/F \/Q "%LAUNCHER%"/i);
 assert.doesNotMatch(source,/rmdir|rd \/s|BrowserProfile|Cookies|User Data/i);
});

test('CMD-only TV package documents safe installation and recovery',()=>{
 const guide=fs.readFileSync(path.join(cmdOnlyPackage,'사용방법.txt'),'utf8');
 const prompt=fs.readFileSync(path.join(cmdOnlyPackage,'BRING-TV-설치복구-프롬프트.txt'),'utf8');
 assert.match(guide,/압축.*해제/s);
 assert.match(guide,/BRING-TV-설치\.cmd/);
 assert.match(guide,/시작프로그램/);
 assert.match(prompt,/BRING-TV-CMD-설치-오류\.txt/);
 assert.match(prompt,/비밀번호.*인증코드.*공유하지/s);
});
