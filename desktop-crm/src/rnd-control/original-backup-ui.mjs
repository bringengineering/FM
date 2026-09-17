export async function requestOriginalBackup({projectId,ready,confirm,isCurrent,exportBackup,say}){
 try{
  if(!isCurrent())return;
  ready();
  if(!confirm('공유 저장된 전체 R&D 메타데이터와 확인 가능한 고정 Drive 원본을 ZIP으로 보관합니다. 미공유 초안은 포함되지 않습니다. 전체 복원 백업 검증은 아직 완료되지 않았습니다. 진행할까요?'))return;
  if(!isCurrent())return;
  const result=await exportBackup({projectId});
  if(!isCurrent())return;
  if(result.saved)say(`공유 원본 자료 보관 완료 · 원본 ${result.fileCount}개 · 전체 복원 백업 검증 미완료`);
 }catch(error){if(isCurrent())say(`원본 자료 보관 미완료 · ${error.message}`);}
}
