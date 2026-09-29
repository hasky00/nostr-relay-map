import "leaflet/dist/leaflet.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";

const description =
  "Live world map of Nostr relays — how many are known, online and offline, from NIP-66 monitors.";

export const metadata: Metadata = {
  metadataBase: new URL("https://map.hasky.chat"),
  title: "Nostr Relay Map",
  description,
  openGraph: {
    title: "Nostr Relay Map",
    description,
    url: "https://map.hasky.chat",
    siteName: "Nostr Relay Map",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nostr Relay Map",
    description,
  },
};

export const viewport: Viewport = { themeColor: "#0b0e14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
