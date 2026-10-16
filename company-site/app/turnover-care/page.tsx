import type { Metadata } from "next";
import LandingPage from "../landing/LandingPage";
import { landingServices } from "../landing/services";

const service = landingServices["turnover-care"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "/turnover-care" },
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

export default function TurnoverCarePage() {
  return <LandingPage service={service} />;
}
