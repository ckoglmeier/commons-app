import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@commons/ui/tokens.css";
import "./globals.css";
import "../components/itinerary-workshop.css";
import "../components/trip-application-shell.css";
import { PosthogAnalytics } from "@/components/posthog-analytics";
import { ProductAnalytics } from "@/components/product-analytics";
import { FeedbackEmailProvider } from "@/components/feedback-sheet";
import { instanceSettings } from "@/lib/instance";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Commons — Group travel with less group work.",
  description: "Plans, decisions, expenses, and photos for a group trip.",
  openGraph: {
    title: "Commons — Group travel with less group work.",
    description: "Plans, decisions, expenses, and photos for a group trip.",
    images: [{ url: "https://www.commons.travel/brand/commons-social.png", width: 1200, height: 630, alt: "Commons" }],
  },
  twitter: { card: "summary_large_image", images: ["https://www.commons.travel/brand/commons-social.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body><FeedbackEmailProvider email={instanceSettings().contactEmail}>{children}</FeedbackEmailProvider><ProductAnalytics /><PosthogAnalytics /></body>
    </html>
  );
}
