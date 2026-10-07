import { describe, expect, it } from "vitest";

import { bindFieldVisualViewport } from "../../app/field/lib/visual-viewport";

type MutableVisualViewport = EventTarget & { height: number };
type MutableBrowserWindow = EventTarget & {
  innerHeight: number;
  visualViewport: MutableVisualViewport | null;
};

function visualViewport(height: number): MutableVisualViewport {
  return Object.assign(new EventTarget(), { height });
}

function browserWindow(
  innerHeight: number,
  viewport: MutableVisualViewport | null,
): MutableBrowserWindow {
  return Object.assign(new EventTarget(), {
    innerHeight,
    visualViewport: viewport,
  });
}

describe("bindFieldVisualViewport", () => {
  it("updates visual height and keyboard state for every viewport and window event", () => {
    const root = document.createElement("div");
    const viewport = visualViewport(760);
    const target = browserWindow(800, viewport);

    const cleanup = bindFieldVisualViewport(
      root,
      target as unknown as Window,
    );

    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("760px");
    expect(root).not.toHaveAttribute("data-field-keyboard-open");

    viewport.height = 500;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("500px");
    expect(root).toHaveAttribute("data-field-keyboard-open", "true");

    viewport.height = 650;
    viewport.dispatchEvent(new Event("scroll"));
    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("650px");
    expect(root).not.toHaveAttribute("data-field-keyboard-open");

    target.innerHeight = 900;
    viewport.height = 700;
    target.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("700px");
    expect(root).toHaveAttribute("data-field-keyboard-open", "true");

    cleanup();
  });

  it("opens only when the visual height reduction exceeds the adaptive threshold", () => {
    const root = document.createElement("div");
    const viewport = visualViewport(800);
    const target = browserWindow(1_000, viewport);
    const cleanup = bindFieldVisualViewport(root, target as unknown as Window);

    expect(root).not.toHaveAttribute("data-field-keyboard-open");

    viewport.height = 799;
    viewport.dispatchEvent(new Event("resize"));
    expect(root).toHaveAttribute("data-field-keyboard-open", "true");

    target.innerHeight = 600;
    viewport.height = 440;
    target.dispatchEvent(new Event("resize"));
    expect(root).not.toHaveAttribute("data-field-keyboard-open");

    viewport.height = 439;
    viewport.dispatchEvent(new Event("resize"));
    expect(root).toHaveAttribute("data-field-keyboard-open", "true");

    cleanup();
  });

  it("falls back to the layout viewport and follows window resizes", () => {
    const root = document.createElement("div");
    const target = browserWindow(720, null);
    const cleanup = bindFieldVisualViewport(root, target as unknown as Window);

    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("720px");
    expect(root).not.toHaveAttribute("data-field-keyboard-open");

    target.innerHeight = 640;
    target.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("640px");
    expect(root).not.toHaveAttribute("data-field-keyboard-open");

    cleanup();
  });

  it("removes listeners and restores the root values it temporarily replaced", () => {
    const root = document.createElement("div");
    root.style.setProperty("--field-visual-viewport-height", "321px");
    root.dataset.fieldKeyboardOpen = "legacy";
    const viewport = visualViewport(500);
    const target = browserWindow(800, viewport);
    const cleanup = bindFieldVisualViewport(root, target as unknown as Window);

    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("500px");
    expect(root.dataset.fieldKeyboardOpen).toBe("true");

    cleanup();
    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("321px");
    expect(root.dataset.fieldKeyboardOpen).toBe("legacy");

    viewport.height = 400;
    viewport.dispatchEvent(new Event("resize"));
    target.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("321px");
    expect(root.dataset.fieldKeyboardOpen).toBe("legacy");
  });

  it("removes newly-created root state during cleanup", () => {
    const root = document.createElement("div");
    const viewport = visualViewport(500);
    const target = browserWindow(800, viewport);
    const cleanup = bindFieldVisualViewport(root, target as unknown as Window);

    cleanup();

    expect(root.style.getPropertyValue("--field-visual-viewport-height")).toBe("");
    expect(root).not.toHaveAttribute("data-field-keyboard-open");
  });

  it("returns an SSR-safe no-op when explicit dependencies are unavailable", () => {
    const cleanup = bindFieldVisualViewport(null, null);

    expect(cleanup).toBeTypeOf("function");
    expect(() => cleanup()).not.toThrow();
  });
});
