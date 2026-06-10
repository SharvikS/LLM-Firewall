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
  title: "TITAN Gateway — Zero-Trust LLM Firewall",
  description: "Enterprise control plane for the TITAN LLM gateway — real-time telemetry, policy management, and threat monitoring.",
};

// Applies the persisted theme class before first paint so there is no
// flash of the default theme on reload. Must stay tiny and inline.
const themeBoot = `
try {
  var t = localStorage.getItem('titan-theme');
  if (t && /^theme-[a-z]+$/.test(t)) document.documentElement.classList.add(t);
  else document.documentElement.classList.add('theme-dark');
} catch (e) { document.documentElement.classList.add('theme-dark'); }
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
