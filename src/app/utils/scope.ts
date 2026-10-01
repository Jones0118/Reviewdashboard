/**
 * Shared scope walking for the per-school "raw" exports.
 *
 * Every dataset keys its school rows by `${district}||${block}`, so one walker
 * serves the School, Academic, Attendance and Infrastructure tabs and they all
 * agree on what "the schools in scope" means.
 */

export type DrillLevel = 'state' | 'district' | 'block' | 'school';

/** A school row tagged with the district and block it came from. */
export type WithPlace<T> = T & { __district: string; __block: string };

/**
 * Collects every school inside the current drill scope.
 *
 * state    -> all blocks
 * district -> that district's blocks
 * block    -> that one block
 * school   -> the single selected school
 */
export function schoolsInScope<T extends { name: string }>(
  map: Record<string, T[]> | null,
  level: DrillLevel,
  district: string | null,
  block: string | null,
  school: string | null,
): WithPlace<T>[] {
  if (!map) return [];

  const tag = (rows: T[], d: string, b: string): WithPlace<T>[] =>
    rows.map((r) => ({ ...r, __district: d, __block: b }));

  const split = (key: string): [string, string] => {
    const i = key.indexOf('||');
    return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 2)];
  };

  if (level === 'block' || level === 'school') {
    if (!district || !block) return [];
    const rows = map[`${district}||${block}`] ?? [];
    const tagged = tag(rows, district, block);
    if (level === 'school') {
      return school ? tagged.filter((r) => r.name === school) : [];
    }
    return tagged;
  }

  const out: WithPlace<T>[] = [];
  for (const key of Object.keys(map)) {
    const [d, b] = split(key);
    if (level === 'district' && d !== district) continue;
    out.push(...tag(map[key], d, b));
  }
  return out;
}
