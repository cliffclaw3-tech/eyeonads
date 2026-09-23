import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EyeOnAds — AI-Powered Real Estate Ad Compliance",
  description:
    "Review sampled public advertising, inspect saved image evidence, and schedule checks. Findings require broker review.",
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
