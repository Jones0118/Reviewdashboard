/**
 * Indian number formatting helpers.
 * Rules:
 *  - Full numbers use Indian digit grouping: 12345678 -> "1,23,45,678"
 *  - Thousands are NEVER abbreviated (no "K")
 *  - Only crore ("Cr") and lakh ("L") abbreviations are used
 *  - "Million"/"M" is never used
 */

/** Full Indian-grouped number, e.g. 12345678 -> "1,23,45,678". */
export function inr(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

/**
 * Short form for big numbers, Indian units only.
 *  >= 1 crore  -> "1.23 Cr"
 *  >= 1 lakh   -> "1.23 L"
 *  otherwise   -> full Indian-grouped number (thousands stay full)
 */
export function inrShort(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  return inr(n);
}

/** Axis-friendly short label (keeps axes readable without inventing units). */
export function inrAxis(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(1) + ' Cr';
  if (abs >= 1e5) return (n / 1e5).toFixed(1) + ' L';
  return inr(n);
}
