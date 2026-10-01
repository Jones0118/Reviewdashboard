/** Data shapes for assets/schemes.json, powering the Review Dashboard. */

export interface ThiranStat {
  eligible: number;
  enrolled: number;
  assessed: number;
}

export interface TnSparkStat {
  schools: number;
  students: number;
}

export interface BreakfastStat {
  eligible: number;
  served: number;
  schools: number;
}

export interface ScholarshipStat {
  applied: number;
  sanctioned: number;
  disbursed: number;
  amountLakh: number;
}

export interface CmCellStat {
  received: number;
  resolved: number;
  pending: number;
}

export interface Helpline14417Stat {
  cases: number;
  critical: number;
  resolved: number;
}

/** Per-programme membership counts, used by the cross-KPI programme filter. */
export interface ProgramMembership {
  schools: number;
  students: number;
}

export interface SchemesNode {
  thiran: ThiranStat;
  tnSpark: TnSparkStat;
  breakfast: BreakfastStat;
  scholarship: ScholarshipStat;
  cmCell: CmCellStat;
  helpline14417: Helpline14417Stat;
}

export interface SchemesDistrict extends SchemesNode {
  name: string;
  students: number;
  schools: number;
  programs: Record<string, ProgramMembership>;
}

/** A selectable school programme for the Review Dashboard filter. */
export interface SchoolProgram {
  id: string;
  label: string;
  share: number;
}

export interface SchemesData {
  generatedAt: string;
  currentYear: string;
  note: string;
  programs: SchoolProgram[];
  state: SchemesNode;
  districts: SchemesDistrict[];
}

/** The programme filter shared across every Review Dashboard KPI. */
export type ReviewProgram = 'all' | 'model' | 'vetri' | 'sparks' | 'pal';
