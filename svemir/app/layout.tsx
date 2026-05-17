import type { Metadata } from "next";
import { Inter, Bebas_Neue } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "svemir",
  description: "Personal universe of references — blocks, channels, graph.",
  icons: {
    icon: "/svemir.svg",
    apple: "/svemir.svg",
  },
};

/**
 * Root layout. Mounts the `@modal` parallel slot alongside `children` so the
 * intercepted block-detail route can render as an overlay over any page.
 *
 * See:
 *   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md
 */
export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${bebasNeue.variable} antialiased`}>
      <body className="min-h-screen bg-[#0a0a0a] font-sans text-neutral-200">
        {children}
        {modal}
      </body>
    </html>
  );
}
