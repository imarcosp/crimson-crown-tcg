import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import CartDrawer from "@/components/cart/CartDrawer";
import HangOrderModal from "@/components/forms/HangOrderModal";
import { AuthProvider } from "@/context/AuthContext";
import { ConfigProvider } from "@/context/ConfigContext";
import CurrencySync from "@/components/CurrencySync";
import CartSync from "@/components/cart/CartSync";
import ActiveImportsBanner from "@/components/layout/ActiveImportsBanner";

import { siteConfig } from "@/config/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// SEO GLOBAL
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url), // Corregido a www para consistencia
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`
  },
  description: siteConfig.description,
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.socialImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      }
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.socialImage],
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#F8FAFC] text-slate-900`}
      >
        <div className="flex flex-col min-h-screen">
          <CurrencySync />
          <CartSync />
          <AuthProvider>
            <ConfigProvider>
              <Navbar />
              <main className="flex-1 w-full mx-auto max-w-7xl px-4 py-6">{children}</main>
              <Footer />
              <CartDrawer />
              <HangOrderModal />
              <ActiveImportsBanner />
            </ConfigProvider>
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}
