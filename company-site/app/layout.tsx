import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host =
    incomingHeaders.get("x-forwarded-host") ??
    incomingHeaders.get("host") ??
    "bring-care.local";
  const protocol =
    incomingHeaders.get("x-forwarded-proto") ??
    (host.includes("localhost") || host.endsWith(".local") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", baseUrl).toString();

  return {
    metadataBase: baseUrl,
    title: "Bring Care | 브링엔지니어링 시설관리",
    description:
      "시설·임대·민원·공사 데이터를 하나로 연결하는 브링엔지니어링의 FM 운영 서비스입니다.",
    applicationName: "Bring Care",
    keywords: [
      "시설관리",
      "FM",
      "건물관리",
      "임대관리",
      "민원관리",
      "브링엔지니어링",
      "Bring Care",
    ],
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "Bring Care",
      title: "Bring Care | 관리의 모든 흐름을 하나의 기준으로",
      description:
        "현장과 기술을 잇는 브링엔지니어링의 시설관리 운영 서비스",
      images: [
        {
          url: socialImage,
          width: 1730,
          height: 909,
          alt: "Bring Care Facility Management",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Bring Care | 브링엔지니어링 시설관리",
      description: "시설관리의 실행력과 디지털 전환을 함께 만듭니다.",
      images: [socialImage],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
