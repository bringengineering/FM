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

  const STATUS_COLORS = Object.freeze({
    lead: "#8b5cf6",
    vacant: "#f79009",
    managed: "#12b76a",
    archived: "#98a2b3",
  });

  function values(collection) {
    if (Array.isArray(collection)) return collection.filter(Boolean);
    if (!collection || typeof collection !== "object") return [];
    return Object.entries(collection).map(([id, item]) => ({ id, ...(item || {}) }));
  }

  function validCoordinate(latitude, longitude) {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  function propertyMarkerColor(status) {
    return STATUS_COLORS[status] || STATUS_COLORS.managed;
  }

  function wonLabel(amount) {
    if (!Number.isInteger(amount) || amount < 0) return "확인 필요";
    if (amount === 0) return "0원";
    if (amount % 100_000_000 === 0) return `${amount / 100_000_000}억`;
    if (amount % 10_000 === 0) return `${amount / 10_000}만`;
    return `${amount.toLocaleString("ko-KR")}원`;
  }

  function listingIsActive(listing) {
    return listing.status !== "closed" && listing.status !== "archived";
  }

  function markerStatus(building, listings) {
    if (building.archivedAt || building.status === "archived") return "archived";
    if (building.status === "lead") return "lead";
    if (listings.some(listingIsActive)) return "vacant";
    return "managed";
  }

  function approvedRentSummary(listings) {
    const approved = listings.find(
      (listing) => listing.advertisingApproved === true && listingIsActive(listing),
    );
    if (!approved) return "광고 승인 임대조건 없음";
    const fee = Number.isInteger(approved.maintenanceFeeWon)
      ? ` · 관리비 ${wonLabel(approved.maintenanceFeeWon)}`
      : "";
    return `보증금 ${wonLabel(approved.depositWon)} · 월세 ${wonLabel(approved.monthlyRentWon)}${fee}`;
  }

  function parkingLabel(parking) {
    if (!parking || parking.available !== true) return "주차 불가 또는 확인 필요";
    return Number.isInteger(parking.totalSpaces)
      ? `주차 가능 · 총 ${parking.totalSpaces}대`
      : "주차 가능";
  }

  function toPropertyMarkers(source) {
    const buildings = values(source && source.buildings);
    const listings = values(source && source.listings);
    const media = values(source && source.media);

    return buildings
      .filter((building) => validCoordinate(building.latitude, building.longitude))
      .map((building) => {
        const buildingListings = listings.filter(
          (listing) => listing.buildingId === building.id,
        );
        const completedMedia = media.filter(
          (item) =>
            item.buildingId === building.id &&
            (item.uploadState === "firebaseComplete" || item.uploadState === "complete"),
        );
        const status = markerStatus(building, buildingListings);

        return {
          id: String(building.id),
          name: String(building.name || building.managementNumber || "이름 없는 건물"),
          managementNumber: String(building.managementNumber || ""),
          roadAddress: String(building.roadAddress || ""),
          latitude: Number(building.latitude),
          longitude: Number(building.longitude),
          status,
          color: propertyMarkerColor(status),
          vacancyCount: buildingListings.filter(listingIsActive).length,
          approvedRentSummary: approvedRentSummary(buildingListings),
          parking: parkingLabel(building.parking),
          captureStatus: completedMedia.length
            ? `촬영 자료 ${completedMedia.length}개`
            : "촬영 자료 없음",
        };
      });
  }

  function safePropertyPopupModel(marker) {
    return {
      id: String(marker.id || ""),
      name: String(marker.name || "이름 없는 건물"),
      managementNumber: String(marker.managementNumber || ""),
      roadAddress: String(marker.roadAddress || ""),
      status: String(marker.status || "managed"),
      vacancyCount: Number.isInteger(marker.vacancyCount) ? marker.vacancyCount : 0,
      approvedRentSummary: String(marker.approvedRentSummary || "광고 승인 임대조건 없음"),
      parking: String(marker.parking || "주차 확인 필요"),
      captureStatus: String(marker.captureStatus || "촬영 자료 없음"),
    };
  }

  function filterMapItems(layers, options) {
    const settings = options || {};
    return {
      vendors: settings.showVendors === false ? [] : values(layers && layers.vendors),
      properties:
        settings.showProperties === false ? [] : values(layers && layers.properties),
    };
  }

  return {
    filterMapItems,
    propertyMarkerColor,
    safePropertyPopupModel,
    toPropertyMarkers,
  };
});
