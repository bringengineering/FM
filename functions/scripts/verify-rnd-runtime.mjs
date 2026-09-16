import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {extname} from 'node:path';
const directory=new URL('../lib/rnd/runtime/',import.meta.url),manifest=JSON.parse(await readFile(new URL('SOURCE_MANIFEST.json',directory),'utf8'));
if(manifest.kind!=='BRING_RND_SERVER_VALIDATION_RUNTIME'||!manifest.files||Array.isArray(manifest.files)||typeof manifest.files!=='object')throw Error('Invalid runtime inventory');
const modulePackage=JSON.parse(await readFile(new URL('package.json',directory),'utf8'));if(modulePackage.type!=='commonjs')throw Error('Runtime module format invalid');
const queue=['shared-restore-preview.js','shared-restore-approval.js','restore-mutation.js','repository.js'],seen=new Set();
while(queue.length){const name=queue.shift();if(seen.has(name))continue;if(!/^[a-zA-Z0-9_-]+\.(?:js|mjs)$/.test(name)||!Object.hasOwn(manifest.files,name)||typeof manifest.files[name]!=='string'||!/^[0-9a-f]{64}$/.test(manifest.files[name]))throw Error('Missing or unsafe runtime dependency');
 const content=await readFile(new URL(name,directory));if(createHash('sha256').update(content).digest('hex')!==manifest.files[name])throw Error('Runtime checksum mismatch');seen.add(name);
 for(const match of content.toString('utf8').matchAll(/(?:require\(\s*|import\(\s*|from\s*)['"](\.\/[^'"]+)['"]/g)){let dependency=match[1].slice(2);if(!extname(dependency))dependency+='.js';queue.push(dependency);}}
if(seen.size!==Object.keys(manifest.files).length)throw Error('Runtime inventory contains unreachable dependencies');
console.log(`PASS verified ${seen.size} packaged CRM validation dependencies`);
