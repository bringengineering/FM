import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLEANING_ORDER_STATUSES } from "../src/cleaning-orders/contracts.js";

const ontology = JSON.parse(readFileSync(resolve("../docs/ontology/bring-service-operations-v1.json"), "utf8"));

describe("BRING service operations ontology contract", () => {
  it("references existing CRM identities instead of copying customer and building rows", () => {
    expect(ontology.schemaVersion).toBe(1);
    expect(ontology.idPolicy.customer).toMatchObject({ source: "crmCompany/data/customers", copyEntity: false });
    expect(ontology.idPolicy.building).toMatchObject({ source: "crmCompany/data/buildings", copyEntity: false });
    expect(ontology.entities.CleaningOrder.id).toBe("crmCompany/cleaningOrders/{uuid}");
  });

  it("matches the implemented order statuses and uses only declared relationship endpoints", () => {
    expect(ontology.entities.CleaningOrder.statuses).toEqual(CLEANING_ORDER_STATUSES);
    for (const relationship of ontology.relationships) {
      expect(ontology.entities).toHaveProperty(relationship.from);
      expect(ontology.entities).toHaveProperty(relationship.to);
    }
  });

  it("maps the Korean workflow terms in the approved design to canonical status IDs", () => {
    expect(ontology.workflowTermMappings).toEqual(expect.arrayContaining([
      { term: "확인중", canonicalStatus: "reviewing" },
      { term: "작업대기", canonicalStatus: "scheduled" },
      { term: "작업중", canonicalStatus: "in_progress" },
      { term: "검수대기", canonicalStatus: "review_pending" },
      { term: "보완요청", canonicalStatus: "revision_requested" },
    ]));
    for (const mapping of ontology.workflowTermMappings) {
      expect(CLEANING_ORDER_STATUSES).toContain(mapping.canonicalStatus);
      expect(mapping.term.trim()).not.toBe("");
    }
  });

  it("labels sensitive fields and does not describe n8n as a source of truth", () => {
    expect(ontology.entities.CleaningOrder.sensitivity).toBe("internal-sensitive");
    expect(ontology.entities.Evidence.sensitivity).toBe("restricted");
    expect(ontology.automation.n8n.sourceOfTruth).toBe(false);
    expect(ontology.automation.n8n.canMutateCanonicalRecords).toBe(false);
  });
});
