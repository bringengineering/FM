import type { Metadata } from "next";
import StairCleaningLanding from "../landing/StairCleaningLanding";
import { landingServices } from "../landing/services";

const service = landingServices["stair-cleaning"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "https://bring-fm.web.app/stair-cleaning" },
  openGraph: {
    title: service.metaTitle,
    description: service.metaDescription,
    url: "https://bring-fm.web.app/stair-cleaning",
    images: ["https://bring-fm.web.app/brand-campaign/bringcare-team-stair-v1.png"],
  },
  twitter: {
    card: "summary",
    title: service.metaTitle,
    description: service.metaDescription,
    images: [],
  },
};

export default function StairCleaningPage() {
  return <StairCleaningLanding />;
}
