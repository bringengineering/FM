import type { Metadata } from "next";
import MoveInCleaningLanding from "../landing/MoveInCleaningLanding";
import { landingServices } from "../landing/services";

const service = landingServices["move-in-cleaning"];

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
  alternates: { canonical: "https://bring-fm.web.app/move-in-cleaning" },
  openGraph: {
    title: service.metaTitle,
    description: service.metaDescription,
    url: "https://bring-fm.web.app/move-in-cleaning",
    images: ["https://bring-fm.web.app/landing/movein-campaign/suit-window.png"],
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
