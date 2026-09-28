import "leaflet/dist/leaflet.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Nostr Relay Map",
  description: "Live world map of Nostr relays — how many are known, online and offline, from NIP-66 monitors.",
};
export const viewport: Viewport = { themeColor: "#0b0e14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
