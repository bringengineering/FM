import type { Metadata } from "next";
import FleetApp from "./FleetApp";
import "./fleet.css";

export const metadata: Metadata = {
  title: "브링 차량대장",
  description: "브링엔지니어링 공용차량 운행·예약·정비 관리",
  manifest: "/fleet/manifest.webmanifest",
  robots: { index: false, follow: false },
};

export default function FleetPage() { return <FleetApp />; }
