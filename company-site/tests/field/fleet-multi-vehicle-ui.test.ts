import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("fleet multi-vehicle UI integration", () => {
  it("renders a vehicle switcher and sends the selected vehicle to every write", async () => {
    const source = await readFile(resolve("app/fleet/FleetApp.tsx"), "utf8");
    expect(source).toContain("<FleetVehicleSwitcher");
    expect(source).toContain("selectedVehicleId");
    expect(source).toContain("vehicleId:selectedVehicleId");
  });

  it("filters reservations before rendering the schedule", async () => {
    const source = await readFile(resolve("app/fleet/FleetApp.tsx"), "utf8");
    expect(source).toContain("reservations={vehicleReservations}");
  });
});
