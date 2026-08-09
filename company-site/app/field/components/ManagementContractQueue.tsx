"use client";

import { useEffect, useState } from "react";

import {
  getCurrentFieldRole,
  setManagementContractStatus,
  subscribePendingManagementContracts,
  type PendingManagementContractSubscriber,
  type SetManagementContractStatusInput,
  type SetManagementContractStatusResult,
} from "../lib/field-api.client";
import type { Building, UserRole } from "../lib/types";

type RoleResolver = () => Promise<UserRole | null>;
type ContractApprover = (
  input: SetManagementContractStatusInput,
) => Promise<SetManagementContractStatusResult>;

export interface ManagementContractQueueProps {
  resolveRole?: RoleResolver;
  subscribe?: PendingManagementContractSubscriber;
  approve?: ContractApprover;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface SecureUuidCrypto {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
}

export function createApprovalRequestId(
  secureCrypto: SecureUuidCrypto | null | undefined = globalThis.crypto,
): string {
  if (typeof secureCrypto?.randomUUID === "function") {
    return secureCrypto.randomUUID();
  }

  if (typeof secureCrypto?.getRandomValues !== "function") {
    throw new Error("field_secure_random_unavailable");
  }

  const bytes = new Uint8Array(16);
  secureCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export default function ManagementContractQueue({
  resolveRole = getCurrentFieldRole,
  subscribe = subscribePendingManagementContracts,
  approve = setManagementContractStatus,
}: ManagementContractQueueProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [startDates, setStartDates] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void resolveRole()
      .then((role) => {
        if (!active || role !== "admin") return;
        setIsAdmin(true);
        unsubscribe = subscribe(
          (nextBuildings) => {
            if (!active) return;
            const liveIds = new Set(nextBuildings.map((building) => building.id));
            setBuildings(nextBuildings);
            setStartDates((current) => {
              const next = { ...current };
              for (const building of nextBuildings) {
                if (!(building.id in next)) {
                  next[building.id] = building.managementContract?.startedOn || "";
                }
              }
              return next;
            });
            setCompleted((current) =>
              new Set([...current].filter((buildingId) => liveIds.has(buildingId))));
            setFailed((current) =>
              new Set([...current].filter((buildingId) => liveIds.has(buildingId))));
            setLoadFailed(false);
            setLoaded(true);
          },
          () => {
            if (!active) return;
            setLoadFailed(true);
            setLoaded(true);
          },
        );
      })
      .catch(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [resolveRole, subscribe]);

  async function approveBuilding(building: Building) {
    const startedOn = startDates[building.id] || "";
    if (!DATE_PATTERN.test(startedOn) || approving.has(building.id)) return;

    setApproving((current) => new Set(current).add(building.id));
    setFailed((current) => {
      const next = new Set(current);
      next.delete(building.id);
      return next;
    });

    try {
      await approve({
        requestId: createApprovalRequestId(),
        buildingId: building.id,
        status: "active",
        startedOn,
      });
      setCompleted((current) => new Set(current).add(building.id));
    } catch {
      setFailed((current) => new Set(current).add(building.id));
    } finally {
      setApproving((current) => {
        const next = new Set(current);
        next.delete(building.id);
        return next;
      });
    }
  }

  const visibleBuildings = buildings.filter((building) => !completed.has(building.id));

  if (!isAdmin || (!loadFailed && (!loaded || visibleBuildings.length === 0))) {
    return null;
  }

  return (
    <section
      className="field-wizard-card"
      aria-labelledby="management-contract-queue-title"
      aria-label="관리계약 승인 대기"
    >
      <header>
        <p className="field-eyebrow">MANAGEMENT CONTRACT</p>
        <h2 id="management-contract-queue-title">관리계약 승인 대기</h2>
        <p className="field-form-help">
          계약서와 시작일을 확인한 뒤 관리 중인 건물로 승인해 주세요.
        </p>
      </header>

      {loadFailed ? (
        <p className="field-inline-error" role="alert">
          승인 대기 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (
        <div className="field-unit-list">
          {visibleBuildings.map((building) => {
            const busy = approving.has(building.id);
            const inputId = `management-start-${building.id}`;
            return (
              <article className="field-unit-row" key={building.id}>
                <div>
                  <h3>{building.name}</h3>
                  <p>{building.roadAddress}</p>
                  <p>
                    요청 시작일: {building.managementContract?.startedOn || "미입력"}
                  </p>
                </div>
                <div className="field-form-field">
                  <label htmlFor={inputId}>{building.name} 관리 시작일</label>
                  <input
                    id={inputId}
                    type="date"
                    required
                    value={startDates[building.id] || ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStartDates((current) => ({ ...current, [building.id]: value }));
                    }}
                  />
                </div>
                <button
                  className="field-add-unit"
                  type="button"
                  disabled={busy || !DATE_PATTERN.test(startDates[building.id] || "")}
                  onClick={() => void approveBuilding(building)}
                >
                  {busy ? "승인 중" : "관리 중으로 승인"}
                </button>
                {failed.has(building.id) && (
                  <p className="field-inline-error" role="alert">
                    승인 실패 · 다시 시도해 주세요
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
