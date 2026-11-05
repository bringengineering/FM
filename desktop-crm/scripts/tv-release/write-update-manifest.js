'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function writeUpdateManifest({dist,version,releaseDate=new Date().toISOString()}){
 if(typeof dist!=='string'||!dist||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(String(version||''))||!Number.isFinite(Date.parse(releaseDate)))fail('TV_MANIFEST_INPUT_INVALID');
 const name=`BRING.TV.Setup.${version}.exe`,root=path.resolve(dist),file=path.join(root,name);let bytes;
 try{bytes=fs.readFileSync(file);}catch{fail('TV_MANIFEST_INSTALLER_MISSING');}if(!bytes.length)fail('TV_MANIFEST_INSTALLER_MISSING');
 const sha512=crypto.createHash('sha512').update(bytes).digest('base64'),text=`version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${releaseDate}'\n`;
 fs.writeFileSync(path.join(root,'latest-tv.yml'),text,'utf8');return {name:'latest-tv.yml',text};
}
function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
if(require.main===module){try{const version=option('--version')||require('../../electron-builder.tv.cjs').extraMetadata.version;writeUpdateManifest({dist:option('--dist'),version});}catch(error){process.stderr.write(String(error.code||error.message));process.exitCode=1;}}
module.exports={writeUpdateManifest};
