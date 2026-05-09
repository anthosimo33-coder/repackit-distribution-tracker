import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { SidebarLayout } from "@/components/layout/SidebarLayout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RepackIt Distribution Tracker",
  description:
    "Tracker de distribution carrousels TikTok + Instagram pour RepackIt",
  robots: "noindex, nofollow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50 font-sans text-slate-900">
        <ConvexClientProvider>
          <TooltipProvider delay={300}>
            <SidebarLayout>
              <div className="container mx-auto px-6 py-8">{children}</div>
            </SidebarLayout>
          </TooltipProvider>
          <Toaster richColors position="top-right" />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
