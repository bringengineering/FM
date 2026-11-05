"use client";

import { useEffect } from "react";

export default function FieldServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) return;

    void navigator.serviceWorker
      .register("/field-sw.js?v=20260812-4", {
        scope: "/field",
        updateViaCache: "none",
      })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, []);

  return null;
}
