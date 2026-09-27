import { describe, expect, it } from "vitest";
import {
  decideCleaningOrderTransition,
  normalizeCleaningOrderInput,
} from "../src/cleaning-orders/core.js";

describe("decideCleaningOrderTransition", () => {
  it("allows a received request to move into review", () => {
    expect(decideCleaningOrderTransition("received", "reviewing", "member")).toEqual({ ok: true });
  });

  it("allows a member to submit work for review but not approve its completion", () => {
    expect(decideCleaningOrderTransition("in_progress", "review_pending", "member")).toEqual({ ok: true });
    expect(decideCleaningOrderTransition("review_pending", "completed", "member")).toEqual({
      ok: false,
      error: "cleaning_order_transition_forbidden",
    });
    expect(decideCleaningOrderTransition("review_pending", "completed", "admin")).toEqual({ ok: true });
  });

  it("rejects viewer changes and transitions out of terminal states", () => {
    expect(decideCleaningOrderTransition("received", "reviewing", "viewer")).toMatchObject({
      ok: false,
      error: "cleaning_order_transition_forbidden",
    });
    expect(decideCleaningOrderTransition("completed", "in_progress", "admin")).toMatchObject({
      ok: false,
      error: "cleaning_order_transition_forbidden",
    });
  });
});

describe("normalizeCleaningOrderInput", () => {
  const validInput = {
    requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
    customerId: "customer_01",
    buildingId: "building_01",
    serviceType: "move_in_cleaning",
    title: "  201호 입주청소  ",
    desiredDate: "2026-10-02",
    description: "  입주 전 전체 청소  ",
  };

  it("trims text and retains canonical customer and building IDs", () => {
    expect(normalizeCleaningOrderInput(validInput)).toEqual({
      ok: true,
      value: {
        requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
        customerId: "customer_01",
        buildingId: "building_01",
        serviceType: "move_in_cleaning",
        title: "201호 입주청소",
        desiredDate: "2026-10-02",
        description: "입주 전 전체 청소",
      },
    });
  });

  it("rejects missing identity, invalid date, and overlong free text", () => {
    expect(normalizeCleaningOrderInput({ ...validInput, requestId: "" })).toMatchObject({
      ok: false,
      error: "invalid_cleaning_order_input",
    });
    expect(normalizeCleaningOrderInput({ ...validInput, desiredDate: "10/02/2026" })).toMatchObject({
      ok: false,
      error: "invalid_cleaning_order_input",
    });
    expect(normalizeCleaningOrderInput({ ...validInput, description: "x".repeat(2001) })).toMatchObject({
      ok: false,
      error: "invalid_cleaning_order_input",
    });
  });

  it("rejects client supplied status, generated ID, or audit fields", () => {
    expect(normalizeCleaningOrderInput({ ...validInput, status: "completed" })).toMatchObject({
      ok: false,
      error: "invalid_cleaning_order_input",
    });
    expect(normalizeCleaningOrderInput({ ...validInput, id: "chosen_by_client" })).toMatchObject({
      ok: false,
      error: "invalid_cleaning_order_input",
    });
    expect(normalizeCleaningOrderInput({ ...validInput, createdBy: "admin" })).toMatchObject({
      ok: false,
      error: "invalid_cleaning_order_input",
    });
  });
});
