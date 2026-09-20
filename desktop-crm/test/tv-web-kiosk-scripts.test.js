const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'../..');
test('Windows installer creates only a current-user Edge kiosk startup shortcut',()=>{
 const source=fs.readFileSync(path.join(root,'release/install-bring-tv-web-kiosk.ps1'),'utf8');
 assert.match(source,/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\/tv/);
 assert.match(source,/Startup/);assert.match(source,/--kiosk/);assert.match(source,/WScript\.Shell/);
 assert.match(source,/BRING-TV[\\/]EdgeProfile/);assert.match(source,/--user-data-dir/);
 assert.match(source,/New-Item[^\r\n]*-ItemType Directory/);
 assert.doesNotMatch(source,/param\s*\([^)]*Url/i);assert.doesNotMatch(source,/RunAs|AllUsers|CommonStartup/i);
 assert.match(source,/if \(\$env:ProgramFiles\)/);assert.match(source,/if \(\$\{env:ProgramFiles\(x86\)\}\)/);
});
test('Windows uninstaller removes only the named BRING TV shortcut',()=>{
 const source=fs.readFileSync(path.join(root,'release/uninstall-bring-tv-web-kiosk.ps1'),'utf8');
 assert.match(source,/BRING TV 운영보드\.lnk/);assert.match(source,/Remove-Item\s+-LiteralPath/);
 assert.doesNotMatch(source,/Remove-Item[^\r\n]*-Recurse|Cookies|User Data|Downloads/i);
});
