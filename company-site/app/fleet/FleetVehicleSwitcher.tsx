"use client";
import { FLEET_VEHICLES, type FleetVehicleId } from "./fleet-vehicles";

export default function FleetVehicleSwitcher({ selected, onChange }:{ selected:FleetVehicleId; onChange:(vehicleId:FleetVehicleId)=>void }) {
  return <div className="fleet-vehicle-switcher" role="tablist" aria-label="공용차량 선택">
    {FLEET_VEHICLES.map(vehicle=><button key={vehicle.id} type="button" role="tab" aria-selected={selected===vehicle.id} className={selected===vehicle.id?"selected":""} onClick={()=>onChange(vehicle.id)}>
      <b>{vehicle.label}</b><span>{vehicle.plate}</span>
    </button>)}
  </div>;
}
