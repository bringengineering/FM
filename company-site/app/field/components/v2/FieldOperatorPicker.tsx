"use client";

import type { FieldOperatorProfile } from "../../lib/v2/operator-profile.client";

type FieldOperatorPickerProps = {
  profiles: readonly FieldOperatorProfile[];
  value: string;
  onChange(operatorId: string): void;
  disabled?: boolean;
  compact?: boolean;
};

export default function FieldOperatorPicker({
  profiles,
  value,
  onChange,
  disabled = false,
  compact = false,
}: FieldOperatorPickerProps) {
  return (
    <section className={`field-v2-operator${compact ? " compact" : ""}`}>
      <div>
        <label htmlFor="field-v2-operator">현재 작업자</label>
        {!compact ? (
          <p>
            업무 배정과 표시를 위한 공용 계정의 작업자 표식입니다. 별도 로그인이나 개인 신원 증명이 아닙니다.
          </p>
        ) : null}
      </div>
      <select
        id="field-v2-operator"
        value={value}
        disabled={disabled}
        aria-describedby={compact ? undefined : "field-v2-operator-help"}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">작업자 선택</option>
        {profiles.map((profile) => (
          <option key={profile.operatorId} value={profile.operatorId}>
            {profile.displayName}
          </option>
        ))}
      </select>
      {!compact ? (
        <small id="field-v2-operator-help">선택값에는 작업자 번호와 선택 시각만 이 기기에 저장됩니다.</small>
      ) : null}
    </section>
  );
}
