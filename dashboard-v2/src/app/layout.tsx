import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import "@/styles/globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ifind.fr";

export const metadata: Metadata = {
  title: {
    default: "iFIND — Détectez les boîtes FR qui ont besoin de vous",
    template: "%s · iFIND",
  },
  description:
    "Le moteur de détection de signaux d'achat sur les PME françaises. 11 sources publiques, qualification IA Claude Opus 4.7, garantie 6 Pépites par mois minimum.",
  applicationName: "iFIND",
  keywords: [
    "détection leads B2B France",
    "prospection PME française",
    "intent data B2B FR",
    "sales intelligence française",
    "lead generation IA",
    "qualification IA leads",
    "BODACC INPI prospection",
    "alternative Pharow",
    "alternative Cognism France",
  ],
  authors: [{ name: "iFIND", url: APP_URL }],
  creator: "iFIND",
  publisher: "iFIND",
  metadataBase: new URL(APP_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: APP_URL,
    siteName: "iFIND",
    title: "iFIND — Détectez les boîtes FR qui ont besoin de vous",
    description:
      "Le moteur de détection temps réel sur les PME françaises. 11 sources publiques + qualification IA + garantie 6 Pépites/mois minimum. 390€/mois.",
    images: [
      {
        url: "/og-default.svg",
        width: 1200,
        height: 630,
        alt: "iFIND — Trigger Engine FR",
        type: "image/svg+xml",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "iFIND — Détectez les boîtes FR qui ont besoin de vous",
    description:
      "Détection temps réel + qualification IA + garantie 6 Pépites/mois. 390€/mois en annuel. Made in France 🇫🇷.",
    images: ["/og-default.svg"],
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  manifest: "/manifest.json",
  category: "Sales Intelligence",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563EB" },
    { media: "(prefers-color-scheme: dark)", color: "#0d3b66" },
  ],
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr-FR" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700;800&display=swap"
        />
        {/* JSON-LD : Organization (visible sur toutes les pages) */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "iFIND",
              url: APP_URL,
              logo: `${APP_URL}/favicon.svg`,
              description:
                "Le moteur de détection de signaux d'achat sur les PME françaises. Détection temps réel + qualification IA Claude Opus 4.7 + garantie qualité.",
              sameAs: [],
              contactPoint: {
                "@type": "ContactPoint",
                contactType: "customer service",
                email: "contact@ifind.fr",
                areaServed: "FR",
                availableLanguage: ["fr"],
              },
              address: {
                "@type": "PostalAddress",
                addressCountry: "FR",
              },
            }),
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
