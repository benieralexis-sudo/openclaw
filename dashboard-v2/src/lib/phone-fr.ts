// Validation phone FR (mobile + fixe). Pour cold call B2B FR, un phone
// international (UK/US/RO/MX/...) est inutile : le commercial n'appellera pas
// à l'étranger. On filtre à l'écriture pour ne pas polluer kasprPhone/phone
// avec des numéros non-actionables.
//
// Audit qualité 29/04 : Decade Energy +52 (Mexique), Deodis/STATION F +40
// (Roumanie), Training Orchestra +44 (UK), WALLIX +1 (US) tous stockés à tort.

const FR_MOBILE_RE = /^(\+?33\s?[67]|0[67])/;
const FR_PHONE_RE = /^(\+?33\s?[1-9]|0[1-9])/;

export function isFrenchMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return FR_MOBILE_RE.test(phone.replace(/\s+/g, ""));
}

// FR phone = fixe (01-05) ou mobile (06/07) ou VoIP/standard (08/09).
// Tout +X autre que +33 est rejeté.
export function isFrenchPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const trimmed = phone.trim().replace(/\s+/g, "");
  // Reject explicit non-FR international prefixes (+1, +44, +40, +52, etc.)
  if (/^\+/.test(trimmed) && !/^\+33/.test(trimmed)) return false;
  return FR_PHONE_RE.test(trimmed);
}
