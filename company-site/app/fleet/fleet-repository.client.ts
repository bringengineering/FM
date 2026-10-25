import { get, onValue, push, ref, set, update } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import { database, ensureFieldAppCheckToken, functions } from "../field/lib/firebase.client";
import type { FieldV2Session } from "../field/lib/v2-auth.client";
import { executeFleetTripStart, type FleetDriveReceipt } from "./fleet-start";
import { FLEET_VEHICLES, isFleetVehicleId, type FleetVehicleId } from "./fleet-vehicles";

export type Vehicle = { id:string; name:string; plate:string; odometer?:number; status:"available"|"in_use"|"maintenance"; updatedAt:string };
export type Trip = { id:string; vehicleId:string; userUid:string; driverName:string; purpose:string; destination:string; startOdometer:number; endOdometer?:number; status:"active"|"completed"; startedAt:string; endedAt?:string; updatedAt:string; evidenceUrl?:string; evidenceDriveFileId?:string; evidenceDriveUrl?:string; evidenceFileName?:string; evidenceUploadState?:"complete" };
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
  const root=ref(database,"crmCompany/fleetManagement");
  const current=clean<Partial<FleetState>>((await get(root)).val(),{});
  const patch:Record<string,unknown>={};
  if(!current.vehicles?.["ev4-001"]){patch["vehicles/ev4-001"]={...FLEET_VEHICLES[0],odometer:0,status:"available",updatedAt:stamp};}
  if(!current.vehicles?.["morning-001"]){patch["vehicles/morning-001"]={...FLEET_VEHICLES[1],status:"available",updatedAt:stamp};}
  if(!current.contracts?.["lease-001"]){patch["contracts/lease-001"]={id:"lease-001",vehicleId:"ev4-001",monthlyFee:497730,allowedKm:30000,startDate:"2026-10-25",endDate:"2029-10-24",updatedAt:stamp};}
  if(!current.maintenance?.["initial-001"]){patch["maintenance/initial-001"]={id:"initial-001",vehicleId:"ev4-001",title:"신차 1,000km 점검",dueDate:"2026-11-25",status:"scheduled",updatedAt:stamp};}
  if(Object.keys(patch).length)await update(root,patch);
}
const requireVehicle=(vehicleId:string):FleetVehicleId=>{if(!isFleetVehicleId(vehicleId))throw new Error("등록되지 않은 차량입니다.");return vehicleId};
export async function startTrip(session:FieldV2Session, input:{vehicleId:FleetVehicleId;purpose:string;destination:string;startOdometer:number;file:File}) {
  requireVehicle(input.vehicleId);
  return executeFleetTripStart(session,input,{
    createTripId:()=>{const key=push(ref(database,"crmCompany/fleetManagement/trips")).key;if(!key)throw new Error("운행번호 생성 실패");return key},
    now,
    upload:async data=>{
      const blob=await compressEvidence(data.file);
      await ensureFieldAppCheckToken();
      const callable=httpsCallable<{
        tripId:string;vehicleId:string;driverName:string;startOdometer:number;capturedAt:string;imageBase64:string
      },FleetDriveReceipt>(functions,"uploadFleetOdometerEvidence",{limitedUseAppCheckTokens:true});
      const response=await callable({tripId:data.tripId,vehicleId:data.vehicleId,driverName:data.displayName,startOdometer:data.startOdometer,capturedAt:data.capturedAt,imageBase64:await blobBase64(blob)});
      return response.data;
    },
    write:async(tripId,record)=>set(ref(database,`crmCompany/fleetManagement/trips/${tripId}`),record),
  });
}
export async function endTrip(session:FieldV2Session, trip:Trip, endOdometer:number) {
  void session;
  if (endOdometer < trip.startOdometer) throw new Error("도착 km는 출발 km보다 작을 수 없습니다.");
  const stamp=now();
  await update(ref(database,`crmCompany/fleetManagement/trips/${trip.id}`), { endOdometer, status:"completed", endedAt:stamp, updatedAt:stamp });
}
export async function createReservation(session:FieldV2Session,input:{vehicleId:FleetVehicleId;purpose:string;destination:string;startAt:string;endAt:string;approvalType:Reservation["approvalType"]}) {
  requireVehicle(input.vehicleId);
  const node=push(ref(database,"crmCompany/fleetManagement/reservations")); if(!node.key) throw new Error("예약번호 생성 실패"); const stamp=now();
  await set(node,{id:node.key,userUid:session.uid,driverName:session.displayName,...input,status:input.approvalType==="none"?"approved":"pending",createdAt:stamp,updatedAt:stamp});
}
export async function decideReservation(id:string,status:"approved"|"rejected") { await update(ref(database,`crmCompany/fleetManagement/reservations/${id}`),{status,updatedAt:now()}); }
export async function reportIssue(session:FieldV2Session,vehicleId:FleetVehicleId,description:string) { requireVehicle(vehicleId); const node=push(ref(database,"crmCompany/fleetManagement/issues")); if(!node.key)return; const stamp=now(); await set(node,{id:node.key,vehicleId,userUid:session.uid,reporterName:session.displayName,category:"vehicle",description,status:"open",createdAt:stamp,updatedAt:stamp}); }

async function compressEvidence(file:File):Promise<Blob> {
  if(file.size>10*1024*1024) throw new Error("원본 사진은 10MB 이하만 가능합니다.");
  const mime=file.type.toLowerCase(); const ext=mime==="image/png"?"png":mime==="image/webp"?"webp":mime==="image/jpeg"?"jpg":"";
  if(!ext) throw new Error("JPG, PNG, WEBP 사진만 가능합니다.");
  const bitmap=await createImageBitmap(file); const ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round(bitmap.width*ratio)); canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const context=canvas.getContext("2d"); if(!context) throw new Error("사진을 처리할 수 없습니다."); context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",.7));
  if(!blob||blob.size>600*1024) throw new Error("사진 압축 후 용량이 큽니다. 해상도를 낮춰 다시 촬영해 주세요.");
  return blob;
}
async function blobBase64(blob:Blob):Promise<string>{
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("사진을 읽지 못했습니다."));reader.readAsDataURL(blob)});
  const comma=dataUrl.indexOf(",");if(comma<0)throw new Error("사진을 읽지 못했습니다.");return dataUrl.slice(comma+1)
}
