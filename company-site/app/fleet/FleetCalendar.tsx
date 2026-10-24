"use client";
import type { Reservation } from "./fleet-repository.client";
import { buildMonthGrid, monthLabel, reservationsForDay, reservationStatusCounts } from "./fleet-calendar";

const weekdays = ["월", "화", "수", "목", "금", "토", "일"];

export default function FleetCalendar({ month, selectedKey, reservations, onMonthChange, onSelect }:{
  month: Date;
  selectedKey: string;
  reservations: Reservation[];
  onMonthChange: (amount: number | "today") => void;
  onSelect: (key: string) => void;
}) {
  const days = buildMonthGrid(month);
  return <section className="fleet-calendar-card" aria-label="차량 예약 달력">
    <div className="fleet-calendar-toolbar">
      <div><p>차량 일정표</p><h2>{monthLabel(month)}</h2></div>
      <div className="fleet-calendar-nav">
        <button type="button" aria-label="이전 달" onClick={()=>onMonthChange(-1)}>‹</button>
        <button type="button" onClick={()=>onMonthChange("today")}>오늘</button>
        <button type="button" aria-label="다음 달" onClick={()=>onMonthChange(1)}>›</button>
      </div>
    </div>
    <div className="fleet-weekdays" aria-hidden="true">{weekdays.map(day=><span key={day}>{day}</span>)}</div>
    <div className="fleet-calendar-grid">
      {days.map(day=>{
        const counts=reservationStatusCounts(reservationsForDay(reservations,day.key));
        const dateLabel=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"long",day:"numeric"}).format(day.date);
        return <button type="button" key={day.key} className={["fleet-day",day.inMonth?"":"outside",day.isToday?"today":"",selectedKey===day.key?"selected":""].filter(Boolean).join(" ")} aria-label={dateLabel} aria-pressed={selectedKey===day.key} onClick={()=>onSelect(day.key)}>
          <span className="fleet-day-number">{day.dayNumber}</span>
          <span className="fleet-day-events">
            {counts.approved>0&&<small className="approved">승인 {counts.approved}</small>}
            {counts.pending>0&&<small className="pending">대기 {counts.pending}</small>}
          </span>
        </button>;
      })}
    </div>
  </section>;
}
