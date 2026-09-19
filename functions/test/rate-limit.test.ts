import { describe, expect, it, vi } from "vitest";

import {
  consumeRateLimit,
  createInMemoryRateLimiter,
} from "../src/security/rate-limit.js";

describe("field media rate limiting", () => {
  it("allows 60 calls per UID/session in ten minutes and rejects the 61st", async () => {
    const limiter = createInMemoryRateLimiter({
      limit: 60,
      windowMs: 600_000,
      now: () => 1_000,
    });
    for (let index = 0; index < 60; index += 1) {
      await limiter.consume("u1", "s1");
    }
    await expect(limiter.consume("u1", "s1"))
      .rejects.toThrow("field_rate_limit_exceeded");
    await expect(limiter.consume("u2", "s1")).resolves.toBeUndefined();
    await expect(limiter.consume("u1", "s2")).resolves.toBeUndefined();
  });

  it("resets at the exact window boundary and after a backward clock jump", async () => {
    let now = 1_000;
    const limiter = createInMemoryRateLimiter({
      limit: 1,
      windowMs: 100,
      now: () => now,
    });
    await limiter.consume("u1", "s1");
    await expect(limiter.consume("u1", "s1"))
      .rejects.toThrow("field_rate_limit_exceeded");
    now = 1_100;
    await expect(limiter.consume("u1", "s1")).resolves.toBeUndefined();
    now = 900;
    await expect(limiter.consume("u1", "s1")).resolves.toBeUndefined();
  });

  it("uses one RTDB transaction and aborts without mutation at the limit", async () => {
    let current: unknown = { windowStartedAt: 1_000, count: 2 };
    const transaction = vi.fn(async (update: (value: unknown) => unknown) => {
      const next = update(current);
      const committed = next !== undefined;
      if (committed) current = next;
      return { committed };
    });

    await expect(consumeRateLimit({ transaction }, {
      limit: 2,
      windowMs: 600_000,
      nowMs: 2_000,
    })).rejects.toThrow("field_rate_limit_exceeded");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(current).toEqual({ windowStartedAt: 1_000, count: 2 });
  });

  it("normalizes malformed state inside the transaction", async () => {
    let current: unknown = { windowStartedAt: "bad", count: 999 };
    const transaction = vi.fn(async (update: (value: unknown) => unknown) => {
      current = update(current);
      return { committed: true };
    });
    await consumeRateLimit({ transaction }, {
      limit: 2,
      windowMs: 600_000,
      nowMs: 5_000,
    });
    expect(current).toEqual({ windowStartedAt: 5_000, count: 1 });
  });
});
