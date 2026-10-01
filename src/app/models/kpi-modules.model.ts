/** Data shapes for assets/kpi-modules.json (KPI.md additional modules). */

export interface ThiranClassRow { cls: number; students: number; }
export interface NamedStudents { name: string; students: number; }

export interface ThiranModule {
  students: number;
  schools: number;
  boys: number;
  girls: number;
  byClass: ThiranClassRow[];
  byCategory: NamedStudents[];
}

/** One scholarship scheme with eligibility, payment and verification figures. */
export interface ScholarshipScheme {
  name: string;
  total: number;
  eligible: number;
  notEligible: number;
  eligibilityPct: number;
  paySuccess: number;
  payFailed: number;
  payPending: number;
  npciActive: number;
  npciInactive: number;
  aadhaarNotUpdated: number;
  verificationPending: number;
  bySocialCategory: NamedStudents[];
}

export interface ScholarshipModule {
  schemes: ScholarshipScheme[];
}

export interface DigitalModule {
  ictSchools: number;
  ictWithInternet: number;
  ictWithoutInternet: number;
  ictWithTeacher: number;
  ictWithoutTeacher: number;
}

export interface SmcLevelRow {
  name: string;
  raised: number;
  closed: number;
  pending: number;
  closureRate: number;
}

export interface SmcAgeingRow { name: string; count: number; }

export interface SmcDepartmentRow {
  name: string;
  mapped: number;
  resolved: number;
  pending: number;
  schools: number;
  students: number;
  rate: number;
}

export interface SmcModule {
  raised: number;
  closed: number;
  pending: number;
  closureRate: number;
  emergency: number;
  nonEmergency: number;
  schools: number;
  studentsCovered: number;
  byLevel: SmcLevelRow[];
  ageing: SmcAgeingRow[];
  departments: SmcDepartmentRow[];
}

export interface DesignationRow {
  name: string;
  target: number;
  observed: number;
  pending: number;
  completionPct: number;
}

export interface ZeroVisitOfficial {
  name: string;
  designation: string;
  district: string;
  target: number;
  visited: number;
  pending: number;
}

export interface PalliParvaiModule {
  target: number;
  visited: number;
  notVisited: number;
  completionPct: number;
  observations: number;
  pendingObservations: number;
  byDesignation: DesignationRow[];
  zeroVisitOfficials: ZeroVisitOfficial[];
}

export interface KpiModuleNode {
  thiran: ThiranModule;
  scholarship: ScholarshipModule;
  digital: DigitalModule;
  smc: SmcModule;
  palliParvai: PalliParvaiModule;
}

export interface KpiModuleDistrict extends KpiModuleNode {
  name: string;
  students: number;
  schools: number;
}

export interface KpiModulesData {
  generatedAt: string;
  currentYear: string;
  note: string;
  scholarshipSchemes: string[];
  socialCategories: string[];
  schoolCategories: string[];
  smcLevels: string[];
  smcAgeing: string[];
  designations: string[];
  state: KpiModuleNode;
  districts: KpiModuleDistrict[];
}
