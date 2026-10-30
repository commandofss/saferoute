import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "SafeRoute – community safety map",
  description: "Anonymous reports of unsafe places, a risk map, and a one-tap SOS share.",
  authors: [{ name: "Ahmed Muhammed Omokunmi" }, { name: "Ruqayah Shehu" }],
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "SafeRoute", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#6d28d9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
