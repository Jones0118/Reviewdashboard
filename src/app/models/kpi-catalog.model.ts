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
  /**
   * Whether the KPI gets a tile on the main component-KPI page. Defaults to
   * true; set false (via `hide()`) for supporting metrics that should stay out
   * of the landing grid but remain available in "View details" — they still
   * contribute drill columns, drill tabs and KPI-column-filter entries.
   */
  tile?: boolean;
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
/**
 * Keep a KPI out of the main component-KPI tile grid while leaving it fully
 * available inside "View details" (drill columns, drill KPI tabs, the column
 * filter). Used where the landing page should show only the headline metrics.
 */
const hide = (def: KpiDef): KpiDef => ({ ...def, tile: false });

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
      F('zenr', 'Zero enrolment schools', -1, 'zeroEnrol', 'enr'),
      F('ztea', 'Zero teacher schools', -1, 'zeroTeacher', 'enr'),
      F('stea', 'Single teacher schools', -1, 'singleTeacher', 'enr'),
      F('u10', 'Under 10 students schools', -1, 'under10', 'enr'),
      F('ptr60', 'PTR over 60 schools', -1, 'ptrOver60', 'enr'),
      F('einc', 'Enrollment increase schools', 1, 'enrolIncreaseSchools', 'enr'),
      F('edec', 'Schools with declined enrollment', -1, 'enrolDeclinedSchools', 'enr'),
      P('trn', 'Transition rate — % schools not meeting 100%', -1, 0, 30, 'transitionPendingPct', 'enr'),
    ],
  },
  {
    title: 'Attendance', color: '#b45309', kpis: [
      P('a_s', 'Student attendance %', 1, 82, 97, 'att', 'att'),
      P('a_t', 'Teacher attendance %', 1, 91, 99, 'teacherAtt', 'att'),
      P('a_nm', 'Schools not marked attendance %', -1, 0, 25, 'schoolsNotMarkedPct', 'att'),
      F('a_s60', 'Schools below 60% student attendance', -1, 'attStudentBelow60', 'att'),
      F('a_t60', 'Schools below 60% teacher attendance', -1, 'attTeacherBelow60', 'att'),
      N('d15', 'Potential dropout (15 days absent)', -1, 'drop', 'att'),
      N('tl30', 'Teacher long absent (30+ days)', -1, 'teacherLong30', 'att'),
    ],
  },
  {
    title: 'Infrastructure', color: '#7c3aed', kpis: [
      F('gap', 'School with critical gap', -1, 'gaps', 'inf'),
      F('i_cl', 'Zero classroom', -1, 'infZeroClassroom', 'inf'),
      F('i_t', 'Zero toilet school', -1, 'infNoToilet', 'inf'),
      F('i_w', 'No drinking water school', -1, 'infNoWater', 'inf'),
      F('i_e', 'No EB connection', -1, 'infNoEb', 'inf'),
      F('i_d', 'Building to be demolished', -1, 'infDemolish', 'inf'),
      F('i_cw', 'School has no compound wall', -1, 'infNoCompound', 'inf'),
      F('i_need', 'Schools needing any infra facility', -1, 'infNeedsAny', 'inf'),
      F('i_k', 'No kitchen shed', -1, 'infNoKitchen', 'inf'),
    ],
  },
  {
    title: 'Academic Performance', color: '#be123c', kpis: [
      P('a_pass', 'Pass Percentage %', 1, 40, 95, 'acaPassPct', 'aca'),
      P('a_avg', 'Average Mark', 1, 35, 80, 'academicAvg', 'aca'),
      P('a_yoy', 'Year-on-Year Improvement %', 1, -5, 10, 'academicChange', 'aca'),
      P('a_e2e', 'Exam-to-Exam Improvement (PP)', 1, -5, 10, 'acaExamToExam', 'aca'),
      P('a_cov', 'Assessment Coverage %', 1, 60, 100, 'acaCoveragePct', 'aca'),
      P('a_cmp', 'Mark Entry Completion %', 1, 0, 100, 'acaCompletionPct', 'aca'),
    ],
  },
  /* ===== TEMPORARILY DISABLED — re-enable when ready =====
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
  ===== END DISABLED ===== */
  {
    title: 'THIRAN', color: '#4d7c0f', kpis: [
      N('t_s', 'THIRAN students identified', 0, 'thiranStudents', 'thiran'),
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
    title: 'Digital Infrastructure (Middle/High/Hr.Sec)', color: '#0e7490', kpis: [
      F('g_i', 'Schools with ICT facilities', 1, 'ictSchools', 'inf'),
      F('g_y', 'ICT schools with internet', 1, 'ictInternet', 'inf'),
      F('g_n', 'ICT schools without internet', -1, 'ictNoInternet', 'inf'),
      P('g_fp', 'ICT functional %', 1, 50, 100, 'ictFunctionalPct', 'inf'),
      P('g_ip', 'ICT internet %', 1, 50, 100, 'ictInternetPct', 'inf'),
      F('g_nf', 'ICT not functional', -1, 'ictNotFunctional', 'inf'),
    ],
  },
  {
    // Only the metric-sheet headlines get a tile on the main page:
    //   meetings held / not held / attendance, emergency completion,
    //   other-resolution completion, grant utilisation.
    // Everything else is wrapped in hide() — still present in "View details"
    // (drill columns, drill KPI tabs, column filter), just not on the landing grid.
    title: 'SMC', color: '#9a3412', kpis: [
      // ---- Meetings held, abstract (metric 1) ----
      N('m_mh', 'Schools where meetings were held', 1, 'smcSchoolsHeld', 'smc'),
      N('m_mn', 'Schools where meetings NOT held', -1, 'smcSchoolsNotHeld', 'smc'),
      P('m_ma', 'Meeting attendance %', 1, 50, 100, 'smcMeetAttendPct', 'smc'),
      hide(N('m_mt', 'Meetings held', 1, 'smcMeetings', 'smc')),
      // ---- Resolutions, overall ----
      hide(N('m_r', 'SMC resolutions raised', 0, 'smcRaised', 'smc')),
      hide(N('m_c', 'Resolutions closed', 1, 'smcClosed', 'smc')),
      hide(N('m_p', 'Pending resolutions', -1, 'smcPending', 'smc')),
      hide(P('m_k', 'Closure rate %', 1, 0, 100, 'smcClosureRate', 'smc')),
      // ---- Emergency resolutions completion status (metric 2) ----
      P('m_ek', 'Emergency resolutions completion %', 1, 0, 100, 'smcEmergencyClosureRate', 'smc'),
      hide(N('m_e', 'Emergency resolutions not closed', -1, 'smcEmergency', 'smc')),
      hide(N('m_er', 'Emergency resolved', 1, 'smcEmergencyResolved', 'smc')),
      // ---- Other resolutions completion status (metric 3) ----
      P('m_ok', 'Other resolutions completion %', 1, 0, 100, 'smcOtherClosureRate', 'smc'),
      hide(N('m_or', 'Other resolutions resolved', 1, 'smcOtherResolved', 'smc')),
      hide(N('m_ou', 'Other resolutions unresolved', -1, 'smcOtherOpen', 'smc')),
      // ---- Maintenance & School Composite Grant (metric 4) ----
      // ASSUMED utilisation: the SMC export carries no grant ledger. Allocation
      // follows the published composite-grant enrolment slabs applied to the
      // real roll; the utilised share is deterministic per school.
      P('m_gp', 'Grant utilisation %', 1, 0, 100, 'smcGrantUtilPct', 'smc'),
      hide(N('m_ga', 'Grant allocated (₹ lakh)', 0, 'smcGrantAllocated', 'smc')),
      hide(N('m_gu', 'Grant utilised (₹ lakh)', 1, 'smcGrantUtilised', 'smc')),
    ],
  },
  {
    title: 'Palli Paarvai', color: '#1d4ed8', kpis: [      P('p_co', '% of Class Observation', 1, 50, 100, 'palliClassObsPct', 'palli'),
      P('p_sno', '% of Schools Not Observed (term)', -1, 0, 40, 'palliSchoolsNotObsPct', 'palli'),
      P('p_ono', '% of Officials Not Observed (month)', -1, 0, 30, 'palliOfficialsNotObsPct', 'palli'),
      P('p_s3', '% of Schools Observed 3+ Times', 1, 30, 100, 'palliSchools3PlusPct', 'palli'),
      /* ===== TEMPORARILY DISABLED (on request) — Low / Top performer metrics.
         Re-enable by removing this comment wrapper, then un-comment the matching
         tab (palliKpiTabs), drill id (palliDrillKpis) and @default table in
         app.html. The computeds (palliLowPerformerRows / palliTopPerformerRows)
         are left in place.
      F('p_low', 'Low performers (observation < 75%)', -1, 'palliLowPerformers', 'palli'),
      F('p_top', 'Top performers (observation ≥ 75%)', 1, 'palliTopPerformers', 'palli'),
      ===== */
    ],
  },
  {
    // Recognition Order — Directorate of Private Schools (DPS).
    // Pending Recognition Certificate (RC) applications: who holds the file
    // (district vs state) and how long it has been pending. The three ageing
    // buckets are mutually exclusive so they sum back to the total.
    title: 'Recognition Order - DPS', color: '#7e22ce', kpis: [
      N('dp_tot', 'Total pending applications', -1, 'dpsTotal', 'dps'),
      N('dp_dist', 'District pending', -1, 'dpsDistrictPending', 'dps'),
      N('dp_state', 'State pending', -1, 'dpsStatePending', 'dps'),
      N('dp_l15', 'Pending < 15 days', 0, 'dpsLt15', 'dps'),
      N('dp_l30', 'Pending 15–30 days', -1, 'dpsD15to30', 'dps'),
      N('dp_g30', 'Pending > 30 days', -1, 'dpsGt30', 'dps'),
    ],
  },
  {
    // All Children in School (ACiS) — the Common Pool.
    // Children who left universal data (TC issued) are held in a common pool,
    // surveyed in the field, given a dropout reason, then routed to SMC
    // validation or to re-admission. Metric sheet order is preserved.
    //
    // REAL: acis-real.json (common pool / survey / admission) and acis-pd.json
    // (potential dropouts — EMIS Potential Dropout report). Nothing assumed.
    // Removed on request: TC dropouts, bridged & admitted, bridging duration,
    // to be validated by SMC.
    title: 'All Children in School', color: '#047857', kpis: [
      N('ac_pool', 'Students in Common Pool', -1, 'acisPool', 'acis'),
      N('ac_surv', 'Students surveyed', 1, 'acisSurveyed', 'acis'),
      N('ac_pend', 'Pending to be surveyed', -1, 'acisPendingSurvey', 'acis'),
      P('ac_sp', 'Survey completion %', 1, 50, 100, 'acisSurveyPct', 'acis'),
      N('ac_adm', 'Students admitted to schools', 1, 'acisAdmitted', 'acis'),
      N('ac_tba', 'Students to be admitted', -1, 'acisToBeAdmitted', 'acis'),
      N('ac_rsn', 'Dropouts with reason recorded', 0, 'acisWithReason', 'acis'),
      N('ac_dact', 'Dept. action taken', 1, 'acisDeptTaken', 'acis'),
      N('ac_dpnd', 'Dept. action to be taken', -1, 'acisDeptPending', 'acis'),
      // ---- Dropout rate (REAL): not-re-enrolled common-pool children ÷ enrolment I–XII ----
      P('ac_dr', 'Dropout rate %', -1, 0, 5, 'acisDropRate', 'acis'),
      N('ac_drc', 'Dropouts not re-enrolled', -1, 'acisDropOut', 'acis'),
      // ---- Potential dropouts (REAL — EMIS Potential Dropout report) ----
      // Absent 15+ days in the last 30. Single report window, so PD duration,
      // monthly PD trend and "regularised" have no source and are not built.
      N('ac_pd', 'Potential dropouts (15+ days absent)', -1, 'acisPd', 'acis'),
      P('ac_pdp', 'Potential dropout %', -1, 0, 5, 'acisPdPct', 'acis'),
      N('ac_pdr', 'Potential dropout repeaters', -1, 'acisPdRepeat', 'acis'),
      hide(N('ac_pdrs', 'Potential dropout reasons', 0, 'acisPdWithReason', 'acis')),
      hide(N('ac_pdg', 'Potential dropouts grade-wise', -1, 'acisPd', 'acis')),
    ],
  },
];
