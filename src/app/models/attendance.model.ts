/** Rolling-window attendance summary (last N working days). */
export interface AttendanceWindow {
  days: number;
  attendance: number;
  absentees: number;
  expected: number;
  compliance: number;
  unmarked: number;
}

/** One working day of attendance, with raw counts for exact single-day views. */
export interface AttendanceDay {
  date: string;
  attendance: number;
  compliance: number;
  teacher: number;
  absentees: number;
  schools: number;
  marked: number;
  unmarked: number;
  expected: number;
  present: number;
  tExpected: number;
  tPresent: number;
}

/** Aggregate attendance node for a scope. */
export interface AttendanceNode {
  schools: number;
  enrolled: number;
  /** Marked school-days / expected school-days. */
  compliance: number;
  unmarkedDays: number;
  markedDays: number;
  expectedDays: number;
  attendance: number;
  absentees: number;
  teacherAttendance: number;
  teacherAbsentees: number;
  /** Students absent 15+ days in the month. */
  dropoutRisk: number;
  dropoutRate: number;
  windows: AttendanceWindow[];
  daily: AttendanceDay[];
}

/** Per-school attendance record. */
export interface AttendanceSchool {
  name: string;
  udise: string;
  mgmt: string;
  ctype: string;
  /** Broad type: Government | Partially Aided | Fully Aided. */
  stype: string;
  enrolled: number;
  compliance: number;
  attendance: number;
  teacherAttendance: number;
  absentees: number;
  unmarkedDays: number;
  dropoutRisk: number;
  dropoutRate: number;
  windows: AttendanceWindow[];
  /** Attendance % per working day; -1 means the day was not marked. */
  dailyAtt: number[];
}

export interface AttendanceData {
  dates: string[];
  windows: number[];
  days: number;
  dropoutThreshold: number;
  asOf: string;
  note: string;
  state: AttendanceNode;
  districts: Record<string, AttendanceNode>;
  blocks: Record<string, AttendanceNode>;
}

export type AttendanceSchoolsData = Record<string, AttendanceSchool[]>;

/** Metric driving comparison and alerts. */
export type AttendanceMetric = 'attendance' | 'compliance' | 'teacherAttendance' | 'dropoutRate';

export const ATTENDANCE_METRICS: { label: string; value: AttendanceMetric; suffix: string }[] = [
  { label: 'Student Attendance', value: 'attendance', suffix: '%' },
  { label: 'Marking Compliance', value: 'compliance', suffix: '%' },
  { label: 'Teacher Attendance', value: 'teacherAttendance', suffix: '%' },
  { label: 'Dropout Risk Rate', value: 'dropoutRate', suffix: '%' },
];
