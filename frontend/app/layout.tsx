import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { siteUrl } from "@/app/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // URL-uri absolute pentru OpenGraph / canonical (NEXT_PUBLIC_SITE_URL)
  metadataBase: new URL(siteUrl()),
  title: "SUCVAR | Spatial & Engineering Studio",
  description:
    "Studio de design interior asistat de AI: randare fotorealistă, calcul precis al materialelor și deviz estimativ transparent cu magazinele din România — Dedeman, Leroy Merlin, Hornbach, IKEA.",
  applicationName: "SUCVAR",
  openGraph: {
    type: "website",
    locale: "ro_RO",
    alternateLocale: ["en_GB", "fr_FR"],
    siteName: "SUCVAR",
    title: "SUCVAR | Spatial & Engineering Studio",
    description: "Randări fotorealiste pentru interioare, fațade și grădini, cu listă de materiale și deviz estimativ.",
    images: [{ url: "/hero.jpg", alt: "SUCVAR — randare fotorealistă de design interior" }],
  },
  twitter: { card: "summary_large_image" },
  authors: [{ name: "Suchevan Denys" }],
  // iOS "Add to Home Screen": rulează ecran complet, fără bara Safari
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SUCVAR",
  },
  // Safari nu mai transformă numerele (ex. dimensiuni, prețuri) în linkuri de telefon
  formatDetection: {
    telephone: false,
  },
  // Etichetă standard (Android / Chrome), alături de cea Apple generată mai sus
  other: {
    "mobile-web-app-capable": "yes",
  },
  // Manifestul PWA vine din app/manifest.ts, iar iconițele din app/icon.png, app/apple-icon.png și public/icons/
};

// Zoom-ul rămâne permis intenț­ionat (accesibilitate).
// Câmpurile folosesc text de 16px, deci iOS nu face zoom automat la focus.
// viewportFit "cover" lasă aplicația să umple ecranul până la marginile iPhone-ului
// (bara de jos și header-ul compensează cu env(safe-area-inset-*)).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0C" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      data-scroll-behavior="smooth"
      lang="ro"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col touch-manipulation [-webkit-tap-highlight-color:transparent] selection:bg-[#111111] selection:text-white">
        {children}
      </body>
    </html>
  );
}
