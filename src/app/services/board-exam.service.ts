import { Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import { loadAsset } from '../utils/asset-loader';
import { inr } from '../utils/format';
import { SchoolRow } from '../models/enrollment.model';
import {
  BOARD_CATEGORIES, BOARD_CATEGORY_COLOR, BoardCategory, BoardClass, BoardDistrict, BoardExamData,
  BoardMgmtRow, BoardSchool, BoardSchoolReport, BoardSchoolSubject, BoardStateRow, BoardSubjectCell,
  BoardSubjectRow,
} from '../models/board-exam.model';

/** A child unit of the current scope (district / management / block / school) for charts and tables. */
export interface BoardUnit {
  key: string;
  name: string;
  sub?: string;
  schools: number;
  appeared: number;
  pass: number | null; passDelta: number | null;
  avg: number | null; avgDelta: number | null;
  rank?: number | string;
  cat?: BoardCategory | null;
  /** How to drill: 'district' | 'block' | 'school' | none. */
  drill?: 'district' | 'block' | 'school';
  udise?: string;
  hasReport?: boolean;
  /** True when the figures are synthesized because the report was not ingested. */
  assumed?: boolean;
}

/** "All" sentinels for the global filters. */
export const BOARD_MGMT_ALL = 'All Managements';
export const BOARD_CTYPE_ALL = 'All Categories';

/** One "Needs Your Attention" item (requirement module 7). */
export interface BoardAlert {
  id: string;
  severity: 'Critical' | 'Watch';
  /** What the issue is, e.g. "Pass % fell sharply". */
  kind: string;
  /** Where: the unit this alert is about. */
  where: string;
  /** Its place in the hierarchy, for the drill button. */
  district?: string;
  block?: string;
  school?: string;
  udise?: string;
  subject?: string;
  /** Number of schools the alert covers (1 for a single school). */
  schools: number | null;
  current: number | null;
  previous: number | null;
  change: number | null;
  /** How to read current / previous / change. */
  unit: 'pp' | 'mark' | 'schools';
  /** Which units the consolidated item covers, e.g. "Worst: Villupuram, Ariyalur and 6 more". */
  detail?: string;
  action: string;
  /** What the "Open" button does: a category list, or the units behind a consolidated item. */
  open: { kind: 'category' | 'units'; key: string; cat?: BoardCategory; subject?: string; keys?: string[] } | null;
  assumed?: boolean;
}

/** Thresholds that decide Critical vs Watch. Configurable, not policy. */
export interface BoardThresholds {
  /** Year-on-year change in pass % (pp): a fall of at least this much. */
  yoyDropCritical: number; yoyDropWatch: number;
  /** Average mark below this. */
  avgMarkCritical: number; avgMarkWatch: number;
  /** Subject pass % below this. */
  subjectPassCritical: number; subjectPassWatch: number;
  /** Subject average mark below this. */
  subjectAvgCritical: number; subjectAvgWatch: number;
}
export const BOARD_THRESHOLDS: BoardThresholds = {
  yoyDropCritical: 5, yoyDropWatch: 2,
  avgMarkCritical: 50, avgMarkWatch: 60,
  subjectPassCritical: 80, subjectPassWatch: 90,
  subjectAvgCritical: 50, subjectAvgWatch: 60,
};

/**
 * Board Exam tab: Class X and Class XII performance reports (AY 2025-26),
 * laid out like the other dashboards (Numbers / Trend / Comparison) and
 * driven by the shared breadcrumb: State -> District -> Block -> School.
 *
 * Coverage (honest, not padded):
 *  - State      : state report (38 districts, Govt schools) + state-wide subject
 *                 pass % / average marks for two years (from the school reports'
 *                 "STATE" rows).
 *  - District   : the district report, only for districts whose PDFs were
 *                 ingested (today ARIYALUR); other districts show their state row.
 *  - Block      : aggregated from the district annexure (Govt + Aided schools).
 *  - School     : the annexure row, plus the school's own two-year report when
 *                 its xlsx exists.
 */
@Injectable({ providedIn: 'root' })
export class BoardExamService {
  private readonly ds = inject(DataService);
  private readonly _data = signal<BoardExamData | null>(null);
  private readonly _loaded = signal(false);
  readonly loaded = this._loaded.asReadonly();
  readonly data = this._data.asReadonly();

  async load(): Promise<void> {
    if (this._loaded()) return;
    this._data.set(await loadAsset<BoardExamData>('assets/board-exam.json'));
    this._loaded.set(true);
  }

  // ---- selection ----
  readonly cls = signal<BoardClass>(10);
  setClass(c: BoardClass): void { this.cls.set(c); this.pick.set(null); }
  readonly clsLabel = computed(() => (this.cls() === 10 ? 'Class X' : 'Class XII'));
  readonly year = computed(() => this._data()?.year ?? '');
  readonly prevYear = computed(() => this._data()?.prevYear ?? '');
  readonly subjects = computed(() => this._data()?.subjects[String(this.cls())] ?? []);
  readonly categories = BOARD_CATEGORIES;
  readonly catColor: Record<string, string> = BOARD_CATEGORY_COLOR;
  private readonly block = computed(() => this._data()?.classes[String(this.cls())] ?? null);
  readonly level = computed(() => this.ds.level());
  readonly scopeLabel = computed(() => this.ds.titleCase(this.ds.scopeLabel()));
  readonly levelLabel = computed(() => ({ state: 'State', district: 'District', block: 'Block', school: 'School' }[this.ds.level()]));

  // ================= GLOBAL FILTERS (requirement module 1) =================
  /**
   * Management, Category Type and Academic Year, alongside the Class toggle.
   * They are service signals, so they survive every drill-down step and the
   * Numbers / Trend / Comparison switch, as the requirement asks.
   *
   * What each one can actually reach, given the ingested reports:
   *  - Management  : the district report's section A (one row per management
   *                  group) and the annexure rows, whose printed management is
   *                  mapped onto the report's four groups by `mgmtGroup()`.
   *                  The STATE report covers Government schools only, so at
   *                  state scope the filter cannot narrow anything.
   *  - Category Type: not in the board reports at all. Taken from the
   *                  enrolment roll by UDISE (`SchoolRow.ctype`), so it works
   *                  wherever annexure schools are listed.
   *  - Academic Year: the reports print the current year and its change, so
   *                  the previous year is `value - change`. Only those two
   *                  years are selectable; a previous-year view therefore has
   *                  no change column of its own (shown as N/A).
   */
  readonly fMgmt = signal(BOARD_MGMT_ALL);
  readonly fCtype = signal(BOARD_CTYPE_ALL);
  readonly fYear = signal<'cur' | 'prev'>('cur');
  readonly mgmtFilterOptions = computed(() => [
    BOARD_MGMT_ALL, ...(this._data()?.managements ?? []).filter((m) => m !== BOARD_MGMT_ALL),
  ]);
  /** School category type per UDISE, from the enrolment roll for the district in scope. */
  private readonly ctypeByUdise = computed(() => {
    const m = new Map<string, string>();
    const d = this.ds.selectedDistrict();
    if (!d) return m;
    for (const r of this.ds.schoolRowsFor(d)) m.set(r.udise, r.ctype);
    return m;
  });
  readonly ctypeFilterOptions = computed(() => {
    const by = this.ctypeByUdise();
    const seen = new Set<string>();
    for (const s of this.annexureSchools()) { const c = by.get(s.udise); if (c) seen.add(c); }
    return [BOARD_CTYPE_ALL, ...[...seen].sort()];
  });
  readonly yearFilterOptions = computed(() => [
    { value: 'cur' as const, label: this.year() }, { value: 'prev' as const, label: this.prevYear() },
  ]);
  readonly activeYear = computed(() => (this.fYear() === 'cur' ? this.year() : this.prevYear()));
  readonly isPrevYear = computed(() => this.fYear() === 'prev');
  readonly hasFilters = computed(() => this.fMgmt() !== BOARD_MGMT_ALL || this.fCtype() !== BOARD_CTYPE_ALL || this.fYear() !== 'cur');
  resetFilters(): void {
    this.fMgmt.set(BOARD_MGMT_ALL);
    this.fCtype.set(BOARD_CTYPE_ALL);
    this.fYear.set('cur');
    this.pick.set(null);
  }
  /** The chips shown above the dashboard: active filters plus the geographic level. */
  readonly filterChips = computed(() => [
    { label: 'Class', value: this.clsLabel() },
    { label: 'Management', value: this.fMgmt() },
    { label: 'Category', value: this.fCtype() },
    { label: 'Academic year', value: this.activeYear() },
    { label: this.levelLabel(), value: this.scopeLabel() },
  ]);
  /** Honest note when a filter cannot be applied to the figures on screen. */
  readonly filterScopeNote = computed(() => {
    const bits: string[] = [];
    const lvl = this.ds.level();
    if (lvl === 'state') {
      if (this.fMgmt() !== BOARD_MGMT_ALL && this.fMgmt() !== 'Govt SED') bits.push(`the state report covers Government schools only, so "${this.fMgmt()}" cannot be isolated at state level`);
      if (this.fCtype() !== BOARD_CTYPE_ALL) bits.push('the state report has no school-category split');
    } else if (!this.district()) {
      bits.push(`the district report for ${this.scopeLabel()} has not been ingested, so only its state row (Government schools) is available`);
    } else {
      if (this.fMgmt() === 'Private') bits.push('private schools are not printed in the district annexures, so school-level rows are empty for them');
    }
    return bits.length ? `Filter not fully applied: ${bits.join('; ')}.` : '';
  });
  /**
   * Report management group for a management string, used for both the printed
   * annexure values ("Govt SED", "ADW", a stray "0 Govt SED") and the
   * enrolment roll's much longer names.
   */
  mgmtGroup(m: string): string {
    const s = (m || '').toUpperCase().trim();
    // "UNAIDED" contains "AIDED", so private has to be tested first
    if (/UNAIDED|UN-AIDED|PRIVATE|RECOGNIS/.test(s)) return 'Private';
    if (s.includes('AIDED')) return 'Aided';
    if (/SCHOOL EDUCATION|GOVT SED/.test(s)) return 'Govt SED';
    if (/ADW|WELFARE|MUNICIPAL|CORPORATION|CENTRAL|RAILWAY|DEFENCE|FOREST|TRIBAL|DEPARTMENT|VID\w?YALAYA|SAINIK|BORSTAL|ARANILAYAM|SPECIAL|KALLAR|ORIENTAL|ATOMIC|ARMY|OTHER/.test(s)) return 'Other Govt Depts';
    return 'Govt SED';
  }
  /** Does this annexure row pass the management + category filters? */
  private keep(s: BoardSchool): boolean {
    const m = this.fMgmt();
    if (m !== BOARD_MGMT_ALL && this.mgmtGroup(s.mgmt) !== m) return false;
    const c = this.fCtype();
    if (c !== BOARD_CTYPE_ALL && this.ctypeByUdise().get(s.udise) !== c) return false;
    return true;
  }
  /** Value for the selected academic year: as printed, or the previous year derived from its change. */
  private py(cur: number | null | undefined, delta: number | null | undefined): number | null {
    if (this.fYear() === 'cur') return cur ?? null;
    return cur == null || delta == null ? null : this.r1(cur - delta);
  }
  /** The reports carry one year-on-year change, so a previous-year view has none of its own. */
  private pd(delta: number | null | undefined): number | null { return this.fYear() === 'cur' ? delta ?? null : null; }

  band(avg: number | null | undefined): BoardCategory | null {
    if (avg == null) return null;
    return avg > 70 ? 'Good' : avg > 60 ? 'Satisfactory' : avg > 50 ? 'Needs Improvement' : 'Poor';
  }
  delta(a: number | null | undefined, b: number | null | undefined): number | null { return a == null || b == null ? null : Math.round((b - a) * 10) / 10; }
  private r1(v: number): number { return Math.round(v * 10) / 10; }
  private wavg(rows: { v: number | null; w: number }[]): number | null {
    const ok = rows.filter((r) => r.v != null && r.w > 0);
    const w = ok.reduce((s, r) => s + r.w, 0);
    return w ? this.r1(ok.reduce((s, r) => s + (r.v as number) * r.w, 0) / w) : null;
  }
  /**
   * The reports and the enrolment roll spell several districts differently
   * ("TRICHY" / "TIRUCHIRAPPALLI", "OOTY" / "THE NILGIRIS"). Strip everything
   * but letters and map the report spellings onto the roll's.
   */
  private static readonly DISTRICT_ALIAS: Record<string, string> = {
    PUDUKOTTAI: 'PUDUKKOTTAI', TRICHY: 'TIRUCHIRAPPALLI', TUTICORIN: 'THOOTHUKKUDI',
    KANYAKUMARI: 'KANNIYAKUMARI', OOTY: 'THENILGIRIS', NILGIRIS: 'THENILGIRIS',
    TIRUPPATHURV: 'TIRUPATHUR', TIRUPPATHUR: 'TIRUPATHUR', TIRUPATTUR: 'TIRUPATHUR',
    KALLACURICHY: 'KALLAKURICHI', TIRUVALLORE: 'TIRUVALLUR', RANIPETTAI: 'RANIPET',
    THENILGIRIS: 'THENILGIRIS',
  };
  private norm(s: string): string {
    const k = (s || '').toUpperCase().replace(/[^A-Z]/g, '');
    return BoardExamService.DISTRICT_ALIAS[k] ?? k;
  }
  sameDistrict(a: string, b: string): boolean { return this.norm(a) === this.norm(b); }

  // ================= STATE =================
  // Per-class accessors (the head-to-head compares classes and years, so the
  // current-class computeds below are thin wrappers over these).
  private blockFor(cls: BoardClass) { return this._data()?.classes[String(cls)] ?? null; }
  subjectsFor(cls: BoardClass): string[] { return this._data()?.subjects[String(cls)] ?? []; }
  private stateTotalFor(cls: BoardClass) { return this.blockFor(cls)?.state.total ?? null; }
  private stateRowsFor(cls: BoardClass): BoardStateRow[] { return this.blockFor(cls)?.state.districts ?? []; }
  private scopeStateRowFor(cls: BoardClass): BoardStateRow | null {
    const d = this.ds.selectedDistrict();
    return d ? this.stateRowsFor(cls).find((r) => this.sameDistrict(r.district, d)) ?? null : null;
  }
  private stateSubjectsFor(cls: BoardClass) {
    const reps = Object.values(this.blockFor(cls)?.schoolReports ?? {});
    const out = new Map<string, { subject: string; pass: (number | null)[]; avg: (number | null)[] }>();
    for (const r of reps) for (const s of r.subjects) if (!out.has(s.subject)) out.set(s.subject, { subject: s.subject, pass: s.statePass, avg: s.stateAvg });
    return [...out.values()];
  }
  private refDistrictFor(cls: BoardClass): BoardDistrict | null { return Object.values(this.blockFor(cls)?.districts ?? {})[0] ?? null; }
  private realDistrictFor(cls: BoardClass): BoardDistrict | null {
    const d = this.ds.selectedDistrict();
    if (!d) return null;
    const m = this.blockFor(cls)?.districts ?? {};
    const key = Object.keys(m).find((k) => this.sameDistrict(k, d));
    return key ? m[key] : null;
  }
  /** District detail for a class: the ingested report, else the assumed one. */
  districtFor(cls: BoardClass): BoardDistrict | null {
    return this.realDistrictFor(cls) ?? (cls === 10 ? this.assumedDistrict10() : this.assumedDistrict12());
  }

  readonly stateTotal = computed(() => this.stateTotalFor(this.cls()));
  readonly stateRows = computed<BoardStateRow[]>(() => this.stateRowsFor(this.cls()));
  readonly detailDistricts = computed(() => Object.keys(this.block()?.districts ?? {}));
  hasDetail(district: string): boolean { return this.detailDistricts().some((d) => this.sameDistrict(d, district)); }
  /** State row for the selected district (breadcrumb). */
  readonly scopeStateRow = computed(() => this.scopeStateRowFor(this.cls()));
  /**
   * State-wide subject figures, both years, from the school reports' STATE rows
   * (the only state-level per-subject source in the folder). Class XII covers
   * the subjects the sample school sat.
   */
  readonly stateSubjects = computed(() => this.stateSubjectsFor(this.cls()));
  readonly stateYears = computed(() => Object.values(this.block()?.schoolReports ?? {})[0]?.years ?? [this.prevYear(), this.year()]);

  // ================= DISTRICT =================
  /** The ingested district report, when this district's PDFs were parsed (today: ARIYALUR). */
  readonly realDistrict = computed<BoardDistrict | null>(() => this.realDistrictFor(this.cls()));
  /** The district report in scope: ingested where available, otherwise assumed (see `assumedDistrict`). */
  readonly district = computed<BoardDistrict | null>(() => this.realDistrict() ?? this.assumedDistrict());
  /** True when the district / block / school figures on screen are synthesized, not printed. */
  readonly assumed = computed(() => this.ds.level() !== 'state' && !this.realDistrict() && !!this.assumedDistrict());
  readonly byMgmt = computed(() => this.district()?.byMgmt ?? []);
  readonly allMgmt = computed(() => this.byMgmt().find((r) => r.mgmt === BOARD_MGMT_ALL) ?? null);
  /** The management row the filter selects (All Managements when the filter is off). */
  readonly filterMgmtRow = computed(() => this.byMgmt().find((r) => r.mgmt === this.fMgmt()) ?? this.allMgmt());
  readonly subjectMgmts = computed(() => {
    const rows = this.district()?.subject ?? [];
    return (this._data()?.managements ?? []).slice(0, 4).filter((m) => rows.some((r) => (r[m] as BoardSubjectCell)?.reliable));
  });

  // ---------- assumed district detail ----------
  /** Deterministic 0..1 from a key, so an assumed figure never changes between renders. */
  private hash01(key: string, salt: string, cls: BoardClass = this.cls()): number {
    let h = 2166136261;
    const s = `${key}|${salt}|${cls}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  /** Signed spread in ±`range`. */
  private spread(key: string, salt: string, range: number, cls: BoardClass = this.cls()): number {
    return (this.hash01(key, salt, cls) - 0.5) * 2 * range;
  }
  private clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
  /** The reference report whose real shape (subject pattern, state series) the assumptions borrow. */
  private readonly refDistrict = computed<BoardDistrict | null>(() => this.refDistrictFor(this.cls()));
  /** Real subject offsets from "All Subjects", taken from the reference district's section D (Govt SED). */
  private subjectShapeFor(cls: BoardClass): Record<string, number> {
    const ref = this.refDistrictFor(cls); const out: Record<string, number> = {};
    if (!ref) return out;
    const all = this.cell(ref.subject.find((r) => r.subject === 'All Subjects') ?? {}, 'Govt SED')?.avg ?? null;
    for (const r of ref.subject) {
      if (r.subject === 'All Subjects') continue;
      const c = this.cell(r, 'Govt SED');
      out[r.subject] = c?.avg != null && all != null ? this.r1(c.avg - all) : 0;
    }
    return out;
  }
  /** Roll schools that can sit this board exam: class X needs a High / Hr.Sec school, class XII a Hr.Sec one. */
  private rollEligible(district: string, cls: BoardClass): { row: SchoolRow; block: string }[] {
    const want = cls === 10 ? ['High School', 'Higher Secondary School'] : ['Higher Secondary School'];
    const out: { row: SchoolRow; block: string }[] = [];
    for (const b of this.ds.blocksForDistrict()) {
      for (const row of this.ds.schoolRowsFor(district, b.block)) {
        if (want.includes(row.ctype)) out.push({ row, block: b.block });
      }
    }
    return out;
  }
  /**
   * District detail for the 37 districts whose reports were not ingested.
   *
   * Anchored on everything real that IS available — the district's row in the
   * state report (schools, appeared, pass %, average mark and both changes),
   * the enrolment roll (school names, UDISE, block, management, category and
   * the real class X / XII enrolment) and the reference district's real
   * subject shape and state series — with only the per-school spread around
   * those anchors synthesized from a hash of the UDISE. Everything built here
   * is flagged `assumed` and badged in the UI.
   */
  private readonly assumedDistrict10 = computed<BoardDistrict | null>(() => this.buildAssumed(10));
  private readonly assumedDistrict12 = computed<BoardDistrict | null>(() => this.buildAssumed(12));
  private readonly assumedDistrict = computed<BoardDistrict | null>(() => (this.cls() === 10 ? this.assumedDistrict10() : this.assumedDistrict12()));
  private buildAssumed(cls: BoardClass): BoardDistrict | null {
    const name = this.ds.selectedDistrict();
    const row = this.scopeStateRowFor(cls);
    const ref = this.refDistrictFor(cls);
    if (!name || !row || !ref) return null;
    const roll = this.rollEligible(name, cls);
    if (!roll.length) return null;
    const subjectList = this.subjectsFor(cls);
    const shape = this.subjectShapeFor(cls);
    const sp = (key: string, salt: string, range: number) => this.spread(key, salt, range, cls);
    const h01 = (key: string, salt: string) => this.hash01(key, salt, cls);
    const gi = cls === 10 ? 12 : 14; // GRADE_ORDER index of X / XII
    const mgmtBump: Record<string, number> = { 'Govt SED': 0, 'Other Govt Depts': -1.5, Aided: 5.5, Private: 9 };

    const schools: BoardSchool[] = roll.map(({ row: r, block }) => {
      const group = this.mgmtGroup(r.mgmt);
      const enrol = (r.gb?.[gi] ?? 0) + (r.gg?.[gi] ?? 0);
      const appeared = Math.round(enrol * 0.97);
      const avg = this.r1(this.clamp(row.avg + mgmtBump[group] + sp(r.udise, 'avg', 13), 28, 92));
      const avgDelta = this.r1(this.clamp(row.avgDelta + sp(r.udise, 'avgd', 5), -25, 20));
      const pass = this.r1(this.clamp(row.pass + (avg - row.avg) * 1.1 + sp(r.udise, 'pass', 4), 25, 100));
      const passDelta = this.r1(this.clamp(row.passDelta + sp(r.udise, 'passd', 6), -30, 25));
      const subjects: Record<string, BoardSchoolSubject> = {};
      for (const s of subjectList) {
        const sa = this.r1(this.clamp(avg + (shape[s] ?? 0) + sp(r.udise, 's-' + s, 7), 20, 98));
        subjects[s] = { avg: sa, avgDelta: this.r1(this.clamp(avgDelta + sp(r.udise, 'sd-' + s, 5), -30, 25)), rankState: '', rankDistrict: '' };
      }
      return {
        block, udise: r.udise, name: r.name, mgmt: r.mgmt, appeared,
        supplementary: Math.round((appeared * (100 - pass)) / 100),
        prevPerf: this.band(this.r1(avg - avgDelta)) ?? '', perf: this.band(avg) ?? '',
        pass, passDelta, avg, avgDelta, rankState: '', rankDistrict: '', subjects,
        annexure: (group === 'Aided' ? 'Aided' : 'Govt') as 'Govt' | 'Aided',
      };
    }).filter((s) => (s.appeared ?? 0) > 0); // a school with no class X / XII roll did not sit the exam
    if (!schools.length) return null;
    // ranks, consistent with the figures above
    const stateTotalSchools = this.stateTotalFor(cls)?.schools ?? schools.length;
    const byAvg = [...schools].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
    byAvg.forEach((s, i) => {
      s.rankDistrict = `${i + 1}/${schools.length}`;
      s.rankState = `${Math.max(1, Math.round(((i + 1) / schools.length) * stateTotalSchools * (0.6 + h01(s.udise, 'rk') * 0.8)))}/${stateTotalSchools}`;
      for (const k of Object.keys(s.subjects)) {
        const rk = Math.max(1, Math.round(((i + 1) / schools.length) * schools.length * (0.5 + h01(s.udise, 'srk-' + k))));
        s.subjects[k].rankDistrict = `${Math.min(schools.length, rk)}/${schools.length}`;
        s.subjects[k].rankState = `${Math.max(1, Math.round((rk / schools.length) * stateTotalSchools))}/${stateTotalSchools}`;
      }
    });

    // section A: one row per management group, plus All Managements
    const refMgmt = new Map(ref.byMgmt.map((m) => [m.mgmt, m]));
    const totalAppeared = schools.reduce((s, r) => s + (r.appeared ?? 0), 0) || 1;
    const groups = [...new Set(schools.map((s) => this.mgmtGroup(s.mgmt)))];
    const order = (this._data()?.managements ?? []).filter((m) => m !== BOARD_MGMT_ALL);
    const mgmtRow = (label: string, rows: BoardSchool[]): BoardMgmtRow => {
      const ap = rows.reduce((s, r) => s + (r.appeared ?? 0), 0);
      const w = (pick: (r: BoardSchool) => number | null) => this.wavg(rows.map((r) => ({ v: pick(r), w: r.appeared ?? 0 })));
      const rm = refMgmt.get(label) ?? refMgmt.get('Govt SED') ?? null;
      return {
        mgmt: label, schools: rows.length, appeared: ap, appearedPct: Math.round((ap / totalAppeared) * 100),
        pass: w((r) => r.pass), passDelta: w((r) => r.passDelta), avg: w((r) => r.avg), avgDelta: w((r) => r.avgDelta),
        statePass: rm?.statePass ?? null, statePassDelta: rm?.statePassDelta ?? null,
        stateAvg: rm?.stateAvg ?? null, stateAvgDelta: rm?.stateAvgDelta ?? null,
        supplementary: rows.reduce((s, r) => s + (r.supplementary ?? 0), 0),
      };
    };
    const byMgmt = [
      ...order.filter((g) => groups.includes(g)).map((g) => mgmtRow(g, schools.filter((s) => this.mgmtGroup(s.mgmt) === g))),
      mgmtRow(BOARD_MGMT_ALL, schools),
    ];

    // section D: subject x management
    const subject: BoardSubjectRow[] = [...subjectList, 'All Subjects'].map((sub) => {
      const cells: Record<string, BoardSubjectCell | string> = { subject: sub };
      for (const g of order) {
        const rows = schools.filter((s) => this.mgmtGroup(s.mgmt) === g);
        if (!rows.length) continue;
        const pickAvg = (r: BoardSchool) => (sub === 'All Subjects' ? r.avg : r.subjects[sub]?.avg ?? null);
        const pickDelta = (r: BoardSchool) => (sub === 'All Subjects' ? r.avgDelta : r.subjects[sub]?.avgDelta ?? null);
        const avg = this.wavg(rows.map((r) => ({ v: pickAvg(r), w: r.appeared ?? 0 })));
        const gAvg = this.wavg(rows.map((r) => ({ v: r.avg, w: r.appeared ?? 0 })));
        const gPass = this.wavg(rows.map((r) => ({ v: r.pass, w: r.appeared ?? 0 })));
        cells[g] = {
          avg, avgDelta: this.wavg(rows.map((r) => ({ v: pickDelta(r), w: r.appeared ?? 0 }))),
          pass: avg == null || gAvg == null || gPass == null ? null : this.r1(this.clamp(gPass + (avg - gAvg) * 0.55, 30, 100)),
          passDelta: this.wavg(rows.map((r) => ({ v: r.passDelta, w: r.appeared ?? 0 }))),
          reliable: true,
        };
      }
      return cells as BoardSubjectRow;
    });

    const count = (pick: (s: BoardSchool) => BoardCategory | null) =>
      Object.fromEntries(BOARD_CATEGORIES.map((c) => [c, schools.filter((s) => pick(s) === c).length])) as Record<BoardCategory, number>;

    // 5-year trend: the last two years are real (state row + its change); the
    // state and best-district lines are the reference report's real series;
    // the district's earlier years follow the state shape.
    const t = ref.trend;
    const mkSeries = (metric: 'pass' | 'avg') => {
      const cur = metric === 'pass' ? row.pass : row.avg;
      const prev = this.r1(cur - (metric === 'pass' ? row.passDelta : row.avgDelta));
      const st = t[metric].state;
      const scale = st[st.length - 1] ? cur / st[st.length - 1] : 1;
      const early = st.slice(0, 3).map((v, i) => this.r1(this.clamp(v * scale + sp(name, `${metric}-y${i}`, 3), metric === 'pass' ? 40 : 30, 100)));
      return { district: [...early, prev, cur], state: st, best: t[metric].best, bestNames: t[metric].bestNames };
    };
    return {
      district: name, byMgmt, subject, schools,
      trend: { years: t.years, pass: mkSeries('pass'), avg: mkSeries('avg') },
      overall: this.band(row.avg) ?? '',
      schoolCats: count((s) => this.band(s.avg)),
      schoolCatsPrev: count((s) => this.band(s.avg == null || s.avgDelta == null ? null : s.avg - s.avgDelta)),
      subjectCats: subjectList.map((k) => ({
        subject: k,
        ...Object.fromEntries(BOARD_CATEGORIES.map((c) => [c, schools.filter((s) => this.band(s.subjects[k]?.avg) === c).length])),
      })) as BoardDistrict['subjectCats'],
    };
  }
  cell(row: Record<string, unknown>, mgmt: string): BoardSubjectCell | null {
    const c = row[mgmt]; return c && typeof c === 'object' ? (c as BoardSubjectCell) : null;
  }

  // ================= BLOCK / SCHOOL (annexure) =================
  /** Annexure schools in the current scope (district or block), before the filters. */
  readonly annexureSchools = computed<BoardSchool[]>(() => {
    const d = this.district(); if (!d) return [];
    const b = this.ds.selectedBlock();
    return b ? d.schools.filter((s) => this.norm(s.block) === this.norm(b)) : d.schools;
  });
  /** Annexure schools after the Management and Category Type filters. */
  readonly scopeSchools = computed<BoardSchool[]>(() => this.annexureSchools().filter((s) => this.keep(s)));
  /** The school in scope, by UDISE from the roll record the breadcrumb points at. */
  readonly school = computed<BoardSchool | null>(() => {
    if (this.ds.level() !== 'school') return null;
    const u = this.ds.currentSchool()?.udise;
    return u ? this.annexureSchools().find((s) => s.udise === u) ?? null : null;
  });
  readonly schoolReport = computed<BoardSchoolReport | null>(() => {
    const u = this.ds.currentSchool()?.udise;
    return u ? this.block()?.schoolReports[u] ?? null : null;
  });
  hasReport(udise: string): boolean { return !!this.block()?.schoolReports[udise]; }
  /** Drill into a school from the annexure (the roll row with that UDISE sits in the same block). */
  drillToSchool(s: BoardSchool): void {
    if (this.norm(this.ds.selectedBlock() ?? '') !== this.norm(s.block)) this.ds.drillToBlock(this.rollBlockName(s.block));
    const roll = this.ds.schoolsForBlock().find((r) => r.udise === s.udise);
    if (roll) this.ds.drillToSchool(roll.name);
  }
  private rollBlockName(b: string): string {
    return this.ds.blocksForDistrict().find((x) => this.norm(x.block) === this.norm(b))?.block ?? b;
  }

  // ================= UNITS: the children of the current scope =================
  private unitFromSchools(key: string, name: string, rows: BoardSchool[], drill: BoardUnit['drill']): BoardUnit {
    const appeared = rows.reduce((s, r) => s + (r.appeared ?? 0), 0);
    const w = (pick: (r: BoardSchool) => number | null) => this.wavg(rows.map((r) => ({ v: pick(r), w: r.appeared ?? 0 })));
    const avg = w((r) => this.py(r.avg, r.avgDelta));
    return {
      key, name, schools: rows.length, appeared, drill,
      pass: w((r) => this.py(r.pass, r.passDelta)), passDelta: this.pd(w((r) => r.passDelta)),
      avg, avgDelta: this.pd(w((r) => r.avgDelta)), cat: this.band(avg),
      sub: `${rows.length} schools`, assumed: this.assumed(),
    };
  }
  /** Children of the current scope: districts (state) / blocks (district) / schools (block). */
  readonly units = computed<BoardUnit[]>(() => {
    const lvl = this.ds.level();
    if (lvl === 'state') {
      return this.stateRows().map((r) => {
        const avg = this.py(r.avg, r.avgDelta);
        return {
          key: r.district, name: this.ds.titleCase(r.district), schools: r.schools, appeared: r.appeared,
          pass: this.py(r.pass, r.passDelta), passDelta: this.pd(r.passDelta), avg, avgDelta: this.pd(r.avgDelta),
          rank: this.isPrevYear() ? undefined : r.rank, cat: this.band(avg),
          drill: 'district' as const, sub: `${r.schools} Govt schools`, hasReport: this.hasDetail(r.district),
        };
      });
    }
    if (lvl === 'district') {
      const d = this.district(); if (!d) return [];
      const rows = this.scopeSchools();
      const blocks = [...new Set(rows.map((s) => s.block))].sort();
      return blocks.map((b) => this.unitFromSchools(b, b, rows.filter((s) => s.block === b), 'block'));
    }
    if (lvl === 'block') {
      return this.scopeSchools().map((s) => {
        const avg = this.py(s.avg, s.avgDelta);
        return {
          key: s.udise, udise: s.udise, name: s.name, sub: `${s.mgmt} · ${s.udise}`, schools: 1, appeared: s.appeared ?? 0,
          pass: this.py(s.pass, s.passDelta), passDelta: this.pd(s.passDelta), avg, avgDelta: this.pd(s.avgDelta),
          rank: s.rankDistrict, cat: (this.isPrevYear() ? this.band(avg) : (s.perf as BoardCategory)) ?? this.band(avg),
          drill: 'school' as const, hasReport: this.hasReport(s.udise), assumed: this.assumed(),
        };
      });
    }
    return [];
  });
  readonly unitLabel = computed(() => ({ state: 'District', district: 'Block', block: 'School', school: 'School' }[this.ds.level()]));
  drill(u: BoardUnit): void {
    this.pick.set(null);
    if (u.drill === 'district') this.ds.drillToDistrict(u.key);
    else if (u.drill === 'block') this.ds.drillToBlock(this.rollBlockName(u.key));
    else if (u.drill === 'school') { const s = this.annexureSchools().find((x) => x.udise === u.udise); if (s) this.drillToSchool(s); }
  }

  // ================= NUMBERS: KPIs =================
  /** Headline figures for the scope: pass %, average mark, appeared; each with YoY change where known. */
  readonly kpis = computed(() => {
    const lvl = this.ds.level();
    const mk = (pass: number | null, pd: number | null, avg: number | null, ad: number | null, appeared: number | null, schools: number | null, extra: string) =>
      [{ label: 'Pass %', value: pass == null ? '–' : `${pass}%`, delta: pd, icon: 'fa-solid fa-circle-check' },
       { label: 'Average mark', value: avg == null ? '–' : `${avg}`, delta: ad, icon: 'fa-solid fa-pen-ruler' },
       { label: 'Year-on-year improvement', value: pd == null ? 'N/A' : `${pd >= 0 ? '+' : ''}${pd} pp`, delta: null, icon: pd == null ? 'fa-solid fa-arrows-left-right' : pd >= 0 ? 'fa-solid fa-arrow-trend-up' : 'fa-solid fa-arrow-trend-down',
         tone: pd == null ? '' : pd >= 0 ? 'up' : 'down',
         sub: pd == null ? (this.isPrevYear() ? `no comparison year before ${this.prevYear()}` : 'change not printed') : `pass % vs AY ${this.prevYear()}${ad == null ? '' : ` · avg mark ${ad >= 0 ? '+' : ''}${ad}`}` },
       { label: 'Students appeared', value: appeared == null ? '–' : inr(appeared), delta: null, icon: 'fa-solid fa-user-graduate', sub: extra || (schools != null ? `${inr(schools)} schools` : '') }];
    if (lvl === 'state') {
      const t = this.stateTotal();
      return t ? mk(this.py(t.pass, t.passDelta), this.pd(t.passDelta), this.py(t.avg, t.avgDelta), this.pd(t.avgDelta), t.appeared, t.schools, `${inr(t.schools)} Govt schools`) : [];
    }
    if (lvl === 'district') {
      const am = this.filterMgmtRow();
      if (am) return mk(this.py(am.pass, am.passDelta), this.pd(am.passDelta), this.py(am.avg, am.avgDelta), this.pd(am.avgDelta), am.appeared, am.schools,
        `${inr(am.schools)} schools · ${am.mgmt}`);
      const r = this.scopeStateRow();
      return r ? mk(this.py(r.pass, r.passDelta), this.pd(r.passDelta), this.py(r.avg, r.avgDelta), this.pd(r.avgDelta), r.appeared, r.schools, `${r.schools} Govt schools · rank ${r.rank} of 38`) : [];
    }
    if (lvl === 'block') {
      const u = this.unitFromSchools('b', '', this.scopeSchools(), undefined);
      return mk(u.pass, u.passDelta, u.avg, u.avgDelta, u.appeared, u.schools, `${u.schools} schools in the annexure`);
    }
    const s = this.school(); const r = this.schoolReport();
    const i = this.isPrevYear() ? 0 : 1;
    if (r) {
      const o = r.overall;
      return mk(o.pass[i], this.isPrevYear() ? null : this.delta(o.pass[0], o.pass[1]), o.avg[i], this.isPrevYear() ? null : this.delta(o.avg[0], o.avg[1]),
        o.appeared[i], 1, `rank ${o.rankDistrict[i]} in district · ${o.rating[i]}`);
    }
    return s ? mk(this.py(s.pass, s.passDelta), this.pd(s.passDelta), this.py(s.avg, s.avgDelta), this.pd(s.avgDelta), s.appeared, 1,
      `rank ${s.rankDistrict} in district · ${this.isPrevYear() ? s.prevPerf : s.perf}`) : [];
  });
  /** Overall category for the scope. */
  readonly scopeCat = computed<BoardCategory | null>(() => {
    const lvl = this.ds.level();
    if (lvl === 'district') {
      const am = this.filterMgmtRow();
      if (am) return this.band(this.py(am.avg, am.avgDelta));
      return (this.district()?.overall as BoardCategory) ?? this.band(this.py(this.scopeStateRow()?.avg, this.scopeStateRow()?.avgDelta));
    }
    if (lvl === 'school') {
      const i = this.isPrevYear() ? 0 : 1;
      return (this.schoolReport()?.overall.rating[i] as BoardCategory)
        ?? ((this.isPrevYear() ? this.school()?.prevPerf : this.school()?.perf) as BoardCategory) ?? null;
    }
    if (lvl === 'block') return this.unitFromSchools('b', '', this.scopeSchools(), undefined).cat ?? null;
    const t = this.stateTotal();
    return this.band(this.py(t?.avg, t?.avgDelta));
  });

  // ================= NUMBERS: pass % and average mark charts =================
  /**
   * The unit charts show a slice, not all 38 districts: Top / Bottom N, with
   * Top 5 as the default and "View all" switching to every unit, highest to
   * lowest. Both charts share the control so they stay comparable.
   */
  readonly unitRank = signal<'top' | 'bottom'>('top');
  readonly unitCount = signal<number | 'all'>(5);
  /** String form for the <select>, whose option values are always strings. */
  readonly unitCountValue = computed(() => String(this.unitCount()));
  readonly unitShowAll = computed(() => this.unitCount() === 'all');
  readonly unitCountOptions = [5, 10, 20, 'all'] as const;
  setUnitCount(v: number | string): void { this.unitCount.set(v === 'all' ? 'all' : +v); }
  viewAllUnits(): void { this.unitCount.set('all'); }
  /** The units the charts draw: sorted by the metric, then sliced to Top / Bottom N. */
  private unitSlice(metric: 'pass' | 'avg'): BoardUnit[] {
    const all = [...this.units()].filter((u) => u[metric] != null).sort((a, b) => (b[metric] as number) - (a[metric] as number));
    const n = this.unitCount();
    if (n === 'all' || all.length <= n) return all;
    return this.unitRank() === 'top' ? all.slice(0, n) : all.slice(-n).reverse();
  }
  readonly passChartRows = computed(() => this.unitSlice('pass'));
  readonly avgChartRows = computed(() => this.unitSlice('avg'));
  /** How the chart titles describe what is on screen. */
  readonly unitSliceLabel = computed(() => {
    const n = this.unitCount();
    const unit = (this.unitLabel() + 's').toLowerCase();
    if (n === 'all') return `all ${this.units().length} ${unit}, highest to lowest`;
    const shown = Math.min(n, this.units().length);
    return `${this.unitRank() === 'top' ? 'top' : 'bottom'} ${shown} ${unit}`;
  });
  private unitBar(metric: 'pass' | 'avg', ref: number | null, refLabel: string) {
    const rows = metric === 'pass' ? this.passChartRows() : this.avgChartRows();
    if (!rows.length) return {};
    const many = rows.length > 12;
    const isPct = metric === 'pass';
    const min = isPct ? Math.max(0, Math.floor((Math.min(...rows.map((u) => u[metric] as number)) - 5) / 5) * 5) : 0;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => { const u = rows[ps[0].dataIndex]; const d = u[isPct ? 'passDelta' : 'avgDelta'];
          return `<b>${u.name}</b>${u.sub ? ` · ${u.sub}` : ''}<br/>${isPct ? 'Pass' : 'Average mark'} <b>${u[metric]}${isPct ? '%' : ''}</b>${d == null ? '' : ` (${d >= 0 ? '+' : ''}${d} vs last year)`}${u.rank != null ? `<br/>Rank ${u.rank}` : ''}`; } },
      grid: { left: 44, right: 16, top: 28, bottom: many ? 90 : 48 },
      xAxis: { type: 'category', data: rows.map((u) => u.name), axisLabel: { fontSize: 10, interval: 0, rotate: many ? 45 : (rows.length > 6 ? 25 : 0), width: many ? 80 : 110, overflow: 'truncate' } },
      yAxis: { type: 'value', min, max: 100, axisLabel: { fontSize: 10, formatter: isPct ? '{value}%' : '{value}' } },
      series: [{
        type: 'bar', barMaxWidth: many ? 22 : 40, cursor: 'pointer',
        data: rows.map((u) => ({ value: u[metric], itemStyle: { color: BOARD_CATEGORY_COLOR[u.cat ?? 'Satisfactory'], borderRadius: [3, 3, 0, 0] } })),
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600, formatter: (p: any) => `${p.value}${isPct ? '%' : ''}` },
        markLine: ref == null ? undefined : { silent: true, symbol: 'none', lineStyle: { color: '#334155', type: 'dashed' }, label: { formatter: `${refLabel} ${ref}${isPct ? '%' : ''}`, fontSize: 10, position: 'insideEndTop' }, data: [{ yAxis: ref }] },
      }],
    };
  }
  /** Reference line: state figure at state/district scope, district figure below. */
  private ref(metric: 'pass' | 'avg'): { v: number | null; label: string } {
    const lvl = this.ds.level();
    const t = this.stateTotal();
    const st = this.py(t?.[metric], t?.[metric === 'pass' ? 'passDelta' : 'avgDelta']);
    if (lvl === 'state') return { v: st, label: 'State' };
    const am = this.filterMgmtRow(); const sr = this.scopeStateRow();
    const dv = am ? this.py(am[metric], am[metric === 'pass' ? 'passDelta' : 'avgDelta'])
      : this.py(sr?.[metric], sr?.[metric === 'pass' ? 'passDelta' : 'avgDelta']);
    return { v: dv ?? st, label: 'District' };
  }
  readonly passChartOpt = computed(() => { const r = this.ref('pass'); return this.unitBar('pass', r.v, r.label); });
  readonly avgChartOpt = computed(() => { const r = this.ref('avg'); return this.unitBar('avg', r.v, r.label); });
  readonly chartHeight = computed(() => Math.max(260, Math.min(760, 28 + this.units().length * 22)));
  /** Height of the unit charts: vertical bars; taller when every unit is drawn full-width with rotated labels. */
  readonly unitChartHeight = computed(() => (this.unitShowAll() ? 460 : this.passChartRows().length > 12 ? 420 : 340));

  // ================= NUMBERS: subject-wise performance =================
  /** The management whose subject figures section D is read for (it has no "All Managements" column). */
  readonly subjectMgmt = computed(() => (this.fMgmt() === BOARD_MGMT_ALL ? 'Govt SED' : this.fMgmt()));
  /** Subject rows for the scope: { subject, avg, pass, prevAvg?, prevPass?, dist?, state? }. */
  readonly subjectRows = computed(() => {
    const lvl = this.ds.level();
    const i = this.isPrevYear() ? 0 : 1;
    if (lvl === 'school') {
      const r = this.schoolReport();
      if (r) return r.subjects.map((s) => ({
        subject: s.subject, avg: s.avg[i], pass: s.pass[i], prevAvg: this.isPrevYear() ? null : s.avg[0], prevPass: this.isPrevYear() ? null : s.pass[0],
        dist: s.distAvg[i], state: s.stateAvg[i], rank: s.rankDistrict[i], rating: s.rating[i],
      }));
      const s = this.school(); if (!s) return [];
      return this.subjects().filter((k) => s.subjects[k]).map((k) => {
        const v = s.subjects[k]; const avg = this.py(v.avg, v.avgDelta);
        return { subject: k, avg, pass: null, prevAvg: this.isPrevYear() || v.avgDelta == null ? null : this.r1(v.avg - v.avgDelta), prevPass: null,
          dist: null, state: null, rank: v.rankDistrict, rating: this.band(avg) };
      });
    }
    if (lvl === 'block' || (lvl === 'district' && this.district() && !this.district()!.subject.length)) {
      const rows = this.scopeSchools();
      return this.subjects().map((k) => {
        const have = rows.filter((s) => s.subjects[k]);
        const avg = this.wavg(have.map((s) => ({ v: this.py(s.subjects[k].avg, s.subjects[k].avgDelta), w: s.appeared ?? 0 })));
        const prev = this.isPrevYear() ? null : this.wavg(have.map((s) => ({ v: s.subjects[k].avgDelta == null ? null : s.subjects[k].avg - s.subjects[k].avgDelta!, w: s.appeared ?? 0 })));
        return { subject: k, avg, pass: null, prevAvg: prev, prevPass: null, dist: null, state: null, rank: null, rating: this.band(avg), n: have.length };
      }).filter((r) => r.avg != null);
    }
    if (lvl === 'district') {
      const d = this.district();
      if (d) {
        const m = this.subjectMgmt();
        return d.subject.filter((r) => r.subject !== 'All Subjects').map((r) => {
          const c = this.cell(r, m);
          const avg = this.py(c?.avg, c?.avgDelta); const pass = this.py(c?.pass, c?.passDelta);
          return {
            subject: r.subject, avg, pass,
            prevAvg: this.isPrevYear() || c?.avg == null || c.avgDelta == null ? null : this.r1(c.avg - c.avgDelta),
            prevPass: this.isPrevYear() || c?.pass == null || c.passDelta == null ? null : this.r1(c.pass - c.passDelta),
            dist: null, state: this.stateSubjects().find((s) => s.subject === r.subject)?.avg[i] ?? null, rank: null, rating: this.band(avg),
          };
        });
      }
      return [];
    }
    return this.stateSubjects().map((s) => ({
      subject: s.subject, avg: s.avg[i], pass: s.pass[i],
      prevAvg: this.isPrevYear() ? null : s.avg[0], prevPass: this.isPrevYear() ? null : s.pass[0],
      dist: null, state: null, rank: null, rating: this.band(s.avg[i]),
    }));
  });
  readonly subjectSource = computed(() => {
    const lvl = this.ds.level();
    const yr = this.activeYear();
    if (lvl === 'state') return `State-wide, from the school reports' state rows · ${yr}`;
    if (lvl === 'district') return this.district()?.subject.length
      ? `${this.subjectMgmt()} schools (district report, section D) · state average for reference`
      : 'Weighted by students appeared, from the annexure';
    if (lvl === 'block') return 'Weighted by students appeared, from the district annexure (average mark only)';
    return this.schoolReport() ? `School report · ${yr}` : 'District annexure (average mark and rank)';
  });
  readonly subjectChartOpt = computed(() => {
    const rows = this.subjectRows();
    const hasPrev = rows.some((r) => r.prevAvg != null), hasState = rows.some((r) => r.state != null), hasDist = rows.some((r) => r.dist != null);
    const series: any[] = [{ name: `Average mark ${this.year()}`, type: 'bar', barMaxWidth: 30, data: rows.map((r) => ({ value: r.avg, itemStyle: { color: this.catColor[r.rating ?? 'Satisfactory'], borderRadius: [3, 3, 0, 0] } })),
      label: { show: true, position: 'top', fontSize: 10, fontWeight: 600 } }];
    if (hasDist) series.push({ name: 'District', type: 'bar', barMaxWidth: 30, data: rows.map((r) => r.dist), itemStyle: { color: '#CBD5E1', borderRadius: [3, 3, 0, 0] } });
    if (hasState) series.push({ name: 'State', type: 'bar', barMaxWidth: 30, data: rows.map((r) => r.state), itemStyle: { color: '#94A3B8', borderRadius: [3, 3, 0, 0] } });
    if (hasPrev) series.push({ name: `Average mark ${this.prevYear()}`, type: 'line', data: rows.map((r) => r.prevAvg), symbol: 'circle', symbolSize: 7, lineStyle: { type: 'dashed', width: 2, color: '#334155' }, itemStyle: { color: '#334155' } });
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 10, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 16, top: 16, bottom: rows.length > 6 ? 70 : 44 },
      xAxis: { type: 'category', data: rows.map((r) => r.subject), axisLabel: { fontSize: 10, interval: 0, rotate: rows.length > 6 ? 30 : 0 } },
      yAxis: { type: 'value', max: 100, axisLabel: { fontSize: 10 } },
      series,
    };
  });

  // ================= NUMBERS: performance (category) chart =================
  /** 100% stacked is what the requirement asks for; absolute counts stay available. */
  readonly stack100 = signal(true);
  /** Category counts for the scope's units (districts / schools), current and previous year where known. */
  readonly perfCounts = computed(() => {
    const lvl = this.ds.level();
    const cats = BOARD_CATEGORIES;
    const prev = this.isPrevYear();
    /** Counts straight from the annexure rows, used whenever a filter narrows the population. */
    const fromSchools = (rows: BoardSchool[], unit: string) => ({
      unit,
      cur: cats.map((c) => rows.filter((s) => this.schoolCat(s) === c).length),
      prev: prev ? null : cats.map((c) => rows.filter((s) => (s.prevPerf as BoardCategory) === c).length),
      subjectCats: this.subjects().map((k) => ({
        subject: k,
        ...Object.fromEntries(cats.map((c) => [c, rows.filter((s) => s.subjects[k] && this.band(this.py(s.subjects[k].avg, s.subjects[k].avgDelta)) === c).length])),
      })),
      filtered: this.hasAnnexureFilter(), derivedSubjects: false,
    });
    if (lvl === 'district') {
      const d = this.district(); if (!d) return null;
      if (this.hasAnnexureFilter() || !d.schoolCats) return fromSchools(this.scopeSchools(), `schools · ${this.annexureFilterLabel() || 'annexure'}`);
      return {
        unit: 'schools (district report)',
        cur: cats.map((c) => (prev ? d.schoolCatsPrev[c] : d.schoolCats[c])),
        prev: prev ? null : cats.map((c) => d.schoolCatsPrev[c]),
        subjectCats: d.subjectCats, filtered: false, derivedSubjects: false,
      };
    }
    if (lvl === 'block') {
      const rows = this.scopeSchools();
      return {
        unit: 'schools', cur: cats.map((c) => rows.filter((x) => this.schoolCat(x) === c).length),
        prev: prev ? null : cats.map((c) => rows.filter((x) => (x.prevPerf as BoardCategory) === c).length),
        subjectCats: this.subjects().map((k) => ({
          subject: k,
          ...Object.fromEntries(cats.map((c) => [c, rows.filter((x) => x.subjects[k] && this.band(this.py(x.subjects[k].avg, x.subjects[k].avgDelta)) === c).length])),
        })),
        filtered: this.hasAnnexureFilter(), derivedSubjects: false,
      };
    }
    if (lvl === 'state') {
      const rows = this.stateRows();
      const t = this.stateTotal();
      const stateAvg = this.py(t?.avg, t?.avgDelta);
      const i = this.isPrevYear() ? 0 : 1;
      const subj = this.stateSubjects();
      /**
       * No per-district subject marks are printed, so the state-level subject
       * distribution counts DISTRICTS, placing each one at the state subject
       * average shifted by its own distance from the state average. Both
       * inputs are real; the shift is a derivation, flagged as such.
       */
      const subjectCats = stateAvg == null || !subj.length ? null : subj.map((s) => {
        const base = s.avg[i];
        const counts: Record<string, number> = Object.fromEntries(cats.map((c) => [c, 0]));
        if (base != null) {
          for (const r of rows) {
            const dAvg = this.py(r.avg, r.avgDelta);
            const b = dAvg == null ? null : this.band(this.r1(base + (dAvg - stateAvg)));
            if (b) counts[b]++;
          }
        }
        return { subject: s.subject, ...counts } as { subject: string } & Record<BoardCategory, number>;
      });
      return {
        unit: 'districts',
        cur: cats.map((c) => rows.filter((r) => this.band(this.py(r.avg, r.avgDelta)) === c).length),
        prev: prev ? null : cats.map((c) => rows.filter((r) => this.band(r.avg - r.avgDelta) === c).length),
        subjectCats, filtered: false, derivedSubjects: true,
      };
    }
    return null;
  });
  /** What the subject-wise category chart is counting at this scope. */
  readonly subjectCatNote = computed(() => {
    const p = this.perfCounts();
    if (!p) return '';
    if (p.derivedSubjects) return `Districts per band, derived: each district sits at the state subject average shifted by its own distance from the state average (${this.activeYear()}). Drill into a district for school counts.`;
    if (p.filtered) return `Denominators recalculated from the ${this.scopeSchools().length} schools left by the active filters, not the printed report totals.`;
    return `Schools per band in each subject, from the average-mark bands (${this.activeYear()}).`;
  });
  /** A school's rating for the selected year: as printed for the current year, banded for the previous one. */
  private schoolCat(s: BoardSchool): BoardCategory | null {
    return this.isPrevYear() ? this.band(this.py(s.avg, s.avgDelta)) : ((s.perf as BoardCategory) || this.band(s.avg));
  }
  readonly hasAnnexureFilter = computed(() => this.fMgmt() !== BOARD_MGMT_ALL || this.fCtype() !== BOARD_CTYPE_ALL);
  readonly annexureFilterLabel = computed(() => [this.fMgmt() === BOARD_MGMT_ALL ? '' : this.fMgmt(), this.fCtype() === BOARD_CTYPE_ALL ? '' : this.fCtype()].filter(Boolean).join(' · '));
  /** Schools (or districts) by performance rating, as a pie. */
  readonly perfChartOpt = computed(() => {
    const p = this.perfCounts(); if (!p) return {};
    const cats = BOARD_CATEGORIES;
    const total = p.cur.reduce((a, b) => a + b, 0) || 1;
    return {
      tooltip: { trigger: 'item', formatter: (d: any) => `<b>${d.seriesName}</b><br/>${d.marker} ${d.name}: <b>${d.value}</b> ${p.unit} (${d.percent}%)` },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 10, textStyle: { fontSize: 11 }, data: cats },
      series: [{
        name: `AY ${this.activeYear()}`, type: 'pie', radius: ['35%', '70%'], center: ['50%', '46%'],
        cursor: 'pointer', avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { fontSize: 11, formatter: (d: any) => (d.value ? `${d.name}\n${d.value} (${Math.round((d.value / total) * 100)}%)` : '') },
        labelLine: { length: 10, length2: 8 },
        emphasis: { scale: true, scaleSize: 6 },
        data: cats.map((c, i) => ({ name: c, value: p.cur[i], itemStyle: { color: BOARD_CATEGORY_COLOR[c] } })),
      }],
    };
  });
  readonly subjectCatOpt = computed(() => {
    const rows = this.perfCounts()?.subjectCats ?? []; if (!rows.length) return {};
    const cats = BOARD_CATEGORIES;
    const pct = this.stack100();
    const totals = rows.map((r) => cats.reduce((s, c) => s + ((r as any)[c] || 0), 0));
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          const i = ps[0].dataIndex; const t = totals[i] || 1;
          return `<b>${rows[i].subject}</b> · ${totals[i]} schools<br/>` + ps.map((p) => {
            const n = (rows[i] as any)[p.seriesName] || 0;
            return `${p.marker} ${p.seriesName}: <b>${n}</b> (${Math.round((n / t) * 1000) / 10}%)`;
          }).join('<br/>');
        },
      },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 10, textStyle: { fontSize: 11 } },
      grid: { left: 130, right: pct ? 20 : 40, top: 8, bottom: 36 },
      xAxis: { type: 'value', max: pct ? 100 : undefined, name: pct ? '% of schools' : 'Number of schools', nameLocation: 'middle', nameGap: 22, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10, formatter: pct ? '{value}%' : '{value}' } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.subject.toUpperCase()), axisLabel: { fontSize: 10 } },
      series: cats.map((c) => ({
        name: c, type: 'bar', stack: 'cat', barMaxWidth: 22, cursor: 'pointer',
        data: rows.map((r, i) => {
          const n = (r as any)[c] || 0;
          return n ? (pct ? Math.round((n / (totals[i] || 1)) * 1000) / 10 : n) : null;
        }),
        itemStyle: { color: BOARD_CATEGORY_COLOR[c] },
        label: { show: true, fontSize: 10, color: c === 'Satisfactory' ? '#1f2937' : '#fff', formatter: (p: any) => (p.value ? ((rows[p.dataIndex] as any)[c] || '') : '') },
      })),
    };
  });

  // ================= DRILL-DOWN PANEL (modules 5, 6 and 7) =================
  /**
   * One list panel, opened either by clicking a performance category (overall
   * or inside a subject) or by opening a consolidated alert.
   */
  readonly pick = signal<{ kind: 'category' | 'units'; title: string; cat?: BoardCategory; subject?: string; keys?: string[] } | null>(null);
  openCat(cat: BoardCategory, subject?: string): void {
    const what = this.ds.level() === 'state' ? 'districts' : 'schools';
    this.pick.set({ kind: 'category', cat, subject, title: `${cat} ${what}${subject ? ` in ${subject}` : ''} — ${this.scopeLabel()}` });
  }
  closePick(): void { this.pick.set(null); }
  /** The units behind the open panel. */
  readonly pickUnits = computed<BoardUnit[]>(() => {
    const p = this.pick(); if (!p) return [];
    if (p.kind === 'units') {
      const keys = new Set(p.keys ?? []);
      return this.units().filter((u) => keys.has(u.key));
    }
    const cat = p.cat!;
    if (p.subject) {
      // state scope has no per-school subject marks: fall back to the derived district band
      if (this.ds.level() === 'state') {
        const t = this.stateTotal();
        const stateAvg = this.py(t?.avg, t?.avgDelta);
        const base = this.stateSubjects().find((s) => s.subject === p.subject)?.avg[this.isPrevYear() ? 0 : 1] ?? null;
        if (base == null || stateAvg == null) return [];
        return this.units().filter((u) => u.avg != null && this.band(this.r1(base + (u.avg - stateAvg))) === cat)
          .map((u) => ({ ...u, avg: this.r1(base + (u.avg as number) - stateAvg), cat }))
          .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));
      }
      return this.scopeSchools()
        .filter((s) => s.subjects[p.subject!] && this.band(this.py(s.subjects[p.subject!].avg, s.subjects[p.subject!].avgDelta)) === cat)
        .map((s) => {
          const v = s.subjects[p.subject!];
          return {
            key: s.udise, udise: s.udise, name: s.name, sub: `${s.block} · ${s.mgmt}`, schools: 1, appeared: s.appeared ?? 0,
            pass: this.py(s.pass, s.passDelta), passDelta: this.pd(s.passDelta),
            avg: this.py(v.avg, v.avgDelta), avgDelta: this.pd(v.avgDelta), rank: v.rankDistrict,
            cat, drill: 'school' as const, hasReport: this.hasReport(s.udise), assumed: this.assumed(),
          };
        }).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));
    }
    if (this.ds.level() === 'district') {
      // the category chart counts schools, so list schools rather than blocks
      return this.scopeSchools().filter((s) => this.schoolCat(s) === cat).map((s) => ({
        key: s.udise, udise: s.udise, name: s.name, sub: `${s.block} · ${s.mgmt}`, schools: 1, appeared: s.appeared ?? 0,
        pass: this.py(s.pass, s.passDelta), passDelta: this.pd(s.passDelta), avg: this.py(s.avg, s.avgDelta), avgDelta: this.pd(s.avgDelta),
        rank: s.rankDistrict, cat, drill: 'school' as const, hasReport: this.hasReport(s.udise), assumed: this.assumed(),
      })).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));
    }
    return this.units().filter((u) => u.cat === cat);
  });
  readonly pickExportRows = computed(() => this.pickUnits().map((u) => ({
    name: u.name, where: u.sub ?? '', udise: u.udise ?? '', appeared: u.appeared, pass: u.pass, avg: u.avg, rank: u.rank ?? '', category: u.cat ?? '',
  })));

  // ================= TREND =================
  readonly trendMetric = signal<'pass' | 'avg'>('pass');
  /** Exam years in the 5-year series (2022 = AY 2021-22 … 2026 = AY 2025-26). */
  readonly trendYears = computed(() => (this.district() ?? this.refDistrict())?.trend.years ?? []);
  /** From / To window on the trend charts; null = the full range. */
  readonly trendFrom = signal<number | null>(null);
  readonly trendTo = signal<number | null>(null);
  readonly trendFromYear = computed(() => this.trendFrom() ?? this.trendYears()[0] ?? 0);
  readonly trendToYear = computed(() => this.trendTo() ?? this.trendYears()[this.trendYears().length - 1] ?? 0);
  /** Options for the two selects: From never after To, To never before From. */
  readonly trendFromOptions = computed(() => this.trendYears().filter((y) => y <= this.trendToYear()));
  readonly trendToOptions = computed(() => this.trendYears().filter((y) => y >= this.trendFromYear()));
  setTrendFrom(v: number | string): void { const y = +v; this.trendFrom.set(y); if (y > this.trendToYear()) this.trendTo.set(y); }
  setTrendTo(v: number | string): void { const y = +v; this.trendTo.set(y); if (y < this.trendFromYear()) this.trendFrom.set(y); }
  resetTrendYears(): void { this.trendFrom.set(null); this.trendTo.set(null); }
  readonly trendHasWindow = computed(() => this.trendFrom() != null || this.trendTo() != null);
  /** Indexes of the years inside the window, in order. */
  private readonly trendIdx = computed(() => {
    const ys = this.trendYears(); const a = this.trendFromYear(), b = this.trendToYear();
    return ys.map((y, i) => (y >= a && y <= b ? i : -1)).filter((i) => i >= 0);
  });
  readonly trendWindowLabel = computed(() => {
    const ys = this.trendYears(); if (!ys.length) return '';
    const a = this.trendFromYear(), b = this.trendToYear();
    return a === b ? String(a) : `${a} – ${b}`;
  });
  /** 5-year lines (2022-26) cut to the From / To window: at state scope the state line; below it the district / state / best. */
  private trendChart(metric: 'pass' | 'avg') {
    const src = this.district() ?? this.refDistrict();
    if (!src) return {};
    const t = src.trend, s = t[metric];
    const idx = this.trendIdx();
    const pick = <T,>(arr: T[]) => idx.map((i) => arr[i]);
    const years = pick(t.years);
    const lvl = this.ds.level();
    const showDistrict = lvl !== 'state' && !!this.district();
    const name = this.ds.selectedDistrict() ? this.ds.titleCase(this.ds.selectedDistrict()!) : this.scopeLabel();
    const series: any[] = [];
    if (showDistrict) series.push({ name, type: 'line', data: pick(s.district), symbol: 'circle', symbolSize: 7, lineStyle: { width: 2.5 }, label: { show: true, fontSize: 10, position: 'top' }, color: '#2F62C4' });
    series.push({ name: 'State', type: 'line', data: pick(s.state), symbol: 'circle', symbolSize: 6, lineStyle: { type: showDistrict ? 'dashed' : 'solid', width: 2.5 }, label: { show: !showDistrict, fontSize: 10, position: 'top' }, color: '#C2185B' });
    series.push({ name: 'Best district', type: 'line', data: pick(s.best), symbol: 'diamond', symbolSize: 7, lineStyle: { type: 'dotted', width: 2 }, color: '#2E9E4F' });
    const bestNames = pick(s.bestNames);
    return {
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const i = ps[0].dataIndex; return `<b>${years[i]}</b>` + ps.map((p) => `<br/>${p.marker} ${p.seriesName}${p.seriesName === 'Best district' ? ` (${bestNames[i]})` : ''}: <b>${p.value}</b>`).join(''); } },
      legend: { bottom: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 20, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: years, axisLabel: { fontSize: 10 }, triggerEvent: true, boundaryGap: years.length === 1 },
      yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 10, formatter: metric === 'pass' ? '{value}%' : '{value}' } },
      series,
    };
  }
  /** Module 3 and module 4 want both lines on screen, not one behind a toggle. */
  readonly passTrendOpt = computed(() => this.trendChart('pass'));
  readonly avgTrendOpt = computed(() => this.trendChart('avg'));
  /**
   * Clicking a point on a trend chart. The x axis is labelled with the exam
   * year (2026 = AY 2025-26), and only the two years the reports carry can be
   * shown across the dashboard; older points say so instead of pretending.
   */
  pickTrendYear(year: number | string): string {
    const end = (ay: string) => String(Number(ay.slice(0, 4)) + 1);
    const y = String(year);
    if (y === end(this.year())) { this.fYear.set('cur'); return ''; }
    if (y === end(this.prevYear())) { this.fYear.set('prev'); return ''; }
    return `The reports carry district and school detail for ${this.prevYear()} and ${this.year()} only; ${y} appears in the 5-year trend alone.`;
  }
  readonly trendHasDistrict = computed(() => this.ds.level() !== 'state' && !!this.district());
  /** Year-on-year change per unit (improvement), most improved first — every unit. */
  readonly trendUnitsAll = computed(() => {
    const k = this.trendMetric() === 'pass' ? 'passDelta' : 'avgDelta';
    return [...this.units()].filter((u) => u[k] != null).sort((a, b) => (b[k] as number) - (a[k] as number));
  });
  /** How many of each end to draw on the change chart. */
  readonly trendEnds = 5;
  /**
   * The change chart draws the five most improved and the five that fell the
   * most, with a gap between them; when the scope has ten or fewer units,
   * every unit is drawn.
   */
  readonly trendUnits = computed<(BoardUnit | null)[]>(() => {
    const all = this.trendUnitsAll();
    const n = this.trendEnds;
    if (all.length <= n * 2) return all;
    return [...all.slice(0, n), null, ...all.slice(-n)];
  });
  readonly trendUnitsTruncated = computed(() => this.trendUnitsAll().length > this.trendEnds * 2);

  // ---------- trend grid: per unit, the two selected years side by side ----------
  /** Exam-year label (x axis) for each of the two report years: AY 2025-26 → 2026. */
  private examYear(which: 'cur' | 'prev'): number { return Number((which === 'cur' ? this.year() : this.prevYear()).slice(0, 4)) + 1; }
  /** Which report year an exam-year label maps to; null when the reports carry no per-unit figures for it. */
  private yearSlot(y: number): 'cur' | 'prev' | null { return y === this.examYear('cur') ? 'cur' : y === this.examYear('prev') ? 'prev' : null; }
  /**
   * Per-unit figures for both report years, independent of the Academic Year
   * filter: current = as printed, previous = value − change.
   */
  private readonly unitYears = computed(() => {
    const lvl = this.ds.level();
    type Row = { key: string; name: string; sub?: string; schools: number; drill: BoardUnit['drill']; udise?: string; passCur: number | null; passPrev: number | null; avgCur: number | null; avgPrev: number | null };
    const prev = (cur: number | null, d: number | null) => (cur == null || d == null ? null : this.r1(cur - d));
    if (lvl === 'state') {
      return this.stateRows().map<Row>((r) => ({ key: r.district, name: this.ds.titleCase(r.district), schools: r.schools, drill: 'district',
        passCur: r.pass, passPrev: prev(r.pass, r.passDelta), avgCur: r.avg, avgPrev: prev(r.avg, r.avgDelta) }));
    }
    const rows = this.scopeSchools();
    const w = (rs: BoardSchool[], p: (s: BoardSchool) => number | null) => this.wavg(rs.map((s) => ({ v: p(s), w: s.appeared ?? 0 })));
    const agg = (rs: BoardSchool[]) => ({
      passCur: w(rs, (s) => s.pass), passPrev: w(rs, (s) => prev(s.pass, s.passDelta)),
      avgCur: w(rs, (s) => s.avg), avgPrev: w(rs, (s) => prev(s.avg, s.avgDelta)),
    });
    if (lvl === 'district') {
      return [...new Set(rows.map((s) => s.block))].sort().map<Row>((b) => {
        const rs = rows.filter((s) => s.block === b);
        return { key: b, name: b, sub: `${rs.length} schools`, schools: rs.length, drill: 'block', ...agg(rs) };
      });
    }
    if (lvl === 'block') {
      return rows.map<Row>((s) => ({ key: s.udise, udise: s.udise, name: s.name, sub: `${s.mgmt} · ${s.udise}`, schools: 1, drill: 'school', ...agg([s]) }));
    }
    return [] as Row[];
  });
  /** The two years the grid compares: the From and To of the trend window. */
  readonly trendGridYears = computed(() => ({ from: this.trendFromYear(), to: this.trendToYear() }));
  /** Rows for the grid: pass % and average mark in the From and To years, with the change between them. */
  readonly trendGridRows = computed(() => {
    const { from, to } = this.trendGridYears();
    const fs = this.yearSlot(from), ts = this.yearSlot(to);
    const pick = (slot: 'cur' | 'prev' | null, cur: number | null, prev: number | null) => (slot === 'cur' ? cur : slot === 'prev' ? prev : null);
    return this.unitYears().map((u) => {
      const passFrom = pick(fs, u.passCur, u.passPrev), passTo = pick(ts, u.passCur, u.passPrev);
      const avgFrom = pick(fs, u.avgCur, u.avgPrev), avgTo = pick(ts, u.avgCur, u.avgPrev);
      return {
        ...u, passFrom, passTo, avgFrom, avgTo,
        passChange: from === to ? null : this.delta(passFrom, passTo), avgChange: from === to ? null : this.delta(avgFrom, avgTo),
        cat: this.band(avgTo ?? avgFrom), assumed: this.assumed(),
      };
    }).sort((a, b) => (b.passChange ?? -Infinity) - (a.passChange ?? -Infinity));
  });
  /** Why a column may be empty: per-unit figures exist for the two report years only. */
  readonly trendGridNote = computed(() => {
    const { from, to } = this.trendGridYears();
    const missing = [from, to].filter((y, i, a) => a.indexOf(y) === i && !this.yearSlot(y));
    if (!missing.length) return from === to ? 'From and To are the same year, so there is no change to show.' : '';
    return `The reports carry ${this.unitLabel().toLowerCase()}-level figures for ${this.examYear('prev')} (AY ${this.prevYear()}) and ${this.examYear('cur')} (AY ${this.year()}) only; ${missing.join(' and ')} shows N/A. The 5-year lines above come from the state series.`;
  });
  /** Drill from a grid row (district → block → school). */
  drillTrendRow(r: { key: string; drill: BoardUnit['drill']; udise?: string }): void {
    this.drill({ key: r.key, drill: r.drill, udise: r.udise, name: '', schools: 0, appeared: 0, pass: null, passDelta: null, avg: null, avgDelta: null });
  }
  readonly trendGridExportRows = computed(() => {
    const { from, to } = this.trendGridYears();
    return this.trendGridRows().map((r) => ({
      name: r.name, where: r.sub ?? '', schools: r.schools,
      passFrom: r.passFrom ?? 'N/A', passTo: r.passTo ?? 'N/A', passChange: r.passChange ?? 'N/A',
      avgFrom: r.avgFrom ?? 'N/A', avgTo: r.avgTo ?? 'N/A', avgChange: r.avgChange ?? 'N/A', category: r.cat ?? '',
      _years: `${from} → ${to}`,
    }));
  });
  readonly trendUnitsOpt = computed(() => {
    const k = this.trendMetric() === 'pass' ? 'passDelta' : 'avgDelta';
    const rows = this.trendUnits();
    if (!rows.length) return {};
    const names = rows.map((u) => (u ? u.name : '…'));
    const isPct = this.trendMetric() === 'pass';
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => { const u = rows[ps[0].dataIndex]; if (!u) return ''; const v = u[k] as number;
          return `<b>${u.name}</b><br/>${this.prevYear()} → ${this.year()}: <b>${v >= 0 ? '+' : ''}${v}${isPct ? ' pp' : ''}</b>${u[this.trendMetric()] != null ? `<br/>Now ${u[this.trendMetric()]}${isPct ? '%' : ''}` : ''}`; } },
      grid: { left: 44, right: 16, top: 28, bottom: rows.length > 6 ? 70 : 44 },
      xAxis: { type: 'category', data: names, axisLabel: { fontSize: 10, interval: 0, rotate: rows.length > 6 ? 30 : 0, width: 100, overflow: 'truncate' } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: isPct ? '{value} pp' : '{value}' } },
      series: [{ type: 'bar', barMaxWidth: 36, cursor: 'pointer',
        data: rows.map((u) => (u ? { value: u[k], itemStyle: { color: (u[k] as number) >= 0 ? '#2E9E4F' : '#E53935', borderRadius: (u[k] as number) >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } } : null)),
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600, formatter: (p: any) => (p.value == null ? '' : `${p.value >= 0 ? '+' : ''}${p.value}`) },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: '#334155' }, label: { show: false }, data: [{ yAxis: 0 }] },
        markArea: this.trendUnitsTruncated() ? { silent: true, itemStyle: { color: 'rgba(148,163,184,0.12)' }, data: [[{ xAxis: '…' }, { xAxis: '…' }]] } : undefined,
      }],
    };
  });
  /** Subject two-year comparison (where a previous value exists). */
  readonly subjectTrendOpt = computed(() => {
    const rows = this.subjectRows().filter((r) => r.prevAvg != null);
    if (!rows.length) return {};
    return {
      color: ['#CBD5E1', '#2F62C4'],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 10, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 16, top: 16, bottom: rows.length > 6 ? 70 : 44 },
      xAxis: { type: 'category', data: rows.map((r) => r.subject), axisLabel: { fontSize: 10, interval: 0, rotate: rows.length > 6 ? 30 : 0 } },
      yAxis: { type: 'value', max: 100, axisLabel: { fontSize: 10 } },
      series: [
        { name: `Average mark ${this.prevYear()}`, type: 'bar', barMaxWidth: 26, data: rows.map((r) => r.prevAvg), itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: `Average mark ${this.year()}`, type: 'bar', barMaxWidth: 26, data: rows.map((r) => r.avg), itemStyle: { borderRadius: [3, 3, 0, 0] }, label: { show: true, position: 'top', fontSize: 10, fontWeight: 600 } },
      ],
    };
  });

  // ================= COMPARISON =================
  /** Same two sub-tabs as the Academic Scores comparison: between units, and between exams. */
  readonly compareMode = signal<'districts' | 'exams'>('districts');
  readonly compareMetric = signal<'pass' | 'avg' | 'passDelta' | 'avgDelta'>('pass');
  readonly compareMetrics = [
    { value: 'pass', label: 'Pass %' }, { value: 'avg', label: 'Average mark' },
    { value: 'passDelta', label: 'Change in pass %' }, { value: 'avgDelta', label: 'Change in average mark' },
  ] as const;
  readonly compareRank = signal<'top' | 'bottom'>('top');
  readonly compareCount = signal(12);
  readonly compareRows = computed(() => {
    const k = this.compareMetric();
    const rows = [...this.units()].filter((u) => u[k] != null).sort((a, b) => (b[k] as number) - (a[k] as number));
    const n = this.compareCount();
    return this.compareRank() === 'top' ? rows.slice(0, n) : rows.slice(-n).reverse();
  });
  readonly compareOpt = computed(() => {
    const k = this.compareMetric();
    const rows = this.compareRows();
    const isDelta = k.endsWith('Delta');
    const r = isDelta ? null : this.ref(k as 'pass' | 'avg');
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 150, right: 44, top: 8, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: k === 'pass' ? '{value}%' : '{value}' }, min: k === 'pass' ? 'dataMin' : undefined },
      yAxis: { type: 'category', inverse: true, data: rows.map((u) => u.name), axisLabel: { fontSize: 10, width: 140, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 18, data: rows.map((u) => ({ value: u[k], itemStyle: { color: isDelta ? ((u[k] as number) >= 0 ? '#2E9E4F' : '#E53935') : BOARD_CATEGORY_COLOR[u.cat ?? 'Satisfactory'], borderRadius: 3 } })),
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => `${isDelta && p.value >= 0 ? '+' : ''}${p.value}${k === 'pass' ? '%' : ''}` },
        markLine: r?.v == null ? undefined : { silent: true, symbol: 'none', lineStyle: { color: '#334155', type: 'dashed' }, label: { formatter: `${r.label} ${r.v}`, fontSize: 10 }, data: [{ xAxis: r.v }] } }],
    };
  });
  /** Management comparison (district scope only): pass / avg per management group vs the state figure. */
  readonly mgmtCompareOpt = computed(() => {
    const rows = this.byMgmt().filter((m) => m.mgmt !== 'All Managements');
    if (!rows.length) return {};
    const metric = this.compareMetric().startsWith('pass') ? 'pass' : 'avg';
    return {
      color: ['#2F62C4', '#94A3B8'],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 10, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 16, top: 16, bottom: 44 },
      xAxis: { type: 'category', data: rows.map((m) => m.mgmt), axisLabel: { fontSize: 10, interval: 0 } },
      yAxis: { type: 'value', max: 100, scale: true, axisLabel: { fontSize: 10, formatter: metric === 'pass' ? '{value}%' : '{value}' } },
      series: [
        { name: `District ${metric === 'pass' ? 'pass %' : 'average mark'}`, type: 'bar', barMaxWidth: 34, data: rows.map((m) => m[metric]), itemStyle: { borderRadius: [3, 3, 0, 0] }, label: { show: true, position: 'top', fontSize: 10, fontWeight: 600 } },
        { name: `State ${metric === 'pass' ? 'pass %' : 'average mark'}`, type: 'bar', barMaxWidth: 34, data: rows.map((m) => (metric === 'pass' ? m.statePass : m.stateAvg)), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      ],
    };
  });

  // ================= COMPARISON: subject x unit heatmap =================
  /**
   * Average mark per subject per child unit, for the "Between districts"
   * heatmap. District scope and below read the annexure (real or assumed);
   * state scope has no per-district subject marks printed, so each district
   * sits at the state subject average shifted by its own distance from the
   * state average (both inputs real, the shift derived — flagged).
   */
  readonly compareHeat = computed<{ units: string[]; subjects: string[]; cells: [number, number, number][]; derived: boolean } | null>(() => {
    const lvl = this.ds.level();
    const subjects = this.subjects();
    if (lvl === 'school' || !subjects.length) return null;
    const cells: [number, number, number][] = [];
    if (lvl === 'state') {
      const t = this.stateTotal(); const stateAvg = this.py(t?.avg, t?.avgDelta);
      const i = this.isPrevYear() ? 0 : 1;
      const ss = this.stateSubjects();
      if (stateAvg == null || !ss.length) return null;
      const units = this.units();
      const subs = subjects.filter((s) => ss.some((x) => x.subject === s && x.avg[i] != null));
      units.forEach((u, ui) => subs.forEach((s, si) => {
        const base = ss.find((x) => x.subject === s)!.avg[i]!;
        if (u.avg != null) cells.push([si, ui, this.r1(this.clamp(base + (u.avg - stateAvg), 0, 100))]);
      }));
      return { units: units.map((u) => u.name), subjects: subs, cells, derived: true };
    }
    // district: blocks; block: schools — weighted by students appeared
    const rows = this.scopeSchools();
    const groups = lvl === 'district'
      ? [...new Set(rows.map((s) => s.block))].sort().map((b) => ({ name: b, rows: rows.filter((s) => s.block === b) }))
      : rows.map((s) => ({ name: s.name, rows: [s] }));
    if (!groups.length) return null;
    const subs = subjects.filter((k) => rows.some((s) => s.subjects[k]));
    groups.forEach((g, ui) => subs.forEach((k, si) => {
      const v = this.wavg(g.rows.filter((s) => s.subjects[k]).map((s) => ({ v: this.py(s.subjects[k].avg, s.subjects[k].avgDelta), w: s.appeared ?? 0 })));
      if (v != null) cells.push([si, ui, v]);
    }));
    return { units: groups.map((g) => g.name), subjects: subs, cells, derived: false };
  });

  // ================= COMPARISON: between exams (head-to-head) =================
  /** One side of the head-to-head: a class and one of the two report years. */
  readonly h2hA = signal<{ cls: BoardClass; year: 'cur' | 'prev' }>({ cls: 10, year: 'prev' });
  readonly h2hB = signal<{ cls: BoardClass; year: 'cur' | 'prev' }>({ cls: 10, year: 'cur' });
  readonly h2hSubject = signal('');
  setH2h(side: 'a' | 'b', patch: { cls?: number | string; year?: 'cur' | 'prev' | string }): void {
    const sig = side === 'a' ? this.h2hA : this.h2hB;
    sig.update((v) => ({
      cls: patch.cls == null ? v.cls : (+patch.cls === 12 ? 12 : 10),
      year: patch.year == null ? v.year : (patch.year === 'prev' ? 'prev' : 'cur'),
    }));
    this.h2hSubject.set('');
  }
  readonly h2hClassOptions: { value: BoardClass; label: string }[] = [{ value: 10, label: 'Class X' }, { value: 12, label: 'Class XII' }];
  /**
   * Figures for one side at the current scope and filters: overall pass %,
   * average mark and students appeared, plus per-subject pass % / average.
   * The previous year is `value − change`, exactly as elsewhere; appeared is
   * printed for the current year only.
   */
  private h2hSide(cls: BoardClass, year: 'cur' | 'prev') {
    const yi = year === 'cur' ? 1 : 0;
    const v = (cur: number | null | undefined, d: number | null | undefined) => (year === 'cur' ? cur ?? null : cur == null || d == null ? null : this.r1(cur - d));
    const label = `${cls === 10 ? 'Class X' : 'Class XII'} · AY ${year === 'cur' ? this.year() : this.prevYear()}`;
    const lvl = this.ds.level();
    type Sub = { name: string; avg: number | null; pass: number | null };
    const empty = { label, cls, year, avg: null as number | null, pass: null as number | null, appeared: null as number | null, subjects: [] as Sub[], source: '', assumed: false };
    const blk = this.blockFor(cls);
    if (!blk) return empty;
    if (lvl === 'state') {
      const t = blk.state.total;
      return { ...empty, avg: v(t.avg, t.avgDelta), pass: v(t.pass, t.passDelta), appeared: year === 'cur' ? t.appeared : null,
        subjects: this.stateSubjectsFor(cls).map((s) => ({ name: s.subject, avg: s.avg[yi], pass: s.pass[yi] })), source: 'State report (Govt schools) · subjects from the school reports\' state rows' };
    }
    const d = this.districtFor(cls);
    const assumed = !!d && !this.realDistrictFor(cls);
    if (!d) { const r = this.scopeStateRowFor(cls); return r ? { ...empty, avg: v(r.avg, r.avgDelta), pass: v(r.pass, r.passDelta), appeared: year === 'cur' ? r.appeared : null, source: 'State report row' } : empty; }
    if (lvl === 'district') {
      const m = d.byMgmt.find((x) => x.mgmt === this.fMgmt()) ?? d.byMgmt.find((x) => x.mgmt === BOARD_MGMT_ALL) ?? null;
      const sm = this.fMgmt() === BOARD_MGMT_ALL ? 'Govt SED' : this.fMgmt();
      return { ...empty, assumed, avg: v(m?.avg, m?.avgDelta), pass: v(m?.pass, m?.passDelta), appeared: year === 'cur' ? m?.appeared ?? null : null,
        subjects: d.subject.filter((r) => r.subject !== 'All Subjects').map((r) => { const c = this.cell(r, sm); return { name: r.subject, avg: v(c?.avg, c?.avgDelta), pass: v(c?.pass, c?.passDelta) }; }),
        source: `District report section D · ${sm}${assumed ? ' · assumed' : ''}` };
    }
    const b = this.ds.selectedBlock();
    let rows = b ? d.schools.filter((s) => this.norm(s.block) === this.norm(b)) : d.schools;
    rows = rows.filter((s) => this.keep(s));
    if (lvl === 'school') {
      const u = this.ds.currentSchool()?.udise;
      const rep = u ? blk.schoolReports[u] : null;
      if (rep) {
        const o = rep.overall;
        return { ...empty, avg: o.avg[yi], pass: o.pass[yi], appeared: o.appeared[yi], subjects: rep.subjects.map((s) => ({ name: s.subject, avg: s.avg[yi], pass: s.pass[yi] })), source: 'School report' };
      }
      rows = rows.filter((s) => s.udise === u);
    }
    if (!rows.length) return { ...empty, assumed };
    const w = (p: (s: BoardSchool) => number | null) => this.wavg(rows.map((s) => ({ v: p(s), w: s.appeared ?? 0 })));
    return { ...empty, assumed,
      avg: w((s) => v(s.avg, s.avgDelta)), pass: w((s) => v(s.pass, s.passDelta)), appeared: year === 'cur' ? rows.reduce((a, s) => a + (s.appeared ?? 0), 0) : null,
      subjects: this.subjectsFor(cls).filter((k) => rows.some((s) => s.subjects[k])).map((k) => ({ name: k, avg: w((s) => (s.subjects[k] ? v(s.subjects[k].avg, s.subjects[k].avgDelta) : null)), pass: null })),
      source: `Annexure, weighted by students appeared${assumed ? ' · assumed' : ''} · subject pass % not printed below district level` };
  }
  readonly examHeadToHead = computed(() => {
    const A = this.h2hA(), B = this.h2hB();
    const a = this.h2hSide(A.cls, A.year), b = this.h2hSide(B.cls, B.year);
    const focus = this.h2hSubject();
    const shared = a.subjects.filter((s) => b.subjects.some((t) => t.name === s.name)).map((s) => s.name);
    const subjects = shared.map((name) => {
      const sa = a.subjects.find((s) => s.name === name)!, sb = b.subjects.find((s) => s.name === name)!;
      return { name, aAvg: sa.avg, bAvg: sb.avg, avgDiff: this.delta(sa.avg, sb.avg), aPass: sa.pass, bPass: sb.pass, passDiff: this.delta(sa.pass, sb.pass) };
    });
    const f = focus ? subjects.find((s) => s.name === focus) ?? null : null;
    const headline = f
      ? { aAvg: f.aAvg, bAvg: f.bAvg, aPass: f.aPass, bPass: f.bPass }
      : { aAvg: a.avg, bAvg: b.avg, aPass: a.pass, bPass: b.pass };
    return {
      a, b, focus, subjects, sharedSubjects: shared, headline,
      avgDiff: this.delta(headline.aAvg, headline.bAvg), passDiff: this.delta(headline.aPass, headline.bPass),
      same: A.cls === B.cls && A.year === B.year,
      mixedClass: A.cls !== B.cls,
    };
  });
  readonly h2hChartRows = computed(() => {
    const h = this.examHeadToHead();
    const rows = h.focus ? h.subjects.filter((s) => s.name === h.focus) : h.subjects;
    return rows.filter((s) => s.aAvg != null && s.bAvg != null).map((s) => ({ name: s.name, aAvg: s.aAvg as number, bAvg: s.bAvg as number, avgDiff: s.avgDiff ?? 0 }));
  });
  readonly h2hExportRows = computed(() => this.examHeadToHead().subjects.map((s) => ({
    subject: s.name, aAvg: s.aAvg ?? 'N/A', bAvg: s.bAvg ?? 'N/A', avgDiff: s.avgDiff ?? 'N/A', aPass: s.aPass ?? 'N/A', bPass: s.bPass ?? 'N/A', passDiff: s.passDiff ?? 'N/A',
  })));

  // ================= SCHOOL REPORT (school scope) =================
  readonly schoolReportOpt = computed(() => {
    const r = this.schoolReport(); if (!r) return {};
    const subs = r.subjects; const [py, cy] = r.years;
    return {
      color: ['#2F62C4', '#F2A33A', '#8BC34A', '#94A3B8'],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 10, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 20, top: 16, bottom: 48 },
      xAxis: { type: 'category', data: subs.map((s) => s.subject), axisLabel: { fontSize: 10, interval: 0, rotate: subs.length > 6 ? 25 : 0 } },
      yAxis: { type: 'value', max: 100, axisLabel: { fontSize: 10 } },
      series: [
        { name: `School ${cy}`, type: 'bar', data: subs.map((s) => s.avg[1]), barMaxWidth: 26, itemStyle: { borderRadius: [3, 3, 0, 0] }, label: { show: true, position: 'top', fontSize: 10, fontWeight: 600 } },
        { name: `District ${cy}`, type: 'bar', data: subs.map((s) => s.distAvg[1]), barMaxWidth: 26, itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: `State ${cy}`, type: 'bar', data: subs.map((s) => s.stateAvg[1]), barMaxWidth: 26, itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: `School ${py}`, type: 'line', data: subs.map((s) => s.avg[0]), symbol: 'circle', symbolSize: 7, lineStyle: { type: 'dashed', width: 2 } },
      ],
    };
  });

  // ================= GRID 1: SUBJECT-WISE DETAILS BY MANAGEMENT (module 8) =================
  readonly gridMetric = signal<'pass' | 'avg'>('pass');
  readonly gridMetricLabel = computed(() => (this.gridMetric() === 'pass' ? 'Pass %' : 'Average mark'));
  /**
   * Section D the way the requirement asks for it: one row per management
   * group, one column per subject plus All Subjects, each cell carrying the
   * figure and its year-on-year change. Shown at every scope:
   *  - district : the printed (or assumed) section D.
   *  - block    : rebuilt from the annexure rows in that block, by management.
   *  - school   : one row, the school's own management.
   *  - state    : the state subject figures shifted by each management group's
   *               distance from the state figure (both inputs real, the shift
   *               derived) — no per-management state subject table is printed.
   */
  readonly subjectMgmtGrid = computed<{ subjects: string[]; rows: { mgmt: string; me: boolean; cells: { subject: string; v: number | null; d: number | null; cat: BoardCategory | null; reliable: boolean }[] }[]; source: string } | null>(() => {
    const metric = this.gridMetric();
    const lvl = this.ds.level();
    const subjects = [...this.subjects(), 'All Subjects'];
    const order = (this._data()?.managements ?? []).filter((m) => m !== BOARD_MGMT_ALL);
    const mk = (mgmt: string, cells: ReturnType<BoardExamService['gridCell']>[]) => ({ mgmt, me: mgmt === this.fMgmt(), cells });

    if (lvl === 'school') {
      const s = this.school();
      if (!s) return null;
      return {
        subjects, source: `This school only · ${s.mgmt} · ${this.activeYear()}${metric === 'pass' ? ' · subject pass % derived from the subject average' : ''}`,
        rows: [mk(this.mgmtGroup(s.mgmt), subjects.map((sub) => this.gridCell([s], sub, metric)))],
      };
    }
    if (lvl === 'block') {
      const rows = this.scopeSchools();
      if (!rows.length) return null;
      const groups = order.filter((g) => rows.some((s) => this.mgmtGroup(s.mgmt) === g));
      return {
        subjects, source: `Block annexure, weighted by students appeared · ${this.activeYear()}${metric === 'pass' ? ' · subject pass % derived from the subject average' : ''}`,
        rows: [
          ...groups.map((g) => mk(g, subjects.map((sub) => this.gridCell(rows.filter((s) => this.mgmtGroup(s.mgmt) === g), sub, metric)))),
          mk(BOARD_MGMT_ALL, subjects.map((sub) => this.gridCell(rows, sub, metric))),
        ],
      };
    }
    const dRows = this.district()?.subject ?? [];
    if (dRows.length) {
      const subs = [...this.subjects().filter((s) => dRows.some((r) => r.subject === s)), 'All Subjects'];
      const mgmts = order.filter((m) => dRows.some((r) => this.cell(r, m)?.reliable));
      return {
        subjects: subs,
        source: `District report, section D${this.assumed() ? ' (assumed)' : ''} · ${this.activeYear()} · no "All Managements" column exists, so the Management filter highlights a row`,
        rows: mgmts.map((m) => mk(m, subs.map((sub) => {
          const row = dRows.find((r) => r.subject === sub);
          const c = row ? this.cell(row, m) : null;
          const cur = metric === 'pass' ? c?.pass : c?.avg;
          const dlt = metric === 'pass' ? c?.passDelta : c?.avgDelta;
          const v = this.py(cur, dlt);
          return { subject: sub, v, d: this.pd(dlt), cat: metric === 'avg' ? this.band(v) : null, reliable: !!c?.reliable };
        }))),
      };
    }
    // state scope
    const t = this.stateTotal();
    const ref = this.refDistrict();
    const subj = this.stateSubjects();
    const i = this.isPrevYear() ? 0 : 1;
    if (!t || !ref || !subj.length) return null;
    const overall = this.py(metric === 'pass' ? t.pass : t.avg, metric === 'pass' ? t.passDelta : t.avgDelta);
    const byMgmt = new Map(ref.byMgmt.map((m) => [m.mgmt, m]));
    const groups = order.filter((g) => byMgmt.has(g));
    return {
      subjects, source: `State-wide, ${this.activeYear()}: the state subject figure shifted by each management group's distance from the state figure (derived — no per-management state subject table is printed)`,
      rows: groups.map((g) => {
        const m = byMgmt.get(g)!;
        const mAll = this.py(metric === 'pass' ? m.statePass : m.stateAvg, metric === 'pass' ? m.statePassDelta : m.stateAvgDelta);
        const mD = this.pd(metric === 'pass' ? m.statePassDelta : m.stateAvgDelta);
        return mk(g, subjects.map((sub) => {
          if (sub === 'All Subjects') return { subject: sub, v: mAll, d: mD, cat: metric === 'avg' ? this.band(mAll) : null, reliable: mAll != null };
          const s = subj.find((x) => x.subject === sub);
          const base = metric === 'pass' ? s?.pass[i] ?? null : s?.avg[i] ?? null;
          const v = base == null || mAll == null || overall == null ? null : this.r1(this.clamp(base + (mAll - overall), 0, 100));
          return { subject: sub, v, d: mD, cat: metric === 'avg' ? this.band(v) : null, reliable: v != null };
        }));
      }),
    };
  });
  /** One grid cell from annexure rows. Average marks are printed; subject pass % is derived from them. */
  private gridCell(rows: BoardSchool[], sub: string, metric: 'pass' | 'avg'): { subject: string; v: number | null; d: number | null; cat: BoardCategory | null; reliable: boolean } {
    const w = (p: (r: BoardSchool) => number | null) => this.wavg(rows.map((r) => ({ v: p(r), w: r.appeared ?? 0 })));
    const avg = w((r) => (sub === 'All Subjects' ? r.avg : r.subjects[sub]?.avg ?? null));
    const avgD = w((r) => (sub === 'All Subjects' ? r.avgDelta : r.subjects[sub]?.avgDelta ?? null));
    if (metric === 'avg') {
      const v = this.py(avg, avgD);
      return { subject: sub, v, d: this.pd(avgD), cat: this.band(v), reliable: avg != null };
    }
    const gPass = w((r) => r.pass), gPassD = w((r) => r.passDelta), gAvg = w((r) => r.avg);
    if (sub === 'All Subjects') return { subject: sub, v: this.py(gPass, gPassD), d: this.pd(gPassD), cat: null, reliable: gPass != null };
    const v = avg == null || gAvg == null || gPass == null ? null : this.r1(this.clamp(gPass + (avg - gAvg) * 0.55, 20, 100));
    return { subject: sub, v: this.py(v, gPassD), d: this.pd(gPassD), cat: null, reliable: v != null };
  }
  /** Long format (one row per management and subject), so the export has fixed columns. */
  readonly subjectGridExportRows = computed(() => {
    const g = this.subjectMgmtGrid(); if (!g) return [];
    const metric = this.gridMetricLabel();
    return g.rows.flatMap((r) => r.cells.map((c) => ({
      mgmt: r.mgmt, subject: c.subject, metric, value: c.v ?? 'N/A',
      change: c.d == null ? 'N/A' : `${c.d >= 0 ? '+' : ''}${c.d}`,
    })));
  });

  // ================= NEEDS YOUR ATTENTION (module 7) =================
  /** Thresholds that split Critical from Watch. Department policy, so they stay configurable. */
  readonly thresholds = signal<BoardThresholds>({ ...BOARD_THRESHOLDS });
  setThreshold<K extends keyof BoardThresholds>(k: K, v: number): void {
    this.thresholds.update((t) => ({ ...t, [k]: v }));
  }
  resetThresholds(): void { this.thresholds.set({ ...BOARD_THRESHOLDS }); }
  /**
   * Critical and Watch items for the current scope and filters.
   *
   * Items are **consolidated**: a rule that fires for many districts, blocks
   * or schools produces ONE card naming how many units it covers and the worst
   * of them, not one card per unit. Open lists the units behind it.
   *
   * Three metrics, each split into a Critical and a Watch card:
   *  1. Year-on-year improvement — units whose pass % FELL versus last year.
   *  2. Average mark — units whose average sits in the Poor / Needs
   *     Improvement band.
   *  3. Subjects with a low pass % and / or a low average mark.
   * Metric 1 needs both years, so it is skipped when the previous year is
   * the one on screen (its own comparison year is not in the reports).
   */
  readonly alerts = computed<BoardAlert[]>(() => {
    const t = this.thresholds();
    const out: BoardAlert[] = [];
    const lvl = this.ds.level();
    const assumed = this.assumed();
    const units = this.units();
    const noun = (this.unitLabel() + 's').toLowerCase();
    const scope = this.scopeLabel();

    /** One consolidated card for the units a rule matched. */
    const group = (
      id: string, severity: 'Critical' | 'Watch', kind: string, rows: BoardUnit[],
      pickVal: (u: BoardUnit) => number | null, pickChange: (u: BoardUnit) => number | null,
      unit: BoardAlert['unit'], action: string, worstBy: 'change' | 'value',
    ) => {
      if (!rows.length) return;
      const sorted = [...rows].sort((a, b) => worstBy === 'change'
        ? (pickChange(a) ?? 0) - (pickChange(b) ?? 0)
        : (pickVal(a) ?? 0) - (pickVal(b) ?? 0));
      const worst = sorted[0];
      const names = sorted.slice(0, 3).map((u) => u.name);
      const cur = pickVal(worst); const ch = pickChange(worst);
      out.push({
        id, severity, kind: `${kind} — ${rows.length} ${rows.length === 1 ? this.unitLabel().toLowerCase() : noun}`,
        where: scope, schools: rows.reduce((s, u) => s + (u.schools || 0), 0),
        current: cur, previous: cur == null || ch == null ? null : this.r1(cur - ch), change: ch, unit,
        detail: `Worst: ${names.join(', ')}${sorted.length > 3 ? ` and ${sorted.length - 3} more` : ''}`,
        action, open: { kind: 'units', key: id, keys: sorted.map((u) => u.key) }, assumed,
        district: lvl === 'state' ? undefined : this.ds.selectedDistrict() ?? undefined,
        block: lvl === 'block' ? this.ds.selectedBlock() ?? undefined : undefined,
      });
    };

    // ===== Metric 1: Year-on-year improvement in pass % (negative = fell) =====
    const yoy = units.filter((u) => u.passDelta != null);
    group('yoy-crit', 'Critical', `Year-on-year pass % fell by ${t.yoyDropCritical} pp or more`,
      yoy.filter((u) => -(u.passDelta as number) >= t.yoyDropCritical),
      (u) => u.pass, (u) => u.passDelta, 'pp',
      'Review subject-wise results in these units and plan remedial teaching for the weakest subjects', 'change');
    group('yoy-watch', 'Watch', `Year-on-year pass % fell by ${t.yoyDropWatch}–${t.yoyDropCritical} pp`,
      yoy.filter((u) => { const d = -(u.passDelta as number); return d >= t.yoyDropWatch && d < t.yoyDropCritical; }),
      (u) => u.pass, (u) => u.passDelta, 'pp', 'Watch the next assessment cycle and check the weakest subjects', 'change');

    // ===== Metric 2: Average mark below target =====
    const withAvg = units.filter((u) => u.avg != null);
    group('avg-crit', 'Critical', `Average mark below ${t.avgMarkCritical} (Poor band)`,
      withAvg.filter((u) => (u.avg as number) <= t.avgMarkCritical),
      (u) => u.avg, (u) => u.avgDelta, 'mark',
      'Open the list and start with the units furthest below the band; check mark entry and subject teaching', 'value');
    group('avg-watch', 'Watch', `Average mark between ${t.avgMarkCritical} and ${t.avgMarkWatch} (Needs Improvement band)`,
      withAvg.filter((u) => (u.avg as number) > t.avgMarkCritical && (u.avg as number) <= t.avgMarkWatch),
      (u) => u.avg, (u) => u.avgDelta, 'mark', 'Track the average mark at the next review', 'value');

    // ===== Metric 3: Subjects with low pass % and / or low average mark =====
    for (const r of this.subjectRows()) {
      const lowPass = r.pass == null ? null : r.pass < t.subjectPassCritical ? 'Critical' : r.pass < t.subjectPassWatch ? 'Watch' : null;
      const lowAvg = r.avg == null ? null : r.avg <= t.subjectAvgCritical ? 'Critical' : r.avg <= t.subjectAvgWatch ? 'Watch' : null;
      if (!lowPass && !lowAvg) continue;
      const s: 'Critical' | 'Watch' = lowPass === 'Critical' || lowAvg === 'Critical' ? 'Critical' : 'Watch';
      const parts: string[] = [];
      if (lowPass) parts.push(`pass ${r.pass}%`);
      if (lowAvg) parts.push(`average ${r.avg}`);
      const both = lowPass && lowAvg;
      out.push({
        id: `subject|${r.subject}`, severity: s,
        kind: `${r.subject}: low ${both ? 'pass % and average mark' : lowPass ? 'pass %' : 'average mark'}`,
        where: scope, subject: r.subject, schools: null,
        // lead with the average mark; the pass % is in the detail line (no pass % below district scope)
        current: lowAvg || r.pass == null ? r.avg : r.pass, previous: lowAvg || r.pass == null ? r.prevAvg ?? null : r.prevPass ?? null,
        change: lowAvg || r.pass == null
          ? (r.prevAvg == null || r.avg == null ? null : this.r1(r.avg - r.prevAvg))
          : (r.prevPass == null ? null : this.r1(r.pass - r.prevPass)),
        unit: lowAvg || r.pass == null ? 'mark' : 'pp',
        detail: `${parts.join(' · ')}${r.pass == null ? ' · subject pass % is not printed at this scope' : ''} · ${lvl === 'state' ? 'state-wide' : this.subjectSource()}`,
        action: s === 'Critical' ? `Plan subject remediation for ${r.subject}; it is the weakest link in this scope` : `Keep ${r.subject} under review`,
        open: lvl === 'school' ? null : { kind: 'category', key: `Poor|${r.subject}`, cat: 'Poor', subject: r.subject },
        assumed,
      });
    }

    const rank = { Critical: 0, Watch: 1 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]
      || (b.schools ?? 0) - (a.schools ?? 0)
      || Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  });
  readonly criticalAlerts = computed(() => this.alerts().filter((a) => a.severity === 'Critical'));
  readonly watchAlerts = computed(() => this.alerts().filter((a) => a.severity === 'Watch'));
  /** Open the list of units (or the category list) an alert points at. */
  openAlert(a: BoardAlert): void {
    const o = a.open; if (!o) return;
    if (o.kind === 'category' && o.cat) this.openCat(o.cat, o.subject);
    else if (o.kind === 'units' && o.keys) this.pick.set({ kind: 'units', title: `${a.kind} — ${a.where}`, keys: o.keys });
  }
  readonly alertExportRows = computed(() => this.alerts().map((a) => ({
    severity: a.severity, kind: a.kind, where: a.where, district: a.district ? this.ds.titleCase(a.district) : '', block: a.block ?? '',
    subject: a.subject ?? '', schools: a.schools ?? '', current: a.current ?? 'N/A', previous: a.previous ?? 'N/A',
    change: a.change == null ? 'N/A' : `${a.change >= 0 ? '+' : ''}${a.change}`, detail: a.detail ?? '', action: a.action,
  })));

  // ================= EXPORT =================
  readonly unitExportRows = computed(() => this.units().map((u) => ({
    name: u.name, schools: u.schools, appeared: u.appeared, pass: u.pass, passChange: u.passDelta, avg: u.avg, avgChange: u.avgDelta, rank: u.rank ?? '', category: u.cat ?? '',
  })));
}
