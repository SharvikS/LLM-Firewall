import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TITAN — Secure Every LLM Request",
  description:
    "An OpenAI-compatible security gateway for prompt-injection defense, bidirectional PII masking, output scanning, policy enforcement, and audit evidence. MIT-licensed core.",
  metadataBase: new URL("https://titan.sharvik.tech"),
  openGraph: {
    title: "TITAN — Secure Every LLM Request",
    description:
      "Put one enforceable security layer between your applications, users, and every LLM provider. OpenAI-compatible and open core.",
    type: "website",
    images: ["/product/screenshot_overview.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "TITAN — Secure Every LLM Request",
    description:
      "Prompt-injection defense, bidirectional PII masking, output scanning, policy enforcement, and audit evidence in one LLM gateway.",
    images: ["/product/screenshot_overview.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
