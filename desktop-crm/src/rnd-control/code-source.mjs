export function codeSource(url,version=''){
 let parsed;try{parsed=new URL(url);}catch{return null;}
 if(parsed.hostname!=='github.com')return null;
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search)throw Error('GitHub 근거는 인증 정보·검색 인자 없는 HTTPS 링크를 사용하세요');
 const parts=parsed.pathname.split('/').filter(Boolean);if(parts.length<4||!['blob','commit'].includes(parts[2]))return{pinned:false,warning:'코드 파일 또는 commit 링크를 등록하세요 · 미고정 근거'};
 const [owner,repo,kind,ref,...path]=parts;const pinned=/^[a-fA-F0-9]{40}$/.test(ref);if(pinned&&/^[a-fA-F0-9]{40}$/.test(version)&&version.toLowerCase()!==ref.toLowerCase())throw Error('코드 링크와 출처 버전의 commit SHA가 다릅니다');
 return{repository:owner+'/'+repo,path:kind==='blob'?decodeURIComponent(path.join('/')):'(commit)',commitSHA:pinned?ref.toLowerCase():null,pinned,warning:pinned?'commit 고정 · 실제 저장소 존재·내용은 별도 검토':'branch·태그·축약 SHA 링크 · 미고정 근거'};
}
export function codeSourceLabel(source){return source?`${source.repository??''} · ${source.path??''} · ${source.commitSHA??'SHA 미고정'} · ${source.warning}`:'';}
