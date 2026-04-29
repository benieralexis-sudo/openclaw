// Split fullName "Pierre de la Fontaine" → firstName/lastName en préservant
// les particules nobiliaires (de/du/des/von/van/le/la/...) dans le lastName.
// Audit qualité 29/04 (Q5) — extrait de enrich-lead-dirigeants.ts pour réutilisation
// par enrich-via-dropcontact + autres pipelines qui matchent par lastName strict.

const NAME_PARTICLES = new Set([
  "de", "du", "des", "d'", "da", "do",
  "von", "van", "vander", "der", "den",
  "le", "la", "les",
  "el", "al", "ibn", "bin", "ben",
  "saint", "st", "ste",
  "mc", "mac", "o'",
]);

export function splitFullName(fullName: string): { firstName: string; lastName: string; full: string } {
  const cleaned = fullName.trim();
  if (!cleaned) return { firstName: "", lastName: "", full: cleaned };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? "", lastName: "", full: cleaned };

  let lastIdx = parts.length - 1;
  while (lastIdx > 0) {
    const prev = (parts[lastIdx - 1] ?? "").toLowerCase().replace(/[.,]/g, "");
    if (NAME_PARTICLES.has(prev)) {
      lastIdx -= 1;
      continue;
    }
    break;
  }

  // Cas convention administrative FR "DUPOND Jean-Marc" : segments tout-MAJ au début = lastName
  const allUpperPrefix: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? "";
    if (p.length >= 2 && p === p.toUpperCase() && /[A-ZÀ-Ý]/.test(p)) {
      allUpperPrefix.push(p);
    } else {
      break;
    }
  }
  if (allUpperPrefix.length >= 1 && allUpperPrefix.length < parts.length) {
    const lastName = allUpperPrefix.join(" ");
    const firstName = parts.slice(allUpperPrefix.length).join(" ");
    return { firstName, lastName, full: cleaned };
  }

  const lastName = parts.slice(lastIdx).join(" ");
  const firstName = parts.slice(0, lastIdx).join(" ");
  return { firstName, lastName, full: cleaned };
}
