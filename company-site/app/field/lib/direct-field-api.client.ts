"use client";

import { equalTo, get, orderByChild, query, ref, runTransaction, update } from "firebase/database";

import type {
  CaptureTarget,
  FieldCaptureWorkspaceResult,
  StartFieldCaptureSessionInput,
  StartFieldCaptureSessionResult,
  SetManagementContractStatusInput,
  SetManagementContractStatusResult,
} from "./field-api.client";
import { database } from "./firebase.client";
import { classifyWonjuArea, formatManagementNumber } from "./management-number";
import type {
  SaveFieldRegistrationInput,
  SaveFieldRegistrationResult,
} from "./registration-draft";
import type {
  Building,
  CaptureSessionRecord,
  Listing,
  Unit,
  UserRole,
} from "./types";

export interface DirectFieldApiDependencies {
  uid(): string;
  role(): UserRole;
  displayName(): string;
  now(): string;
  read(path: string): Promise<unknown>;
  readCaptureSessions(uid: string, role: UserRole): Promise<unknown>;
  allocateManagementNumber(address: string, now: string): Promise<string>;
  update(patch: Record<string, unknown>): Promise<void>;
}

export interface DirectFieldApi {
  saveRegistration(input: SaveFieldRegistrationInput): Promise<SaveFieldRegistrationResult>;
  setManagementContractStatus(
    input: SetManagementContractStatusInput,
  ): Promise<SetManagementContractStatusResult>;
  startCaptureSession(input: StartFieldCaptureSessionInput): Promise<StartFieldCaptureSessionResult>;
  loadCaptureWorkspace(): Promise<FieldCaptureWorkspaceResult>;
}

function recordMap<T>(value: unknown): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, T>;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, withoutUndefined(child)]),
  ) as T;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function entityId(prefix: string, uid: string, draftId: string, localId: string): Promise<string> {
  return `${prefix}_${(await sha256Hex(`${uid}\0${draftId}\0${localId}`)).slice(0, 24)}`;
}

function assertActor(dependencies: DirectFieldApiDependencies): { uid: string; role: UserRole } {
  const uid = dependencies.uid();
  const role = dependencies.role();
  if (!uid || (role !== "admin" && role !== "staff")) throw new Error("field_registration_forbidden");
  return { uid, role };
}

function activeListingStatus(status: Listing["status"]): boolean {
  return status !== "closed";
}

export function createDirectFieldApi(dependencies: DirectFieldApiDependencies): DirectFieldApi {
  return {
    async saveRegistration(input) {
      const actor = assertActor(dependencies);
      const receiptPath = `fieldPlatform/registrationRequests/${actor.uid}/${input.requestId}`;
      const receipt = await dependencies.read(receiptPath) as { result?: SaveFieldRegistrationResult } | null;
      const writeActiveProjection = async (
        result: SaveFieldRegistrationResult,
        updatedAt: string,
      ) => {
        if (!input.managementContract.requested || actor.role !== "admin") return;
        const vacancyCount = input.units.filter((unit) => unit.isVacant).length;
        await dependencies.update({
          [`fieldPlatform/mapProjections/${result.buildingId}`]: {
            buildingId: result.buildingId,
            managementNumber: result.managementNumber,
            name: input.building.name,
            roadAddress: input.building.roadAddress,
            latitude: input.building.latitude,
            longitude: input.building.longitude,
            markerStatus: vacancyCount > 0 ? "vacant" : "managed",
            vacancyCount,
            approvedRentSummary: "광고 검토 전",
            parkingSummary: input.building.parking.available
              ? input.building.parking.totalSpaces
                ? `${input.building.parking.totalSpaces}대`
                : "주차 가능"
              : "주차 불가",
            captureStatus: "notStarted",
            updatedAt,
          },
        });
      };
      if (receipt?.result) {
        await writeActiveProjection(receipt.result, dependencies.now());
        return receipt.result;
      }

      const managementNumber = await dependencies.allocateManagementNumber(
        input.building.roadAddress,
        dependencies.now(),
      );

      const buildingId = await entityId("building", actor.uid, input.draftId, input.draftId);
      const unitEntries = await Promise.all(input.units.map(async (unit) => [
        unit.localId,
        await entityId("unit", actor.uid, input.draftId, unit.localId),
      ] as const));
      const unitIds = Object.fromEntries(unitEntries);
      const primaryUnitId = unitIds[input.primaryUnitLocalId];
      const primaryUnit = input.units.find((unit) => unit.localId === input.primaryUnitLocalId);
      if (!primaryUnitId || !primaryUnit) throw new Error("field_invalid_registration");
      const listingId = await entityId("listing", actor.uid, input.draftId, input.primaryUnitLocalId);
      const visitId = await entityId("visit", actor.uid, input.draftId, input.primaryUnitLocalId);
      const result = { buildingId, managementNumber, unitIds, listingId, visitId };
      const now = dependencies.now();
      const auditStamp = {
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
      };
      const contractStatus = input.managementContract.requested
        ? actor.role === "admin" ? "active" : "pending"
        : "none";
      const building = {
        id: buildingId,
        ...input.building,
        managementNumber,
        unitCount: input.units.length,
        assignedStaffIds: [actor.uid],
        managementContract: {
          status: contractStatus,
          ...(input.managementContract.requested && input.managementContract.startedOn
            ? { startedOn: input.managementContract.startedOn }
            : {}),
          updatedAt: now,
          updatedBy: actor.uid,
        },
        ...auditStamp,
      };
      const listing = {
        id: listingId,
        buildingId,
        unitId: primaryUnitId,
        unitLabel: primaryUnit.unitLabel,
        status: "draft",
        ...input.listing,
        advertisingApproved: false,
        ...auditStamp,
      };
      const patch: Record<string, unknown> = {
        [`fieldPlatform/buildings/${buildingId}`]: building,
        [`fieldPlatform/listings/${listingId}`]: listing,
        [`fieldPlatform/visits/${visitId}`]: {
          id: visitId,
          buildingId,
          unitId: primaryUnitId,
          listingId,
          type: "initial",
          assignedUserId: actor.uid,
          checklistTemplateId: "initial",
          checklistTemplateVersion: 1,
          ...auditStamp,
        },
        [`fieldPlatform/buildingAssignments/${buildingId}/${actor.uid}`]: true,
        [receiptPath]: { result, completedAt: now },
      };
      for (const unit of input.units) {
        const id = unitIds[unit.localId];
        patch[`fieldPlatform/units/${id}`] = {
          id,
          buildingId,
          unitLabel: unit.unitLabel,
          ...(unit.structure ? { structure: unit.structure } : {}),
          ...(unit.floor === undefined ? {} : { floor: unit.floor }),
          options: [...unit.options],
          isVacant: unit.isVacant,
          ...(unit.localId === input.primaryUnitLocalId ? { currentListingId: listingId } : {}),
          ...auditStamp,
        };
      }
      await dependencies.update(withoutUndefined(patch));
      await writeActiveProjection(result, now);
      return result;
    },

    async setManagementContractStatus(input) {
      const actor = assertActor(dependencies);
      if (actor.role !== "admin") {
        throw new Error("field_management_contract_admin_required");
      }
      const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
      if (input.status === "active" && !datePattern.test(input.startedOn ?? "")) {
        throw new Error("field_management_contract_started_on_invalid");
      }
      if (input.status === "ended" && !datePattern.test(input.endedOn ?? "")) {
        throw new Error("field_management_contract_ended_on_invalid");
      }
      const [rawBuilding, rawUnits] = await Promise.all([
        dependencies.read(`fieldPlatform/buildings/${input.buildingId}`),
        dependencies.read("fieldPlatform/units"),
      ]);
      if (!rawBuilding || typeof rawBuilding !== "object") {
        throw new Error("field_management_contract_building_missing");
      }
      const building = rawBuilding as Building;
      const now = dependencies.now();
      const base = `fieldPlatform/buildings/${input.buildingId}`;
      const patch: Record<string, unknown> = {
        [`${base}/managementContract/status`]: input.status,
        [`${base}/managementContract/updatedAt`]: now,
        [`${base}/managementContract/updatedBy`]: actor.uid,
        [`${base}/updatedAt`]: now,
        [`${base}/updatedBy`]: actor.uid,
      };
      if (input.startedOn) {
        patch[`${base}/managementContract/startedOn`] = input.startedOn;
      }
      if (input.endedOn) {
        patch[`${base}/managementContract/endedOn`] = input.endedOn;
      }
      const projectionPath = `fieldPlatform/mapProjections/${input.buildingId}`;
      if (input.status === "active") {
        const vacancyCount = Object.values(recordMap<Unit>(rawUnits)).filter((unit) => (
          unit.buildingId === input.buildingId && unit.isVacant === true
        )).length;
        patch[projectionPath] = {
          buildingId: input.buildingId,
          managementNumber: building.managementNumber,
          name: building.name,
          roadAddress: building.roadAddress,
          latitude: building.latitude,
          longitude: building.longitude,
          markerStatus: vacancyCount > 0 ? "vacant" : "managed",
          vacancyCount,
          approvedRentSummary: "광고 검토 전",
          parkingSummary: building.parking?.available
            ? building.parking.totalSpaces
              ? `${building.parking.totalSpaces}대`
              : "주차 가능"
            : "주차 불가",
          captureStatus: "notStarted",
          updatedAt: now,
        };
      } else {
        patch[projectionPath] = null;
      }
      await dependencies.update(patch);
      return { buildingId: input.buildingId, status: input.status };
    },

    async startCaptureSession(input) {
      const actor = assertActor(dependencies);
      const [building, unit, listing, existing] = await Promise.all([
        dependencies.read(`fieldPlatform/buildings/${input.buildingId}`),
        input.unitId ? dependencies.read(`fieldPlatform/units/${input.unitId}`) : null,
        input.listingId ? dependencies.read(`fieldPlatform/listings/${input.listingId}`) : null,
        dependencies.read(`fieldPlatform/captureSessions/${input.captureSessionId}`),
      ]);
      if (existing) return { captureSessionId: input.captureSessionId, visitId: input.visitId };
      if (!building) throw new Error("field_capture_building_missing");
      if (input.unitId && (!unit || (unit as Unit).buildingId !== input.buildingId)) {
        throw new Error("field_capture_unit_mismatch");
      }
      if (input.listingId && (!listing
        || (listing as Listing).buildingId !== input.buildingId
        || (input.unitId && (listing as Listing).unitId !== input.unitId))) {
        throw new Error("field_capture_listing_mismatch");
      }
      const now = dependencies.now();
      const base = `fieldPlatform/captureSessions/${input.captureSessionId}`;
      const patch: Record<string, unknown> = {
        [`${base}/id`]: input.captureSessionId,
        [`${base}/requestId`]: input.requestId,
        [`${base}/buildingId`]: input.buildingId,
        [`${base}/visitId`]: input.visitId,
        [`${base}/visitType`]: input.visitType,
        [`${base}/createdBy`]: actor.uid,
        [`${base}/status`]: "open",
        [`${base}/createdAt`]: now,
        [`${base}/updatedAt`]: now,
        [`fieldPlatform/visits/${input.visitId}`]: {
          id: input.visitId,
          buildingId: input.buildingId,
          ...(input.unitId ? { unitId: input.unitId } : {}),
          ...(input.listingId ? { listingId: input.listingId } : {}),
          type: input.visitType,
          assignedUserId: actor.uid,
          checklistTemplateId: input.visitType,
          checklistTemplateVersion: 1,
          createdAt: now,
          createdBy: actor.uid,
          updatedAt: now,
          updatedBy: actor.uid,
        },
      };
      if (input.unitId) patch[`${base}/unitId`] = input.unitId;
      if (input.listingId) {
        patch[`${base}/listingId`] = input.listingId;
        patch[`fieldPlatform/listings/${input.listingId}/status`] = "capturing";
        patch[`fieldPlatform/listings/${input.listingId}/updatedAt`] = now;
        patch[`fieldPlatform/listings/${input.listingId}/updatedBy`] = actor.uid;
      }
      await dependencies.update(patch);
      return { captureSessionId: input.captureSessionId, visitId: input.visitId };
    },

    async loadCaptureWorkspace() {
      const actor = assertActor(dependencies);
      const [rawBuildings, rawUnits, rawListings, rawSessions] = await Promise.all([
        dependencies.read("fieldPlatform/buildings"),
        dependencies.read("fieldPlatform/units"),
        dependencies.read("fieldPlatform/listings"),
        dependencies.readCaptureSessions(actor.uid, actor.role),
      ]);
      const buildings = recordMap<Building>(rawBuildings);
      const units = recordMap<Unit>(rawUnits);
      const listings = recordMap<Listing>(rawListings);
      const targets: CaptureTarget[] = [];
      for (const building of Object.values(buildings)) {
        if (building.managementContract?.status === "active") {
          targets.push({
            id: `management:${building.id}`,
            buildingId: building.id,
            buildingName: building.name,
            source: "management",
          });
        }
      }
      for (const listing of Object.values(listings)) {
        if (!activeListingStatus(listing.status)) continue;
        const building = buildings[listing.buildingId];
        const unit = units[listing.unitId];
        if (!building || !unit) continue;
        targets.push({
          id: `advertising:${listing.id}`,
          buildingId: building.id,
          buildingName: building.name,
          unitId: unit.id,
          unitLabel: unit.unitLabel,
          listingId: listing.id,
          source: "advertising",
        });
      }
      const openSessions = Object.values(recordMap<CaptureSessionRecord>(rawSessions))
        .filter((item) => item.status === "open" && (actor.role === "admin" || item.createdBy === actor.uid));
      return { targets, openSessions };
    },
  };
}

export function createFirebaseDirectFieldApi(actor: {
  uid: string;
  role: UserRole;
  displayName: string;
}): DirectFieldApi {
  return createDirectFieldApi({
    uid: () => actor.uid,
    role: () => actor.role,
    displayName: () => actor.displayName,
    now: () => new Date().toISOString(),
    read: async (path) => (await get(ref(database, path))).val(),
    readCaptureSessions: async (uid, role) => {
      const sessionsRef = ref(database, "fieldPlatform/captureSessions");
      const snapshot = role === "admin"
        ? await get(sessionsRef)
        : await get(query(sessionsRef, orderByChild("createdBy"), equalTo(uid)));
      return snapshot.val();
    },
    allocateManagementNumber: async (address, now) => {
      const year = new Date(now).getUTCFullYear();
      const area = classifyWonjuArea(address);
      const counter = ref(database, `fieldPlatform/managementNumberCounters/${year}/${area}`);
      const result = await runTransaction(counter, (current) => {
        const value = typeof current === "number" && Number.isSafeInteger(current) && current >= 0
          ? current
          : 0;
        return value + 1;
      });
      const sequence = result.snapshot.val();
      if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
        throw new Error("field_management_number_allocation_failed");
      }
      return formatManagementNumber({ area, year, sequence });
    },
    update: async (patch) => update(ref(database), patch),
  });
}
