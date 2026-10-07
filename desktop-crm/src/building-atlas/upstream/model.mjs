import {validateRoutes} from './portfolio.mjs';
import {validatePlans} from './plan-coordinates.mjs';
import {validDate} from './maintenance.mjs';
export const categories = [
 ['building','건물 기본정보','준공연도,연면적,용도,구조,관리업체,도면 링크'],
 ['water','급배수·펌프','모델,용량,배관 재질,직경,설치일,교체주기'],
 ['electric','전기·통신','분전반 번호,회로,담당 구역,계약전력,모델,설치일'],
 ['fire','소방·안전','장비 종류,점검일,검사 예정일,불량 항목,피난구역'],
 ['hvac','냉난방·승강기','모델,설치연도,보증기간,필터 교체일,유지보수 업체'],
 ['lease','공간·임대차','임대 상태,업종,계약기간,갱신일,보증금,임대료,관리비,면적'],
 ['work','유지보수 업무','접수일,긴급도,담당자,업체,견적,작업일,재료비,인건비,총원가,승인,재발 여부'],
 ['sensor','센서·측정 기록','측정 항목,값,단위,측정시각,수집 방식,장비 번호'],
 ['document','문서·증빙','문서 종류,원본 링크,발행일,관련 설비,담당 기관'],
 ['insight','분석·검토 기록','검토 주제,근거 기록,제안,담당 검토자,검토일,실행 결과']
].map(([id,name,fields])=>({id,name,fields:fields.split(',')}));
export const colors={building:0x94a3b8,water:0x38bdf8,electric:0xfbbf24,fire:0xfb7185,hvac:0xa78bfa,lease:0x34d399,work:0xfb923c,sensor:0x2dd4bf,document:0x94a3b8,insight:0xc4b5fd};
export function demo(){return {version:1,building:{name:'BRING 예시 빌딩',address:'실제 건물 자료를 등록해주세요',floors:4,width:16,depth:12},records:[
 {id:'tank',name:'지하 저수조',category:'water',floor:0,x:-5,z:2,status:'정상',confidence:'예시',notes:'예시 급수 계통입니다. 실제 현장 확인 전 사용하지 마세요.',fields:{용량:'예시 10㎥'},links:[]},
 {id:'pump',name:'급수 펌프',category:'water',floor:0,x:0,z:2,status:'점검 필요',confidence:'예시',notes:'명판 사진과 모델을 등록해 주세요.',fields:{모델:'등록 필요'},links:['tank']},
 {id:'valve',name:'주 급수 밸브',category:'water',floor:0,x:5,z:2,status:'정상',confidence:'예시',notes:'실제 차단 범위는 현장 확인 후 기록합니다.',fields:{},links:['pump']},
 ...[1,2,3,4].map(f=>({id:'riser'+f,name:f+'층 급수 분기',category:'water',floor:f,x:5,z:2,status:'정상',confidence:'예시',fields:{},links:[f===1?'valve':'riser'+(f-1)]})),
 {id:'panel',name:'주 분전반',category:'electric',floor:0,x:-5,z:-3,status:'정상',confidence:'예시',fields:{},links:[]},
 {id:'hydrant',name:'1층 소화전',category:'fire',floor:1,x:-5,z:-3,status:'정상',confidence:'예시',fields:{},links:[]},
 {id:'hvac',name:'옥상 실외기',category:'hvac',floor:4,x:-4,z:-2,status:'정상',confidence:'예시',fields:{},links:[]}
 ]};}
export function validate(data){
 if(!data||data.version!==1||!data.building||!Array.isArray(data.records))throw Error('지원하는 건물 데이터 형식이 아닙니다.');
 const b=data.building;
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>150)throw Error('건물명은 공백을 제외한 글자를 포함하여 150자 이내로 입력해주세요.');
 if(!Number.isInteger(b.floors)||b.floors<1||b.floors>30||![b.width,b.depth].every(n=>Number.isFinite(n)&&n>=4&&n<=100))throw Error('층수는 1~30, 가로·세로는 4~100m로 입력해주세요.');
 validatePlans(b);
 if(data.records.length>2000)throw Error('최대 2,000개 기록까지 가져올 수 있습니다.');
 const ids=new Set();
 for(const r of data.records){
 if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||!categories.some(c=>c.id===r.category))throw Error('기록 이름·분류·고유번호를 확인해주세요.');
 ids.add(r.id);
 if(r.verifiedAt!==undefined&&r.verifiedAt!==''&&!validDate(r.verifiedAt))throw Error('확인일은 실제 날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
 if(r.nextInspection&&!validDate(r.nextInspection))throw Error('다음 점검일 형식을 확인해주세요.');
 if(r.assignee!==undefined&&(typeof r.assignee!=='string'||r.assignee.length>150))throw Error('담당자 형식을 확인해주세요.');
 if(r.room&&(!Number.isFinite(r.room.width)||r.room.width<=0||r.room.width>100||!Number.isFinite(r.room.depth)||r.room.depth<=0||r.room.depth>100))throw Error('호실 크기를 확인해주세요.');
 if(!Number.isInteger(r.floor)||r.floor<0||r.floor>b.floors||!Number.isFinite(r.x)||!Number.isFinite(r.z)||Math.abs(r.x)>b.width/2||Math.abs(r.z)>b.depth/2)throw Error('설비 위치가 건물 범위를 벗어났습니다.');
 if(!Array.isArray(r.links)||!r.fields||typeof r.fields!=='object'||Array.isArray(r.fields)||Object.values(r.fields).some(v=>typeof v!=='string'))throw Error('기록의 연결·상세 항목을 확인해주세요.');
 }
 for(const r of data.records){if(r.links.some(id=>!ids.has(id)||id===r.id))throw Error('존재하지 않거나 자기 자신인 연결이 있습니다.');validateRoutes(r,b,ids);if(r.photoData!==undefined&&(typeof r.photoData!=='string'||r.photoData.length>800000||!/^data:image\/(jpeg|png|webp);base64,/.test(r.photoData)))throw Error('사진 데이터 형식을 확인해주세요.');if(r.history!==undefined&&(!Array.isArray(r.history)||r.history.length>1000||r.history.some(h=>!h||typeof h.date!=='string'||typeof h.text!=='string')))throw Error('점검 이력 형식을 확인해주세요.');}
 return data;
}
export function connected(data,id){const found=new Set([id]);let changed=true;while(changed){changed=false;for(const r of data.records)for(const link of r.links)if(found.has(r.id)||found.has(link)){if(!found.has(r.id)||!found.has(link))changed=true;found.add(r.id);found.add(link);}}return [...found];}
