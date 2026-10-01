/**
 * Caution checks: schools that fail a hard, objective condition (a facility or
 * a figure being zero) rather than merely scoring below a threshold. These are
 * exception lists for follow-up, so each check carries the matching schools and
 * every list is downloadable in full.
 */

/** One school on a caution list, with its hierarchy context. */
export interface CautionSchool {
  district: string;
  block: string;
  school: string;
  udise: string;
  mgmt: string;
  /** Broad school type where the dataset carries one. */
  stype: string;
  students: number;
  /** The figure that triggered the check, pre-formatted for display. */
  detail: string;
}

/** A single caution check with its matching schools. */
export interface CautionCheck {
  id: string;
  label: string;
  icon: string;
  /** Short explanation of what failing this check means. */
  hint: string;
  /** high = a child-facing essential is missing outright. */
  severity: 'high' | 'medium';
  count: number;
  schools: CautionSchool[];
}
