/**
 * KPI catalog for the State Monitoring & Review Dashboard.
 *
 * Ported from the state_review_dashboard.html artifact: 12 modules, ~60 KPIs.
 * Each KPI maps to a real field on ReviewService's DrillRow where the data
 * exists; KPIs with no backing field have `field: null` and render as "–".
 *
 * `fmt` controls display/RAG:
 *   'pct'    weighted percentage (value already 0–100)
 *   'num'    integer count / total
 *   'flag'   count of schools failing a check (lower is better)
 *   'text'   passthrough label
 *
 * `dir` is the good direction for RAG colouring: 1 = higher is better,
 * -1 = lower is better, 0 = neutral (no RAG dot). `lo`/`hi` bound the
 * expected range for percentage RAG scoring.
 */
export type KpiFmt = 'pct' | 'num' | 'flag' | 'text';

export interface KpiDef {
  /** Stable id (matches the drill topic/field where possible). */
  id: string;
  label: string;
  fmt: KpiFmt;
  /** Good direction: 1 higher-better, -1 lower-better, 0 neutral. */
  dir: 0 | 1 | -1;
  /** Expected range for percentage RAG (only used when fmt === 'pct'). */
  lo?: number;
  hi?: number;
  /**
   * DrillRow field this KPI reads from, or null when the source data has no
   * equivalent (renders as "–"). Some ids are resolved specially in app.ts
   * (e.g. derived girls %); those use field === 'DERIVED'.
   */
  field: string | null;
  /** Drill topic to activate when this KPI is opened (for the shared table). */
  topic: string;
}

export interface KpiModule {
  title: string;
  color: string;
  kpis: KpiDef[];
}

const P = (id: string, label: string, dir: 0 | 1 | -1, lo: number, hi: number, field: string | null, topic: string): KpiDef =>
  ({ id, label, fmt: 'pct', dir, lo, hi, field, topic });
const N = (id: string, label: string, dir: 0 | 1 | -1, field: string | null, topic: string): KpiDef =>
  ({ id, label, fmt: 'num', dir, field, topic });
const F = (id: string, label: string, dir: 0 | 1 | -1, field: string | null, topic: string): KpiDef =>
  ({ id, label, fmt: 'flag', dir, field, topic });

export const KPI_MODULES: KpiModule[] = [
  {
    title: 'State Summary', color: '#1f4e79', kpis: [
      N('sch', 'Schools', 0, 'ns', 'enr'),
      N('stu', 'Students', 0, 'n', 'enr'),
      N('tch', 'Teachers', 0, 'teaching', 'enr'),
      P('a_s', 'Student attendance %', 1, 82, 97, 'att', 'att'),
      P('a_t', 'Teacher attendance %', 1, 91, 99, 'teacherAtt', 'att'),
      N('d15', 'Potential dropouts (15 days absent)', -1, 'drop', 'att'),
      F('gap', 'Schools with critical infra gap', -1, 'gaps', 'inf'),
    ],
  },
  {
    title: 'Enrollment', color: '#0f766e', kpis: [
      N('stu', 'Students', 0, 'n', 'enr'),
      P('gr', 'Enrollment change %', 1, -6, 8, 'chg', 'enr'),
      P('girl', 'Girls %', 0, 46, 52, 'girlsPct', 'enr'),
      P('cwsn', 'CWSN enrollment %', 1, 1, 4, 'cwsnPct', 'enr'),
      P('dro', 'Dropout rate %', -1, 0.5, 4, 'dropRate', 'enr'),
      F('decl', 'Schools with declined enrollment', -1, 'declSchools', 'enr'),
    ],
  },
  {
    title: 'Attendance', color: '#b45309', kpis: [
      P('a_s', 'Student attendance %', 1, 82, 97, 'att', 'att'),
      P('a_t', 'Teacher attendance %', 1, 91, 99, 'teacherAtt', 'att'),
      P('a_c', 'Attendance marking compliance %', 1, 75, 100, 'compliance', 'att'),
      F('a_p', 'Schools pending attendance', -1, 'attPending', 'att'),
      N('d15', 'Potential dropouts (15 days absent)', -1, 'drop', 'att'),
      N('tl', 'Teachers absent 30+ days', -1, 'tl', 'att'),
    ],
  },
  {
    title: 'Infrastructure', color: '#7c3aed', kpis: [
      F('gap', 'Schools with critical infra gap', -1, 'gaps', 'inf'),
      F('i_t', 'No functional toilet', -1, 'infNoToilet', 'inf'),
      F('i_w', 'No drinking water', -1, 'infNoWater', 'inf'),
      F('i_c', 'No CWSN toilet', -1, 'infNoCwsnToilet', 'inf'),
      F('i_e', 'No EB connection', -1, 'infNoEb', 'inf'),
      F('i_k', 'Kitchen shed unavailable', -1, 'infNoKitchen', 'inf'),
      F('i_d', 'Building to be demolished', -1, 'infDemolish', 'inf'),
      F('i_r', 'Repair & renovation pending', -1, 'infRepair', 'inf'),
    ],
  },
  {
    title: 'Academic Performance', color: '#be123c', kpis: [
      P('sc', 'Overall academic score %', 1, 45, 80, 'academicAvg', 'aca'),
      P('sm', 'Improvement over last year %', 1, -3, 9, 'academicChange', 'aca'),
      P('a_lan', 'Tamil/Language avg %', 1, 35, 80, 'acaLanguageAvg', 'aca'),
      P('a_eng', 'English avg %', 1, 35, 80, 'acaEnglishAvg', 'aca'),
      P('a_mat', 'Maths avg %', 1, 35, 80, 'acaMathsAvg', 'aca'),
      P('a_sci', 'Science avg %', 1, 35, 80, 'acaScienceAvg', 'aca'),
      P('a_soc', 'Social avg %', 1, 35, 80, 'acaSocialAvg', 'aca'),
      P('a_cmp', 'Mark-entry completion %', 1, 0, 100, 'acaCompletionPct', 'aca'),
    ],
  },
  {
    title: 'Schemes Coverage', color: '#0369a1', kpis: [
      P('th_c', 'Thiran coverage %', 1, 60, 100, 'sch', 'sch'),
      P('sp', 'TN SPARK coverage %', 1, 55, 98, 'tnSparkPct', 'sch'),
      P('bf', 'Breakfast scheme coverage %', 1, 85, 100, 'breakfastPct', 'sch'),
      F('bx', 'Breakfast exception schools', -1, 'breakfastExcept', 'sch'),
    ],
  },
  {
    title: 'Grievance & Support', color: '#dc2626', kpis: [
      F('cm_o', 'CM Cell open petitions', -1, 'cmOpen', 'sch'),
      F('cm_c', 'CM Cell critical petitions', -1, 'cmCritical', 'sch'),
      F('h_o', '14417 open cases', -1, 'h14417Open', 'sch'),
      F('h_c', '14417 critical cases', -1, 'h14417Critical', 'sch'),
      P('h_r', '14417 resolution %', 1, 70, 99, 'h14417ResPct', 'sch'),
    ],
  },
  {
    title: 'THIRAN+', color: '#4d7c0f', kpis: [
      N('t_s', 'THIRAN+ students identified', 0, 'thiranStudents', 'thiran'),
      F('t_sc', 'Schools covered', 0, 'thiranSchools', 'thiran'),
      P('t_sh', '% of enrolment', 1, 20, 60, 'thiranSharePct', 'thiran'),
      P('t_bl', 'BLO attainment %', 1, 50, 100, 'thiranBloPct', 'thiran'),
      P('t_bu', 'Baseline update %', 1, 30, 100, 'thiranBaselinePct', 'thiran'),
      N('t_nt', 'Students not tagged', -1, 'thiranNotTagged', 'thiran'),
    ],
  },
  {
    title: 'Scholarship', color: '#a21caf', kpis: [
      P('sh_e', 'Scholarship eligibility %', 1, 70, 98, 'scholarEligibilityPct', 'scholarship'),
      P('sh_p', 'Payment success %', 1, 75, 99, 'scholarPaySuccessPct', 'scholarship'),
      N('sh_f', 'Payment failed', -1, 'scholarPayFailed', 'scholarship'),
      N('sh_w', 'Payment pending', -1, 'scholarPayPending', 'scholarship'),
      N('sh_n', 'NPCI inactive', -1, 'scholarNpciInactive', 'scholarship'),
      N('sh_a', 'Aadhaar not updated', -1, 'scholarAadhaar', 'scholarship'),
    ],
  },
  {
    title: 'Digital Infrastructure', color: '#0e7490', kpis: [
      F('g_i', 'Schools with ICT facilities', 1, 'ictSchools', 'inf'),
      F('g_y', 'ICT schools with internet', 1, 'ictInternet', 'inf'),
      F('g_n', 'ICT schools without internet', -1, 'ictNoInternet', 'inf'),
      P('g_fp', 'ICT functional %', 1, 50, 100, 'ictFunctionalPct', 'inf'),
      P('g_ip', 'ICT internet %', 1, 50, 100, 'ictInternetPct', 'inf'),
      F('g_nf', 'ICT not functional', -1, 'ictNotFunctional', 'inf'),
    ],
  },
  {
    title: 'SMC', color: '#9a3412', kpis: [
      N('m_r', 'SMC resolutions raised', 0, 'smcRaised', 'smc'),
      N('m_c', 'Resolutions closed', 1, 'smcClosed', 'smc'),
      N('m_p', 'Pending resolutions', -1, 'smcPending', 'smc'),
      P('m_k', 'Closure rate %', 1, 0, 100, 'smcClosureRate', 'smc'),
      N('m_e', 'Emergency resolutions not closed', -1, 'smcEmergency', 'smc'),
    ],
  },
  {
    title: 'Palli Paarvai', color: '#1d4ed8', kpis: [
      F('p_v', 'Schools visited', 1, 'palliVisited', 'palli'),
      N('p_ob', 'Observations recorded', 1, 'palliObservations', 'palli'),
      N('p_of', 'Officials who observed', 1, 'palliOfficials', 'palli'),
      N('p_br', 'BRTE observations', 1, 'palliBrte', 'palli'),
      N('p_be', 'BEO observations', 1, 'palliBeo', 'palli'),
    ],
  },
];
