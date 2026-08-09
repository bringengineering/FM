(function attachFieldMapModel(root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = model;
  }
  if (root) {
    root.BRING_FIELD_MAP_MODEL = model;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createFieldMapModel() {
  "use strict";

  const MAP_MODES = Object.freeze(["vendors", "managed"]);
  const MARKER_STATUSES = Object.freeze(["vacant", "managed"]);
  const CAPTURE_STATUSES = Object.freeze(["notStarted", "inProgress", "complete"]);
  const STATUS_COLORS = Object.freeze({
    vacant: "#f79009",
    managed: "#12b76a",
  });

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function collectionValues(collection) {
    if (Array.isArray(collection)) return collection.filter(Boolean);
    if (!isRecord(collection)) return [];
    return Object.values(collection).filter(Boolean);
  }

  function isOneOf(value, allowedValues) {
    return allowedValues.includes(value);
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function isValidCoordinate(value, minimum, maximum) {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= minimum &&
      value <= maximum
    );
  }

  function isValidVacancyCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isValidProjection(value) {
    return (
      isRecord(value) &&
      isNonEmptyString(value.buildingId) &&
      isNonEmptyString(value.name) &&
      isNonEmptyString(value.roadAddress) &&
      isValidCoordinate(value.latitude, -90, 90) &&
      isValidCoordinate(value.longitude, -180, 180) &&
      isOneOf(value.markerStatus, MARKER_STATUSES) &&
      isValidVacancyCount(value.vacancyCount) &&
      isNonEmptyString(value.approvedRentSummary) &&
      isNonEmptyString(value.parkingSummary) &&
      isOneOf(value.captureStatus, CAPTURE_STATUSES) &&
      isNonEmptyString(value.updatedAt)
    );
  }

  function copyProjection(projection) {
    return {
      buildingId: projection.buildingId,
      name: projection.name,
      roadAddress: projection.roadAddress,
      latitude: projection.latitude,
      longitude: projection.longitude,
      markerStatus: projection.markerStatus,
      vacancyCount: projection.vacancyCount,
      approvedRentSummary: projection.approvedRentSummary,
      parkingSummary: projection.parkingSummary,
      captureStatus: projection.captureStatus,
      updatedAt: projection.updatedAt,
    };
  }

  function resolveMapMode(options) {
    const settings = isRecord(options) ? options : {};
    if (isOneOf(settings.requestedMode, MAP_MODES)) return settings.requestedMode;
    if (isOneOf(settings.storedMode, MAP_MODES)) return settings.storedMode;
    return settings.embedded === true ? "managed" : "vendors";
  }

  function filterMapItems(layers, mode) {
    const source = isRecord(layers) ? layers : {};
    const vendors = collectionValues(source.vendors);
    const managedBuildings = collectionValues(source.managedBuildings);

    if (mode === "managed") {
      return { vendors: [], managedBuildings };
    }

    return { vendors, managedBuildings: [] };
  }

  function toManagedBuildingMarkers(projections) {
    return collectionValues(projections)
      .filter(isValidProjection)
      .map(copyProjection);
  }

  function filterManagedBuildings(records, filters) {
    const settings = isRecord(filters) ? filters : {};
    const query =
      typeof settings.query === "string" ? settings.query.trim().toLowerCase() : "";
    const vacancy =
      settings.vacancy === "hasVacancy" || settings.vacancy === "full"
        ? settings.vacancy
        : "all";
    const capture = isOneOf(settings.capture, CAPTURE_STATUSES)
      ? settings.capture
      : "all";

    return toManagedBuildingMarkers(records).filter((record) => {
      const matchesQuery =
        query.length === 0 ||
        record.name.toLowerCase().includes(query) ||
        record.roadAddress.toLowerCase().includes(query);
      const matchesVacancy =
        vacancy === "all" ||
        (vacancy === "hasVacancy" && record.vacancyCount > 0) ||
        (vacancy === "full" && record.vacancyCount === 0);
      const matchesCapture = capture === "all" || record.captureStatus === capture;

      return matchesQuery && matchesVacancy && matchesCapture;
    });
  }

  function propertyMarkerColor(markerStatus) {
    return markerStatus === "vacant" ? STATUS_COLORS.vacant : STATUS_COLORS.managed;
  }

  function safeString(value, fallback) {
    return isNonEmptyString(value) ? value : fallback;
  }

  function safePropertyPopupModel(marker) {
    const source = isRecord(marker) ? marker : {};
    return {
      name: safeString(source.name, "이름 없는 건물"),
      roadAddress: safeString(source.roadAddress, "주소 확인 필요"),
      vacancyCount: isValidVacancyCount(source.vacancyCount) ? source.vacancyCount : 0,
      approvedRentSummary: safeString(
        source.approvedRentSummary,
        "광고 승인 임대조건 없음",
      ),
      parkingSummary: safeString(source.parkingSummary, "주차 확인 필요"),
      captureStatus: isOneOf(source.captureStatus, CAPTURE_STATUSES)
        ? source.captureStatus
        : "notStarted",
    };
  }

  return {
    filterManagedBuildings,
    filterMapItems,
    propertyMarkerColor,
    resolveMapMode,
    safePropertyPopupModel,
    toManagedBuildingMarkers,
  };
});
