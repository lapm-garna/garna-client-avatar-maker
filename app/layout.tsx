import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["cyrillic", "latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  return {
    metadataBase: new URL(baseUrl),
    title: "Garna Logo Mixer — объединить два логотипа онлайн",
    description: "Бесплатный генератор совместных логотипов для Telegram: загрузите два знака, выберите композицию и скачайте PNG 1024×1024.",
    icons: {
      icon: [{ url: "/favicon.png", type: "image/png", sizes: "512x512" }],
      apple: [{ url: "/favicon.png", sizes: "512x512" }],
    },
    openGraph: {
      title: "Garna Logo Mixer",
      description: "Два логотипа. Одна иконка.",
      type: "website",
      url: baseUrl,
      images: [{ url: `${baseUrl}/og.png`, width: 1536, height: 1024, alt: "Garna Logo Mixer" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Garna Logo Mixer",
      description: "Два логотипа. Одна иконка.",
      images: [`${baseUrl}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
