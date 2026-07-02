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
  title: "TITAN — Zero-Trust Firewall for LLMs",
  description:
    "A drop-in reverse proxy that intercepts, inspects, and governs every LLM request before it reaches the model. Sub-millisecond ML threat detection, PII masking, and full observability. Open-core, MIT.",
  metadataBase: new URL("https://titan.sharvik.tech"),
  openGraph: {
    title: "TITAN — Zero-Trust Firewall for LLMs",
    description:
      "Intercept, inspect, and govern every LLM request. Prompt-injection defense, PII masking, output scanning, and a full control plane. Open-core, MIT.",
    type: "website",
    images: ["/product/screenshot_overview.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "TITAN — Zero-Trust Firewall for LLMs",
    description:
      "A drop-in reverse proxy that intercepts, inspects, and governs every LLM request before it reaches the model.",
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
