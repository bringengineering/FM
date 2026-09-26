export interface RateLimitTransactionResult {
  committed: boolean;
}

export interface RateLimitReference {
  transaction(
    update: (current: unknown) => unknown,
    onComplete?: unknown,
    applyLocally?: boolean,
  ): Promise<RateLimitTransactionResult>;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  nowMs: number;
}

interface RateLimitState {
  windowStartedAt: number;
  count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validOptions(options: RateLimitOptions): boolean {
  return isRecord(options)
    && Number.isSafeInteger(options.limit)
    && options.limit > 0
    && Number.isSafeInteger(options.windowMs)
    && options.windowMs > 0
    && Number.isSafeInteger(options.nowMs)
    && options.nowMs >= 0;
}

function nextState(
  current: unknown,
  options: RateLimitOptions,
): RateLimitState | undefined {
  if (
    !isRecord(current)
    || typeof current.windowStartedAt !== "number"
    || !Number.isSafeInteger(current.windowStartedAt)
    || current.windowStartedAt < 0
    || options.nowMs < current.windowStartedAt
    || options.nowMs - current.windowStartedAt >= options.windowMs
  ) {
    return { windowStartedAt: options.nowMs, count: 1 };
  }
  const count = typeof current.count === "number"
      && Number.isSafeInteger(current.count)
      && current.count >= 0
    ? current.count
    : 0;
  if (count >= options.limit) return undefined;
  return { windowStartedAt: current.windowStartedAt, count: count + 1 };
}

export async function consumeRateLimit(
  reference: RateLimitReference,
  options: RateLimitOptions,
): Promise<void> {
  if (!reference || typeof reference.transaction !== "function" || !validOptions(options)) {
    throw new Error("field_rate_limit_invalid");
  }
  const result = await reference.transaction(
    (current) => nextState(current, options),
    undefined,
    false,
  );
  if (result.committed !== true) {
    throw new Error("field_rate_limit_exceeded");
  }
}

export function createInMemoryRateLimiter(options: {
  limit: number;
  windowMs: number;
  now(): number;
}): { consume(uid: string, sessionId: string): Promise<void> } {
  const states = new Map<string, RateLimitState>();
  return {
    async consume(uid, sessionId) {
      const nowMs = options.now();
      const rateOptions = {
        limit: options.limit,
        windowMs: options.windowMs,
        nowMs,
      };
      if (
        typeof uid !== "string"
        || uid.length === 0
        || typeof sessionId !== "string"
        || sessionId.length === 0
        || !validOptions(rateOptions)
      ) {
        throw new Error("field_rate_limit_invalid");
      }
      const key = `${uid}\0${sessionId}`;
      const next = nextState(states.get(key), rateOptions);
      if (!next) throw new Error("field_rate_limit_exceeded");
      states.set(key, next);
    },
  };
}
