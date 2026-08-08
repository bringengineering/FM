import type { Building, ChecklistAnswer } from "./types";

export type BuildingDraft = Partial<
  Pick<Building, "managementNumber" | "name" | "roadAddress" | "latitude" | "longitude">
>;

export interface ListingDraft {
  buildingId?: string;
  unitLabel?: string;
  depositWon?: number;
  monthlyRentWon?: number;
  maintenanceFeeWon?: number;
}

export interface VisitCompletionInput {
  checklistFields: Array<{
    id: string;
    required: boolean;
    visible?: boolean;
  }>;
  answers: Record<string, ChecklistAnswer | undefined>;
  requiredMediaSlots: string[];
  completedMediaSlotIds: string[];
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasAnswer(value: ChecklistAnswer | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Number.isFinite(value.value) && value.unit.trim().length > 0;
  }

  return true;
}

export function validateBuildingDraft(draft: BuildingDraft): string[] {
  const errors: string[] = [];

  if (!isNonBlankString(draft.managementNumber)) {
    errors.push("managementNumber");
  }
  if (!isNonBlankString(draft.name)) {
    errors.push("name");
  }
  if (!isNonBlankString(draft.roadAddress)) {
    errors.push("roadAddress");
  }
  if (
    typeof draft.latitude !== "number" ||
    !Number.isFinite(draft.latitude) ||
    draft.latitude < -90 ||
    draft.latitude > 90
  ) {
    errors.push("latitude");
  }
  if (
    typeof draft.longitude !== "number" ||
    !Number.isFinite(draft.longitude) ||
    draft.longitude < -180 ||
    draft.longitude > 180
  ) {
    errors.push("longitude");
  }

  return errors;
}

export function validateListingDraft(draft: ListingDraft): string[] {
  const errors: string[] = [];

  if (!isNonBlankString(draft.buildingId)) {
    errors.push("buildingId");
  }
  if (!isNonBlankString(draft.unitLabel)) {
    errors.push("unitLabel");
  }
  if (!isNonNegativeInteger(draft.depositWon)) {
    errors.push("depositWon");
  }
  if (!isNonNegativeInteger(draft.monthlyRentWon)) {
    errors.push("monthlyRentWon");
  }
  if (!isNonNegativeInteger(draft.maintenanceFeeWon)) {
    errors.push("maintenanceFeeWon");
  }

  return errors;
}

export function validateVisitCompletion(input: VisitCompletionInput): string[] {
  const errors: string[] = [];

  for (const field of input.checklistFields) {
    if (field.required && field.visible !== false && !hasAnswer(input.answers[field.id])) {
      errors.push(field.id);
    }
  }

  const completedSlots = new Set(input.completedMediaSlotIds);
  for (const slotId of input.requiredMediaSlots) {
    if (!completedSlots.has(slotId)) {
      errors.push(`media:${slotId}`);
    }
  }

  return errors;
}
