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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookie3d.vercel.app";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Bookie 3D — Read any PDF on a realistic 3D book",
    template: "%s · Bookie 3D",
  },
  description:
    "Bookie 3D is a free, in-browser PDF reader that renders your document on a realistic 3D book — "
    + "two-page spreads, zoom into any section, Paper/Sepia/Night modes, and accessibility reflow.",
  keywords: [
    "3D book reader", "3D PDF reader", "3D flipbook", "flipbook", "online PDF viewer",
    "read PDF online", "book viewer", "PDF to 3D book",
  ],
  applicationName: "Bookie 3D",
  openGraph: {
    siteName: "Bookie 3D",
    type: "website",
    url: SITE_URL,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
