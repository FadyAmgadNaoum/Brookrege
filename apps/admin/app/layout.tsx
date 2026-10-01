import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Marcellus } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
// Same display face as the website's titles, for the wordmark and page titles.
const marcellus = Marcellus({ subsets: ["latin"], weight: "400", variable: "--font-marcellus", display: "swap" });

export const metadata: Metadata = { title: "Brookrege admin", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${marcellus.variable}`}>
      <body>{children}</body>
    </html>
  );
}
