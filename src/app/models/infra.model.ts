/** Metrics for one infrastructure type at one scope. */
export interface InfraType {
  available: number;
  required: number;
  surplus: number;
  norms: number;
  good: number;
  needRepair: number;
  demolish: number;
  functional: number;
  schools: number;
  schoolsWith: number;
  availabilityPct: number;
  coveragePct: number;
  functionalPct: number;
  goodPct: number;
  gapPct: number;
}

export interface InfraNode {
  schools: number;
  students: number;
  /** Data entry compliance for the month. */
  expected: number;
  entered: number;
  notEntered: number;
  entryPct: number;
  types: Record<string, InfraType>;
}

export interface InfraSchool {
  name: string;
  udise: string;
  mgmt: string;
  cat: string;
  students: number;
  /** Whether this school submitted for the current month. */
  entered: number;
  enteredPeriods: string[];
  periodsEntered: number;
  entryPct: number;
  types: Record<string, InfraType>;
}

export interface InfraTypeMeta {
  id: string;
  label: string;
  icon: string;
}

/** One data-entry compliance point for a period. */
export interface InfraEntryPoint {
  /** "September 2026-27" for EMIS, "2026-27" for UDISE+ */
  period: string;
  month: string;
  year: string;
  expected: number;
  entered: number;
  notEntered: number;
  entryPct: number;
}

export interface InfraPeriod {
  state: InfraNode;
  districts: Record<string, InfraNode>;
  blocks: Record<string, InfraNode>;
}

export interface InfraData {
  source: string;
  /**
   * How the source collects data:
   *   'month' (EMIS)  -> periods are months within an academic year
   *   'year'  (UDISE+) -> periods are academic years
   */
  cadence: 'month' | 'year';
  periods: string[];
  latestPeriod: string;
  academicYear: string;
  entryTrend: InfraEntryPoint[];
  types: InfraTypeMeta[];
  note: string;
  byPeriod: Record<string, InfraPeriod>;
}

export type InfraSchoolsData = Record<string, InfraSchool[]>;

/** Metric driving comparison and alerts. */
export type InfraMetric = 'availabilityPct' | 'coveragePct' | 'goodPct' | 'functionalPct' | 'gapPct' | 'entryPct';

export const INFRA_METRICS: { label: string; value: InfraMetric; lowerIsBetter?: boolean }[] = [
  { label: 'Data Entry Compliance', value: 'entryPct' },
  { label: 'Availability vs Norms', value: 'availabilityPct' },
  { label: 'School Coverage', value: 'coveragePct' },
  { label: 'Good Condition', value: 'goodPct' },
  { label: 'Functional', value: 'functionalPct' },
  { label: 'Shortfall Gap', value: 'gapPct', lowerIsBetter: true },
];
