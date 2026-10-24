import { onValue, push, ref, set, update } from "firebase/database";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { database, storage } from "../field/lib/firebase.client";
import type { FieldV2Session } from "../field/lib/v2-auth.client";

export type Vehicle = { id:string; name:string; plate:string; odometer:number; status:"available"|"in_use"|"maintenance"; updatedAt:string };
export type Trip = { id:string; vehicleId:string; userUid:string; driverName:string; purpose:string; destination:string; startOdometer:number; endOdometer?:number; status:"active"|"completed"; startedAt:string; endedAt?:string; updatedAt:string; evidenceUrl?:string };
export type Reservation = { id:string; vehicleId:string; userUid:string; driverName:string; purpose:string; destination:string; startAt:string; endAt:string; approvalType:"none"|"long_distance"|"weekend"|"external"; status:"pending"|"approved"|"rejected"; createdAt:string; updatedAt:string };
export type Issue = { id:string; vehicleId:string; userUid:string; reporterName:string; category:string; description:string; status:"open"|"resolved"; createdAt:string; updatedAt:string };
export type FleetState = { vehicles:Record<string,Vehicle>; trips:Record<string,Trip>; reservations:Record<string,Reservation>; issues:Record<string,Issue>; maintenance:Record<string,{id:string;vehicleId:string;title:string;dueDate:string;status:string;updatedAt:string}>; contracts:Record<string,{id:string;vehicleId:string;monthlyFee:number;allowedKm:number;startDate:string;endDate:string;updatedAt:string}> };
export const emptyFleet: FleetState = { vehicles:{}, trips:{}, reservations:{}, issues:{}, maintenance:{}, contracts:{} };

const clean = <T,>(value: unknown, fallback: T): T => value && typeof value === "object" ? value as T : fallback;
export function subscribeFleet(next:(value:FleetState)=>void, error:(e:Error)=>void) {
  return onValue(ref(database,"crmCompany/fleetManagement"), (snapshot) => {
    const raw = clean<Partial<FleetState>>(snapshot.val(), {});
    next({ ...emptyFleet, ...raw, vehicles:clean(raw.vehicles,{}), trips:clean(raw.trips,{}), reservations:clean(raw.reservations,{}), issues:clean(raw.issues,{}), maintenance:clean(raw.maintenance,{}), contracts:clean(raw.contracts,{}) });
  }, (e) => error(e));
}
const now = () => new Date().toISOString();
export async function initializeFleet(session:FieldV2Session) {
  if (session.role !== "admin") throw new Error("관리자만 초기 설정할 수 있습니다.");
  const stamp = now();
  await update(ref(database,"crmCompany/fleetManagement"), {
    "vehicles/ev4-001": { id:"ev4-001", name:"[26MY] 기아 EV4 스탠다드 에어", plate:"차량번호 등록 필요", odometer:0, status:"available", updatedAt:stamp },
    "contracts/lease-001": { id:"lease-001", vehicleId:"ev4-001", monthlyFee:497730, allowedKm:30000, startDate:"2026-10-25", endDate:"2029-10-24", updatedAt:stamp },
    "maintenance/initial-001": { id:"initial-001", vehicleId:"ev4-001", title:"신차 1,000km 점검", dueDate:"2026-11-25", status:"scheduled", updatedAt:stamp },
  });
}
export async function startTrip(session:FieldV2Session, input:{purpose:string;destination:string;startOdometer:number;file?:File}) {
  const node = push(ref(database,"crmCompany/fleetManagement/trips"));
  if (!node.key) throw new Error("운행번호 생성 실패");
  const stamp=now(); let evidenceUrl="";
  if (input.file) evidenceUrl = await uploadEvidence(session.uid,node.key,input.file);
  const value:Trip = { id:node.key, vehicleId:"ev4-001", userUid:session.uid, driverName:session.displayName, purpose:input.purpose, destination:input.destination, startOdometer:input.startOdometer, status:"active", startedAt:stamp, updatedAt:stamp, ...(evidenceUrl?{evidenceUrl}:{}) };
  await set(node,value); return node.key;
}
export async function endTrip(session:FieldV2Session, trip:Trip, endOdometer:number, file?:File) {
  if (endOdometer < trip.startOdometer) throw new Error("도착 km는 출발 km보다 작을 수 없습니다.");
  const stamp=now(); const evidenceUrl=file?await uploadEvidence(session.uid,trip.id,file):trip.evidenceUrl;
  await update(ref(database,`crmCompany/fleetManagement/trips/${trip.id}`), { endOdometer, status:"completed", endedAt:stamp, updatedAt:stamp, ...(evidenceUrl?{evidenceUrl}:{}) });
}
export async function createReservation(session:FieldV2Session,input:{purpose:string;destination:string;startAt:string;endAt:string;approvalType:Reservation["approvalType"]}) {
  const node=push(ref(database,"crmCompany/fleetManagement/reservations")); if(!node.key) throw new Error("예약번호 생성 실패"); const stamp=now();
  await set(node,{id:node.key,vehicleId:"ev4-001",userUid:session.uid,driverName:session.displayName,...input,status:input.approvalType==="none"?"approved":"pending",createdAt:stamp,updatedAt:stamp});
}
export async function decideReservation(id:string,status:"approved"|"rejected") { await update(ref(database,`crmCompany/fleetManagement/reservations/${id}`),{status,updatedAt:now()}); }
export async function reportIssue(session:FieldV2Session,description:string) { const node=push(ref(database,"crmCompany/fleetManagement/issues")); if(!node.key)return; const stamp=now(); await set(node,{id:node.key,vehicleId:"ev4-001",userUid:session.uid,reporterName:session.displayName,category:"vehicle",description,status:"open",createdAt:stamp,updatedAt:stamp}); }

async function uploadEvidence(uid:string,tripId:string,file:File) {
  if(file.size>5*1024*1024) throw new Error("사진은 5MB 이하만 가능합니다.");
  const mime=file.type.toLowerCase(); const ext=mime==="image/png"?"png":mime==="image/webp"?"webp":mime==="image/jpeg"?"jpg":"";
  if(!ext) throw new Error("JPG, PNG, WEBP 사진만 가능합니다.");
  const id=crypto.randomUUID(); const target=storageRef(storage,`fleet-evidence/${uid}/${tripId}/${id}.${ext}`);
  await uploadBytes(target,file,{contentType:mime}); return getDownloadURL(target);
}
