const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),archive=path.join(root,'dist/win-unpacked/resources/app.asar');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const files=[];
function verify(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())verify(file);else if(entry.isFile()){const relative=path.relative(root,file).split(path.sep).join('/'),source=fs.readFileSync(file),packed=asar.extractFile(archive,path.relative(root,file));if(!source.equals(packed))throw Error('Packaged source mismatch: '+relative);files.push({path:relative,sizeBytes:source.length,sha256:sha(source)});}}}
verify(path.join(root,'src'));files.sort((a,b)=>a.path.localeCompare(b.path));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const changed=execFileSync('git',['diff','--name-only','HEAD','--','src'],{cwd:root,encoding:'utf8'}).trim();
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{cwd:root,encoding:'utf8'}).trim();
if(untracked)throw Error('Uncommitted source files: '+untracked);
if(changed)throw Error('Build source differs from committed source: '+changed);
const result={kind:'BRING_RND_PACKAGED_SOURCE_VERIFICATION',version:1,sourceCommit,operationalRelease:false,asarSHA256:sha(fs.readFileSync(archive)),files};
fs.writeFileSync(path.join(root,'rnd-packaged-source-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(`PASS ${files.length} source files match packaged ASAR byte-for-byte; commit ${sourceCommit}`);

