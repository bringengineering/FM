"use client";
import { useMemo, useState } from "react";
import type { Reservation } from "./fleet-repository.client";
import { koreaDateKey, reservationsForDay, shiftMonth, validateReservationRange } from "./fleet-calendar";
import { overlapsReservation } from "./fleet-policy";
import FleetCalendar from "./FleetCalendar";

type ReservationInput={purpose:string;destination:string;startAt:string;endAt:string;approvalType:"long_distance"|"weekend"|"external"};

const dayTitle=(key:string)=>new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${key}T12:00:00+09:00`));
const time=(iso:string)=>new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));
const isWeekend=(key:string)=>{const day=new Date(`${key}T12:00:00+09:00`).getDay();return day===0||day===6};

export default function FleetSchedule({reservations,userUid,role,busy,initialDate,onSubmit,onDecide,now=new Date()}:{
  reservations:Reservation[];userUid:string;role:"admin"|"member"|"viewer";busy:boolean;initialDate?:string;
  onSubmit:(input:ReservationInput)=>Promise<unknown>|unknown;
  onDecide:(id:string,status:"approved"|"rejected")=>Promise<unknown>|unknown;
  now?:Date;
}){
  const firstKey=initialDate??koreaDateKey(now);
  const[selectedKey,setSelectedKey]=useState(firstKey);
  const[month,setMonth]=useState(()=>new Date(`${firstKey.slice(0,7)}-01T12:00:00+09:00`));
  const[formOpen,setFormOpen]=useState(false);
  const[error,setError]=useState("");
  const dayReservations=useMemo(()=>{
    const visible=reservationsForDay(reservations,selectedKey);
    const dayStart=new Date(`${selectedKey}T00:00:00+09:00`);
    const startAt=dayStart.toISOString();
    const endAt=new Date(dayStart.getTime()+86_400_000).toISOString();
    const myRejected=reservations.filter(item=>item.status==="rejected"&&item.userUid===userUid&&overlapsReservation(startAt,endAt,item));
    return [...visible,...myRejected].sort((left,right)=>left.startAt.localeCompare(right.startAt));
  },[reservations,selectedKey,userUid]);
  const select=(key:string)=>{setSelectedKey(key);setMonth(new Date(`${key.slice(0,7)}-01T12:00:00+09:00`));setFormOpen(false);setError("")};
  return <div className="fleet-schedule-layout">
    <FleetCalendar month={month} selectedKey={selectedKey} reservations={reservations} onMonthChange={direction=>{
      if(direction==="today"){const key=koreaDateKey(now);setMonth(new Date(`${key.slice(0,7)}-01T12:00:00+09:00`));setSelectedKey(key)}
      else setMonth(value=>shiftMonth(value,direction));
    }} onSelect={select}/>
    <aside className="fleet-day-panel">
      <div className="fleet-day-heading"><p>선택한 날짜</p><h2>{dayTitle(selectedKey)}</h2><span>{dayReservations.length?`${dayReservations.length}개의 일정`:"예약 가능"}</span></div>
      <div className="fleet-agenda">
        {dayReservations.map(item=><article className={`fleet-agenda-item ${item.status}`} key={item.id}>
          <div className="fleet-agenda-time"><b>{time(item.startAt)}</b><span>{time(item.endAt)}</span></div>
          <div className="fleet-agenda-copy"><div><span className={`fleet-reservation-status ${item.status}`}>{item.status==="approved"?"승인 완료":item.status==="pending"?"승인 대기":"반려됨"}</span>{item.userUid===userUid&&<span className="fleet-mine">내 일정</span>}</div><b>{item.destination}</b><p>{item.driverName} · {item.purpose}</p></div>
          {role==="admin"&&item.status==="pending"&&<div className="fleet-agenda-actions"><button type="button" onClick={()=>onDecide(item.id,"rejected")} aria-label={`${item.driverName} 예약 반려`}>반려</button><button type="button" className="approve" onClick={()=>onDecide(item.id,"approved")} aria-label={`${item.driverName} 예약 승인`}>승인</button></div>}
        </article>)}
        {dayReservations.length===0&&<div className="fleet-agenda-empty"><b>예약 가능</b><p>이 날짜에는 등록된 차량 일정이 없습니다.</p></div>}
      </div>
      {!formOpen?<button type="button" className="fleet-primary fleet-reserve-date" onClick={()=>setFormOpen(true)}>이 날짜에 예약하기</button>:<form className="fleet-reservation-form" onSubmit={event=>{
        event.preventDefault();setError("");const data=new FormData(event.currentTarget);
        const startAt=new Date(String(data.get("start"))).toISOString();const endAt=new Date(String(data.get("end"))).toISOString();
        const rangeError=validateReservationRange(startAt,endAt,now);if(rangeError){setError(rangeError);return}
        if(reservations.some(item=>(item.status==="pending"||item.status==="approved")&&overlapsReservation(startAt,endAt,item))){setError("이미 예약된 시간입니다.");return}
        void onSubmit({purpose:String(data.get("purpose")).trim(),destination:String(data.get("destination")).trim(),startAt,endAt,approvalType:String(data.get("type")) as ReservationInput["approvalType"]});
      }}>
        <div className="fleet-form-title"><div><p>새 예약</p><h3>{selectedKey}</h3></div><button type="button" onClick={()=>{setFormOpen(false);setError("")}}>닫기</button></div>
        <label>승인 사유<select name="type" aria-label="승인 사유" defaultValue={isWeekend(selectedKey)?"weekend":"long_distance"}><option value="long_distance">100km 이상 장거리</option><option value="weekend">주말·야간</option><option value="external">외부 반출</option></select></label>
        <div className="fleet-time-fields"><label>시작<input name="start" aria-label="시작" type="datetime-local" required defaultValue={`${selectedKey}T09:00`}/></label><label>종료<input name="end" aria-label="종료" type="datetime-local" required defaultValue={`${selectedKey}T18:00`}/></label></div>
        <label>목적<input name="purpose" aria-label="목적" required placeholder="예: 고객 미팅, 현장 점검"/></label>
        <label>목적지<input name="destination" aria-label="목적지" required placeholder="예: 원주 혁신도시"/></label>
        {error&&<p className="fleet-error" role="alert">{error}</p>}
        <button className="fleet-primary" disabled={busy}>{busy?"예약 저장 중…":"예약 신청하기"}</button>
      </form>}
    </aside>
  </div>;
}
