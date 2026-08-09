"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  LEGACY_WIZARD_DRAFT_KEY,
  activeWizardDraftKey,
  createRegistrationDraft,
  prepareWizardDraft,
  readActiveWizardDraftId,
  RegistrationDraftCompatibilityError,
  saveWizardDraft,
  type BuildingDraftState,
  type BuildingWizardDraft,
  type ListingDraftState,
  type RegistrationDraftStorage,
  type RegistrationDraftInitial,
  type StoredRegistrationDraft,
  type UnitDraftState,
} from "../lib/registration-draft";
import type { FieldSession } from "../lib/auth.client";
import {
  validateBuildingDraft,
  validateListingDraft,
  validateManagementContractDraft,
} from "../lib/validation";

export type { BuildingWizardDraft } from "../lib/registration-draft";

const STEPS = ["건물", "임대조건", "상태점검", "옵션", "촬영", "입지", "검토"] as const;

interface AddressSelection {
  roadAddress: string;
  jibunAddress?: string;
  latitude: number;
  longitude: number;
}

interface AddressCheckResult {
  selection: AddressSelection;
  existingBuilding: { id: string; name: string } | null;
}

export interface BuildingWizardProps {
  session: Pick<FieldSession, "uid" | "displayName" | "role">;
  draftId?: string;
  legacyDraftKey?: string;
  storage?: RegistrationDraftStorage;
  now?: () => string;
  idFactory?: Parameters<typeof createRegistrationDraft>[1];
  initialStep?: number;
  initialDraft?: RegistrationDraftInitial;
  currentPosition?: { latitude: number; longitude: number };
  checkAddress?: (query: string) => Promise<AddressCheckResult>;
  onComplete?: (draft: BuildingWizardDraft) => void | Promise<void>;
}

function defaultNow() {
  return new Date().toISOString();
}

function defaultIdFactory() {
  return crypto.randomUUID();
}

const unavailableStorage: RegistrationDraftStorage = {
  getItem: () => null,
  setItem: () => { throw new Error("registration_draft_storage_unavailable"); },
  removeItem: () => undefined,
};

function browserStorage(): RegistrationDraftStorage {
  if (typeof window === "undefined") return unavailableStorage;
  try {
    return window.localStorage;
  } catch {
    return unavailableStorage;
  }
}

function createDraftEnvelope(
  session: Pick<FieldSession, "uid">,
  draftId: string,
  initialDraft: RegistrationDraftInitial | undefined,
  idFactory: () => string,
  now: () => string,
): StoredRegistrationDraft {
  const value = createRegistrationDraft(initialDraft, idFactory);
  return {
    ownerUid: session.uid,
    draftId,
    updatedAt: now(),
    value: { ...value, draftId },
  };
}

function emptyUnit(index = 1): UnitDraftState {
  return {
    localId: `unit-${index}`,
    unitLabel: "",
    structure: "",
    floor: "",
    options: [],
    isVacant: true,
  };
}

function numericInput(value: string): number | "" {
  if (value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function distanceMeters(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ERROR_COPY: Record<string, string> = {
  managementNumber: "내부 관리번호를 입력해 주세요.",
  name: "건물명을 입력해 주세요.",
  roadAddress: "도로명주소를 입력해 주세요.",
  unitLabel: "호실명을 입력해 주세요.",
  depositWon: "보증금을 0원 이상 정수로 입력해 주세요.",
  monthlyRentWon: "월세를 0원 이상 정수로 입력해 주세요.",
  maintenanceFeeWon: "관리비를 0원 이상 정수로 입력해 주세요.",
};

export default function BuildingWizard({
  session,
  draftId,
  legacyDraftKey = LEGACY_WIZARD_DRAFT_KEY,
  storage,
  now = defaultNow,
  idFactory = defaultIdFactory,
  initialStep = 0,
  initialDraft,
  currentPosition,
  checkAddress = async (query) => ({
    selection: {
      roadAddress: query.trim(),
      latitude: 37.3422,
      longitude: 127.9202,
    },
    existingBuilding: null,
  }),
  onComplete,
}: BuildingWizardProps) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), STEPS.length - 1));
  const resolvedStorage = storage ?? browserStorage();
  const [resolvedDraftId] = useState(() => {
    if (draftId) return draftId;
    try {
      return readActiveWizardDraftId(resolvedStorage, session.uid) || idFactory();
    } catch {
      return idFactory();
    }
  });
  const [initialLoad] = useState(() => {
    try {
      const prepared = prepareWizardDraft(resolvedStorage, {
        uid: session.uid,
        draftId: resolvedDraftId,
        legacyKey: legacyDraftKey,
        initial: initialDraft,
        idFactory,
        now,
      });
      return {
        envelope: prepared.envelope,
        legacyKeyToRemove: prepared.legacyKeyToRemove,
        incompatibleDraft: false,
        storageLoadFailed: false,
      };
    } catch (error) {
      const incompatibleDraft = error instanceof RegistrationDraftCompatibilityError;
      return {
        envelope: createDraftEnvelope(
          session,
          resolvedDraftId,
          initialDraft,
          idFactory,
          now,
        ),
        legacyKeyToRemove: null,
        incompatibleDraft,
        storageLoadFailed: !incompatibleDraft,
      };
    }
  });
  const [envelope, setEnvelope] = useState<StoredRegistrationDraft>(initialLoad.envelope);
  const draft = envelope.value;
  const incompatibleDraft = initialLoad.incompatibleDraft;
  const [errors, setErrors] = useState<string[]>([]);
  const [completedSave, setCompletedSave] = useState<{
    draft: BuildingWizardDraft;
    status: string;
  } | null>(null);
  const [localSave, setLocalSave] = useState<{
    draft: BuildingWizardDraft;
    status: "로컬 자동저장 완료" | "로컬 자동저장 실패";
  } | null>(null);
  const [addressStatus, setAddressStatus] = useState("");
  const [checkingAddress, setCheckingAddress] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (incompatibleDraft) return;
    let active = true;
    if (initialLoad.storageLoadFailed && envelope === initialLoad.envelope) {
      queueMicrotask(() => {
        if (active) setLocalSave({ draft, status: "로컬 자동저장 실패" });
      });
      return () => {
        active = false;
      };
    }
    let status: "로컬 자동저장 완료" | "로컬 자동저장 실패";
    try {
      if (!draftId) {
        resolvedStorage.setItem(activeWizardDraftKey(session.uid), resolvedDraftId);
      }
      saveWizardDraft(resolvedStorage, envelope, now());
      if (initialLoad.legacyKeyToRemove) {
        resolvedStorage.removeItem(initialLoad.legacyKeyToRemove);
      }
      status = "로컬 자동저장 완료";
    } catch {
      status = "로컬 자동저장 실패";
    }
    queueMicrotask(() => {
      if (active) setLocalSave({ draft, status });
    });
    return () => {
      active = false;
    };
  }, [
    draft,
    draftId,
    envelope,
    incompatibleDraft,
    initialLoad,
    now,
    resolvedDraftId,
    resolvedStorage,
    session.uid,
  ]);

  function updateDraft(
    updater: (current: BuildingWizardDraft) => BuildingWizardDraft,
  ) {
    setEnvelope((current) => ({ ...current, value: updater(current.value) }));
  }

  const saveStatus = completedSave?.draft === draft
    ? completedSave.status
    : localSave?.draft === draft
      ? localSave.status
      : "로컬 저장 준비";

  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const gpsDistance = useMemo(() => {
    if (!currentPosition || typeof draft.building.latitude !== "number" ||
      typeof draft.building.longitude !== "number") return null;
    return Math.round(distanceMeters(currentPosition, {
      latitude: draft.building.latitude,
      longitude: draft.building.longitude,
    }));
  }, [currentPosition, draft.building.latitude, draft.building.longitude]);

  const buildingErrors = validateBuildingDraft({
    managementNumber: draft.building.managementNumber,
    name: draft.building.name,
    roadAddress: draft.building.roadAddress,
    latitude: draft.building.latitude === "" ? undefined : draft.building.latitude,
    longitude: draft.building.longitude === "" ? undefined : draft.building.longitude,
  });
  const contractErrors = validateManagementContractDraft({
    requested: draft.building.managementContractRequested,
    startedOn: draft.building.managementStartedOn,
  });
  const buildingStepErrors = [...buildingErrors, ...contractErrors];
  const buildingStepValid = buildingStepErrors.length === 0 &&
    draft.addressVerified && !draft.duplicateBuilding;

  function updateBuilding<Key extends keyof BuildingDraftState>(
    key: Key,
    value: BuildingDraftState[Key],
  ) {
    if (incompatibleDraft) return;
    updateDraft((current) => ({
      ...current,
      building: { ...current.building, [key]: value },
      ...(key === "roadAddress" ? { addressVerified: false, duplicateBuilding: null } : {}),
    }));
    setErrors((current) => current.filter((field) => field !== key));
    if (key === "roadAddress") setAddressStatus("");
  }

  async function verifyAddress() {
    if (incompatibleDraft) return;
    if (!draft.building.roadAddress.trim()) {
      setErrors((current) => [...new Set([...current, "roadAddress"])]);
      return;
    }
    setCheckingAddress(true);
    try {
      const result = await checkAddress(draft.building.roadAddress.trim());
      updateDraft((current) => ({
        ...current,
        building: {
          ...current.building,
          roadAddress: result.selection.roadAddress,
          jibunAddress: result.selection.jibunAddress || current.building.jibunAddress,
          latitude: result.selection.latitude,
          longitude: result.selection.longitude,
        },
        addressVerified: !result.existingBuilding,
        duplicateBuilding: result.existingBuilding,
      }));
      setAddressStatus(result.existingBuilding
        ? `${result.existingBuilding.name}과 주소가 같습니다.`
        : "새 건물로 등록할 수 있는 주소입니다.");
    } finally {
      setCheckingAddress(false);
    }
  }

  function validateCurrentStep() {
    if (incompatibleDraft) return false;
    if (step === 0) {
      setErrors(buildingStepErrors);
      return buildingStepValid;
    }
    if (step === 1) {
      const listingErrors = validateListingDraft({
        buildingId: draft.building.managementNumber || "building-draft",
        unitLabel: draft.units[0]?.unitLabel,
        depositWon: draft.listing.depositWon === "" ? undefined : draft.listing.depositWon,
        monthlyRentWon: draft.listing.monthlyRentWon === "" ? undefined : draft.listing.monthlyRentWon,
        maintenanceFeeWon: draft.listing.maintenanceFeeWon === ""
          ? undefined
          : draft.listing.maintenanceFeeWon,
      });
      setErrors(listingErrors);
      return listingErrors.length === 0;
    }
    setErrors([]);
    return true;
  }

  function nextStep() {
    if (validateCurrentStep()) setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function updateUnit(index: number, key: keyof UnitDraftState, value: string | number) {
    if (incompatibleDraft) return;
    updateDraft((current) => ({
      ...current,
      units: current.units.map((unit, unitIndex) =>
        unitIndex === index ? { ...unit, [key]: value } : unit),
    }));
    setErrors((current) => current.filter((field) => field !== "unitLabel"));
  }

  function updateListing<Key extends keyof ListingDraftState>(
    key: Key,
    value: ListingDraftState[Key],
  ) {
    if (incompatibleDraft) return;
    updateDraft((current) => ({ ...current, listing: { ...current.listing, [key]: value } }));
    setErrors((current) => current.filter((field) => field !== key));
  }

  async function complete() {
    if (incompatibleDraft) return;
    setSubmitting(true);
    try {
      await onComplete?.(draft);
      setCompletedSave({
        draft,
        status: onComplete ? "서버 저장 요청 완료" : "로컬 초안 저장 완료",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="field-wizard" aria-labelledby="field-wizard-title">
      <header className="field-wizard-header">
        <div>
          <p className="field-eyebrow">BUILDING &amp; VACANCY</p>
          <h1 id="field-wizard-title">새 건물·매물 등록</h1>
          <p>건물 공통정보와 호실별 임대조건을 한 번 입력해 지도·촬영·광고에 사용합니다.</p>
        </div>
        <span className="field-save-status" aria-live="polite"><i />{saveStatus}</span>
      </header>

      {incompatibleDraft && (
        <p className="field-gps-warning" role="alert">
          더 최신 버전에서 작성된 초안이라 현재 화면에서 수정할 수 없습니다.
        </p>
      )}

      <div className="field-wizard-progress" aria-label={`등록 진행률 ${progress}%`}>
        <div><span>{step + 1} / {STEPS.length}</span><strong>{STEPS[step]}</strong><b>{progress}%</b></div>
        <div className="field-wizard-progress-track"><span style={{ width: `${progress}%` }} /></div>
      </div>

      <ol className="field-wizard-steps" aria-label="등록 단계">
        {STEPS.map((title, index) => (
          <li key={title} className={index === step ? "active" : index < step ? "done" : ""}>
            <span>{index < step ? "✓" : index + 1}</span>{title}
          </li>
        ))}
      </ol>

      <div className="field-wizard-card">
        {step === 0 && (
          <fieldset>
            <legend>건물 기본정보</legend>
            <p className="field-form-help">주소 중복 확인을 완료해야 다음 단계로 이동할 수 있습니다.</p>
            <div className="field-form-grid">
              <Field label="내부 관리번호" required error={errors.includes("managementNumber") ? ERROR_COPY.managementNumber : ""}>
                <input id="managementNumber" required value={draft.building.managementNumber} onChange={(event) => updateBuilding("managementNumber", event.target.value)} aria-invalid={errors.includes("managementNumber")} />
              </Field>
              <Field label="건물명" required error={errors.includes("name") ? ERROR_COPY.name : ""}>
                <input id="name" required value={draft.building.name} onChange={(event) => updateBuilding("name", event.target.value)} aria-invalid={errors.includes("name")} />
              </Field>
              <Field wide htmlFor="roadAddress" label="도로명주소" required error={errors.includes("roadAddress") ? ERROR_COPY.roadAddress : ""}>
                <div className="field-address-row">
                  <input id="roadAddress" required value={draft.building.roadAddress} onChange={(event) => updateBuilding("roadAddress", event.target.value)} aria-invalid={errors.includes("roadAddress")} />
                  <button type="button" onClick={verifyAddress} disabled={checkingAddress || incompatibleDraft}>{checkingAddress ? "확인 중" : "주소 중복 확인"}</button>
                </div>
                {addressStatus && <p className={draft.duplicateBuilding ? "field-inline-error" : "field-inline-success"} role="status">{addressStatus}</p>}
                {(errors.includes("latitude") || errors.includes("longitude")) && (
                  <p className="field-inline-error" role="alert">
                    주소 확인으로 지도 위치를 설정해 주세요.
                  </p>
                )}
              </Field>
              <div className="field-form-field wide">
                <Toggle
                  label="BRING 관리계약 건물"
                  checked={draft.building.managementContractRequested}
                  onChange={(checked) => updateBuilding("managementContractRequested", checked)}
                />
                <p className="field-form-help">
                  직원 등록은 관리계약 확인 요청으로 저장되며, 관리자 확인 후 지도에 표시됩니다.
                </p>
              </div>
              {draft.building.managementContractRequested && (
                <Field
                  label="관리 시작일"
                  required
                  error={errors.includes("managementStartedOn")
                    ? "관리 시작일을 입력해 주세요."
                    : ""}
                >
                  <input
                    id="managementStartedOn"
                    type="date"
                    required
                    value={draft.building.managementStartedOn}
                    onChange={(event) => updateBuilding("managementStartedOn", event.target.value)}
                    aria-invalid={errors.includes("managementStartedOn")}
                  />
                </Field>
              )}
              <Field wide label="지번주소"><input id="jibunAddress" value={draft.building.jibunAddress} onChange={(event) => updateBuilding("jibunAddress", event.target.value)} /></Field>
              <Field label="건물 용도"><input id="purpose" value={draft.building.purpose} onChange={(event) => updateBuilding("purpose", event.target.value)} placeholder="다가구주택" /></Field>
              <Field label="준공연도"><input id="completionYear" type="number" value={draft.building.completionYear} onChange={(event) => updateBuilding("completionYear", numericInput(event.target.value))} /></Field>
              <Field label="층수"><input id="floorCount" type="number" value={draft.building.floorCount} onChange={(event) => updateBuilding("floorCount", numericInput(event.target.value))} /></Field>
              <Toggle label="승강기 있음" checked={draft.building.elevator} onChange={(checked) => updateBuilding("elevator", checked)} />
              <Toggle label="주차 가능" checked={draft.building.parkingAvailable} onChange={(checked) => updateBuilding("parkingAvailable", checked)} />
              <Field label="총 주차대수"><input id="parkingSpaces" type="number" value={draft.building.parkingSpaces} onChange={(event) => updateBuilding("parkingSpaces", numericInput(event.target.value))} /></Field>
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <fieldset>
            <legend>호실과 임대조건</legend>
            <p className="field-form-help">한 건물 아래 여러 호실을 추가할 수 있습니다.</p>
            <div className="field-unit-list">
              {draft.units.map((unit, index) => (
                <div className="field-unit-row" key={unit.localId}>
                  <Field label={`호실 ${index + 1}`} required error={index === 0 && errors.includes("unitLabel") ? ERROR_COPY.unitLabel : ""}><input id={`unit-${index + 1}`} required value={unit.unitLabel} onChange={(event) => updateUnit(index, "unitLabel", event.target.value)} /></Field>
                  <Field label="구조"><input id={`structure-${index + 1}`} value={unit.structure} onChange={(event) => updateUnit(index, "structure", event.target.value)} placeholder="원룸 / 투룸" /></Field>
                  <Field label="층"><input id={`floor-${index + 1}`} type="number" value={unit.floor} onChange={(event) => updateUnit(index, "floor", numericInput(event.target.value))} /></Field>
                </div>
              ))}
              <button className="field-add-unit" type="button" disabled={incompatibleDraft} onClick={() => updateDraft((current) => ({ ...current, units: [...current.units, emptyUnit(current.units.length + 1)] }))}><span aria-hidden="true">+ </span>호실 추가</button>
            </div>
            <div className="field-form-grid field-form-divider">
              <MoneyField id="depositWon" label="보증금(원)" value={draft.listing.depositWon} error={errors.includes("depositWon") ? ERROR_COPY.depositWon : ""} onChange={(value) => updateListing("depositWon", value)} />
              <MoneyField id="monthlyRentWon" label="월세(원)" value={draft.listing.monthlyRentWon} error={errors.includes("monthlyRentWon") ? ERROR_COPY.monthlyRentWon : ""} onChange={(value) => updateListing("monthlyRentWon", value)} />
              <MoneyField id="maintenanceFeeWon" label="관리비(원)" value={draft.listing.maintenanceFeeWon} error={errors.includes("maintenanceFeeWon") ? ERROR_COPY.maintenanceFeeWon : ""} onChange={(value) => updateListing("maintenanceFeeWon", value)} />
              <Field label="관리비 포함항목"><input id="maintenanceFeeItems" value={draft.listing.maintenanceFeeItems} onChange={(event) => updateListing("maintenanceFeeItems", event.target.value)} placeholder="수도, 인터넷" /></Field>
              <Field label="입주 가능일"><input id="availableFrom" type="date" value={draft.listing.availableFrom} onChange={(event) => updateListing("availableFrom", event.target.value)} /></Field>
              <Field label="계약기간(개월)"><input id="contractTermMonths" type="number" value={draft.listing.contractTermMonths} onChange={(event) => updateListing("contractTermMonths", numericInput(event.target.value))} /></Field>
              <Field label="주차 조건"><input id="parkingDescription" value={draft.listing.parkingDescription} onChange={(event) => updateListing("parkingDescription", event.target.value)} /></Field>
              <Field label="반려동물 조건"><input id="petPolicy" value={draft.listing.petPolicy} onChange={(event) => updateListing("petPolicy", event.target.value)} /></Field>
            </div>
          </fieldset>
        )}

        {step === 2 && <SimpleStep title="상태점검"><Field wide label="공실 사유"><input id="vacancyReason" value={draft.listing.vacancyReason} onChange={(event) => updateListing("vacancyReason", event.target.value)} /></Field><Field label="공실 시작일"><input id="vacantSince" type="date" value={draft.listing.vacantSince} onChange={(event) => updateListing("vacantSince", event.target.value)} /></Field><Field wide label="호실 상태 메모"><textarea id="conditionNote" value={draft.listing.conditionNote} onChange={(event) => updateListing("conditionNote", event.target.value)} /></Field></SimpleStep>}
        {step === 3 && <OptionsStep selected={draft.listing.options} onChange={(options) => updateListing("options", options)} />}
        {step === 4 && <SimpleStep title="촬영 준비"><div className="field-step-notice"><b>다음 기능에서 촬영 체크리스트가 연결됩니다.</b><p>외관, 진입부, 주차, 공동현관, 호실, 주방, 욕실, 옵션, 설비, 세로영상 순서로 촬영합니다.</p></div></SimpleStep>}
        {step === 5 && <SimpleStep title="입지와 GPS 확인">{gpsDistance !== null && gpsDistance > 150 && <div className="field-gps-warning" role="alert">현재 위치와 검색 주소가 {gpsDistance}m 떨어져 있습니다. 검색 주소를 유지하거나 지도 핀을 보정해 주세요.</div>}<Field wide label="입지 설명"><textarea id="locationNote" value={draft.listing.locationNote} onChange={(event) => updateListing("locationNote", event.target.value)} placeholder="편의점, 버스정류장, 학교, 생활권 정보를 기록하세요." /></Field></SimpleStep>}
        {step === 6 && <ReviewStep draft={draft} />}
      </div>

      <footer className="field-wizard-actions">
        <button type="button" className="field-wizard-back" onClick={() => setStep((current) => Math.max(current - 1, 0))} disabled={incompatibleDraft || step === 0}>이전</button>
        {step === 0 && <button type="button" className="field-wizard-check" onClick={validateCurrentStep} disabled={incompatibleDraft}>입력 확인</button>}
        {step < STEPS.length - 1 ? (
          <button type="button" className="field-wizard-next" onClick={nextStep} disabled={incompatibleDraft || (step === 0 && !buildingStepValid)}>다음 단계</button>
        ) : (
          <button type="button" className="field-wizard-next" onClick={complete} disabled={incompatibleDraft || submitting}>{submitting ? "저장 중" : "등록 내용 저장"}</button>
        )}
      </footer>
    </section>
  );
}

function Field({ label, required, error, wide, htmlFor, children }: { label: string; required?: boolean; error?: string; wide?: boolean; htmlFor?: string; children: ReactNode }) {
  const id = htmlFor || findInputId(children);
  return <div className={`field-form-field ${wide ? "wide" : ""}`}><label className={required ? "required" : undefined} htmlFor={id}>{label}</label>{children}{error && <p id={`${id}-error`} className="field-inline-error" role="alert">{error}</p>}</div>;
}

function findInputId(children: ReactNode): string {
  if (typeof children === "object" && children && "props" in children) {
    const id = (children as ReactElement<{ id?: string }>).props.id;
    if (id) return id;
  }
  return "field-input";
}

function MoneyField({ id, label, value, error, onChange }: { id: string; label: string; value: number | ""; error?: string; onChange: (value: number | "") => void }) {
  return <Field label={label} required error={error}><input id={id} required type="number" min="0" step="1" value={value} onChange={(event) => onChange(numericInput(event.target.value))} aria-invalid={Boolean(error)} /></Field>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="field-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function SimpleStep({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset><legend>{title}</legend><div className="field-form-grid">{children}</div></fieldset>;
}

function OptionsStep({ selected, onChange }: { selected: string[]; onChange: (options: string[]) => void }) {
  const options = ["에어컨", "냉장고", "세탁기", "인덕션", "전자레인지", "침대", "옷장", "신발장"];
  return <fieldset><legend>옵션·비품</legend><div className="field-option-grid">{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} /><span>{option}</span></label>)}</div></fieldset>;
}

function ReviewStep({ draft }: { draft: BuildingWizardDraft }) {
  return <fieldset><legend>등록 전 검토</legend><div className="field-review-grid"><article><span>건물</span><strong>{draft.building.name || "미입력"}</strong><p>{draft.building.roadAddress || "주소 미입력"}</p></article><article><span>호실</span><strong>{draft.units.map((unit) => unit.unitLabel).filter(Boolean).join(", ") || "미입력"}</strong><p>총 {draft.units.length}개 호실</p></article><article><span>임대조건</span><strong>보증금 {draft.listing.depositWon === "" ? "-" : draft.listing.depositWon.toLocaleString()}원</strong><p>월세 {draft.listing.monthlyRentWon === "" ? "-" : draft.listing.monthlyRentWon.toLocaleString()}원 · 관리비 {draft.listing.maintenanceFeeWon === "" ? "-" : draft.listing.maintenanceFeeWon.toLocaleString()}원</p></article></div></fieldset>;
}
