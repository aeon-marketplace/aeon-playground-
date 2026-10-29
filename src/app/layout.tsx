import type { Metadata, Viewport } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  applicationName: "AI Playground",
  title: {
    default: "AI Playground",
    template: "%s · AI Playground",
  },
  description:
    "One playground for verified free-tier text and image models, with transparent access labels, visitor-owned keys, and real usage data.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#060a18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
