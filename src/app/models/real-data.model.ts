/**
 * Models for the real EMIS data assets produced by scripts/ingest-real.mjs.
 *
 * Each dataset is aggregated to three scopes keyed to match the dashboard join:
 *   districts : UPPERCASE district name
 *   blocks    : `DISTRICT||UPPERCASE_BLOCK`
 *   schools   : UDISE code
 *
 * All four cover real figures for Academic Score, THIRAN+, Palli Paarvai and
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

/** THIRAN+ — compliance + endline (real). */
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

/** SMC — resolutions incl. emergency-not-closed (real). */
export interface SmcReal {
  raised: number;
  closed: number;
  pending: number;
  closureRate: number | null;
  emergency: number;
  /** Emergency resolutions that are not closed (still open / work in progress). */
  emergencyOpen: number;
}

export type SmcRealAsset = RealAsset<SmcReal>;
