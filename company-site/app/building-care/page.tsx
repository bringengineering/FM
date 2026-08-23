import type { Metadata } from "next";
import LandingPage from "../landing/LandingPage";
import { landingServices } from "../landing/services";

const service = landingServices["building-care"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "/building-care" },
  openGraph: {
    title: service.metaTitle,
    description: service.metaDescription,
    images: [],
  },
  twitter: {
    card: "summary",
    title: service.metaTitle,
    description: service.metaDescription,
    images: [],
  },
};

export default function BuildingCarePage() {
  return <LandingPage service={service} />;
}
