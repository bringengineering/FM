(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringGoogleCalendarEvents=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  function dateKey(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const n=Date.parse(value+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;}
  function timed(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&dateKey(value.slice(0,10))&&Number.isFinite(Date.parse(value));}
  function korea(ms){return new Date(ms+9*3600000).toISOString();}
  function project(events,month){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return [];
    const first=Date.parse(month+'-01T00:00:00Z');const d=new Date(first);d.setUTCMonth(d.getUTCMonth()+1);const limit=d.getTime();
    const seen=new Set(),output=[];
    for(const item of Array.isArray(events)?events:[]){
      if(!item||typeof item.id!=='string'||typeof item.calendarId!=='string'||!item.id||!item.calendarId||item.status==='cancelled')continue;
      const identity=JSON.stringify([item.calendarId,item.id]);if(seen.has(identity))continue;seen.add(identity);
      const allDay=item.allDay===true;
      if(allDay?(!dateKey(item.start)||!dateKey(item.end)):(!timed(item.start)||!timed(item.end)))continue;
      const start=Date.parse(item.start+(allDay?'T00:00:00Z':'')),end=Date.parse(item.end+(allDay?'T00:00:00Z':''));if(end<=start)continue;
      const startDay=allDay?item.start:korea(start).slice(0,10),lastDay=allDay?new Date(end-1).toISOString().slice(0,10):korea(end-1).slice(0,10);
      const from=Math.max(first,Date.parse(startDay+'T00:00:00Z')),to=Math.min(limit-1,Date.parse(lastDay+'T00:00:00Z'));
      for(let ms=from;ms<=to;ms+=DAY){const date=new Date(ms).toISOString().slice(0,10);output.push({
        id:'google:'+encodeURIComponent(item.calendarId)+':'+encodeURIComponent(item.id)+':'+date,
        source:'google',readonly:true,calendarId:item.calendarId,sourceId:item.id,buildingId:'',building:null,
        buildingName:'Google 캘린더',buildingLabel:'Google 캘린더 · 건물 미연결',buildingArchived:false,
        title:String(item.title||'제목 없는 일정').slice(0,500),summary:[item.location,item.description].filter(Boolean).map(String).join('\n').slice(0,8000),
        scheduledDate:date,startTime:!allDay&&date===startDay?korea(start).slice(11,16):'',endTime:!allDay&&date===lastDay?korea(end).slice(11,16):'',scheduledTime:allDay?'종일':'',
        status:'planned',statusLabel:'Google · 읽기 전용',serviceType:'meeting',owner:'',vendorName:'',completed:false,
      });}
    }
    return output;
  }
  return {project};
});
