import {sampleBuilding} from './sample-buildings.mjs';
export function setupSamples(api){
 const panel=document.createElement('section');panel.className='sample-buildings';panel.innerHTML='<strong>도면 없이 시작하기</strong><p>호실·계단·설비가 들어 있는 예시 건물을 추가합니다.</p><button data-sample="house">4층 계단형 다가구</button><button data-sample="shop">3층 근린상가</button>';
 document.querySelector('.building-picker').after(panel);
 function activate(kind){try{const p=structuredClone(api.getPortfolio()),id='bring-example-'+kind;let item=p.items.find(i=>i.id===id);if(!item){item={id,data:sampleBuilding(kind)};p.items.push(item);}p.activeId=id;api.getState().isolate=false;document.getElementById('isolateSystem').checked=false;api.setPortfolio(p);api.choose('pump');api.toast('예시 건물을 열었습니다. 배치는 자유롭게 수정할 수 있습니다.');}catch(e){api.toast(e.message);}}
 panel.onclick=e=>{const b=e.target.closest('[data-sample]');if(b)activate(b.dataset.sample);};
 const banner=document.createElement('div');banner.id='sampleBanner';banner.className='sample-banner';document.querySelector('.viewbar').after(banner);
 document.addEventListener('atlas-render',()=>{banner.hidden=!api.getData().building.example;banner.textContent='예시 건물 · 호실, 계단, 설비 계통은 가상 배치입니다. 층을 선택하거나 설비를 눌러 살펴보세요.';});
 const kind=new URL(location.href).searchParams.get('example');if(['house','shop'].includes(kind)){queueMicrotask(()=>{activate(kind);const url=new URL(location.href);url.searchParams.delete('example');history.replaceState(null,'',url);});}
}
