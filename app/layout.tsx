import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-space-grotesk",
  display: "swap"
});

export const metadata: Metadata = {
  title: "CAVITY GAME — F.I.S.T.",
  description: "Simulateur officiel de tir en cavité, homologué par la F.I.S.T.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CAVITY GAME",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050e1e"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={spaceGrotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
