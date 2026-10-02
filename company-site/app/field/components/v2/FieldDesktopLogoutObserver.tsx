"use client";

import { useEffect } from "react";

import { logoutFieldV2User } from "../../lib/v2-auth.client";
import { isFieldRequestId, isPlainFieldRecord } from "../../lib/v2/contracts";

function requestIdFromEvent(event: Event): string {
  return event instanceof CustomEvent
    && isPlainFieldRecord(event.detail)
    && Object.keys(event.detail).length === 1
    && isFieldRequestId(event.detail.requestId)
    ? event.detail.requestId
    : "";
}

export default function FieldDesktopLogoutObserver({
  logout = logoutFieldV2User,
}: {
  logout?: () => Promise<void>;
}) {
  useEffect(() => observeFieldDesktopLogout(logout), [logout]);
  return null;
}

export function observeFieldDesktopLogout(
  logout: () => Promise<void> = logoutFieldV2User,
): () => void {
  let running = false;
  const listener = (event: Event) => {
    if (running) return;
    const requestId = requestIdFromEvent(event);
    if (!requestId) return;
    running = true;
    window.dispatchEvent(new Event("bring-field-logout-started"));
    void Promise.resolve()
      .then(logout)
      .then(() => window.dispatchEvent(new CustomEvent("bring-field-logout-complete", { detail: { requestId } })))
      .catch(() => window.dispatchEvent(new CustomEvent("bring-field-logout-failed", { detail: { requestId } })))
      .finally(() => { running = false; });
  };
  window.addEventListener("bring-crm-logout", listener);
  return () => window.removeEventListener("bring-crm-logout", listener);
}
