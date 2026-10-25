import { describe, expect, it } from "vitest";
import { FLEET_VEHICLES, currentOdometerForVehicle, recordsForVehicle } from "../../app/fleet/fleet-vehicles";

describe("fleet vehicle domain", () => {
  it("defines EV4 and the Morning with the requested plate", () => {
    expect(FLEET_VEHICLES.map(vehicle => vehicle.id)).toEqual(["ev4-001", "morning-001"]);
    expect(FLEET_VEHICLES[1]).toMatchObject({ name: "기아 모닝", plate: "23모 0648" });
  });

  it("filters records by the selected vehicle", () => {
    const records = [
      { id: "ev4-trip", vehicleId: "ev4-001" },
      { id: "morning-trip", vehicleId: "morning-001" },
    ];
    expect(recordsForVehicle(records, "morning-001").map(record => record.id)).toEqual(["morning-trip"]);
  });

  it("returns no odometer until the Morning has trip evidence", () => {
    expect(currentOdometerForVehicle(undefined, [])).toBeUndefined();
    expect(currentOdometerForVehicle(undefined, [{ startOdometer: 38214 }])).toBe(38214);
    expect(currentOdometerForVehicle(38000, [{ startOdometer: 38214, endOdometer: 38248 }])).toBe(38248);
  });
});
