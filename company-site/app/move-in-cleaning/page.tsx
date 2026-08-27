import type { Metadata } from "next";
import MoveInCleaningLanding from "../landing/MoveInCleaningLanding";
import { landingServices } from "../landing/services";

const service = landingServices["move-in-cleaning"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "/move-in-cleaning" },
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

export default function MoveInCleaningPage() {
  return <MoveInCleaningLanding />;
}
