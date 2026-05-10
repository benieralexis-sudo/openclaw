import type { MetadataRoute } from "next";

// Sprint Saint Graal (10/05/2026) — sitemap.xml SEO dynamique.

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.ifind.fr";
  const lastModified = new Date();

  return [
    { url: `${baseUrl}/`, lastModified, changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/tarifs`, lastModified, changeFrequency: "monthly", priority: 0.95 },
    { url: `${baseUrl}/produit`, lastModified, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/cas-d-usage`, lastModified, changeFrequency: "monthly", priority: 0.85 },
    { url: `${baseUrl}/ressources`, lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/a-propos`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/signup`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/cgv`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/cgu`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/rgpd`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/cookies`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: `${baseUrl}/mentions-legales`, lastModified, changeFrequency: "yearly", priority: 0.2 },
  ];
}
