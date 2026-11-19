/**
 * Board Exam performance reports (Class X and Class XII), AY 2025-26.
 * Asset: assets/board-exam.json, built by scripts/ingest-board.py from the
 * state report (district-wise, Govt schools) and the district reports
 * (results summary, subject detail, school annexure). See the script header
 * for what each figure is and where it came from.
 */
export type BoardClass = 10 | 12;
export type BoardCategory = 'Good' | 'Satisfactory' | 'Needs Improvement' | 'Poor';
export const BOARD_CATEGORIES: BoardCategory[] = ['Good', 'Satisfactory', 'Needs Improvement', 'Poor'];
export const BOARD_CATEGORY_COLOR: Record<BoardCategory, string> = {
  Good: '#2E9E4F', Satisfactory: '#F2E205', 'Needs Improvement': '#F2A33A', Poor: '#E53935',
};
/** Average-mark band used by the reports for subject / school categories. */
export function boardBand(avg: number | null | undefined): BoardCategory | null {
  if (avg == null) return null;
  return avg > 70 ? 'Good' : avg > 60 ? 'Satisfactory' : avg > 50 ? 'Needs Improvement' : 'Poor';
}

/** One district row of the state report (Govt schools). */
export interface BoardStateRow {
  sno: number;
  district: string;
  schools: number;
  appeared: number;
  pass: number;
  /** Change vs the previous year, percentage points. */
  passDelta: number;
  avg: number;
  avgDelta: number;
  /** District rank: equal weight to current-year performance and improvement. */
  rank: number;
}
export interface BoardState {
  total: { schools: number; appeared: number; pass: number; passDelta: number; avg: number; avgDelta: number };
  districts: BoardStateRow[];
}

/** Results summary row, one per management group (section A of the district report). */
export interface BoardMgmtRow {
  mgmt: string;
  schools: number;
  appeared: number;
  appearedPct: number;
  pass: number | null; passDelta: number | null;
  avg: number | null; avgDelta: number | null;
  statePass: number | null; statePassDelta: number | null;
  stateAvg: number | null; stateAvgDelta: number | null;
  /** Failed + absent: students for the supplementary exam. */
  supplementary: number;
}
export interface BoardSubjectCell {
  pass: number | null; passDelta: number | null;
  avg: number | null; avgDelta: number | null;
  /** False when the PDF row had blank cells and could not be mapped positionally. */
  reliable: boolean;
}
/** Section D: a subject (or "All Subjects") with a cell per management group. */
export type BoardSubjectRow = { subject: string } & Record<string, BoardSubjectCell | string>;

export interface BoardTrendSeries {
  district: number[]; state: number[]; best: number[]; bestNames: string[];
}
export interface BoardTrend { years: number[]; pass: BoardTrendSeries; avg: BoardTrendSeries }

export interface BoardSchoolSubject { avg: number; avgDelta: number | null; rankState: string; rankDistrict: string }
/** One annexure row (Govt or Aided annexure; private schools are not in the annexures). */
export interface BoardSchool {
  block: string;
  udise: string;
  name: string;
  mgmt: string;
  appeared: number | null;
  supplementary: number | null;
  prevPerf: BoardCategory | string;
  perf: BoardCategory | string;
  pass: number | null; passDelta: number | null;
  avg: number | null; avgDelta: number | null;
  /** "1476/6269" style rank strings, as printed. */
  rankState: string;
  rankDistrict: string;
  subjects: Record<string, BoardSchoolSubject>;
  annexure: 'Govt' | 'Aided';
}
/**
 * One school's own report (xlsx named by UDISE): two academic years side by
 * side, school vs district vs state, with ranks and the performance rating.
 * Every array is [previous year, current year] in `years` order.
 */
export interface BoardSchoolReportBlock {
  appeared: (number | null)[];
  pass: (number | null)[]; distPass: (number | null)[]; statePass: (number | null)[];
  avg: (number | null)[]; distAvg: (number | null)[]; stateAvg: (number | null)[];
  rankDistrict: (string | null)[]; rankState: (string | null)[];
  rating: (string | null)[];
}
export interface BoardSchoolReport {
  udise: string;
  name: string;
  district: string;
  block: string;
  years: string[];
  overall: BoardSchoolReportBlock;
  subjects: ({ subject: string } & BoardSchoolReportBlock)[];
}

export interface BoardDistrict {
  district: string;
  byMgmt: BoardMgmtRow[];
  subject: BoardSubjectRow[];
  trend: BoardTrend;
  schools: BoardSchool[];
  /** Section C: district overall performance (Govt schools). */
  overall: BoardCategory | string;
  schoolCats: Record<BoardCategory, number>;
  schoolCatsPrev: Record<BoardCategory, number>;
  subjectCats: ({ subject: string } & Record<BoardCategory, number>)[];
}
export interface BoardExamData {
  year: string;
  prevYear: string;
  generatedAt: string;
  note: string;
  subjects: Record<string, string[]>;
  managements: string[];
  categories: BoardCategory[];
  classes: Record<string, { state: BoardState; districts: Record<string, BoardDistrict>; schoolReports: Record<string, BoardSchoolReport> }>;
}
