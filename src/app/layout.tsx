import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EyeOnAds — AI-Powered Real Estate Ad Compliance",
  description:
    "AI keeps an eye on your agents' ads. 24/7 compliance + performance monitoring so you don't have to.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
