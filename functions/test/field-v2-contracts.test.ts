import { describe, expect, it } from "vitest";

import {
  FIELD_JOB_TYPES,
  FIELD_PROTOCOL_VERSION,
  FIELD_UPLOAD_STATUSES,
  FIELD_V2_ROOT,
  FIELD_WORKFLOW_STATUSES,
  assertFieldCommandEnvelope,
  type FieldCommandEnvelope,
} from "../src/field-v2/contracts.js";
import {
  FIELD_WORKFLOW_STATUS_LABELS,
  fieldJobPolicies,
  nextFieldAction,
  transitionFieldStatus,
} from "../src/field-v2/policies.js";

const REQUEST_ID = "8f738cdc-cc9a-4f23-8b27-a87661232806";

describe("FIELD v2 contracts", () => {
  it("pins the protocol root and exactly six supported job types", () => {
    expect(FIELD_PROTOCOL_VERSION).toBe(2);
    expect(FIELD_V2_ROOT).toBe("fieldPlatform/v2");
    expect(FIELD_JOB_TYPES).toEqual([
      "vacancy_capture",
      "move_out_check",
      "cleaning_before_after",
      "maintenance_inspection",
      "complaint_check",
      "repair_before_after",
    ]);
    expect(Object.isFrozen(FIELD_JOB_TYPES)).toBe(true);
    expect(() => (FIELD_JOB_TYPES as unknown as string[]).push("other"))
      .toThrow();
  });

  it("pins the complete workflow and upload status vocabularies", () => {
    expect(FIELD_WORKFLOW_STATUSES).toEqual([
      "requested",
      "assigned",
      "accepted",
      "in_progress",
      "evidence_ready",
      "review_pending",
      "changes_requested",
      "approved",
      "completed",
      "cancelled",
    ]);
    expect(FIELD_UPLOAD_STATUSES).toEqual([
      "none",
      "queued",
      "uploading",
      "partial_failure",
      "failed",
      "synced",
    ]);
    expect(Object.isFrozen(FIELD_WORKFLOW_STATUSES)).toBe(true);
    expect(Object.isFrozen(FIELD_UPLOAD_STATUSES)).toBe(true);
  });

  it("accepts an RFC 4122 UUID and returns a bounded command envelope", () => {
    const envelope = {
      protocolVersion: 2,
      type: "field.command",
      requestId: REQUEST_ID,
      payload: { command: "claimJob", jobId: "job_123" },
    } satisfies FieldCommandEnvelope;

    expect(assertFieldCommandEnvelope(envelope)).toBe(envelope);
  });

  it.each([
    ["nil UUID", "00000000-0000-0000-0000-000000000000"],
    ["version zero", "8f738cdc-cc9a-0f23-8b27-a87661232806"],
    ["unknown RFC 4122 version", "8f738cdc-cc9a-6f23-8b27-a87661232806"],
    ["invalid variant", "8f738cdc-cc9a-4f23-7b27-a87661232806"],
    ["bad grouping", "8f738cdccc9a4f238b27a87661232806"],
  ])("rejects %s request IDs", (_label, requestId) => {
    expect(() => assertFieldCommandEnvelope({
      protocolVersion: 2,
      type: "field.command",
      requestId,
      payload: {},
    })).toThrow("field_protocol_invalid");
  });

  it.each([
    { protocolVersion: 1, type: "field.command", requestId: REQUEST_ID, payload: {} },
    { protocolVersion: 2, type: "other", requestId: REQUEST_ID, payload: {} },
    { protocolVersion: 2, type: "field.command", requestId: REQUEST_ID, payload: null },
    { protocolVersion: 2, type: "field.command", requestId: REQUEST_ID, payload: [] },
    {
      protocolVersion: 2,
      type: "field.command",
      requestId: REQUEST_ID,
      payload: {},
      unexpected: true,
    },
  ])("rejects malformed command envelopes", (value) => {
    expect(() => assertFieldCommandEnvelope(value))
      .toThrow("field_protocol_invalid");
  });

  it("rejects envelopes larger than 32 KiB and unserializable payloads", () => {
    expect(() => assertFieldCommandEnvelope({
      protocolVersion: 2,
      type: "field.command",
      requestId: REQUEST_ID,
      payload: { value: "x".repeat(32_768) },
    })).toThrow("field_protocol_invalid");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertFieldCommandEnvelope({
      protocolVersion: 2,
      type: "field.command",
      requestId: REQUEST_ID,
      payload: circular,
    })).toThrow("field_protocol_invalid");
  });
});

describe("FIELD v2 job policies", () => {
  it("publishes one deeply immutable versioned policy per job type", () => {
    expect(Object.keys(fieldJobPolicies)).toEqual([...FIELD_JOB_TYPES]);
    expect(Object.isFrozen(fieldJobPolicies)).toBe(true);

    for (const jobType of FIELD_JOB_TYPES) {
      const policy = fieldJobPolicies[jobType];
      expect(policy.policyVersion).toMatch(/^FIELD_V2_[A-Z_]+$/);
      expect(policy.checklistId).toMatch(/_V1$/);
      expect(policy.label).toMatch(/[가-힣]/u);
      expect(policy.requiredEvidence.length).toBeGreaterThan(0);
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.requiredEvidence)).toBe(true);
      expect(Object.isFrozen(policy.allowedTransitions)).toBe(true);
      expect(Object.isFrozen(policy.allowedTransitions.completed)).toBe(true);
      expect(Object.isFrozen(policy.allowedTransitions.cancelled)).toBe(true);
    }
  });

  it("keeps advertising output exclusive to vacancy capture", () => {
    expect(fieldJobPolicies.vacancy_capture.completion).toMatchObject({
      rule: "review_required",
      outcome: "ad_package_ready",
      crmEffect: "vacancy_marketing_ready",
      createsAdPackage: true,
    });
    expect(fieldJobPolicies.maintenance_inspection.completion).toMatchObject({
      rule: "complete_if_no_issues_otherwise_review",
      outcome: "inspection_report_ready",
      crmEffect: "building_condition_updated",
      createsAdPackage: false,
    });
    expect(fieldJobPolicies.complaint_check.completion).toMatchObject({
      rule: "review_required",
      outcome: "complaint_resolution_ready",
      crmEffect: "complaint_case_updated",
      createsAdPackage: false,
    });
    expect(fieldJobPolicies.maintenance_inspection.completion.outcome)
      .not.toContain("ad_package");
    expect(fieldJobPolicies.complaint_check.completion.outcome)
      .not.toContain("ad_package");
  });

  it("keeps move-out completion proposal-only in CRM", () => {
    expect(fieldJobPolicies.move_out_check.completion).toMatchObject({
      outcome: "move_out_report_ready",
      crmEffect: "vacancy_transition_proposed",
      createsAdPackage: false,
    });
    expect(fieldJobPolicies.move_out_check.completion.crmEffect)
      .not.toMatch(/updated|confirmed/u);
  });

  it("pins the six checklist versions from the approved operating design", () => {
    expect(Object.fromEntries(FIELD_JOB_TYPES.map((jobType) => [
      jobType,
      fieldJobPolicies[jobType].checklistId,
    ]))).toEqual({
      vacancy_capture: "VACANCY_CAPTURE_V1",
      move_out_check: "MOVE_OUT_CHECK_V1",
      cleaning_before_after: "CLEAN_BEFORE_AFTER_V1",
      maintenance_inspection: "MAINTENANCE_INSPECTION_V1",
      complaint_check: "COMPLAINT_CHECK_V1",
      repair_before_after: "REPAIR_BEFORE_AFTER_V1",
    });
  });

  it("pins each checklist's required evidence without raw UI labels", () => {
    expect(Object.fromEntries(FIELD_JOB_TYPES.map((jobType) => [
      jobType,
      fieldJobPolicies[jobType].requiredEvidence.map(({ id }) => id),
    ]))).toEqual({
      vacancy_capture: [
        "unitInterior",
        "defectRecord",
        "leaseTermsSnapshot",
        "captureConsent",
      ],
      move_out_check: [
        "conditionOverview",
        "damageDetail",
        "meterReading",
        "keys",
        "remainingItems",
      ],
      cleaning_before_after: ["beforeAfterPair", "workScope", "worker"],
      maintenance_inspection: ["facilityStatus", "issuePhoto"],
      complaint_check: [
        "complaintDetails",
        "siteObservation",
        "impactScope",
        "sitePhoto",
        "contactResult",
      ],
      repair_before_after: [
        "workOrderReference",
        "beforeRepair",
        "duringRepair",
        "afterRepair",
        "completionConfirmation",
      ],
    });
    for (const policy of Object.values(fieldJobPolicies)) {
      expect(policy.requiredEvidence.every(({ label }) => /[가-힣]/u.test(label)))
        .toBe(true);
    }
  });

  it("allows a no-issue maintenance inspection to complete from evidence ready", () => {
    expect(fieldJobPolicies.maintenance_inspection.allowedTransitions.evidence_ready)
      .toEqual(["review_pending", "completed", "cancelled"]);
    expect(transitionFieldStatus(
      "maintenance_inspection",
      "evidence_ready",
      "completed",
    )).toBe("completed");
  });

  it("selects the maintenance evidence-ready action from the inspection outcome", () => {
    expect(nextFieldAction(
      "maintenance_inspection",
      "evidence_ready",
      { inspectionOutcome: "no_issue" },
    )).toEqual({ action: "complete", label: "완료" });
    expect(nextFieldAction(
      "maintenance_inspection",
      "evidence_ready",
      { inspectionOutcome: "issue_found" },
    )).toEqual({ action: "requestReview", label: "검수 요청" });
    expect(nextFieldAction("maintenance_inspection", "evidence_ready"))
      .toEqual({ action: "recordInspectionOutcome", label: "점검 결과 기록" });
  });

  it("publishes an immutable Korean label for every workflow status", () => {
    expect(Object.keys(FIELD_WORKFLOW_STATUS_LABELS))
      .toEqual([...FIELD_WORKFLOW_STATUSES]);
    expect(FIELD_WORKFLOW_STATUS_LABELS).toEqual({
      requested: "요청됨",
      assigned: "배정됨",
      accepted: "수락됨",
      in_progress: "진행 중",
      evidence_ready: "증거 작성 완료",
      review_pending: "검수 대기",
      changes_requested: "수정 요청",
      approved: "승인됨",
      completed: "완료",
      cancelled: "취소됨",
    });
    expect(Object.isFrozen(FIELD_WORKFLOW_STATUS_LABELS)).toBe(true);
    for (const status of FIELD_WORKFLOW_STATUSES) {
      expect(FIELD_WORKFLOW_STATUS_LABELS[status]).not.toBe(status);
      expect(FIELD_WORKFLOW_STATUS_LABELS[status]).toMatch(/[가-힣]/u);
    }
  });

  it("allows the reviewed workflow including correction resumption", () => {
    expect(transitionFieldStatus("vacancy_capture", "requested", "assigned"))
      .toBe("assigned");
    expect(transitionFieldStatus("vacancy_capture", "assigned", "accepted"))
      .toBe("accepted");
    expect(transitionFieldStatus("vacancy_capture", "accepted", "in_progress"))
      .toBe("in_progress");
    expect(transitionFieldStatus("vacancy_capture", "in_progress", "evidence_ready"))
      .toBe("evidence_ready");
    expect(transitionFieldStatus("vacancy_capture", "evidence_ready", "review_pending"))
      .toBe("review_pending");
    expect(transitionFieldStatus("vacancy_capture", "review_pending", "changes_requested"))
      .toBe("changes_requested");
    expect(transitionFieldStatus("vacancy_capture", "changes_requested", "in_progress"))
      .toBe("in_progress");
    expect(transitionFieldStatus("vacancy_capture", "review_pending", "approved"))
      .toBe("approved");
    expect(transitionFieldStatus("vacancy_capture", "approved", "completed"))
      .toBe("completed");
  });

  it.each([
    ["vacancy_capture", "requested", "completed"],
    ["complaint_check", "assigned", "approved"],
    ["maintenance_inspection", "completed", "requested"],
    ["repair_before_after", "cancelled", "assigned"],
  ] as const)("rejects illegal or terminal transition %s %s -> %s", (jobType, from, to) => {
    expect(() => transitionFieldStatus(jobType, from, to))
      .toThrow("field_transition_invalid");
  });

  it("returns exactly one deterministic Korean primary action", () => {
    expect(nextFieldAction("vacancy_capture", "requested"))
      .toEqual({ action: "claim", label: "내가 맡기" });
    expect(nextFieldAction("vacancy_capture", "assigned"))
      .toEqual({ action: "accept", label: "수락" });
    expect(nextFieldAction("vacancy_capture", "accepted"))
      .toEqual({ action: "start", label: "촬영 시작" });
    expect(nextFieldAction("vacancy_capture", "in_progress"))
      .toEqual({ action: "evidenceReady", label: "증거 완료" });
    expect(nextFieldAction("vacancy_capture", "review_pending"))
      .toEqual({ action: "review", label: "검수하기" });
    expect(nextFieldAction("vacancy_capture", "changes_requested"))
      .toEqual({ action: "resume", label: "재촬영" });
    expect(nextFieldAction("vacancy_capture", "approved"))
      .toEqual({ action: "complete", label: "완료" });
  });

  it("uses job-appropriate labels after a non-capture job is accepted", () => {
    expect(nextFieldAction("move_out_check", "accepted").label).toBe("퇴실 점검 시작");
    expect(nextFieldAction("cleaning_before_after", "accepted").label).toBe("청소 기록 시작");
    expect(nextFieldAction("maintenance_inspection", "accepted").label).toBe("시설 점검 시작");
    expect(nextFieldAction("complaint_check", "accepted").label).toBe("민원 확인 시작");
    expect(nextFieldAction("repair_before_after", "accepted").label).toBe("수리 기록 시작");
    expect(nextFieldAction("complaint_check", "in_progress"))
      .toEqual({ action: "evidenceReady", label: "증거 완료" });
  });
});
