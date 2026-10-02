const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('TV release is manual, protected, signed, immutable and isolated from CRM deployment',()=>{
 const file=path.resolve(__dirname,'../../.github/workflows/tv-release.yml'),yaml=fs.readFileSync(file,'utf8');
 assert.match(yaml,/workflow_dispatch:/);assert.doesNotMatch(yaml,/\n\s+push:/);assert.match(yaml,/environment:\s*bring-tv-production/);
 assert.match(yaml,/permissions:\s*\n\s+contents:\s*write/);assert.match(yaml,/BRING_TV_CERT_SUBJECT/);assert.match(yaml,/BRING_TV_CERT_THUMBPRINT/);
 assert.match(yaml,/verify-assets\.js[\s\S]+gh release create/);assert.match(yaml,/tv-v/);assert.match(yaml,/tv-update-channel/);assert.match(yaml,/latest-tv\.yml/);
 assert.doesNotMatch(yaml,/crm-update-channel|crm-v\$\{\{|firebase deploy|functions:deploy|hosting:deploy/i);
});
