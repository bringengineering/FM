import type { Metadata } from "next";
import StairCleaningLanding from "../landing/StairCleaningLanding";
import { landingServices } from "../landing/services";

const service = landingServices["stair-cleaning"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "/stair-cleaning" },
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

export default function StairCleaningPage() {
  return <StairCleaningLanding />;
}
