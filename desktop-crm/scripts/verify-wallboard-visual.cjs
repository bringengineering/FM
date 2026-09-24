// Isolated, hidden Electron renderer; synthetic data only, no CRM preload/network.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'bring-wallboard-visual-')));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
setTimeout(()=>{console.error('Visual verification timed out');app.exit(2);},45000).unref();
app.whenReady().then(async()=>{
 const out=path.resolve(process.argv[2]||'visual-wallboard');fs.mkdirSync(out,{recursive:true});
 const source=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
 const css=['styles.css','company-wallboard.css','company-wallboard-theme.css','toss.css'].map(source).join('\n').replaceAll(':fullscreen','.test-fullscreen');
 for(const [width,height] of [[1920,1080],[1366,768],[1280,720]]){
  const win=new BrowserWindow({width,height,useContentSize:true,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(`document.head.innerHTML='<style>'+${JSON.stringify(css)}+'</style>';document.body.innerHTML='<main></main>';document.body.style.margin='0';`);
  await win.webContents.executeJavaScript(source('company-wallboard.js'));
  const result=await win.webContents.executeJavaScript(`(async()=>{
   const today=new Date().toLocaleDateString('en-CA');
   const data={orders:Array.from({length:12},(_,i)=>({id:String(i),status:i%2?'doing':'done',assigneeName:'가상 직원 '+(i%6+1)})),calendar:{serviceRecords:Array.from({length:6},(_,i)=>({scheduledDate:today,startTime:(9+i)+':30',status:'planned'}))}};
   window.BringCompanyWallboard.mount(document.querySelector('main'),{load:async()=>data});
   await new Promise(r=>setTimeout(r,50));
   const stage=document.querySelector('.wb-stage');stage.classList.add('test-fullscreen');
   document.querySelector('[data-wb="pause"]').click();
   document.querySelector('main').replaceChildren(stage);document.querySelector('main').classList.add('wb-manager');
   return true;
  })()`);
  for(const key of ['roadmap','portfolio','people','status','issues','notice','schedule','strategy']){
   const overflow=await win.webContents.executeJavaScript(`(()=>{const data={orders:Array.from({length:12},(_,i)=>({id:String(i),status:i%2?'doing':'done',assigneeName:'가상 직원 '+(i%6+1),projectId:${JSON.stringify(key)}==='portfolio'?'p1':''})),projects:${JSON.stringify(key)}==='portfolio'?[{id:'p1',name:'가상 디지털 트윈 실증',owner:'가상 직원',status:'active',progress:70}]:[],calendar:{serviceRecords:Array.from({length:6},(_,i)=>({scheduledDate:'2026-09-20',startTime:String(9+i).padStart(2,'0')+':30',status:'planned'}))},strategy:{year:'2026',vision:'현장을 더 안전하고 투명하게 운영합니다',organization:[{displayName:'가상 대표',role:'대표',reportsToIndex:null},{displayName:'가상 운영',role:'운영',reportsToIndex:0}],goals:[{period:'annual',title:'건물 데이터 구축',unit:'count',target:10,current:4,percent:40,source:'CRM 승인 기록'},{period:'H2',title:'표준 촬영점 확립',unit:'milestone',target:null,current:null,percent:null,source:'현장 보고서'}]}};const m=BringCompanyWallboard.project(data,'2026-09-20');const s=document.querySelector('.wb-stage');s.querySelector('h1').textContent=${JSON.stringify(key)};s.querySelector('.wb-content').innerHTML=BringCompanyWallboard.scene(m,${JSON.stringify(key)},0,'이번 주 현장 사진과 업무 결과를 확인해 주세요.','10:15');return {vertical:s.scrollHeight>s.clientHeight,horizontal:s.scrollWidth>s.clientWidth};})()`);
   await new Promise(r=>setTimeout(r,100));
   fs.writeFileSync(path.join(out,`${key}-${width}x${height}.png`),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
   console.log(JSON.stringify({key,width,height,...overflow}));
   if(overflow.vertical||overflow.horizontal)process.exitCode=1;
   if(key==='roadmap'){
    const descriptionWidth=await win.webContents.executeJavaScript(`document.querySelector('.wb-overall-card .wb-progress-ring + div').getBoundingClientRect().width`);
    if(descriptionWidth<150){console.error(`Roadmap description too narrow: ${descriptionWidth}px`);process.exitCode=1;}
   }
  }
  win.destroy();
 }
 app.exit(process.exitCode||0);
}).catch(e=>{console.error(e);app.exit(1);});
