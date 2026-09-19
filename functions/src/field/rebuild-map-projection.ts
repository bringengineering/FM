import { Buffer } from "node:buffer";

import type { FieldMapProjection } from "./contracts.js";
import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionListing,
  type ProjectionMedia,
} from "./map-projection.js";

const BUILDING_ID_BYTES = 128;

export interface RebuildMapProjectionDependencies {
  getBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  getListings(buildingId: string): Promise<ProjectionListing[]>;
  getMedia(buildingId: string): Promise<ProjectionMedia[]>;
  setProjection(
    buildingId: string,
    projection: FieldMapProjection | null,
  ): Promise<void>;
  now(): string;
}

function isPathSafeBuildingId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Buffer.byteLength(value, "utf8") <= BUILDING_ID_BYTES &&
    !/[\u0000-\u001f\u007f.#$\[\]\/]/u.test(value)
  );
}

export async function rebuildMapProjectionForBuilding(
  buildingId: string,
  dependencies: RebuildMapProjectionDependencies,
): Promise<void> {
  if (!isPathSafeBuildingId(buildingId)) {
    throw new Error("field_projection_building_id_invalid");
  }

  const [storedBuilding, listings, media] = await Promise.all([
    dependencies.getBuilding(buildingId),
    dependencies.getListings(buildingId),
    dependencies.getMedia(buildingId),
  ]);
  const building = storedBuilding?.id === buildingId ? storedBuilding : null;
  const projection = buildMapProjection({
    building,
    listings,
    media,
    updatedAt: dependencies.now(),
  });

  await dependencies.setProjection(buildingId, projection);
}
