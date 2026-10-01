/** One academic year on the Births → Class 1 entry monitor. */
export interface Class1MonitorRow {
  /** Academic year label, e.g. "2026-27". */
  year: string;
  /** Calendar birth year feeding this intake (year start − 6). */
  birthYear: number;
  /** Registered live births that year (demo). */
  births: number;
  /** Expected Class 1 entrants = births × entry factor. */
  expected: number;
  /** Actual EMIS Class 1 enrolment, or null where not yet on record. */
  actual: number | null;
  /** True for years whose cohort has not yet actually entered school. */
  projected: boolean;
}

export interface Class1MonitorKpis {
  currentExpected: number;
  projectionExpected: number;
  baseExpected: number;
  pctChange: number;
}

/** Compact per-scope descriptor; rows are reconstructed from the state series. */
export interface Class1ScopeDescriptor {
  share: number;
  currentClass1: number;
}

export interface Class1SchoolDescriptor {
  name: string;
  udise: string;
  share: number;
  currentClass1: number;
}

export interface Class1ByScope {
  /** keyed by DISTRICT */
  districts: Record<string, Class1ScopeDescriptor>;
  /** keyed by "DISTRICT||Block" */
  blocks: Record<string, Class1ScopeDescriptor>;
  /** keyed by "DISTRICT||Block" -> schools in that block */
  schools: Record<string, Class1SchoolDescriptor[]>;
}

export interface Class1MonitorData {
  title: string;
  note: string;
  entryFactor: number;
  currentYear: string;
  projectionYear: string;
  baseYear: string;
  kpis: Class1MonitorKpis;
  rows: Class1MonitorRow[];
  /** expected entrants per academic-year label, state level. */
  stateExpected: Record<string, number>;
  /** actual Class 1 enrolment per academic-year label, state level. */
  stateActual: Record<string, number>;
  /** 1 / entryFactor, to back out births from expected. */
  entryFactorInv: number;
  byScope: Class1ByScope;
}
