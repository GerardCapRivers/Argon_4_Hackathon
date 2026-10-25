import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { PixelMark } from "@/components/ui/PixelMark";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Pitch Studio",
  description: "Live investor coaching and self-correcting pitch video creation",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <SiteHeader />
        <main className="mx-auto max-w-[1240px] px-4 pb-14 pt-10 sm:px-6 sm:pt-14">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-muted sm:px-6">
            <span className="flex items-center gap-2"><PixelMark size={14} /> AI Pitch Studio</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="badge"><span className="dot-live" /> Gemma on device</span>
              <span className="badge">Gemini 4 Argon</span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
