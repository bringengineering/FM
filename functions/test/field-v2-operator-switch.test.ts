import { describe, expect, it, vi } from "vitest";

import { FieldV2Error, type FieldV2Actor } from "../src/field-v2/contracts.js";
import {
  reduceFieldOperatorSwitchRoot,
  recordFieldOperatorSwitchCore,
  type RecordFieldOperatorSwitchInput,
} from "../src/field-v2/operator-switch.js";

const NOW = "2026-08-14T03:04:05.000Z";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";

function validInput(
  overrides: Partial<RecordFieldOperatorSwitchInput> = {},
): RecordFieldOperatorSwitchInput {
  return {
    protocolVersion: 2,
    clientKind: "pwa",
    buildVersion: "1.2.3",
    requestId: REQUEST_ID,
    operatorId: "operator_new",
    fromOperatorId: "operator_old",
    toOperatorId: "operator_new",
    reason: "manual_switch",
    ...overrides,
  };
}

function viewerActor(
  overrides: Partial<FieldV2Actor> = {},
): FieldV2Actor {
  return {
    authUid: "shared_uid",
    operatorId: "operator_new",
    displayName: "New Operator",
    role: "viewer",
    ...overrides,
  };
}

function validRoot(): Record<string, unknown> {
  return {
    crmCompany: {
      access: {
        shared_uid: {
          enabled: true,
          role: "viewer",
          email: "team@bringcare.kr",
        },
      },
      teamProfiles: {
        operator_old: { active: true, displayName: "Old Operator" },
        operator_new: { active: true, displayName: "New Operator" },
      },
    },
    fieldPlatform: {
      v2: {
        config: {
          release: {
            protocolVersion: 2,
            minDesktopVersion: "1.0.0",
            minPwaVersion: "1.0.0",
            enabledOperatorIds: ["operator_old", "operator_new"],
            v2WritesEnabled: true,
            canonicalCrmEnabled: true,
            safeMode: false,
            cutoverAt: null,
          },
        },
      },
    },
  };
}

function makeHarness(initialRoot = validRoot()) {
  let root: unknown = structuredClone(initialRoot);
  const transact = vi.fn(async (command) => {
    const decision = reduceFieldOperatorSwitchRoot(root, command);
    root = decision.root;
    return decision.result;
  });
  return {
    dependencies: {
      authenticatedEmail: "team@bringcare.kr",
      now: () => NOW,
      transact,
    },
    transact,
    get root() {
      return root as any;
    },
    set root(value: unknown) {
      root = value;
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject<FieldV2Error>({ code });
}

describe("FIELD v2 operator-switch audit", () => {
  it("lets a viewer select an active operator and writes only one audit plus one receipt", async () => {
    const harness = makeHarness();
    const beforeCrm = structuredClone(harness.root.crmCompany);

    const result = await recordFieldOperatorSwitchCore(
      validInput(),
      viewerActor(),
      harness.dependencies,
    );

    expect(result).toEqual({
      requestId: REQUEST_ID,
      fromOperatorId: "operator_old",
      toOperatorId: "operator_new",
      reason: "manual_switch",
      recordedAt: NOW,
      repeated: false,
    });
    expect(harness.transact).toHaveBeenCalledTimes(1);
    expect(harness.root.crmCompany).toEqual(beforeCrm);
    expect(Object.keys(harness.root.fieldPlatform.v2)).toEqual([
      "config",
      "requestReceipts",
      "auditLogs",
    ]);

    const receipts = harness.root.fieldPlatform.v2.requestReceipts;
    expect(Object.keys(receipts)).toEqual(["recordFieldOperatorSwitch"]);
    const receipt = receipts.recordFieldOperatorSwitch[REQUEST_ID];
    expect(Object.keys(receipt).sort()).toEqual([
      "createdAt", "requestHash", "requestId", "result", "scope",
    ]);
    expect(receipt).toMatchObject({
      scope: "recordFieldOperatorSwitch",
      requestId: REQUEST_ID,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      createdAt: NOW,
      result: {
        requestId: REQUEST_ID,
        fromOperatorId: "operator_old",
        toOperatorId: "operator_new",
        reason: "manual_switch",
        recordedAt: NOW,
      },
    });
    expect(Object.keys(receipt.result).sort()).toEqual([
      "fromOperatorId", "reason", "recordedAt", "requestId", "toOperatorId",
    ]);

    const auditIds = Object.keys(harness.root.fieldPlatform.v2.auditLogs);
    expect(auditIds).toHaveLength(1);
    expect(auditIds[0]).toMatch(/^audit_[a-f0-9]{32}$/u);
    const audit = harness.root.fieldPlatform.v2.auditLogs[auditIds[0]];
    expect(Object.keys(audit).sort()).toEqual([
      "action", "authUid", "buildVersion", "clientKind", "fromOperatorId",
      "id", "occurredAt", "reason", "requestId", "toOperatorId",
    ]);
    expect(audit).toEqual({
      id: auditIds[0],
      action: "field.operator.switched",
      requestId: REQUEST_ID,
      authUid: "shared_uid",
      fromOperatorId: "operator_old",
      toOperatorId: "operator_new",
      reason: "manual_switch",
      clientKind: "pwa",
      buildVersion: "1.2.3",
      occurredAt: NOW,
    });
    expect(JSON.stringify(audit)).not.toContain("team@bringcare.kr");
    expect(JSON.stringify(audit)).not.toContain("New Operator");
  });

  it.each(["admin", "member", "viewer"] as const)(
    "allows the %s CRM role without granting another business mutation",
    async (role) => {
      const root = validRoot() as any;
      root.crmCompany.access.shared_uid.role = role;
      const harness = makeHarness(root);

      await expect(recordFieldOperatorSwitchCore(
        validInput({ requestId: OTHER_REQUEST_ID }),
        viewerActor({ role }),
        harness.dependencies,
      )).resolves.toMatchObject({ repeated: false, toOperatorId: "operator_new" });

      expect(Object.keys(harness.root.fieldPlatform.v2)).toEqual([
        "config", "requestReceipts", "auditLogs",
      ]);
    },
  );

  it("accepts initial selection only with a null previous operator", async () => {
    const harness = makeHarness();
    await expect(recordFieldOperatorSwitchCore(
      validInput({ fromOperatorId: null, reason: "initial_selection" }),
      viewerActor(),
      harness.dependencies,
    )).resolves.toMatchObject({
      fromOperatorId: null,
      reason: "initial_selection",
      repeated: false,
    });
  });

  it.each([
    ["desktop client", { clientKind: "desktop" }],
    ["target mismatch", { operatorId: "operator_old" }],
    ["bad UUID", { requestId: "request-1" }],
    ["unknown reason", { reason: "other" }],
    ["initial with previous", { reason: "initial_selection" }],
    ["manual without previous", { fromOperatorId: null }],
    ["desktop navigation without previous", {
      reason: "desktop_navigation", fromOperatorId: null,
    }],
    ["same previous and target", { fromOperatorId: "operator_new" }],
    ["unsafe target", { operatorId: "constructor", toOperatorId: "constructor" }],
    ["oversize build", { buildVersion: "1".repeat(5_000) }],
    ["non-semver build", { buildVersion: "latest" }],
    ["extra secret field", { secretToken: "do-not-store" }],
  ])("rejects malformed input: %s", async (_label, patch) => {
    const harness = makeHarness();
    const input = { ...validInput(), ...patch } as unknown as RecordFieldOperatorSwitchInput;
    await expectCode(
      recordFieldOperatorSwitchCore(input, viewerActor(), harness.dependencies),
      "field_operator_switch_input_invalid",
    );
    expect(harness.transact).not.toHaveBeenCalled();
  });

  it("rejects an input object with a custom prototype", async () => {
    const harness = makeHarness();
    const input = Object.assign(Object.create({ token: "inherited" }), validInput());
    await expectCode(
      recordFieldOperatorSwitchCore(input, viewerActor(), harness.dependencies),
      "field_operator_switch_input_invalid",
    );
    expect(harness.transact).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["inactive", { active: false, displayName: "Old Operator" }],
    ["malformed", { active: true, displayName: "" }],
  ])("fails closed when the previous operator profile is %s", async (_label, profile) => {
    const root = validRoot() as any;
    if (profile === undefined) delete root.crmCompany.teamProfiles.operator_old;
    else root.crmCompany.teamProfiles.operator_old = profile;
    const harness = makeHarness(root);
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_operator_switch_previous_invalid",
    );
  });

  it.each([
    ["missing", undefined, "field_operator_invalid"],
    ["inactive", { active: false, displayName: "New Operator" }, "field_operator_inactive"],
    ["malformed", { active: true, displayName: "" }, "field_operator_invalid"],
  ])("revalidates a %s target profile inside the transaction", async (
    _label,
    profile,
    code,
  ) => {
    const root = validRoot() as any;
    if (profile === undefined) delete root.crmCompany.teamProfiles.operator_new;
    else root.crmCompany.teamProfiles.operator_new = profile;
    const harness = makeHarness(root);
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      code,
    );
  });

  it.each([
    ["disabled", { enabled: false }],
    ["email changed", { email: "someone-else@bringcare.kr" }],
    ["role corrupted", { role: "staff" }],
  ])("fails when current CRM access is %s at transaction time", async (_label, patch) => {
    const root = validRoot() as any;
    Object.assign(root.crmCompany.access.shared_uid, patch);
    const harness = makeHarness(root);
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_access_forbidden",
    );
  });

  it("rejects when the role changed after actor resolution", async () => {
    const root = validRoot() as any;
    root.crmCompany.access.shared_uid.role = "member";
    const harness = makeHarness(root);
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_access_forbidden",
    );
  });

  it("replays the exact request without adding another audit", async () => {
    const harness = makeHarness();
    const first = await recordFieldOperatorSwitchCore(
      validInput(), viewerActor(), harness.dependencies,
    );
    const second = await recordFieldOperatorSwitchCore(
      validInput(), viewerActor(), harness.dependencies,
    );

    expect(first.repeated).toBe(false);
    expect(second).toEqual({ ...first, repeated: true });
    expect(harness.transact).toHaveBeenCalledTimes(2);
    expect(Object.keys(harness.root.fieldPlatform.v2.auditLogs)).toHaveLength(1);
    expect(Object.keys(
      harness.root.fieldPlatform.v2.requestReceipts.recordFieldOperatorSwitch,
    )).toHaveLength(1);
  });

  it.each([
    ["disabled access", (root: any) => {
      root.crmCompany.access.shared_uid.enabled = false;
    }, "field_access_forbidden"],
    ["inactive target", (root: any) => {
      root.crmCompany.teamProfiles.operator_new.active = false;
    }, "field_operator_inactive"],
    ["inactive previous", (root: any) => {
      root.crmCompany.teamProfiles.operator_old.active = false;
    }, "field_operator_switch_previous_invalid"],
  ])("revalidates %s on exact replay without adding an audit", async (
    _label,
    mutate,
    code,
  ) => {
    const harness = makeHarness();
    await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
    mutate(harness.root);

    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      code,
    );
    expect(Object.keys(harness.root.fieldPlatform.v2.auditLogs)).toHaveLength(1);
  });

  it("rejects reuse of a request ID with a different canonical hash", async () => {
    const harness = makeHarness();
    await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
    await expectCode(
      recordFieldOperatorSwitchCore(
        validInput({ reason: "desktop_navigation" }),
        viewerActor(),
        harness.dependencies,
      ),
      "field_request_id_conflict",
    );
  });

  it("rejects a transaction command whose hash was not derived from its closed input", async () => {
    const harness = makeHarness();
    await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
    const command = harness.transact.mock.calls[0][0];
    expect(() => reduceFieldOperatorSwitchRoot(validRoot(), {
      ...command,
      requestHash: "0".repeat(64),
    })).toThrowError(expect.objectContaining({
      code: "field_operator_switch_transaction_invalid",
    }));
  });

  it("blocks a new audit in safe mode but permits an exact receipt replay", async () => {
    const harness = makeHarness();
    const first = await recordFieldOperatorSwitchCore(
      validInput(), viewerActor(), harness.dependencies,
    );
    harness.root.fieldPlatform.v2.config.release.safeMode = true;

    await expect(recordFieldOperatorSwitchCore(
      validInput(), viewerActor(), harness.dependencies,
    )).resolves.toEqual({ ...first, repeated: true });
    await expectCode(
      recordFieldOperatorSwitchCore(
        validInput({ requestId: OTHER_REQUEST_ID }),
        viewerActor(),
        harness.dependencies,
      ),
      "field_safe_mode_read_only",
    );
  });

  it("blocks new writes when v2 writes are disabled", async () => {
    const root = validRoot() as any;
    root.fieldPlatform.v2.config.release.v2WritesEnabled = false;
    const harness = makeHarness(root);
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_v2_writes_disabled",
    );
  });

  it("permits only an exact receipt replay when v2 writes are disabled", async () => {
    const harness = makeHarness();
    const first = await recordFieldOperatorSwitchCore(
      validInput(), viewerActor(), harness.dependencies,
    );
    harness.root.fieldPlatform.v2.config.release.v2WritesEnabled = false;
    await expect(recordFieldOperatorSwitchCore(
      validInput(), viewerActor(), harness.dependencies,
    )).resolves.toEqual({ ...first, repeated: true });
  });

  it("still revalidates release compatibility on exact replay", async () => {
    const harness = makeHarness();
    await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
    harness.root.fieldPlatform.v2.config.release.minPwaVersion = "9.0.0";
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_client_upgrade_required",
    );
  });

  it("rejects a corrupted stored receipt instead of overwriting it", async () => {
    const harness = makeHarness();
    await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
    const receipt = harness.root.fieldPlatform.v2.requestReceipts
      .recordFieldOperatorSwitch[REQUEST_ID];
    harness.root.fieldPlatform.v2.requestReceipts
      .recordFieldOperatorSwitch[REQUEST_ID] = { ...receipt, secret: "corrupt" };
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_request_receipt_invalid",
    );
  });

  it("rejects a receipt whose server timestamps disagree", async () => {
    const harness = makeHarness();
    await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
    const receipt = harness.root.fieldPlatform.v2.requestReceipts
      .recordFieldOperatorSwitch[REQUEST_ID];
    harness.root.fieldPlatform.v2.requestReceipts
      .recordFieldOperatorSwitch[REQUEST_ID] = {
        ...receipt,
        createdAt: "2026-08-14T03:04:06.000Z",
      };
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
      "field_request_receipt_invalid",
    );
  });

  it.each(["missing", "corrupted"])(
    "rejects exact replay when its paired audit is %s",
    async (state) => {
      const harness = makeHarness();
      await recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies);
      const auditId = Object.keys(harness.root.fieldPlatform.v2.auditLogs)[0];
      if (state === "missing") {
        delete harness.root.fieldPlatform.v2.auditLogs[auditId];
      } else {
        harness.root.fieldPlatform.v2.auditLogs[auditId] = {
          ...harness.root.fieldPlatform.v2.auditLogs[auditId],
          authUid: "someone_else",
        };
      }
      await expectCode(
        recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
        "field_operator_switch_storage_invalid",
      );
    },
  );

  it.each(["auditLogs", "requestReceipts"])(
    "rejects a corrupted %s parent instead of replacing data",
    async (parent) => {
      const root = validRoot() as any;
      root.fieldPlatform.v2[parent] = ["corrupt"];
      const before = structuredClone(root);
      const harness = makeHarness(root);
      await expectCode(
        recordFieldOperatorSwitchCore(validInput(), viewerActor(), harness.dependencies),
        "field_operator_switch_storage_invalid",
      );
      expect(harness.root).toEqual(before);
    },
  );

  it("validates the server timestamp and authenticated email before transaction", async () => {
    const badClock = makeHarness();
    badClock.dependencies.now = () => "2026-08-14T03:04:05Z";
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), badClock.dependencies),
      "field_operator_switch_timestamp_invalid",
    );
    expect(badClock.transact).not.toHaveBeenCalled();

    const badEmail = makeHarness();
    badEmail.dependencies.authenticatedEmail = "";
    await expectCode(
      recordFieldOperatorSwitchCore(validInput(), viewerActor(), badEmail.dependencies),
      "field_access_forbidden",
    );
    expect(badEmail.transact).not.toHaveBeenCalled();
  });
});
