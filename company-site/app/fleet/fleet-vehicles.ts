export const FLEET_VEHICLES = [
  { id: "ev4-001", name: "[26MY] 기아 EV4 스탠다드 에어", plate: "차량번호 등록 필요", label: "EV4" },
  { id: "morning-001", name: "기아 모닝", plate: "23모 0648", label: "모닝" },
] as const;

export type FleetVehicleId = typeof FLEET_VEHICLES[number]["id"];

export function isFleetVehicleId(value: string): value is FleetVehicleId {
  return FLEET_VEHICLES.some(vehicle => vehicle.id === value);
}

export function recordsForVehicle<T extends { vehicleId: string }>(records: T[], vehicleId: FleetVehicleId): T[] {
  return records.filter(record => record.vehicleId === vehicleId);
}

export function storedOdometerReading(vehicle: { odometer?: number; odometerRegistered?: boolean } | undefined): number | undefined {
  if (!vehicle || vehicle.odometerRegistered === false) return undefined;
  return vehicle.odometer;
}

export function currentOdometerForVehicle(
  storedOdometer: number | undefined,
  trips: Array<{ startOdometer: number; endOdometer?: number }>,
): number | undefined {
  const readings = trips.flatMap(trip => trip.endOdometer === undefined ? [trip.startOdometer] : [trip.startOdometer, trip.endOdometer]);
  if (storedOdometer === undefined && readings.length === 0) return undefined;
  return Math.max(storedOdometer ?? 0, ...readings);
}
