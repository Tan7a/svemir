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
  title: "Svemir",
  description: "Personal universe of references: blocks, channels, graph.",
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
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${bebasNeue.variable} antialiased`}
    >
      <body className="min-h-screen font-sans">
        {/* No-flash theme: apply the saved theme to <html> before first paint
            so a light-theme user never sees the dark default flash. Runs
            synchronously; suppressHydrationWarning on <html> covers the
            attribute the script mutates. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t){document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
        {children}
        {modal}
        {/* Site-wide maker credit, tucked in the bottom-left corner. */}
        <a
          href="https://www.linkedin.com/in/tanjaradovanovic/"
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-3 left-4 z-40 text-[11px] text-neutral-600 transition-colors hover:text-neutral-300"
        >
          designed &amp; built by Tanja Radovanovic
        </a>
      </body>
    </html>
  );
}
