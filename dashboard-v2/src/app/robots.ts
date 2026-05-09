import type { MetadataRoute } from "next";

// Sprint Saint Graal (10/05/2026) — robots.txt SEO.
// Pages publiques marketing indexables, pages auth/api bloquées.

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ifind.fr";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/tarifs", "/produit", "/a-propos", "/cgv", "/cgu", "/rgpd", "/cookies", "/mentions-legales"],
        disallow: ["/dashboard", "/clients", "/triggers", "/settings", "/system", "/onboarding", "/login", "/logout", "/signup", "/api/", "/_next/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
