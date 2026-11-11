import {
  FIELD_JOB_TYPES,
  FIELD_WORKFLOW_STATUSES,
  FieldV2Error,
  type FieldJobType,
  type FieldWorkflowStatus,
} from "./contracts.js";

export interface FieldEvidenceRequirement {
  id: string;
  label: string;
  minimumCount: number;
  requiredWhen?: "issue_reported";
}

export type FieldCompletionOutcome =
  | "ad_package_ready"
  | "move_out_report_ready"
  | "cleaning_evidence_ready"
  | "inspection_report_ready"
  | "complaint_resolution_ready"
  | "repair_verification_ready";

export type FieldCrmEffect =
  | "vacancy_marketing_ready"
  | "vacancy_transition_proposed"
  | "cleaning_service_updated"
  | "building_condition_updated"
  | "complaint_case_updated"
  | "repair_case_updated";

export type FieldCompletionRule =
  | "review_required"
  | "complete_if_no_issues_otherwise_review";

export interface FieldJobPolicy {
  policyVersion: string;
  checklistId: string;
  label: string;
  requiredEvidence: readonly FieldEvidenceRequirement[];
  allowedTransitions: Readonly<Record<
    FieldWorkflowStatus,
    readonly FieldWorkflowStatus[]
  >>;
  completion: Readonly<{
    rule: FieldCompletionRule;
    outcome: FieldCompletionOutcome;
    crmEffect: FieldCrmEffect;
    createsAdPackage: boolean;
  }>;
}

export interface FieldNextAction {
  action:
    | "claim"
    | "accept"
    | "start"
    | "evidenceReady"
    | "requestReview"
    | "review"
    | "resume"
    | "complete"
    | "recordInspectionOutcome"
    | "none";
  label: string;
}

export interface FieldNextActionContext {
  inspectionOutcome?: "no_issue" | "issue_found";
}

interface MaintenanceInspectionDecision {
  action: FieldNextAction;
  targetStatus: "completed" | "review_pending";
}

export const FIELD_WORKFLOW_STATUS_LABELS: Readonly<Record<
  FieldWorkflowStatus,
  string
>> = Object.freeze({
  requested: "요청",
  assigned: "배정",
  accepted: "수락",
  in_progress: "진행 중",
  evidence_ready: "증거 작성 완료",
  review_pending: "검수 대기",
  changes_requested: "수정 요청",
  approved: "승인",
  completed: "완료",
  cancelled: "취소",
});

function freezeEvidence(
  items: readonly FieldEvidenceRequirement[],
): readonly FieldEvidenceRequirement[] {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

const REVIEWED_TRANSITIONS: Readonly<Record<
  FieldWorkflowStatus,
  readonly FieldWorkflowStatus[]
>> = Object.freeze({
  requested: Object.freeze(["assigned", "cancelled"] as const),
  assigned: Object.freeze(["accepted", "cancelled"] as const),
  accepted: Object.freeze(["in_progress", "cancelled"] as const),
  in_progress: Object.freeze(["evidence_ready", "cancelled"] as const),
  evidence_ready: Object.freeze(["review_pending", "cancelled"] as const),
  review_pending: Object.freeze(["changes_requested", "approved", "cancelled"] as const),
  changes_requested: Object.freeze(["in_progress", "cancelled"] as const),
  approved: Object.freeze(["completed", "cancelled"] as const),
  completed: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
});

const CONDITIONAL_INSPECTION_TRANSITIONS: Readonly<Record<
  FieldWorkflowStatus,
  readonly FieldWorkflowStatus[]
>> = Object.freeze({
  ...REVIEWED_TRANSITIONS,
  evidence_ready: Object.freeze([
    "review_pending",
    "completed",
    "cancelled",
  ] as const),
});

function policy(
  input: Omit<FieldJobPolicy, "allowedTransitions"> & {
    allowedTransitions?: FieldJobPolicy["allowedTransitions"];
  },
): FieldJobPolicy {
  const { allowedTransitions = REVIEWED_TRANSITIONS, ...metadata } = input;
  return Object.freeze({
    ...metadata,
    requiredEvidence: freezeEvidence(input.requiredEvidence),
    allowedTransitions,
    completion: Object.freeze({ ...input.completion }),
  });
}

export const fieldJobPolicies: Readonly<Record<FieldJobType, FieldJobPolicy>> =
  Object.freeze({
    vacancy_capture: policy({
      policyVersion: "FIELD_V2_VACANCY_CAPTURE",
      checklistId: "VACANCY_CAPTURE_V1",
      label: "공실 촬영",
      requiredEvidence: [
        { id: "unitInterior", label: "호실 내부 필수 구역", minimumCount: 1 },
        { id: "defectRecord", label: "하자 기록", minimumCount: 1 },
        { id: "leaseTermsSnapshot", label: "임대 조건 확인", minimumCount: 1 },
        { id: "captureConsent", label: "촬영 동의 확인", minimumCount: 1 },
      ],
      completion: {
        rule: "review_required",
        outcome: "ad_package_ready",
        crmEffect: "vacancy_marketing_ready",
        createsAdPackage: true,
      },
    }),
    move_out_check: policy({
      policyVersion: "FIELD_V2_MOVE_OUT_CHECK",
      checklistId: "MOVE_OUT_CHECK_V1",
      label: "퇴실 점검",
      requiredEvidence: [
        { id: "conditionOverview", label: "퇴실 상태 전경", minimumCount: 2 },
        { id: "damageDetail", label: "파손·오염 상세", minimumCount: 1 },
        { id: "meterReading", label: "계량기", minimumCount: 1 },
        { id: "keys", label: "열쇠", minimumCount: 1 },
        { id: "remainingItems", label: "잔존물", minimumCount: 1 },
      ],
      completion: {
        rule: "review_required",
        outcome: "move_out_report_ready",
        crmEffect: "vacancy_transition_proposed",
        createsAdPackage: false,
      },
    }),
    cleaning_before_after: policy({
      policyVersion: "FIELD_V2_CLEANING_BEFORE_AFTER",
      checklistId: "CLEAN_BEFORE_AFTER_V1",
      label: "청소 전후 기록",
      requiredEvidence: [
        { id: "beforeAfterPair", label: "같은 구역 청소 전·후", minimumCount: 2 },
        { id: "workScope", label: "작업 범위", minimumCount: 1 },
        { id: "worker", label: "작업자 확인", minimumCount: 1 },
      ],
      completion: {
        rule: "review_required",
        outcome: "cleaning_evidence_ready",
        crmEffect: "cleaning_service_updated",
        createsAdPackage: false,
      },
    }),
    maintenance_inspection: policy({
      policyVersion: "FIELD_V2_MAINTENANCE_INSPECTION",
      checklistId: "MAINTENANCE_INSPECTION_V1",
      label: "시설 점검",
      requiredEvidence: [
        { id: "facilityStatus", label: "시설별 정상·주의·고장", minimumCount: 1 },
        {
          id: "issuePhoto",
          label: "이상 항목 사진",
          minimumCount: 1,
          requiredWhen: "issue_reported",
        },
      ],
      allowedTransitions: CONDITIONAL_INSPECTION_TRANSITIONS,
      completion: {
        rule: "complete_if_no_issues_otherwise_review",
        outcome: "inspection_report_ready",
        crmEffect: "building_condition_updated",
        createsAdPackage: false,
      },
    }),
    complaint_check: policy({
      policyVersion: "FIELD_V2_COMPLAINT_CHECK",
      checklistId: "COMPLAINT_CHECK_V1",
      label: "민원 확인",
      requiredEvidence: [
        { id: "complaintDetails", label: "민원 내용", minimumCount: 1 },
        { id: "siteObservation", label: "현장 관찰", minimumCount: 1 },
        { id: "impactScope", label: "영향 범위", minimumCount: 1 },
        { id: "sitePhoto", label: "현장 사진", minimumCount: 1 },
        { id: "contactResult", label: "연락 결과", minimumCount: 1 },
      ],
      completion: {
        rule: "review_required",
        outcome: "complaint_resolution_ready",
        crmEffect: "complaint_case_updated",
        createsAdPackage: false,
      },
    }),
    repair_before_after: policy({
      policyVersion: "FIELD_V2_REPAIR_BEFORE_AFTER",
      checklistId: "REPAIR_BEFORE_AFTER_V1",
      label: "수리 전후 기록",
      requiredEvidence: [
        { id: "workOrderReference", label: "작업 지시 확인", minimumCount: 1 },
        { id: "beforeRepair", label: "수리 전", minimumCount: 1 },
        { id: "duringRepair", label: "수리 중", minimumCount: 1 },
        { id: "afterRepair", label: "수리 후", minimumCount: 1 },
        { id: "completionConfirmation", label: "완료 확인", minimumCount: 1 },
      ],
      completion: {
        rule: "review_required",
        outcome: "repair_verification_ready",
        crmEffect: "repair_case_updated",
        createsAdPackage: false,
      },
    }),
  });

function isJobType(value: unknown): value is FieldJobType {
  return typeof value === "string"
    && (FIELD_JOB_TYPES as readonly string[]).includes(value);
}

function isWorkflowStatus(value: unknown): value is FieldWorkflowStatus {
  return typeof value === "string"
    && (FIELD_WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export function transitionFieldStatus(
  jobType: FieldJobType,
  from: FieldWorkflowStatus,
  to: FieldWorkflowStatus,
  context: FieldNextActionContext = {},
): FieldWorkflowStatus {
  if (
    !isJobType(jobType)
    || !isWorkflowStatus(from)
    || !isWorkflowStatus(to)
    || !fieldJobPolicies[jobType].allowedTransitions[from].includes(to)
  ) {
    throw new FieldV2Error("field_transition_invalid");
  }
  if (
    jobType === "maintenance_inspection"
    && from === "evidence_ready"
    && (to === "completed" || to === "review_pending")
  ) {
    const decision = maintenanceInspectionDecision(context);
    if (!decision || decision.targetStatus !== to) {
      throw new FieldV2Error("field_inspection_outcome_invalid");
    }
  }
  return to;
}

const ACCEPTED_LABELS: Readonly<Record<FieldJobType, string>> = Object.freeze({
  vacancy_capture: "촬영 시작",
  move_out_check: "퇴실 점검 시작",
  cleaning_before_after: "청소 기록 시작",
  maintenance_inspection: "시설 점검 시작",
  complaint_check: "민원 확인 시작",
  repair_before_after: "수리 기록 시작",
});

function maintenanceInspectionDecision(
  context: FieldNextActionContext | null | undefined,
): MaintenanceInspectionDecision | null {
  if (!context || typeof context !== "object") return null;
  if (context.inspectionOutcome === "no_issue") {
    return {
      action: { action: "complete", label: "완료" },
      targetStatus: "completed",
    };
  }
  if (context.inspectionOutcome === "issue_found") {
    return {
      action: { action: "requestReview", label: "검수 요청" },
      targetStatus: "review_pending",
    };
  }
  return null;
}

export function nextFieldAction(
  jobType: FieldJobType,
  status: FieldWorkflowStatus,
  context: FieldNextActionContext = {},
): FieldNextAction {
  if (!isJobType(jobType) || !isWorkflowStatus(status)) {
    throw new FieldV2Error("field_policy_invalid");
  }
  switch (status) {
    case "requested": return { action: "claim", label: "내가 맡기" };
    case "assigned": return { action: "accept", label: "수락" };
    case "accepted": return { action: "start", label: ACCEPTED_LABELS[jobType] };
    case "in_progress": return { action: "evidenceReady", label: "증거 완료" };
    case "evidence_ready": {
      if (jobType !== "maintenance_inspection") {
        return { action: "requestReview", label: "검수 요청" };
      }
      const decision = maintenanceInspectionDecision(context);
      if (decision) return decision.action;
      return {
        action: "recordInspectionOutcome",
        label: "점검 결과 기록",
      };
    }
    case "review_pending": return { action: "review", label: "검수하기" };
    case "changes_requested": return { action: "resume", label: "재촬영" };
    case "approved": return { action: "complete", label: "완료" };
    case "completed": return { action: "none", label: "완료됨" };
    case "cancelled": return { action: "none", label: "취소됨" };
  }
}
