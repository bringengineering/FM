import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./field.css";

export const metadata: Metadata = {
  title: "BRING 현장 매물 플랫폼",
  description: "브링 내부 직원용 건물·매물·현장 촬영 및 광고 패키지 관리 플랫폼",
  applicationName: "BRING FIELD",
  manifest: "/field/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BRING FIELD",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function FieldLayout({ children }: { children: ReactNode }) {
  return children;
}
