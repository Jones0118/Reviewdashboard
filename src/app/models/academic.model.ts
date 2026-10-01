/** Per-subject performance block. */
export interface SubjectStat {
  name: string;
  avg: number;
  below35: number;
  b35_60: number;
  b61_80: number;
  above80: number;
  absent: number;
  pass: number;
}

/** Breakdown row keyed by exam type or class. */
export interface AcademicBreakdown {
  name: string;
  avg: number;
  pass: number;
  compliance: number;
  total: number;
  updated: number;
}

/** Exam x subject cell, for comparing exams. */
export interface ExamSubjectStat {
  exam: string;
  subject: string;
  avg: number;
  pass: number;
}

/** A single exam sitting: exam type + class (class 10/12 are board Annual only). */
export interface ExamClassStat {
  exam: string;
  cls: number;
  label: string;
  board: boolean;
  avg: number;
  pass: number;
  compliance: number;
  total: number;
  updated: number;
  /** Subject averages within this sitting, for head-to-head comparison. */
  subjects: { name: string; avg: number; pass: number }[];
}

/** Higher-secondary stream summary. */
export interface StreamStat {
  name: string;
  avg: number;
  pass: number;
  updated: number;
}

/** Aggregate academic node for a scope + year. */
export interface AcademicNode {
  records: number;
  total: number;
  updated: number;
  compliance: number;
  avgMark: number;
  passPct: number;
  /** Five core subjects, classes 6-10. */
  bySubject: SubjectStat[];
  /** Stream subjects, classes 11-12 (many more than five). */
  byHsSubject: SubjectStat[];
  byExam: AcademicBreakdown[];
  byClass: AcademicBreakdown[];
  examSubject: ExamSubjectStat[];
  examClass: ExamClassStat[];
  byStream: StreamStat[];
}

/** Individual school academic record (current year). */
export interface AcademicSchool {
  name: string;
  udise: string;
  mgmt: string;
  ctype: string;
  avgMark: number;
  passPct: number;
  compliance: number;
  total: number;
  updated: number;
  bySubject: SubjectStat[];
  byHsSubject: SubjectStat[];
  byExam: AcademicBreakdown[];
  byClass: AcademicBreakdown[];
  examSubject: ExamSubjectStat[];
  examClass: ExamClassStat[];
  byStream: StreamStat[];
}

export interface AcademicData {
  years: string[];
  currentYear: string;
  subjects: string[];
  hsSubjects: string[];
  streams: string[];
  coreClasses: number[];
  hsClasses: number[];
  examTypes: string[];
  boardClasses: number[];
  note: string;
  state: Record<string, AcademicNode>;
  districts: Record<string, Record<string, AcademicNode>>;
  blocks: Record<string, Record<string, AcademicNode>>;
}

/** Which comparison the user is looking at. */
export type CompareMode = 'districts' | 'exams';

export type AcademicSchoolsData = Record<string, AcademicSchool[]>;

/** Metric selectable across the academic views. */
export type AcademicMetric = 'avgMark' | 'passPct' | 'compliance';

export const ACADEMIC_METRICS: { label: string; value: AcademicMetric; suffix: string }[] = [
  { label: 'Average Mark', value: 'avgMark', suffix: '' },
  { label: 'Pass Percentage', value: 'passPct', suffix: '%' },
  { label: 'Compliance', value: 'compliance', suffix: '%' },
];
