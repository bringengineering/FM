const safeKey=value=>typeof value==='string'&&value.length>0&&!/[.#$\[\]/]/.test(value);
export function createResearchStore({db,uid,role,workspaceId}={}){
 function ready(write=false){if(!db||!uid||!safeKey(workspaceId))throw Error('연구 저장소 연결 필요');if(!['admin','member','viewer'].includes(role)||(write&&role==='viewer'))throw Error('연구 저장 권한 없음');}
 return{
 async listProjects(){ready();const snap=await db.ref(`rndWorkspaces/${workspaceId}/projects`).once('value');return Object.values(snap.val()??{});},
 async getProject(id){ready();if(!safeKey(id))throw Error('프로젝트 ID 오류');const snap=await db.ref(`rndWorkspaces/${workspaceId}/projects/${id}`).once('value');if(!snap.val())throw Error('프로젝트를 찾을 수 없습니다');return snap.val();},
 async listVisits(){ready();const snap=await db.ref(`rndWorkspaces/${workspaceId}/visits`).once('value');return Object.values(snap.val()??{});},
 async saveProject(project){ready(true);if(!safeKey(project.id))throw Error('프로젝트 ID 오류');const result=await db.ref(`rndWorkspaces/${workspaceId}/projects/${project.id}`).transaction(current=>{if((current?.revision??0)!==(project.revision??0))return;return{...project,revision:(project.revision??0)+1,updatedBy:uid,updatedAt:new Date().toISOString()};});if(!result.committed)throw Error('프로젝트 동시편집 충돌');return result.snapshot.val();},
 async saveVisit(visit){ready(true);if(!safeKey(visit.id))throw Error('방문 ID 오류');const revision=visit.revision??0;const result=await db.ref(`rndWorkspaces/${workspaceId}/visits/${visit.id}`).transaction(current=>{if((current?.revision??0)!==revision)return;return{...visit,revision:revision+1,updatedBy:uid,updatedAt:new Date().toISOString()};});if(!result.committed)throw Error('동시편집 충돌: 최신 기록을 다시 확인하세요');return result.snapshot.val();}
 };
}
export async function uploadEvidence({file,rootFolderId,token,fetchImpl=fetch,onState=()=>{}}={}){
 if(!file||!rootFolderId||!token)throw Error('Drive 저장소·인증 연결 필요');
 if(file.size>100*1024*1024)throw Error('현재 단일 업로드 한도는 100MiB입니다');
 onState('업로드 중');
 const body=new FormData();body.append('metadata',new Blob([JSON.stringify({name:file.name??'evidence',parents:[rootFolderId]})],{type:'application/json'}));body.append('file',file);
 const response=await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,parents,webViewLink',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});
 if(!response.ok)throw Error(`Drive 업로드 실패 (${response.status})`);
 const uploaded=await response.json();if(!uploaded.id)throw Error('Drive 파일 ID 검증 실패');onState('저장 확인 중');
 const check=await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}?supportsAllDrives=true&fields=id,name,size,parents,webViewLink,trashed`,{headers:{Authorization:`Bearer ${token}`}});
 if(!check.ok)throw Error(`Drive 원본 확인 실패 (${check.status}), 파일 ID: ${uploaded.id}`);
 const verified=await check.json();if(verified.trashed||verified.id!==uploaded.id||Number(verified.size)!==file.size||!verified.parents?.includes(rootFolderId))throw Error(`Drive 원본 검증 실패, 파일 ID: ${uploaded.id}`);
 onState('Drive 원본 확인 완료 · 연구 등록 전');return {...verified,url:verified.webViewLink??`https://drive.google.com/file/d/${verified.id}/view`,verifiedAt:new Date().toISOString()};
}
