export interface NamedValue {
  name: string;
  students: number;
}

export interface GradeValue {
  name: string;
  boys: number;
  girls: number;
}

export interface CasteBreakdown {
  OC: number;
  BC: number;
  MBC: number;
  DNC: number;
  SC: number;
  ST: number;
}

/** Common aggregate node shared by state / district / block levels. */
export interface AggregateNode {
  schools: number;
  boys: number;
  girls: number;
  transgen: number;
  students: number;
  teaching: number;
  nonTeaching: number;
  staff: number;
  caste: CasteBreakdown;
  byManagement: NamedValue[];
  byCategory: NamedValue[];
  byCategoryType: NamedValue[];
  bySchoolType: NamedValue[];
  byGrade: GradeValue[];
}

export interface DistrictNode extends AggregateNode {
  name: string;
}

export interface BlockNode extends AggregateNode {
  district: string;
  block: string;
}

/** Individual school (current year) with its own breakdowns. */
export interface SchoolRow {
  name: string;
  udise: string;
  students: number;
  boys: number;
  girls: number;
  transgen: number;
  teaching: number;
  nonTeaching: number;
  staff: number;
  schools: number; // always 1, kept for table uniformity
  mgmt: string;
  ctype: string;
  cat: string;
  stype: string;
  gb: number[]; // 15 grade boys
  gg: number[]; // 15 grade girls
  caste: number[]; // [OC,BC,MBC,DNC,SC,ST]
  series: number[]; // students by year
  bseries: number[]; // boys by year
  gseries: number[]; // girls by year
}

export interface TrendStatePoint {
  year: string;
  schools: number;
  students: number;
  boys: number;
  girls: number;
  teaching: number;
}

export interface DistrictTrend {
  name: string;
  series: number[]; // students, aligned with `years`
  boys: number[];
  girls: number[];
}

export interface BlockTrend {
  series: number[];
  boys: number[];
  girls: number[];
}

/**
 * State-level enrolment by grade, per year. `boys[y]`/`girls[y]` are 15-length
 * arrays (Pre-KG..XII, see GRADE_ORDER) for the year at `years[y]`.
 * Powers the Transition Rate (Class V->VI, VIII->IX, X->XI) year over year.
 */
export interface GradeYear {
  years: string[];
  boys: number[][];
  girls: number[][];
}

/** Schooling levels used for GER, with their official age groups. */
export type GerLevel = 'primary' | 'upperPrimary' | 'secondary' | 'higherSecondary';

/**
 * Projected age-group population by level and year. Present for UDISE+; `null`
 * for EMIS, which has no age-wise population until it is fetched from the
 * respective departments' API (the UI shows a "Needs API integration" badge).
 */
export interface Population {
  note?: string;
  byLevel: Record<GerLevel, Record<string, number>>;
}

/** A computed transition-rate stage series aligned with `years`. */
export interface TransitionStage {
  key: string;
  label: string;   // e.g. "Class V -> VI"
  fromGrade: number;
  toGrade: number;
  rate: number[];  // % per year, aligned with the trimmed year axis
}

/** A computed GER series for one level, aligned with `years`. */
export interface GerSeries {
  level: GerLevel;
  label: string;
  ger: number[];       // % per year
  enrolment: number[];
  population: number[];
}

/** Grade labels in the fixed order produced by the aggregator. */
export const GRADE_ORDER = ['Pre-KG','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

export interface EnrollmentData {
  generatedAt: string;
  years: string[];
  trendState: TrendStatePoint[];
  districtTrend: DistrictTrend[];
  blockTrend: Record<string, BlockTrend>; // "DISTRICT||Block" -> series aligned with years
  currentYear: string;
  state: AggregateNode;
  districts: DistrictNode[];
  blocks: BlockNode[];
  /** Per-year grade totals for Transition Rate. Optional for older assets. */
  gradeYear?: GradeYear;
  /** Projected age-group population for GER; null for EMIS (pending API). */
  population?: Population | null;
}

/** schools.json: map "DISTRICT||Block" -> SchoolRow[] */
export type SchoolsData = Record<string, SchoolRow[]>;

export type DrillLevel = 'state' | 'district' | 'block' | 'school';

export type DonutDimension = 'management' | 'level' | 'schoolType' | 'caste' | 'gender';

/** Multi-select filter state applied across the dashboard. */
export interface FilterState {
  mgmt: string[];
  cat: string[];
  stype: string[];
}

export const EMPTY_FILTERS: FilterState = { mgmt: [], cat: [], stype: [] };

/** How a chart card is currently rendered. */
export type ChartView = 'chart' | 'table';

export const DONUT_DIMENSIONS: { label: string; value: DonutDimension }[] = [
  { label: 'Management-Wise', value: 'management' },
  { label: 'Level of Education', value: 'level' },
  // 'schoolType' removed: source data yields a zero-value slice.
  // 'caste' (Social Category) and 'gender' removed: each has its own dedicated
  // donut in the Numbers 2x2 grid, so they are redundant in this selector.
];

/** Metric used by the choropleth map + stat emphasis. */
export type MapMetric = 'students' | 'schools' | 'boys' | 'girls' | 'teaching';

export const MAP_METRICS: { label: string; value: MapMetric }[] = [
  { label: 'Total Students', value: 'students' },
  { label: 'Total Schools', value: 'schools' },
  { label: 'Boys Enrolment', value: 'boys' },
  { label: 'Girls Enrolment', value: 'girls' },
  { label: 'Teachers', value: 'teaching' },
];
