import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes — résout les conflits proprement.
 * Standard Shadcn UI.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatage de date en français court (ex: "il y a 2 min")
 */
export function formatRelativeFr(date: Date | string | number): string {
  const d = typeof date === "object" ? date : new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;

  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `il y a ${Math.floor(diff / 86400)}j`;

  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/**
 * Formatage de nombre français (1 234 au lieu de 1,234)
 */
export function formatNumberFr(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

/**
 * Initiales depuis un nom (ex: "Alexis Bénier" → "AB")
 */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Score → couleur sémantique (1-10 scale iFIND)
 */
export function scoreColor(score: number): "danger" | "warning" | "info" | "success" | "fire" {
  if (score >= 9) return "fire";
  if (score >= 7) return "success";
  if (score >= 5) return "info";
  if (score >= 3) return "warning";
  return "danger";
}

/**
 * Tronque proprement à n caractères avec ellipsis
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}
