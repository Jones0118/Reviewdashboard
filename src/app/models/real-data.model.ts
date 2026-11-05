/**
 * Models for the real EMIS data assets produced by scripts/ingest-real.mjs.
 *
 * Each dataset is aggregated to three scopes keyed to match the dashboard join:
 *   districts : UPPERCASE district name
 *   blocks    : `DISTRICT||UPPERCASE_BLOCK`
 *   schools   : UDISE code
 *
 * All four cover real figures for Academic Score, THIRAN, Palli Paarvai and
 * Digital Infrastructure. Infrastructure (SIDS) is deferred.
 */

export interface RealAsset<T> {
  note?: string;
  generatedAt?: string;
  districts: Record<string, T>;
  blocks: Record<string, T>;
  schools: Record<string, T>;
}

/** Academic — Class 10 result analysis (real). */
export interface AcademicReal {
  sections: number;
  overallAvg: number | null;
  subjectAvg: {
    language: number | null;
    english: number | null;
    maths: number | null;
    science: number | null;
    social: number | null;
  };
  updatedSections: number;
  completionPct: number | null;
}

/** THIRAN — compliance + endline (real). */
export interface ThiranReal {
  students: number;
  schools: number;
  totalStudents: number;
  sharePct: number | null;
  baselineUpdated: number;
  baselineUpdatePct: number | null;
  absent: number;
  notSelected: number;
  notTagged: number;
  endlineThiran: number;
  attainBLO: number;
  notAttainTamil: number;
  notAttainEnglish: number;
  notAttainMaths: number;
  bloAttainmentPct: number | null;
}

/** Palli Paarvai — observations (real) + state-level designation target model. */
export interface PalliReal {
  observations: number;
  visitedSchools: number;
  officials: number;
  byDesignation: Record<string, number>;
}

export interface PalliTargetRow {
  official: string;
  classesPerMonth: number;
  newSchoolsPerMonth: number;
  sanctionedPosts: number;
}

export interface PalliRealAsset extends RealAsset<PalliReal> {
  targetModel: PalliTargetRow[];
}

/**
 * Palli Parvai observation line list (`assets/palli-obs.json`), one row per
 * observation. Loaded lazily when the "Observation line list" tab opens; every
 * other Palli KPI runs off the pre-aggregated `PalliRealAsset` (or is assumed).
 */
export interface PalliObsSchoolRef {
  /** District name. */ d: string;
  /** Block name. */ b: string;
  /** UDISE code. */ u: string;
  /** School name. */ s: string;
}

/** Positional indexes into a `PalliObsAsset.observations` row. */
export const PalliObsCol = {
  /** Whole days since `baseDate`. */
  day: 0,
  school: 1,
  /** 1–12, or 0 when missing from the export. */
  cls: 2,
  /** Index into `desigs[]` (the observing stakeholder's designation). */
  desig: 3,
  /** Index into `users[]` (the observer). */
  user: 4,
  /** Observation duration in seconds, or -1 when the timestamps are invalid. */
  durSec: 5,
  /** Start time as seconds since midnight, or -1. */
  startSecOfDay: 6,
} as const;

export interface PalliObsAsset {
  note?: string;
  generatedAt?: string;
  source?: string;
  baseDate: string;
  /** Durations longer than this are treated as invalid timestamps. */
  maxValidMinutes: number;
  fields: string[];
  dataQuality: { noDate: number; noUdise: number; missingTime: number; endBeforeStart: number; tooLong: number };
  schools: PalliObsSchoolRef[];
  desigs: string[];
  users: { id: string; n: string }[];
  observations: number[][];
}

/** Digital Infrastructure — ICT functional + internet status (real). */
export interface DigitalInfraReal {
  schools: number;
  ictSchools: number;
  functional: number;
  partiallyFunctional: number;
  notFunctional: number;
  internet: number;
  noInternet: number;
  labs: number;
  functionalPct: number | null;
  internetPct: number | null;
}

export type AcademicRealAsset = RealAsset<AcademicReal>;
export type ThiranRealAsset = RealAsset<ThiranReal>;
export type DigitalInfraRealAsset = RealAsset<DigitalInfraReal>;

/** Infrastructure — SIDS assessment (real, DSE + DEE). */
export interface InfraReal {
  schools: number;
  noToilet: number;
  noWater: number;
  noCwsnToilet: number;
  noKitchen: number;
  noPlayground: number;
  noFirstAid: number;
  noFire: number;
  noRamp: number;
  classDemolish: number;
  classRepair: number;
  classShortage: number;
  toiletRepair: number;
  schoolsWithGap: number;
  gapPct: number | null;
}

export type InfraRealAsset = RealAsset<InfraReal>;

/**
 * The rolling windows the SMC metric sheet asks for. Anchored to the latest
 * date in the export (`SmcRealAsset.anchorDate`), not to today's clock, so the
 * filter keeps meaning as the data ages. `all` is the full export.
 */
export type SmcPeriodKey = 'all' | 'p12' | 'p9' | 'p6' | 'p3';

/**
 * Positional indexes into a `SmcReal.p[period]` array. Must stay in sync with
 * `SMC_PERIOD_COLS` in scripts/ingest-real.mjs (asserted by `periodCols`).
 */
export const SmcPeriodCol = {
  raised: 0,
  resolved: 1,
  unresolved: 2,
  withdrawn: 3,
  /** Work in progress — counted with unresolved for completion status. */
  wip: 4,
  emgRaised: 5,
  emgResolved: 6,
  /** Emergency resolutions not resolved (unresolved + work in progress). */
  emgUnresolved: 7,
  othRaised: 8,
  othResolved: 9,
  othUnresolved: 10,
  /** Meetings held (one row per meeting). */
  meetings: 11,
  /** Distinct schools that held at least one meeting in the window. */
  schoolsHeld: 12,
  present: 13,
  absent: 14,
  /** Vacant SMC seats — excluded from the attendance denominator. */
  vacant: 15,
} as const;

/** SMC — resolutions, emergency split and meeting attendance (real). */
export interface SmcReal {
  raised: number;
  closed: number;
  pending: number;
  closureRate: number | null;
  emergency: number;
  /** Emergency resolutions that are not closed (still open / work in progress). */
  emergencyOpen: number;
  /** Per-window counters, indexed by `SmcPeriodCol`. */
  p: Record<SmcPeriodKey, number[]>;
}

export interface SmcRealAsset extends RealAsset<SmcReal> {
  /** Column order of every `p[period]` array (sanity-check against SmcPeriodCol). */
  periodCols: string[];
  periods: SmcPeriodKey[];
  /** Latest date present in the export; every window is measured back from it. */
  anchorDate: string;
  cutoffs: Record<SmcPeriodKey, string>;
  /** Managements the SMC programme covers — the "meetings not held" denominator. */
  managements: string[];
}

/**
 * Per-meeting and per-resolution detail (`assets/smc-detail.json`), loaded
 * lazily when the SMC drill opens. Rows are positional arrays and dates are
 * whole-day offsets from `baseDate`, which keeps 2.6 lakh rows at ~1.5 MB
 * gzipped. Column order is documented by `meetingFields`/`resolutionFields`
 * and by the index maps below.
 */
export interface SmcSchoolRef {
  /** District name. */ d: string;
  /** Block name. */ b: string;
  /** UDISE code. */ u: string;
  /** School name. */ s: string;
  /** Management. */ m: string;
  /** School category. */ c: string;
}

export const SmcMeetingCol = {
  school: 0,
  /** Days since `baseDate`. */
  day: 1,
  present: 2,
  absent: 3,
  vacant: 4,
  /** Recorded SMC member strength — unreliable, kept for reference only. */
  members: 5,
} as const;

export const SmcResolutionCol = {
  school: 0,
  dept: 1,
  /** 0 Unresolved, 1 Resolved, 2 Withdrawn, 3 Work in progress. */
  status: 2,
  emergency: 3,
  level: 4,
  day: 5,
  /** Resolution category (index into `cats`). */
  cat: 6,
  /** Resolution sub-category (index into `subcats`). */
  subcat: 7,
} as const;

export interface SmcDetailAsset {
  note?: string;
  generatedAt?: string;
  baseDate: string;
  anchorDate: string;
  cutoffs: Record<SmcPeriodKey, string>;
  managements: string[];
  meetingFields: string[];
  resolutionFields: string[];
  statusLabels: string[];
  schools: SmcSchoolRef[];
  depts: string[];
  levels: string[];
  /** Resolution categories (indexed by `SmcResolutionCol.cat`). */
  cats?: string[];
  /** Resolution sub-categories (indexed by `SmcResolutionCol.subcat`). */
  subcats?: string[];
  meetings: number[][];
  resolutions: number[][];
}

/**
 * Recognition Order — DPS (Directorate of Private Schools).
 * Pending Recognition Certificate (RC) applications, split by the office
 * currently holding the file (district vs state) and by how long they have
 * been pending (<15 / 15-30 / >30 days, mutually exclusive buckets).
 */
export interface DpsReal {
  /** Total pending RC applications in scope. */
  total: number;
  /** Pending with a district office (DEO / document verification). */
  districtPending: number;
  /** Pending with a state office (Section Office, JD, Director…). */
  statePending: number;
  /** Pending under 15 days. */
  lt15: number;
  /** Pending 15–30 days (inclusive). */
  d15to30: number;
  /** Pending over 30 days. */
  gt30: number;
  avgDays: number | null;
  maxDays: number;
}

/** One pending RC application (drill-down detail row). */
export interface DpsApplication {
  appId: string;
  district: string;
  block: string;
  udise: string;
  schoolType: string;
  applicationName: string;
  /** Human-readable office currently holding the file. */
  pendingWith: string;
  level: 'District' | 'State' | 'Unspecified';
  status: string;
  days: number;
  bucket: '<15' | '15-30' | '>30';
  updatedOn: string;
}

export interface DpsRealAsset extends RealAsset<DpsReal> {
  applications: DpsApplication[];
}

/**
 * All Children in School (ACiS) — the Common Pool.
 *
 * The common pool holds every child who left universal data (TC issued) and is
 * not yet back in a school. Counters mirror the ACiS metric sheet: the pool is
 * surveyed, each surveyed child gets a dropout reason, and is then routed either
 * to SMC validation or to re-admission.
 */
export interface AcisReal {
  /** Children in the common pool (= TC dropouts out of universal data). */
  pool: number;
  surveyed: number;
  pendingSurvey: number;
  surveyPct: number | null;
  /** Admit_status = Admitted. */
  admitted: number;
  /** Admitted children with a measurable common-pool → survey gap. */
  bridged: number;
  /** Mean bridging duration in days (observe_date − common_pool_date). */
  bridgeDays: number | null;
  /** dropout_bucket = To be Admitted. */
  toBeAdmitted: number;
  /** dropout_bucket = To be Validated (pending SMC validation). */
  toBeValidated: number;
  /** Surveyed children with a dropout reason recorded. */
  withReason: number;
  /** Surveyed children whose owning department has acted (re-admitted/closed). */
  deptTaken: number;
  deptPending: number;
  /** Children with a recorded disability (CWSN). */
  cwsn: number;
  /** umis_status = Joined_higher_edu. */
  umis: number;
}

/** Class-wise slice of the pool (state level). */
export interface AcisClassRow {
  cls: string;
  pool: number;
  boys: number;
  girls: number;
  cwsn: number;
  admitted: number;
  bridgeDays: number | null;
}

/** Reason-wise dropout counts with the sub-reason breakdown. */
export interface AcisReasonRow {
  reason: string;
  total: number;
  admitted: number;
  pending: number;
  subs: { sub: string; count: number }[];
}

/** Department-wise action taken / to be taken. */
export interface AcisDeptRow {
  dept: string;
  total: number;
  taken: number;
  pending: number;
}

/** Month-wise common-pool entries from the start of the academic year. */
export interface AcisMonthRow {
  month: string;
  entered: number;
  surveyed: number;
  admitted: number;
}

export interface AcisRealAsset extends RealAsset<AcisReal> {
  classWise: AcisClassRow[];
  reasonWise: AcisReasonRow[];
  deptWise: AcisDeptRow[];
  monthWise: AcisMonthRow[];
}

/**
 * Per-student common-pool asset (`assets/acis-students.json`), loaded lazily
 * when the ACiS drill opens. Rows are positional arrays and the string columns
 * are interned into lookup tables, which keeps ~291k students at ~6 MB gzipped.
 * Column order is documented by `fields` and by `AcisStudentCol` below.
 */
export interface AcisSchoolRef {
  /** District name. */ d: string;
  /** Block name. */ b: string;
  /** UDISE code. */ u: string;
  /** School name. */ s: string;
  /** School type (Government / Un-aided / …). */ t: string;
  /** Management (School Education Department School / Unaided (Private) …). */ m: string;
  /** School category (Primary / High School / …). */ c: string;
}

export type AcisStudentRow = (number | string)[];

/** Positional indexes into `AcisStudentRow`. */
export const AcisStudentCol = {
  school: 0,
  cls: 1,
  /** 1 = Male, 2 = Female, 0 = not recorded. */
  gender: 2,
  cwsn: 3,
  surveyed: 4,
  admitted: 5,
  /** 1 = To be Validated, 2 = To be Admitted, 0 = none. */
  bucket: 6,
  reason: 7,
  subReason: 8,
  dept: 9,
  umis: 10,
  /** Bridging days, or -1 when not measurable. */
  days: 11,
  emis: 12,
  name: 13,
  transferDate: 14,
  surveyDate: 15,
  disability: 16,
} as const;

export interface AcisStudentsAsset {
  note?: string;
  generatedAt?: string;
  fields: string[];
  schools: AcisSchoolRef[];
  reasons: string[];
  subReasons: string[];
  depts: string[];
  students: AcisStudentRow[];
}

/**
 * Potential dropouts (`assets/acis-pd.json`) — students absent 15+ days in the
 * last 30, from the EMIS Potential Dropout report. A single report window
 * (`reportFrom`..`reportTo`), so no duration / trend / regularised figures.
 */
export interface AcisPdReal {
  pd: number;
  /** Red_Flag_Status = Repeater (appeared in the last two PD reports). */
  repeaters: number;
  notRepeater: number;
  /** Red_Flag_Status = Not updated (no follow-up recorded yet). */
  notUpdated: number;
  boys: number;
  girls: number;
  /** PD students with a dropout reason recorded. */
  withReason: number;
  avgAbsent: number | null;
}

export interface AcisPdSchoolRef {
  d: string; b: string; u: string; s: string;
  /** School type. */ t: string;
  /** Management. */ m: string;
  /** Category. */ c: string;
}

/** Positional indexes into an `AcisPdAsset.students` row. */
export const AcisPdCol = {
  school: 0,
  cls: 1,
  /** 1 = Male, 2 = Female, 0 = not recorded. */
  gender: 2,
  /** 1 = Repeater, 0 = Not Repeater, -1 = Not updated. */
  repeater: 3,
  category: 4,
  reason: 5,
  absentDays: 6,
  emis: 7,
  name: 8,
  section: 9,
} as const;

export interface AcisPdAsset extends RealAsset<AcisPdReal> {
  reportFrom: string;
  reportTo: string;
  fields: string[];
  /** School lookup table indexed by AcisPdCol.school (distinct from the per-UDISE schools map). */
  schoolRefs: AcisPdSchoolRef[];
  categories: string[];
  reasons: string[];
  students: (number | string)[][];
}
