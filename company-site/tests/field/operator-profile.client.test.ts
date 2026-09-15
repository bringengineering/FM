import { describe, expect, it } from "vitest";

import {
  loadActiveOperatorProfiles,
  operatorPreferenceKey,
  readOperatorPreference,
  writeOperatorPreference,
} from "../../app/field/lib/v2/operator-profile.client";

describe("FIELD v2 operator profiles", () => {
  it("accepts only exact active display profiles and sorts them deterministically", async () => {
    const profiles = await loadActiveOperatorProfiles(async (path) => {
      expect(path).toBe("crmCompany/teamProfiles");
      return {
        operator_hwang: { displayName: "황우중", active: true, sortOrder: 20 },
        operator_kim: { displayName: "김현진", active: true, sortOrder: 10 },
        disabled: { displayName: "비활성", active: false, sortOrder: 1 },
        leaked: { displayName: "누출", active: true, sortOrder: 2, email: "secret@example.com" },
      };
    });

    expect(profiles).toEqual([
      { operatorId: "operator_kim", displayName: "김현진", active: true, sortOrder: 10 },
      { operatorId: "operator_hwang", displayName: "황우중", active: true, sortOrder: 20 },
    ]);
  });

  it("stores only a UID-scoped operator label and selected time", () => {
    const storage = window.localStorage;
    writeOperatorPreference(storage, "shared_uid", "operator_kim", () => (
      new Date("2026-08-14T03:00:00.000Z")
    ));

    expect(operatorPreferenceKey("shared_uid")).toBe("bring.field.v2.operator.shared_uid");
    expect(JSON.parse(storage.getItem(operatorPreferenceKey("shared_uid")) || "{}"))
      .toEqual({ operatorId: "operator_kim", selectedAt: "2026-08-14T03:00:00.000Z" });
    expect(readOperatorPreference(storage, "shared_uid", [
      { operatorId: "operator_kim", displayName: "김현진", active: true, sortOrder: 1 },
    ])).toBe("operator_kim");
  });

  it("clears malformed, inactive, and unknown preferences without guessing from email", () => {
    const storage = window.localStorage;
    const key = operatorPreferenceKey("shared_uid");
    storage.setItem(key, JSON.stringify({ operatorId: "operator_old", selectedAt: "2026-08-14T03:00:00.000Z" }));

    expect(readOperatorPreference(storage, "shared_uid", [
      { operatorId: "operator_kim", displayName: "김현진", active: true, sortOrder: 1 },
    ])).toBeNull();
    expect(storage.getItem(key)).toBeNull();

    storage.setItem(key, JSON.stringify({ operatorId: "operator_kim", selectedAt: "bad", email: "x@y.z" }));
    expect(readOperatorPreference(storage, "shared_uid", [])).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });
});
