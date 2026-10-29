import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  adPackageSourceFingerprint,
  buildAdPackageArtifacts,
  canonicalUtf8Text,
  storageBase64Md5ToDriveHex,
} from "../src/packages/ad-package-artifacts.js";
import { base64Md5ToHex } from "../src/drive/google-drive-adapter.js";
import {
  BUILDING_ID,
  DRIVE_MD5_HEX,
  MEDIA_IDS,
  PHOTO_1,
  PHOTO_2,
  SESSION_ID,
  STORAGE_MD5_BASE64,
  VIDEO_1,
  makeFrozenPackage as frozenPackage,
  removeManifestMedia,
} from "./helpers/ad-package-fixture.js";

describe("ad package frozen artifacts", () => {
  it("canonicalizes real Storage base64 MD5 to the Drive lowercase hex checksum", () => {
    expect(storageBase64Md5ToDriveHex(STORAGE_MD5_BASE64)).toBe(DRIVE_MD5_HEX);
    expect(storageBase64Md5ToDriveHex(STORAGE_MD5_BASE64))
      .toBe(base64Md5ToHex(STORAGE_MD5_BASE64));
    for (const malformed of [
      "not-base64",
      "YWJjZA==",
      "1B2M2Y8AsgTpgAmY7PhCfg=",
    ]) {
      expect(() => storageBase64Md5ToDriveHex(malformed))
        .toThrow("ad_package_media_checksum_invalid");
    }
  });

  it("computes a canonical SHA-256 fingerprint independent of object key order", () => {
    const source = frozenPackage();
    const reordered = {
      secret: "must-not-affect-frozen-source",
      ...Object.fromEntries(Object.entries(source).reverse()),
    };

    expect(adPackageSourceFingerprint(reordered)).toBe(source.sourceFingerprint);
    expect(source.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(adPackageSourceFingerprint({ ...source, version: 4 }))
      .not.toBe(source.sourceFingerprint);
  });

  it("normalizes text to NFC CRLF with exactly one final newline and no BOM", () => {
    const bytes = canonicalUtf8Text("가\n나\r\n\r\n");
    expect(Buffer.from(bytes).subarray(0, 3)).not.toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    expect(Buffer.from(bytes).toString("utf8")).toBe("가\r\n나\r\n");
  });

  it("builds deterministic 01~05 artifacts with exact representative order", () => {
    const artifacts = buildAdPackageArtifacts(frozenPackage());

    expect(artifacts.packageFolderName).toBe("광고패키지_v003");
    expect(artifacts.representativePhotos.map((item) => item.name)).toEqual([
      `001_${PHOTO_2}.png`,
      `002_${PHOTO_1}.jpg`,
    ]);
    expect(artifacts.originalPhotos).toHaveLength(9);
    expect(artifacts.originalPhotos[0].name).toBe(`001_${PHOTO_1}.jpg`);
    expect(artifacts.originalPhotos[3].name).toBe(`004_${PHOTO_2}.png`);
    expect(artifacts.originalPhotos.every(
      (item) => item.md5Checksum === DRIVE_MD5_HEX,
    )).toBe(true);
    expect(artifacts.verticalVideos.map((item) => item.name)).toEqual([
      `001_${VIDEO_1}.mp4`,
    ]);
    expect(Buffer.from(artifacts.daangn.bytes).toString("utf8")).toBe(
      "브링빌 301호\r\n보증금 500만원\r\n월세 45만원\r\n",
    );
  });

  it("renders Naver fields in a fixed Korean order without arbitrary secret keys", () => {
    const source = frozenPackage();
    source.naverListingFields.ownerPhone = "010-SECRET";
    source.naverListingFields.commonDoorPassword = "DOOR-SECRET";
    const text = Buffer.from(
      buildAdPackageArtifacts(source).naver.bytes,
    ).toString("utf8");

    expect(text.split("\r\n").slice(0, 8)).toEqual([
      "건물명: 브링빌",
      "도로명주소: 강원특별자치도 원주시 브링로 1",
      "호실: 301",
      "보증금(원): 5000000",
      "월세(원): 450000",
      "관리비(원): 50000",
      "관리비 포함항목: 수도, 공용전기",
      "입주가능일: 2026-08-11",
    ]);
    expect(text).not.toMatch(/ownerPhone|commonDoorPassword|010-SECRET|DOOR-SECRET/u);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.endsWith("\r\n\r\n")).toBe(false);
  });

  it("rejects noncontiguous orders, missing hashes, wrong representative media, and unbounded text", () => {
    const wrongOrder = frozenPackage();
    wrongOrder.mediaManifest[2].advertisingOrder = 9;
    expect(() => buildAdPackageArtifacts(wrongOrder))
      .toThrow("ad_package_artifact_source_invalid");

    const missingHash = frozenPackage();
    delete missingHash.mediaManifest[0].driveMd5Checksum;
    expect(() => buildAdPackageArtifacts(missingHash))
      .toThrow("ad_package_artifact_source_invalid");

    const videoRepresentative = frozenPackage();
    videoRepresentative.representativeMediaIds = [VIDEO_1];
    expect(() => buildAdPackageArtifacts(videoRepresentative))
      .toThrow("ad_package_artifact_source_invalid");

    const wrongZone = frozenPackage();
    wrongZone.mediaManifest[9].zone = "exterior";
    expect(() => adPackageSourceFingerprint(wrongZone))
      .toThrow("ad_package_artifact_source_invalid");

    const injectedField = frozenPackage();
    injectedField.naverListingFields.buildingName =
      "브링빌\n공동현관 비밀번호: SECRET";
    expect(() => adPackageSourceFingerprint(injectedField))
      .toThrow("ad_package_artifact_source_invalid");

    const tooLong = frozenPackage();
    tooLong.daangnDescription = "가".repeat(20_001);
    expect(() => buildAdPackageArtifacts(tooLong))
      .toThrow("ad_package_artifact_source_invalid");
  });

  it("rejects missing required zones and insufficient room-overview photos", () => {
    const missingBoiler = frozenPackage();
    removeManifestMedia(missingBoiler, MEDIA_IDS[8]);
    expect(() => adPackageSourceFingerprint(missingBoiler))
      .toThrow("ad_package_artifact_source_invalid");

    const oneOverview = frozenPackage();
    removeManifestMedia(oneOverview, MEDIA_IDS[4]);
    expect(() => adPackageSourceFingerprint(oneOverview))
      .toThrow("ad_package_artifact_source_invalid");
  });

  it("rejects cross-building media, mixed sessions, and invalid vertical quality", () => {
    const crossBuilding = frozenPackage();
    crossBuilding.mediaManifest[0].buildingId = "building-2";
    crossBuilding.mediaManifest[0].storagePath =
      `field-media-finalized/building-2/${PHOTO_1}.jpg`;
    expect(() => adPackageSourceFingerprint(crossBuilding))
      .toThrow("ad_package_artifact_source_invalid");

    const mixedSession = frozenPackage();
    mixedSession.mediaManifest[0].captureSessionId =
      "44444444-4444-4444-8444-444444444444";
    expect(() => adPackageSourceFingerprint(mixedSession))
      .toThrow("ad_package_artifact_source_invalid");

    const invalidVideo = frozenPackage();
    invalidVideo.mediaManifest[9].captureQualityState = "warning";
    expect(() => adPackageSourceFingerprint(invalidVideo))
      .toThrow("ad_package_artifact_source_invalid");

    const extraWarningVideo = frozenPackage();
    const warningVideoId = "55555555-5555-4555-8555-555555555555";
    extraWarningVideo.mediaManifest.push({
      ...extraWarningVideo.mediaManifest[9],
      id: warningVideoId,
      storagePath: `field-media-finalized/${BUILDING_ID}/${warningVideoId}.mp4`,
      objectGeneration: "1011",
      captureQualityState: "warning",
      advertisingOrder: 11,
    });
    extraWarningVideo.allApprovedMediaIds.push(warningVideoId);
    expect(() => adPackageSourceFingerprint(extraWarningVideo))
      .toThrow("ad_package_artifact_source_invalid");

    const upperChecksum = frozenPackage();
    upperChecksum.mediaManifest[0].driveMd5Checksum = DRIVE_MD5_HEX.toUpperCase();
    expect(() => adPackageSourceFingerprint(upperChecksum))
      .toThrow("ad_package_artifact_source_invalid");

    expect(frozenPackage()).toMatchObject({
      buildingId: BUILDING_ID,
      captureSessionId: SESSION_ID,
    });
  });
});
