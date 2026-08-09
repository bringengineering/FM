"use client";

import { useEffect } from "react";

export default function FieldServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) return;

    void navigator.serviceWorker
      .register("/field-sw.js", { scope: "/field/" })
      .catch(() => undefined);
  }, []);

  return null;
}
