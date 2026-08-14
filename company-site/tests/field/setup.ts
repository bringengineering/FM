import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);
const originalNavigatorStorage = Object.getOwnPropertyDescriptor(
  navigator,
  "storage",
);

let objectUrlSequence = 0;

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
  objectUrlSequence = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => `blob:test-${++objectUrlSequence}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      estimate: vi.fn(async () => ({ usage: 0, quota: 1_000_000_000 })),
      persist: vi.fn(async () => true),
    },
  });
});

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
  restoreProperty(URL, "createObjectURL", originalCreateObjectUrl);
  restoreProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  restoreProperty(navigator, "storage", originalNavigatorStorage);
});
