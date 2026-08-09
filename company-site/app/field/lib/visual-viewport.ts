const VISUAL_VIEWPORT_HEIGHT_PROPERTY = "--field-visual-viewport-height";
const KEYBOARD_OPEN_ATTRIBUTE = "data-field-keyboard-open";
const MINIMUM_KEYBOARD_REDUCTION_PX = 160;

function normalizedHeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function defaultRoot(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

function defaultBrowserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function bindFieldVisualViewport(
  root: HTMLElement | null = defaultRoot(),
  browserWindow: Window | null = defaultBrowserWindow(),
): () => void {
  if (!root || !browserWindow) return () => undefined;

  const viewport = browserWindow.visualViewport;
  const previousHeight = root.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_PROPERTY);
  const previousHeightPriority = root.style.getPropertyPriority(
    VISUAL_VIEWPORT_HEIGHT_PROPERTY,
  );
  const hadKeyboardAttribute = root.hasAttribute(KEYBOARD_OPEN_ATTRIBUTE);
  const previousKeyboardAttribute = root.getAttribute(KEYBOARD_OPEN_ATTRIBUTE);

  const update = () => {
    const layoutHeight = normalizedHeight(browserWindow.innerHeight);
    const measuredVisualHeight = viewport
      ? normalizedHeight(viewport.height)
      : layoutHeight;
    const visualHeight = measuredVisualHeight || layoutHeight;
    root.style.setProperty(
      VISUAL_VIEWPORT_HEIGHT_PROPERTY,
      `${Math.round(visualHeight)}px`,
    );

    const keyboardThreshold = Math.max(
      MINIMUM_KEYBOARD_REDUCTION_PX,
      layoutHeight * 0.2,
    );
    const keyboardOpen = Boolean(
      viewport
      && layoutHeight - visualHeight > keyboardThreshold,
    );
    if (keyboardOpen) {
      root.setAttribute(KEYBOARD_OPEN_ATTRIBUTE, "true");
    } else {
      root.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE);
    }
  };

  browserWindow.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  update();

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;

    browserWindow.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);

    if (previousHeight) {
      root.style.setProperty(
        VISUAL_VIEWPORT_HEIGHT_PROPERTY,
        previousHeight,
        previousHeightPriority,
      );
    } else {
      root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY);
    }

    if (hadKeyboardAttribute) {
      root.setAttribute(KEYBOARD_OPEN_ATTRIBUTE, previousKeyboardAttribute ?? "");
    } else {
      root.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE);
    }
  };
}
