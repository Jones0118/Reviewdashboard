import { Injectable, computed, inject, signal } from '@angular/core';
import { loadAsset } from '../utils/asset-loader';
import { DataService } from './data.service';
import { AttendanceService } from './attendance.service';
import { InfraService } from './infra.service';
import { AcademicService } from './academic.service';
import {
  ReviewProgram,
  SchemesData,
  SchemesDistrict,
} from '../models/schemes.model';
import { KpiModuleNode, KpiModulesData, ScholarshipScheme } from '../models/kpi-modules.model';
import {
  AcademicRealAsset, ThiranRealAsset, PalliRealAsset, DigitalInfraRealAsset,
  AcademicReal, ThiranReal, PalliReal, DigitalInfraReal,
  InfraRealAsset, InfraReal,
  SmcRealAsset, SmcReal,
} from '../models/real-data.model';

/** A leaderboard entry (district or school ranked by a metric). */
export interface RankEntry {
  name: string;
  value: number;
  suffix?: string;
}

/**
 * Consolidates the five spec domains — Enrolment, Attendance, Infrastructure,
 * Academic and Schemes — into the "Overall State Dashboard" review view.
 *
 * Every KPI is scaled by the active school-programme filter
 * (All / Model School / Vetri Palli / TN SPARKS / PAL). The source rolls are
 * not tagged by programme, so the programme's share of enrolment (published in
 * schemes.json) is used as a consistent scaling factor across all counts; "All"
 * is the unscaled total. Rates and percentages are left unscaled, since a
 * programme subset shares the same rate to a first approximation.
 */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly ds = inject(DataService);
  private readonly at = inject(AttendanceService);
  private readonly inf = inject(InfraService);
  private readonly ac = inject(AcademicService);

  private readonly _schemes = signal<SchemesData | null>(null);
  private readonly _modules = signal<KpiModulesData | null>(null);
  private readonly _sample = signal<KpiSampleData | null>(null);
  private readonly _academicReal = signal<AcademicRealAsset | null>(null);
  private readonly _thiranReal = signal<ThiranRealAsset | null>(null);
  private readonly _palliReal = signal<PalliRealAsset | null>(null);
  private readonly _digitalReal = signal<DigitalInfraRealAsset | null>(null);
  private readonly _infraReal = signal<InfraRealAsset | null>(null);
  private readonly _smcReal = signal<SmcRealAsset | null>(null);
  private readonly _loaded = signal(false);
  readonly loaded = this._loaded.asReadonly();
  readonly schemes = this._schemes.asReadonly();
  readonly modules = this._modules.asReadonly();

  /** Shared programme filter applied to every Review KPI. */
  readonly program = signal<ReviewProgram>('all');
  setProgram(p: ReviewProgram): void { this.program.set(p); }

  /** Programme options for the filter control (from the generated data). */
  readonly programOptions = computed(
    () => this._schemes()?.programs ?? [{ id: 'all', label: 'All', share: 1 }],
  );

  async load(): Promise<void> {
    if (this._loaded()) return;
    const d = await loadAsset<SchemesData>('assets/schemes.json');
    this._schemes.set(d);
    this._loaded.set(true);
    // the additional KPI modules are optional; the core review still renders without them
    loadAsset<KpiModulesData>('assets/kpi-modules.json')
      .then((m) => this._modules.set(m))
      .catch(() => { /* module figures unavailable */ });
    // synthetic sample data for KPIs without a real source field (optional)
    loadAsset<KpiSampleData>('assets/kpi-sample.json')
      .then((s) => this._sample.set(s))
      .catch(() => { /* sample figures unavailable */ });
    // real EMIS data (optional per domain; row builders fall back gracefully)
    loadAsset<AcademicRealAsset>('assets/academic-real.json')
      .then((a) => this._academicReal.set(a)).catch(() => {});
    loadAsset<ThiranRealAsset>('assets/thiran-real.json')
      .then((a) => this._thiranReal.set(a)).catch(() => {});
    loadAsset<PalliRealAsset>('assets/palli-real.json')
      .then((a) => this._palliReal.set(a)).catch(() => {});
    loadAsset<DigitalInfraRealAsset>('assets/digital-infra-real.json')
      .then((a) => this._digitalReal.set(a)).catch(() => {});
    loadAsset<InfraRealAsset>('assets/infra-real.json')
      .then((a) => this._infraReal.set(a)).catch(() => {});
    loadAsset<SmcRealAsset>('assets/smc-real.json')
      .then((a) => this._smcReal.set(a)).catch(() => {});
  }

  readonly currentYear = computed(
    () => this._schemes()?.currentYear ?? this.ds.data()?.currentYear ?? '',
  );
  readonly note = computed(() => this._schemes()?.note ?? '');

  /**
   * State-wide scaling factor for the active programme: the programme's share
   * of total enrolment. 1 for "All".
   */
  readonly programFactor = computed(() => {
    const p = this.program();
    if (p === 'all') return 1;
    const s = this._schemes();
    if (!s) return 1;
    let total = 0;
    let sub = 0;
    for (const d of s.districts) {
      total += d.programs['all']?.students ?? d.students;
      sub += d.programs[p]?.students ?? 0;
    }
    return total > 0 ? sub / total : 1;
  });

  readonly programLabel = computed(() => {
    const p = this.program();
    return this.programOptions().find((o) => o.id === p)?.label ?? 'All';
  });

  private scale(n: number): number {
    return Math.round(n * this.programFactor());
  }

  // ================= ENROLMENT =================
  /** Enrolment node for the current drill scope (state/district/block/school). */
  private readonly enrolNode = computed(() => this.ds.current());

  readonly enrolmentKpis = computed(() => {
    const st = this.enrolNode();
    if (!st) return [] as { label: string; value: number }[];
    return [
      { label: 'Total Students', value: this.scale(st.students) },
      { label: 'Total Schools', value: this.scale(st.schools) },
      { label: 'Boys', value: this.scale(st.boys) },
      { label: 'Girls', value: this.scale(st.girls) },
      { label: 'Teachers', value: this.scale(st.teaching) },
    ];
  });

  /** Gender split for the current scope (scaled). */
  readonly genderSplit = computed(() => {
    const st = this.enrolNode();
    if (!st) return [];
    return [
      { name: 'Boys', value: this.scale(st.boys) },
      { name: 'Girls', value: this.scale(st.girls) },
      { name: 'Transgender', value: this.scale(st.transgen) },
    ];
  });

  /**
   * Management-wise split. Per the product spec this is the Govt / Fully Aided /
   * Partially Aided / Unaided grouping, which in this dataset lives on
   * `bySchoolType` — `byManagement` is the granular 30-way management list.
   */
  readonly managementSplit = computed(() => {
    const st = this.enrolNode();
    if (!st) return [];
    return (st.bySchoolType ?? [])
      .filter((m) => m.name !== '0')
      .map((m) => ({ name: m.name, value: this.scale(m.students) }));
  });

  /** Social-category split (OC/BC/MBC/DNC/SC/ST). */
  readonly socialCategory = computed(() => {
    const st = this.enrolNode();
    if (!st) return [];
    const c = st.caste;
    return [
      { name: 'OC', value: this.scale(c.OC) },
      { name: 'BC', value: this.scale(c.BC) },
      { name: 'MBC', value: this.scale(c.MBC) },
      { name: 'DNC', value: this.scale(c.DNC) },
      { name: 'SC', value: this.scale(c.SC) },
      { name: 'ST', value: this.scale(c.ST) },
    ];
  });

  /**
   * Leaderboard entries scoped to the current drill level:
   *   state    -> districts
   *   district -> blocks of that district
   *   block    -> schools of that block
   *   school   -> just that school
   * The card titles adapt via `rankUnitLabel`.
   */
  readonly rankUnitLabel = computed(() => {
    switch (this.ds.level()) {
      case 'state': return 'Districts';
      case 'district': return 'Blocks';
      case 'block': return 'Schools';
      default: return 'School';
    }
  });

  private rankRows(): { name: string; value: number }[] {
    const level = this.ds.level();
    if (level === 'state') {
      return this.ds.districts().map((d) => ({ name: this.ds.titleCase(d.name), value: this.scale(d.students) }));
    }
    if (level === 'district') {
      return this.ds.blocksForDistrict().map((b) => ({ name: this.ds.titleCase(b.block), value: this.scale(b.students) }));
    }
    if (level === 'block') {
      return this.ds.schoolsForBlock().map((s) => ({ name: s.name, value: this.scale(s.students) }));
    }
    const sc = this.ds.currentSchool();
    return sc ? [{ name: sc.name, value: this.scale(sc.students) }] : [];
  }

  /**
   * Raw drill keys for the current-scope leaderboard, aligned with rankRows().
   * Districts/blocks drill by their raw (upper-case) key; schools are leaves.
   */
  private rankKeys(): string[] {
    const level = this.ds.level();
    if (level === 'state') return this.ds.districts().map((d) => d.name);
    if (level === 'district') return this.ds.blocksForDistrict().map((b) => b.block);
    if (level === 'block') return this.ds.schoolsForBlock().map((s) => s.name);
    return [];
  }

  /** Top / low performers by enrolment for the current scope, with drill keys. */
  readonly topDistricts = computed<RankEntry[]>(() => this.rankScoped('desc').rows);
  readonly lowDistricts = computed<RankEntry[]>(() => this.rankScoped('asc').rows);
  readonly topDistrictKeys = computed(() => this.rankScoped('desc').keys);
  readonly lowDistrictKeys = computed(() => this.rankScoped('asc').keys);

  private rankScoped(dir: 'asc' | 'desc'): { rows: RankEntry[]; keys: string[] } {
    const rows = this.rankRows();
    const keys = this.rankKeys();
    const paired = rows.map((r, i) => ({ r, k: keys[i] ?? '' }));
    paired.sort((a, b) => (dir === 'desc' ? b.r.value - a.r.value : a.r.value - b.r.value));
    const top = paired.slice(0, 5);
    return { rows: top.map((p) => p.r), keys: top.map((p) => p.k) };
  }

  /** Drill one level deeper into a clicked leaderboard entry. */
  drillInto(key: string): void {
    if (!key) return;
    switch (this.ds.level()) {
      case 'state': this.ds.drillToDistrict(key); break;
      case 'district': this.ds.drillToBlock(key); break;
      case 'block': this.ds.drillToSchool(key); break;
      default: break;
    }
  }

  /**
   * Enrolment trend for the current scope. State/district/block use the
   * matching yearly series; a school uses its own series.
   */
  readonly enrolmentTrend = computed(() => {
    const d = this.ds.data();
    if (!d) return { years: [] as string[], students: [] as number[] };
    const years = d.years ?? [];
    const level = this.ds.level();

    if (level === 'state') {
      return { years: d.trendState.map((p) => p.year), students: d.trendState.map((p) => this.scale(p.students)) };
    }
    if (level === 'district') {
      const dt = d.districtTrend.find((x) => x.name === this.ds.selectedDistrict());
      if (dt) return { years, students: dt.series.map((v) => this.scale(v)) };
    }
    if (level === 'block') {
      const bt = d.blockTrend?.[`${this.ds.selectedDistrict()}||${this.ds.selectedBlock()}`];
      if (bt) return { years, students: bt.series.map((v) => this.scale(v)) };
    }
    if (level === 'school') {
      const sc = this.ds.currentSchool();
      if (sc?.series?.length) return { years, students: sc.series.map((v) => this.scale(v)) };
    }
    // fallback to state series
    return { years: d.trendState.map((p) => p.year), students: d.trendState.map((p) => this.scale(p.students)) };
  });

  /** Year-over-year enrolment change %, latest year vs previous, for the scope. */
  readonly enrolmentChangePct = computed(() => {
    const s = this.enrolmentTrend().students;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    const prev = s[s.length - 2];
    return prev ? Math.round(((last - prev) / prev) * 1000) / 10 : 0;
  });

  // ================= ATTENDANCE =================
  readonly attendanceKpis = computed(() => {
    const n = this.at.current();
    if (!n) return [] as { label: string; value: number; suffix: string }[];
    return [
      { label: 'Marking Compliance', value: Math.round(n.compliance * 10) / 10, suffix: '%' },
      { label: 'Student Attendance', value: Math.round(n.attendance * 10) / 10, suffix: '%' },
      { label: 'Teacher Attendance', value: Math.round(n.teacherAttendance * 10) / 10, suffix: '%' },
      { label: 'Dropout Risk (15+ days)', value: this.scale(n.dropoutRisk), suffix: '' },
    ];
  });

  // ================= INFRASTRUCTURE =================
  /**
   * Infrastructure gap counts pulled from the caution checks (schools failing
   * each safety/facility norm), scaled by programme share.
   */
  readonly infraGaps = computed<RankEntry[]>(() => {
    const checks = this.inf.cautionChecks?.() ?? [];
    return checks
      .filter((c) => c.count > 0)
      .slice(0, 8)
      .map((c) => ({ name: c.label, value: this.scale(c.count) }));
  });

  // ================= SCHEMES =================
  /**
   * Scheme figures for the current scope. schemes.json is published per-district,
   * so state uses the rolled-up total, a district uses its own row, and
   * block/school fall back to their parent district's figures.
   */
  readonly schemeNode = computed(() => {
    const data = this._schemes();
    if (!data) return null;
    const dist = this.ds.selectedDistrict();
    if (dist) {
      const row = data.districts.find((d) => d.name === dist);
      if (row) return row;
    }
    return data.state;
  });

  /** Scheme totals for the current scope, scaled by the programme filter. */
  readonly schemeCards = computed(() => {
    const s = this.schemeNode();
    if (!s) return [];
    return [
      {
        id: 'thiran',
        label: 'Thiran',
        icon: 'fa-solid fa-graduation-cap',
        primary: this.scale(s.thiran.assessed),
        primaryLabel: 'Assessed',
        detail: `${this.pct(s.thiran.assessed, s.thiran.eligible)}% of ${this.scale(s.thiran.eligible)} eligible`,
      },
      {
        id: 'tnspark',
        label: 'TN SPARK',
        icon: 'fa-solid fa-flask',
        primary: this.scale(s.tnSpark.students),
        primaryLabel: 'Students Reached',
        detail: `${this.scale(s.tnSpark.schools)} schools onboarded`,
      },
      {
        id: 'breakfast',
        label: 'Breakfast',
        icon: 'fa-solid fa-mug-hot',
        primary: this.scale(s.breakfast.served),
        primaryLabel: 'Beneficiaries',
        detail: `${this.scale(s.breakfast.schools)} schools serving`,
      },
      {
        id: 'scholarship',
        label: 'Scholarship',
        icon: 'fa-solid fa-award',
        primary: this.scale(s.scholarship.disbursed),
        primaryLabel: 'Disbursed',
        detail: `\u20b9${this.scale(s.scholarship.amountLakh)} L disbursed`,
      },
      {
        id: 'cmcell',
        label: 'CM Cell Petition',
        icon: 'fa-solid fa-file-signature',
        primary: this.scale(s.cmCell.resolved),
        primaryLabel: 'Resolved',
        detail: `${this.scale(s.cmCell.pending)} pending of ${this.scale(s.cmCell.received)}`,
      },
      {
        id: 'helpline',
        label: '14417 Critical Case',
        icon: 'fa-solid fa-phone-volume',
        primary: this.scale(s.helpline14417.cases),
        primaryLabel: 'Cases',
        detail: `${this.scale(s.helpline14417.critical)} critical \u00b7 ${this.scale(s.helpline14417.resolved)} resolved`,
      },
    ];
  });

  private pct(n: number, d: number): number {
    return d ? Math.round((n / d) * 1000) / 10 : 0;
  }

  // ================= STATE EXECUTIVE KPIs =================
  /**
   * The top executive strip from Dashboard (1).md: a single row mixing totals
   * (scaled by programme) and rates (unscaled) drawn from every domain.
   */
  readonly executiveKpis = computed(() => {
    const en = this.enrolNode();
    const at = this.at.current();
    const acNode = this.ac.current();
    const infraCritical = this.criticalInfraTotal();
    const sc = this.schemeNode();

    const out: { label: string; value: string; icon: string; tone?: 'bad' }[] = [];
    if (en) {
      out.push(
        { label: 'Total Schools', value: this.fmt(this.scale(en.schools)), icon: 'fa-solid fa-school' },
        { label: 'Total Students', value: this.fmt(this.scale(en.students)), icon: 'fa-solid fa-user-graduate' },
        { label: 'Total Teachers', value: this.fmt(this.scale(en.teaching)), icon: 'fa-solid fa-chalkboard-user' },
      );
    }
    out.push({
      label: 'Enrolment Change (YoY)',
      value: `${this.enrolmentChangePct()}%`,
      icon: 'fa-solid fa-arrow-trend-up',
      tone: this.enrolmentChangePct() < 0 ? 'bad' : undefined,
    });
    if (at) {
      out.push(
        { label: 'Student Attendance', value: `${Math.round(at.attendance * 10) / 10}%`, icon: 'fa-solid fa-user-check' },
        { label: 'Teacher Attendance', value: `${Math.round(at.teacherAttendance * 10) / 10}%`, icon: 'fa-solid fa-user-tie' },
        { label: 'Attendance Compliance', value: `${Math.round(at.compliance * 10) / 10}%`, icon: 'fa-solid fa-clipboard-check' },
        { label: 'Potential Dropouts (15d)', value: this.fmt(this.scale(at.dropoutRisk)), icon: 'fa-solid fa-person-walking-arrow-right', tone: 'bad' },
      );
    }
    out.push({
      label: 'Critical Infra Gaps',
      value: this.fmt(infraCritical),
      icon: 'fa-solid fa-triangle-exclamation',
      tone: 'bad',
    });
    if (acNode) {
      const st = this.examStat(acNode.byExam);
      out.push(
        { label: `Academic Score (${this.examPeriod()})`, value: `${st ? Math.round(st.avg * 10) / 10 : Math.round(acNode.avgMark * 10) / 10}`, icon: 'fa-solid fa-medal' },
      );
    }
    if (sc) {
      out.push(
        { label: 'Scheme Coverage', value: `${this.pct(sc.thiran.assessed, sc.thiran.eligible)}%`, icon: 'fa-solid fa-hand-holding-heart' },
        { label: 'Critical CM Petitions', value: this.fmt(this.scale(sc.cmCell.pending)), icon: 'fa-solid fa-file-signature', tone: 'bad' },
        { label: '14417 Critical Cases', value: this.fmt(this.scale(sc.helpline14417.critical)), icon: 'fa-solid fa-phone-volume', tone: 'bad' },
      );
    }
    return out;
  });

  private fmt(n: number): string {
    return Math.round(n).toLocaleString('en-IN');
  }

  // ================= CAUTION (ALARMING KPIs ONLY) =================
  /** Total schools flagged across the critical infrastructure caution checks. */
  readonly criticalInfraTotal = computed(() =>
    (this.inf.cautionChecks?.() ?? [])
      .filter((c) => c.severity === 'high' && c.count > 0)
      .reduce((s, c) => s + this.scale(c.count), 0),
  );

  /**
   * The alarming items for the Caution view: only critical/exception figures —
   * high-severity infrastructure gaps plus pending CM petitions and critical
   * 14417 cases. Each carries a count and a short reason.
   */
  readonly cautionItems = computed(() => {
    const items: { id: string; label: string; icon: string; count: number; hint: string; severity: 'high' | 'medium' }[] = [];

    // Critical infrastructure gaps (child-facing essentials missing outright)
    for (const c of this.inf.cautionChecks?.() ?? []) {
      if (c.severity === 'high' && c.count > 0) {
        items.push({
          id: `infra-${c.id}`,
          label: c.label,
          icon: c.icon,
          count: this.scale(c.count),
          hint: c.hint,
          severity: 'high',
        });
      }
    }

    // Grievance / support criticals
    const sc = this.schemeNode();
    if (sc) {
      if (sc.cmCell.pending > 0) {
        items.push({
          id: 'cm-pending',
          label: 'CM Cell — Pending Petitions',
          icon: 'fa-solid fa-file-signature',
          count: this.scale(sc.cmCell.pending),
          hint: 'Petitions received but not yet resolved.',
          severity: 'high',
        });
      }
      if (sc.helpline14417.critical > 0) {
        items.push({
          id: 'helpline-critical',
          label: '14417 — Critical Cases',
          icon: 'fa-solid fa-phone-volume',
          count: this.scale(sc.helpline14417.critical),
          hint: 'Child-safety / distress cases flagged critical.',
          severity: 'high',
        });
      }
    }

    return items.sort((a, b) => b.count - a.count);
  });

  /** Total across all caution items — powers the sub-menu badge. */
  readonly cautionTotal = computed(() =>
    this.cautionItems().reduce((s, i) => s + i.count, 0),
  );

  /** Caution items shaped for the ranked bar chart. */
  readonly cautionBars = computed<RankEntry[]>(() =>
    this.cautionItems().map((i) => ({ name: i.label, value: i.count })),
  );

  /** Whether every underlying dataset needed for the review has arrived. */
  readonly ready = computed(
    () => this.ds.loaded() && this._loaded(),
  );

  // ================= ACADEMIC EXAM PERIOD =================
  /**
   * Quarterly / Half Yearly / Annual switch. Sourced from the real `byExam`
   * breakdown that exists at state, district, block AND school level, so the
   * Academic drill-down column and KPI can compare exam periods rather than
   * only showing one blended average.
   */
  readonly examPeriod = signal<string>('Annual');
  setExamPeriod(p: string): void { this.examPeriod.set(p); }
  readonly examPeriodOptions = computed(() => this.ac.data()?.examTypes ?? ['Quarterly', 'Half Yearly', 'Annual']);

  /** Pick the {avg, pass, compliance} for the active exam period from a byExam array. */
  private examStat(byExam: { name: string; avg: number; pass: number; compliance: number }[] | undefined) {
    if (!byExam?.length) return null;
    return byExam.find((x) => x.name === this.examPeriod()) ?? byExam[byExam.length - 1];
  }

  /** Academic KPIs for the current scope, sourced from the selected exam period. */
  readonly academicKpisByPeriod = computed(() => {
    const node = this.ac.current();
    const st = this.examStat(node?.byExam);
    if (!st) return [] as { label: string; value: number; suffix: string }[];
    return [
      { label: `Average Mark (${this.examPeriod()})`, value: Math.round(st.avg * 10) / 10, suffix: '' },
      { label: `Pass % (${this.examPeriod()})`, value: Math.round(st.pass * 10) / 10, suffix: '%' },
      { label: 'Compliance', value: Math.round(st.compliance * 10) / 10, suffix: '%' },
    ];
  });

  // ================= PROTOTYPE CHART DATA =================
  /**
   * The prototype's KPI cards, grouped into per-domain rows so each domain's
   * KPIs read as a single line. Thresholds follow the spec's RAG table.
   */
  readonly kpiSections = computed<KpiSection[]>(() => {
    const en = this.enrolNode();
    const at = this.at.current();
    const acStat = this.examStat(this.ac.current()?.byExam);
    const sc = this.schemeNode();
    const gaps = this.criticalInfraTotal();
    const chg = this.enrolmentChangePct();
    const out: KpiSection[] = [];
    if (!en) return out;

    // ---- Enrolment: one line ----
    out.push({
      id: 'enr', label: 'Enrolment', icon: 'fa-solid fa-user-graduate', topic: 'enr',
      cards: [
        { label: 'Schools', value: this.fmt(this.scale(en.schools)), sub: '', subClass: '', icon: 'fa-solid fa-school', topic: 'enr', card: '' },
        { label: 'Students', value: this.lakh(this.scale(en.students)), sub: '', subClass: '', icon: 'fa-solid fa-users', topic: 'enr', card: '' },
        { label: 'Boys', value: this.lakh(this.scale(en.boys)), sub: '', subClass: '', icon: 'fa-solid fa-person', topic: 'enr', card: '' },
        { label: 'Girls', value: this.lakh(this.scale(en.girls)), sub: '', subClass: '', icon: 'fa-solid fa-person-dress', topic: 'enr', card: '' },
        { label: 'Teachers', value: this.fmt(this.scale(en.teaching)), sub: '', subClass: '', icon: 'fa-solid fa-chalkboard-user', topic: 'enr', card: '' },
        {
          label: 'Enrolment Change', value: `${chg > 0 ? '+' : ''}${chg}%`,
          sub: 'vs last year', subClass: chg < 0 ? 'down' : 'up',
          icon: chg < 0 ? 'fa-solid fa-arrow-trend-down' : 'fa-solid fa-arrow-trend-up',
          topic: 'enr', card: chg < -2 ? 'r' : '',
        },
      ],
    });

    // ---- Attendance ----
    if (at) {
      out.push({
        id: 'att', label: 'Attendance', icon: 'fa-solid fa-calendar-check', topic: 'att',
        cards: [
          { label: 'Student attendance', value: `${Math.round(at.attendance * 10) / 10}%`, sub: 'Target 95%', subClass: '', icon: 'fa-solid fa-calendar-check', topic: 'att', card: '', ring: Math.round(at.attendance * 10) / 10, ringRed: 88, ringAmber: 91 },
          { label: 'Teacher attendance', value: `${Math.round(at.teacherAttendance * 10) / 10}%`, sub: '', subClass: '', icon: 'fa-solid fa-chalkboard-user', topic: 'att', card: '', ring: Math.round(at.teacherAttendance * 10) / 10, ringRed: 88, ringAmber: 91 },
          { label: 'Marked on time', value: `${Math.round(at.compliance * 10) / 10}%`, sub: '', subClass: '', icon: 'fa-solid fa-clock', topic: 'att', card: 'a', ring: Math.round(at.compliance * 10) / 10, ringRed: 88, ringAmber: 91 },
          { label: 'Potential dropouts', value: this.fmt(this.scale(at.dropoutRisk)), sub: '15+ days absent', subClass: '', icon: 'fa-solid fa-user-xmark', topic: 'att', card: 'r' },
          { label: 'Teachers on long leave', value: this.fmt(this.estimateLongLeave(en.teaching)), sub: 'estimated', subClass: '', icon: 'fa-solid fa-user-clock', topic: 'att', card: '' },
        ],
      });
    }

    // ---- Infrastructure / Academic / Schemes ----
    const rest: ProtoKpi[] = [
      {
        label: 'Schools with infra gaps', value: this.fmt(gaps),
        sub: `${this.pct(gaps, this.scale(en.schools))}% of schools`, subClass: '',
        icon: 'fa-solid fa-building', topic: 'inf', card: 'r',
      },
    ];
    if (acStat) {
      const avg = Math.round(acStat.avg * 10) / 10;
      rest.push({
        label: `Academic score (${this.examPeriod()})`, value: `${avg}%`, sub: 'Target 65%', subClass: '',
        icon: 'fa-solid fa-graduation-cap', topic: 'aca', card: '', ring: avg, ringRed: 50, ringAmber: 58,
      });
    }
    if (sc) {
      const cov = this.pct(sc.thiran.assessed, sc.thiran.eligible);
      rest.push(
        { label: 'Scheme coverage', value: `${cov}%`, sub: '', subClass: '', icon: 'fa-solid fa-gift', topic: 'sch', card: '', ring: cov, ringRed: 90, ringAmber: 94 },
        { label: 'Open cases', value: this.fmt(this.scale(sc.cmCell.pending + sc.helpline14417.critical)), sub: 'CM Cell + 14417', subClass: '', icon: 'fa-solid fa-comment-dots', topic: 'sch', card: 'r' },
      );
    }
    out.push({
      id: 'rest', label: 'Infrastructure, Academic & Schemes',
      icon: 'fa-solid fa-layer-group', topic: 'inf', cards: rest,
    });

    return out;
  });

  /** Flat list, kept for anything that wants every card in one array. */
  readonly protoKpis = computed<ProtoKpi[]>(() => this.kpiSections().flatMap((s) => s.cards));

  /** Indian lakh/crore short form, matching the prototype's lk() helper. */
  private lakh(v: number): string {
    if (v >= 1e7) return `${Math.round((v / 1e7) * 10) / 10} cr`;
    if (v >= 1e5) return `${Math.round((v / 1e5) * 10) / 10} lakh`;
    return this.fmt(v);
  }

  /** Percentage-normalised slices for the plain-CSS donuts. */
  private toPct(slices: { name: string; value: number }[]) {
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (!total) return slices.map((s) => ({ name: s.name, value: 0 }));
    return slices.map((s) => ({ name: s.name, value: Math.round((s.value / total) * 1000) / 10 }));
  }
  readonly genderPct = computed(() => this.toPct(this.genderSplit()));
  readonly managementPct = computed(() => this.toPct(this.managementSplit()));

  /** Real infra gap rows (label + count + icon) for the prototype's gap bar chart. */
  readonly infraGapRows = computed(() =>
    (this.inf.cautionChecks?.() ?? [])
      .filter((c) => c.id !== 'notEntered')
      .map((c) => ({ name: c.label, value: this.scale(c.count), icon: c.icon }))
      .sort((a, b) => b.value - a.value),
  );

  /** Total potential dropouts for the current scope (trend-chart note). */
  readonly protoDropTotal = computed(() => this.scale(this.at.current()?.dropoutRisk ?? 0));

  /** Last five academic years of enrolment for the current scope. */
  readonly enrolmentTrend5y = computed(() => {
    const t = this.enrolmentTrend();
    const n = t.years.length;
    if (!n) return { years: [] as string[], values: [] as number[] };
    const from = Math.max(0, n - 5);
    return { years: t.years.slice(from), values: t.students.slice(from) };
  });

  /**
   * Attendance across the current scope's children, lowest first, capped to the
   * worst performers so the card stays a "who needs attention" list rather than
   * a full roster. `attendanceUnitTotal` reports how many were ranked.
   */
  private readonly LOW_PERFORMERS = 10;
  private readonly attendanceRanked = computed(() =>
    [...this.drillRows()]
      .filter((r) => r.level !== 'school' || r.hasAtt !== false)
      .filter((r) => r.att > 0)
      .sort((a, b) => a.att - b.att)
      .map((r) => ({ name: r.name, value: r.att })),
  );
  readonly attendanceByUnit = computed(() => this.attendanceRanked().slice(0, this.LOW_PERFORMERS));
  readonly attendanceUnitTotal = computed(() => this.attendanceRanked().length);
  /** Weighted average attendance for the current scope, as the comparison line. */
  readonly attendanceScopeAvg = computed(() => {
    const n = this.at.current();
    return n ? Math.round(n.attendance * 10) / 10 : 0;
  });

  /**
   * Attendance by school type: the real EMIS categories (Government / Fully
   * Aided / Partially Aided / Un-aided) attendance is actually collected for.
   * The prototype's exact labels (Model School / Vetri Palli / TN SPARKS / PAL)
   * are not tagged in the source data — see the programme filter for that.
   */
  readonly attendanceBySchoolType = computed(() =>
    this.at.byManagement().map((m) => ({ name: m.name, value: m.attendance })),
  );

  /**
   * Academic score by class for the active exam period.
   *
   * Sourced from `examClass` (exam x class), not `byClass` — `byClass` is a
   * single blended breakdown whose values are identical for every exam period,
   * so comparing it against a period-specific State average would be
   * apples-to-oranges. Classes 10 and 12 are board exams, so they appear under
   * Annual only, which is why the bar count changes with the period.
   */
  readonly academicByClass = computed(() => {
    const node = this.ac.current();
    const period = this.examPeriod();
    const rows = (node?.examClass ?? []).filter((r) => r.exam === period);
    if (rows.length) {
      return [...rows]
        .sort((a, b) => a.cls - b.cls)
        .map((r) => ({ name: `Class ${r.cls}`, value: Math.round(r.avg * 10) / 10, board: r.board }));
    }
    // fall back to the blended class breakdown when a scope has no exam x class detail
    return (node?.byClass ?? []).map((c) => ({
      name: `Class ${c.name}`, value: Math.round(c.avg * 10) / 10, board: false,
    }));
  });

  /**
   * State average for the active exam period — the comparison baseline the
   * class-wise chart is read against. At state level this is the same figure as
   * the scope itself; when drilled down it is the State line to beat.
   */
  readonly academicStateAvg = computed(() => {
    const stateNode = this.ac.data()?.state?.[this.ac.activeYear()];
    const st = this.examStat(stateNode?.byExam);
    return st ? Math.round(st.avg * 10) / 10 : 0;
  });

  /** Class-wise rows annotated with their gap against the State average. */
  readonly academicByClassVsState = computed(() => {
    const avg = this.academicStateAvg();
    return this.academicByClass().map((c) => ({
      ...c,
      diff: Math.round((c.value - avg) * 10) / 10,
      below: c.value < avg,
    }));
  });

  /** Six scheme/resolution rings, matching the prototype's ring grid. */
  readonly schemeRings = computed(() => {
    const s = this.schemeNode();
    const en = this.enrolNode();
    if (!s) return [];
    return [
      { label: 'Thiran', icon: 'fa-solid fa-graduation-cap', value: this.pct(s.thiran.assessed, s.thiran.eligible) },
      { label: 'TN SPARK', icon: 'fa-solid fa-star', value: this.pct(s.tnSpark.schools, en?.schools ?? s.tnSpark.schools) },
      { label: 'Breakfast', icon: 'fa-solid fa-mug-hot', value: this.pct(s.breakfast.served, s.breakfast.eligible) },
      { label: 'Scholarship', icon: 'fa-solid fa-award', value: this.pct(s.scholarship.disbursed, s.scholarship.applied) },
      { label: 'CM Cell resolved', icon: 'fa-solid fa-comment-dots', value: this.pct(s.cmCell.resolved, s.cmCell.received) },
      { label: '14417 resolved', icon: 'fa-solid fa-comment-dots', value: this.pct(s.helpline14417.resolved, s.helpline14417.cases) },
    ];
  });

  /** Grievance stack: resolved vs open vs critical, real counts from schemes.json. */
  readonly grievanceStack = computed(() => {
    const s = this.schemeNode();
    if (!s) return { resolved: 0, open: 0, critical: 0 };
    return {
      resolved: this.scale(s.cmCell.resolved + s.helpline14417.resolved),
      open: this.scale(s.cmCell.pending),
      critical: this.scale(s.helpline14417.critical),
    };
  });

  // ================= DRILL-DOWN TABLE (topic-tabbed, prototype structure) =================
  /** Topics mirror the prototype's lens tabs. */
  readonly topics: { id: DrillTopic; label: string; icon: string }[] = [
    { id: 'enr', label: 'Enrollment', icon: 'fa-solid fa-user-graduate' },
    { id: 'att', label: 'Attendance', icon: 'fa-solid fa-clipboard-check' },
    { id: 'inf', label: 'Infrastructure', icon: 'fa-solid fa-building-columns' },
    { id: 'aca', label: 'Academic', icon: 'fa-solid fa-graduation-cap' },
    { id: 'sch', label: 'Schemes & Grievances', icon: 'fa-solid fa-hand-holding-heart' },
    { id: 'thiran', label: 'THIRAN+', icon: 'fa-solid fa-user-graduate' },
    { id: 'scholarship', label: 'Scholarship', icon: 'fa-solid fa-award' },
    { id: 'smc', label: 'SMC', icon: 'fa-solid fa-people-group' },
    { id: 'palli', label: 'Palli Parvai', icon: 'fa-solid fa-clipboard-check' },
  ];
  readonly activeTopic = signal<DrillTopic>('att');
  setTopic(t: DrillTopic): void { this.activeTopic.set(t); this.sortCol.set(null); }

  /**
   * Per-topic column (KPI) filter for the drill table. Keyed by topic; the
   * value is the list of selected column keys for that topic. An empty list
   * means "show all columns" for that topic. This powers the KPI filter next
   * to the drill-table title: it only ever lists the active component's KPIs.
   */
  readonly colFilter = signal<Partial<Record<DrillTopic, string[]>>>({});

  /** Selected column keys for the active topic (empty = all). */
  readonly colFilterKeys = computed<string[]>(() => this.colFilter()[this.activeTopic()] ?? []);

  /** Set the active topic's selected columns. */
  setColFilter(keys: string[]): void {
    this.colFilter.update((m) => ({ ...m, [this.activeTopic()]: keys ?? [] }));
    // keep sorting valid if the sorted column was hidden
    const sc = this.sortCol();
    if (sc && keys && keys.length && !keys.includes(sc)) this.sortCol.set(null);
  }

  /** Clear the active topic's column filter. */
  clearColFilter(): void { this.setColFilter([]); }

  /** Multiselect options = the active component's KPIs only. */
  readonly topicColumnOptions = computed(() =>
    this.allTopicColumns().map((c) => ({ label: c.label, value: c.key })),
  );

  /** Column model per topic, matching the prototype's per-lens columns. */
  readonly allTopicColumns = computed<DrillColumn[]>(() => {
    switch (this.activeTopic()) {
      case 'enr':
        return [
          { key: 'n', label: 'Students', fmt: 'num' },
          { key: 'chg', label: 'Change vs last year', fmt: 'pctSigned', tone: (v) => (v < -2 ? 'bad' : v < 0 ? 'warn' : 'good') },
          { key: 'drop', label: 'Potential dropout', fmt: 'num' },
          { key: 'ns', label: 'Schools', fmt: 'num' },
        ];
      case 'att':
        return [
          { key: 'att', label: 'Student attendance', fmt: 'pct', bar: true, tone: (v) => (v < 88 ? 'bad' : v < 91 ? 'warn' : 'good') },
          { key: 'drop', label: 'Potential dropout (15 days)', fmt: 'num' },
          { key: 'tl', label: 'Teachers on long leave (est.)', fmt: 'num' },
          { key: 'n', label: 'Students', fmt: 'num' },
        ];
      case 'inf':
        return [
          { key: 'gaps', label: 'Schools with gaps', fmt: 'num', tone: (v, r) => (r.ns > 1 ? (v / r.ns > 0.3 ? 'bad' : 'warn') : (v >= 2 ? 'bad' : v ? 'warn' : 'good')) },
          { key: 'gapl', label: 'Main gap', fmt: 'text' },
          { key: 'n', label: 'Students', fmt: 'num' },
        ];
      case 'aca':
        return [
          { key: 'academicAvg', label: `Avg mark (${this.examPeriod()})`, fmt: 'num1', bar: true, barMax: 100, tone: (v) => (v < 50 ? 'bad' : v < 58 ? 'warn' : 'good') },
          { key: 'acaLanguageAvg', label: 'Tamil/Lang', fmt: 'num1' },
          { key: 'acaEnglishAvg', label: 'English', fmt: 'num1' },
          { key: 'acaMathsAvg', label: 'Maths', fmt: 'num1' },
          { key: 'acaScienceAvg', label: 'Science', fmt: 'num1' },
          { key: 'acaSocialAvg', label: 'Social', fmt: 'num1' },
          { key: 'acaCompletionPct', label: 'Entry %', fmt: 'pct' },
        ];
      case 'thiran':
        return [
          { key: 'thiranStudents', label: 'Students identified', fmt: 'num' },
          { key: 'thiranSchools', label: 'Schools covered', fmt: 'num' },
          { key: 'thiranSharePct', label: '% of enrolment', fmt: 'pct' },
          { key: 'thiranBloPct', label: 'BLO attainment %', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 60 ? 'bad' : v < 80 ? 'warn' : 'good') },
          { key: 'thiranBaselinePct', label: 'Baseline update %', fmt: 'pct' },
          { key: 'thiranNotTagged', label: 'Not tagged', fmt: 'num' },
        ];
      case 'scholarship':
        return [
          { key: 'scholarEligible', label: 'Eligible', fmt: 'num' },
          { key: 'scholarEligibilityPct', label: 'Eligibility %', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 70 ? 'bad' : v < 80 ? 'warn' : 'good') },
          { key: 'scholarAadhaar', label: 'Aadhaar not updated', fmt: 'num', tone: (v, r) => (v > 0 && v / Math.max(1, r.scholarEligible ?? 1) >= 0.08 ? 'bad' : v > 0 ? 'warn' : 'good') },
          { key: 'scholarPayPending', label: 'Payment pending', fmt: 'num' },
        ];
      case 'smc':
        return [
          { key: 'smcRaised', label: 'Raised', fmt: 'num' },
          { key: 'smcClosed', label: 'Closed', fmt: 'num' },
          { key: 'smcPending', label: 'Pending', fmt: 'num' },
          { key: 'smcEmergencyOpen', label: 'Emergency open', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
          { key: 'smcClosureRate', label: 'Closure rate', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 60 ? 'bad' : v < 75 ? 'warn' : 'good') },
        ];
      case 'palli':
        return [
          { key: 'palliVisited', label: 'Schools visited', fmt: 'num' },
          { key: 'palliObservations', label: 'Observations', fmt: 'num' },
          { key: 'palliOfficials', label: 'Officials', fmt: 'num' },
          { key: 'palliBrte', label: 'BRTE', fmt: 'num' },
          { key: 'palliBeo', label: 'BEO', fmt: 'num' },
        ];
      default:
        return [
          { key: 'sch', label: 'Scheme coverage (est. below district)', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 90 ? 'bad' : v < 94 ? 'warn' : 'good') },
          { key: 'cases', label: 'Open cases (CM Cell, 14417) (est.)', fmt: 'num' },
        ];
    }
  });

  /**
   * The columns actually rendered in the drill table: the active topic's
   * columns, narrowed to the user's KPI selection (if any). Header, body and
   * sorting all consume this, so filtering here hides columns everywhere.
   */
  readonly topicColumns = computed<DrillColumn[]>(() => {
    const all = this.allTopicColumns();
    const sel = this.colFilterKeys();
    if (!sel.length) return all;
    const keep = new Set(sel);
    const filtered = all.filter((c) => keep.has(c.key));
    // never render an empty table; fall back to all if the selection matched nothing
    return filtered.length ? filtered : all;
  });

  /** Unit label for the current drill level (District / Block / School). */
  readonly drillUnitLabel = computed(() => {
    switch (this.ds.level()) {
      case 'state': return 'District';
      case 'district': return 'Block';
      default: return 'School';
    }
  });

  /** Breadcrumb entries: Tamil Nadu -> District -> Block, clickable to jump up. */
  readonly drillCrumb = computed(() => {
    const out: { label: string; action: 'state' | 'district' }[] = [{ label: 'Tamil Nadu', action: 'state' }];
    if (this.ds.selectedDistrict()) out.push({ label: this.ds.titleCase(this.ds.selectedDistrict()!), action: 'district' });
    return out;
  });

  /**
   * Unified drill rows for the current scope's children, joined by udise
   * across enrolment/attendance/academic/infra, all real data except:
   *  - `tl` (teachers on long leave): no leave/duration field exists anywhere
   *    in the source data, so it is estimated at ~2% of teaching staff.
   *  - `sch`/`cases` below district level: schemes.json has no per-block or
   *    per-school breakdown, so these are apportioned from the parent
   *    district's totals by each unit's share of district enrolment.
   * Infra gap categories are the real EMIS checks (zero toilets/water/
   * classrooms/urinals/furniture, water not functional) — the prototype's
   * CWSN/internet/EB/demolish categories have no equivalent field in this data.
   */
  readonly drillRows = computed<DrillRow[]>(() => {
    const level = this.ds.level();
    if (level === 'state') return this.districtRows();
    if (level === 'district') return this.blockRows();
    if (level === 'block') return this.schoolRows();
    return [];
  });

  /** Always district-level rows (used by the District Review card grid). */
  readonly allDistrictRows = computed<DrillRow[]>(() => this.districtRows());

  private districtRows(): DrillRow[] {
    const enDistricts = this.ds.districts();
    const atMap = this.at.data()?.districts ?? {};
    const acMap = this.ac.data()?.districts?.[this.ac.activeYear()] ?? {};
    const infChecks = this.inf.cautionChecks?.() ?? []; // state-scope; per-district breakdown below via schools list
    const schemesByDist = new Map((this._schemes()?.districts ?? []).map((d) => [d.name, d] as const));

    return enDistricts.map((d) => {
      const key = d.name;
      const atNode = atMap[key];
      const acNode = acMap[key];
      const sc = schemesByDist.get(key) ?? null;
      const trend = this.districtChangePct(key);
      const gapInfo = this.infraGapForKeys([key]);
      const examStat = this.examStat(acNode?.byExam);
      const examPrev = this.examStatPrev(acNode?.byExam);

      return {
        key, name: this.ds.titleCase(key), level: 'district',
        ns: this.scale(d.schools), n: this.scale(d.students),
        chg: trend,
        att: atNode ? Math.round(atNode.attendance * 10) / 10 : 0,
        drop: this.scale(atNode?.dropoutRisk ?? 0),
        tl: this.estimateLongLeave(d.teaching),
        gaps: this.scale(gapInfo.count),
        gapl: gapInfo.label,
        academicAvg: examStat ? Math.round(examStat.avg * 10) / 10 : 0,
        academicPrevAvg: examPrev ? Math.round(examPrev.avg * 10) / 10 : 0,
        academicChange: examStat && examPrev ? Math.round((examStat.avg - examPrev.avg) * 10) / 10 : 0,
        sch: sc ? this.pct(sc.thiran.assessed, sc.thiran.eligible) : 0,
        cases: sc ? this.scale(sc.cmCell.pending + sc.helpline14417.critical) : 0,
        // ---- extra real KPI fields for the tile grid ----
        teacherAtt: atNode ? Math.round(atNode.teacherAttendance * 10) / 10 : 0,
        compliance: atNode ? Math.round(atNode.compliance * 10) / 10 : 0,
        teaching: this.scale(d.teaching),
        girlsPct: d.students ? Math.round((d.girls / d.students) * 1000) / 10 : 0,
        dropRate: atNode ? Math.round((atNode.dropoutRate ?? 0) * 10) / 10 : 0,
        tnSparkPct: sc ? this.pct(sc.tnSpark.students, d.students) : 0,
        breakfastPct: sc ? this.pct(sc.breakfast.served, sc.breakfast.eligible) : 0,
        cmOpen: sc ? this.scale(sc.cmCell.pending) : 0,
        h14417Open: sc ? this.scale(sc.helpline14417.cases - sc.helpline14417.resolved) : 0,
        h14417Critical: sc ? this.scale(sc.helpline14417.critical) : 0,
        h14417ResPct: sc ? this.pct(sc.helpline14417.resolved, sc.helpline14417.cases) : 0,
        ...this.moduleFields(key, 1, d.schools),
        ...this.sampleFields(key, 1, d.schools),
        ...this.realFields(key, null, undefined, 'district'),
      };
    });
  }

  private blockRows(): DrillRow[] {
    const dist = this.ds.selectedDistrict();
    if (!dist) return [];
    const enBlocks = this.ds.blocksForDistrict();
    const atMap = this.at.data()?.blocks ?? {};
    const acMap = this.ac.data()?.blocks?.[this.ac.activeYear()] ?? {};
    const sc = (this._schemes()?.districts ?? []).find((x) => x.name === dist) ?? null;
    const distStudents = sc?.students || this.ds.data()?.districts.find((x) => x.name === dist)?.students || 1;

    return enBlocks.map((b) => {
      const key = `${dist}||${b.block}`;
      const atNode = atMap[key];
      const acNode = acMap[key];
      const gapInfo = this.infraGapForKeys([key]);
      const examStat = this.examStat(acNode?.byExam);
      const examPrev = this.examStatPrev(acNode?.byExam);
      const share = distStudents ? b.students / distStudents : 0;

      return {
        key: b.block, name: this.ds.titleCase(b.block), level: 'block',
        ns: this.scale(b.schools), n: this.scale(b.students),
        chg: this.blockChangePct(dist, b.block),
        att: atNode ? Math.round(atNode.attendance * 10) / 10 : 0,
        drop: this.scale(atNode?.dropoutRisk ?? 0),
        tl: this.estimateLongLeave(b.teaching),
        gaps: this.scale(gapInfo.count),
        gapl: gapInfo.label,
        academicAvg: examStat ? Math.round(examStat.avg * 10) / 10 : 0,
        academicPrevAvg: examPrev ? Math.round(examPrev.avg * 10) / 10 : 0,
        academicChange: examStat && examPrev ? Math.round((examStat.avg - examPrev.avg) * 10) / 10 : 0,
        sch: sc ? this.pct(sc.thiran.assessed, sc.thiran.eligible) : 0,
        cases: sc ? this.scale(Math.round((sc.cmCell.pending + sc.helpline14417.critical) * share)) : 0,
        ...this.moduleFields(dist, share, b.schools),
        ...this.sampleFields(dist, share, b.schools),
        ...this.realFields(dist, b.block, undefined, 'block'),
      };
    });
  }

  private schoolRows(): DrillRow[] {
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    if (!dist || !blk) return [];
    const enSchools = this.ds.schoolsForBlock();
    const atByUdise = new Map(this.at.schoolsForBlock().map((s) => [s.udise, s] as const));
    const acByUdise = new Map(this.ac.schoolsForBlock().map((s) => [s.udise, s] as const));
    const infByUdise = new Map(this.inf.schoolsForBlock().map((s) => [s.udise, s] as const));
    const sc = (this._schemes()?.districts ?? []).find((x) => x.name === dist) ?? null;
    const distStudents = sc?.students || 1;

    return enSchools.map((s) => {
      const atS = atByUdise.get(s.udise);
      const acS = acByUdise.get(s.udise);
      const infS = infByUdise.get(s.udise);
      const gapInfo = this.infraGapForSchool(infS);
      const examStat = this.examStat(acS?.byExam);
      const examPrev = this.examStatPrev(acS?.byExam);
      const share = distStudents ? s.students / distStudents : 0;

      return {
        key: s.name, udise: s.udise, name: s.name, level: 'school',
        ns: 1, n: this.scale(s.students),
        chg: s.series?.length >= 2 ? this.seriesChangePct(s.series) : 0,
        att: atS ? Math.round(atS.attendance * 10) / 10 : 0,
        hasAtt: !!atS,
        drop: this.scale(atS?.dropoutRisk ?? 0),
        tl: this.estimateLongLeave(s.teaching),
        gaps: gapInfo.count,
        gapl: gapInfo.label,
        gapList: gapInfo.list,
        academicAvg: examStat ? Math.round(examStat.avg * 10) / 10 : 0,
        academicPrevAvg: examPrev ? Math.round(examPrev.avg * 10) / 10 : 0,
        academicChange: examStat && examPrev ? Math.round((examStat.avg - examPrev.avg) * 10) / 10 : 0,
        hasAca: !!acS,
        sch: sc ? this.pct(sc.thiran.assessed, sc.thiran.eligible) : 0,
        cases: sc ? this.scale(Math.round((sc.cmCell.pending + sc.helpline14417.critical) * share)) : 0,
        ...this.moduleFields(dist, share, 1),
        ...this.sampleFields(dist, share, 1),
        ...this.realFields(dist, blk, s.udise, 'school'),
      };
    });
  }

  /** Second-most-recent exam period stat, for the "previous" / change columns. */
  private examStatPrev(byExam: { name: string; avg: number; pass: number; compliance: number }[] | undefined) {
    if (!byExam?.length) return null;
    const order = this.examPeriodOptions();
    const idx = order.indexOf(this.examPeriod());
    if (idx <= 0) return byExam.find((x) => x.name === order[0]) ?? byExam[0];
    return byExam.find((x) => x.name === order[idx - 1]) ?? null;
  }

  /** Teachers on long leave has no source field anywhere in the data; estimated at ~2% of teaching staff. */
  private estimateLongLeave(teaching: number): number {
    return Math.round(this.scale(teaching) * 0.02);
  }

  /**
   * Initiative module fields (THIRAN+, Scholarship, SMC, Palli Parvai) for a
   * district row. `share` is 1 for a district; for blocks and schools it is that
   * unit's share of district enrolment, since the modules are published only at
   * district level. Rates are carried through unscaled.
   */
  private moduleFields(districtName: string | null, share: number, units: number): Partial<DrillRow> {
    const m = this._modules();
    if (!m || !districtName) return {};
    const d = m.districts.find((x) => x.name === districtName);
    if (!d) return {};
    const part = (n: number) => this.scale(Math.round(n * share));

    // combine every scholarship scheme for the row-level view
    const schemes = d.scholarship.schemes;
    const sAdd = (k: 'total' | 'eligible' | 'aadhaarNotUpdated' | 'payPending') =>
      schemes.reduce((a, s) => a + s[k], 0);
    const sTotal = sAdd('total');
    const sEligible = sAdd('eligible');

    const palliTarget = part(d.palliParvai.target);
    const palliVisited = part(d.palliParvai.visited);
    const smcRaised = part(d.smc.raised);
    const smcClosed = part(d.smc.closed);

    return {
      thiranStudents: part(d.thiran.students),
      thiranSchools: units > 1 ? part(d.thiran.schools) : Math.min(1, part(d.thiran.schools)),
      thiranSharePct: this.pct(d.thiran.students * share, (d.students || 1) * share),
      scholarEligible: part(sEligible),
      scholarEligibilityPct: this.pct(sEligible, sTotal),
      scholarAadhaar: part(sAdd('aadhaarNotUpdated')),
      scholarPayPending: part(sAdd('payPending')),
      smcRaised,
      smcClosed,
      smcPending: Math.max(0, smcRaised - smcClosed),
      smcClosureRate: this.pct(smcClosed, smcRaised),
      palliTarget,
      palliVisited,
      palliNotVisited: Math.max(0, palliTarget - palliVisited),
      palliCompletionPct: this.pct(palliVisited, palliTarget),
    };
  }

  /**
   * Synthetic sample KPI fields (from kpi-sample.json) for KPIs that have no
   * real source field. Published per district; apportioned to blocks/schools by
   * `share` for counts, with percentages carried through unscaled. `units` is
   * the number of schools in the row (used to cap per-school count fields at 1).
   */
  private sampleFields(districtName: string | null, share: number, units: number): Partial<DrillRow> {
    const s = this._sample();
    if (!s || !districtName) return {};
    const d = s.districts.find((x) => x.name === districtName);
    if (!d) return {};
    const part = (n: number) => this.scale(Math.round(n * share));
    // count fields that represent "number of schools": cap at 1 for a single school
    const cnt = (n: number) => (units > 1 ? part(n) : Math.min(1, part(n)));

    return {
      cwsnPct: d.cwsnPct,
      declSchools: cnt(d.declSchools),
      attPending: cnt(d.attPending),
      infNoToilet: cnt(d.infNoToilet),
      infNoWater: cnt(d.infNoWater),
      infNoCwsnToilet: cnt(d.infNoCwsnToilet),
      infNoEb: cnt(d.infNoEb),
      infNoKitchen: cnt(d.infNoKitchen),
      infDemolish: cnt(d.infDemolish),
      infRepair: cnt(d.infRepair),
      ictSchools: cnt(d.ictSchools),
      ictInternet: cnt(d.ictInternet),
      ictNoInternet: cnt(d.ictNoInternet),
      ictNoTeacher: cnt(d.ictNoTeacher),
      slasPct: d.slasPct,
      acaUp: cnt(d.acaUp),
      acaDown: cnt(d.acaDown),
      breakfastExcept: cnt(d.breakfastExcept),
      cmCritical: part(d.cmCritical),
      thiranBoys: part(d.thiranBoys),
      thiranGirls: part(d.thiranGirls),
      scholarPaySuccessPct: d.scholarPaySuccessPct,
      scholarPayFailed: part(d.scholarPayFailed),
      scholarNpciInactive: part(d.scholarNpciInactive),
      smcEmergency: part(d.smcEmergency),
      palliZeroVisits: Math.round(d.palliZeroVisits * (units > 1 ? share : share)),
    };
  }

  /**
   * Real EMIS data fields (Academic, THIRAN+, Palli, Digital Infra) for a row.
   * Looks up the matching scope: district rows by UPPERCASE name, block rows by
   * `DISTRICT||UPPERCASE_BLOCK`, school rows by UDISE. Returns only the fields
   * the real data supports; falls back to {} (keeping synthetic/other values)
   * when a dataset or key is missing. Real data takes precedence over synthetic.
   */
  private realFields(
    dist: string | null, block: string | null, udise: string | undefined,
    level: 'district' | 'block' | 'school',
  ): Partial<DrillRow> {
    const pick = <T>(asset: { districts: Record<string, T>; blocks: Record<string, T>; schools: Record<string, T> } | null): T | null => {
      if (!asset) return null;
      if (level === 'school') return (udise && asset.schools[udise]) || null;
      if (level === 'block') {
        const key = `${(dist ?? '').toUpperCase()}||${(block ?? '').toUpperCase()}`;
        return asset.blocks[key] ?? null;
      }
      return (dist && asset.districts[dist.toUpperCase()]) || null;
    };

    const out: Partial<DrillRow> = {};

    const aca = pick<AcademicReal>(this._academicReal());
    if (aca) {
      if (aca.overallAvg != null) out.academicAvg = aca.overallAvg;
      out.acaLanguageAvg = aca.subjectAvg.language ?? undefined;
      out.acaEnglishAvg = aca.subjectAvg.english ?? undefined;
      out.acaMathsAvg = aca.subjectAvg.maths ?? undefined;
      out.acaScienceAvg = aca.subjectAvg.science ?? undefined;
      out.acaSocialAvg = aca.subjectAvg.social ?? undefined;
      out.acaCompletionPct = aca.completionPct ?? undefined;
    }

    const th = pick<ThiranReal>(this._thiranReal());
    if (th) {
      out.thiranStudents = th.students;
      out.thiranSchools = th.schools;
      out.thiranSharePct = th.sharePct ?? undefined;
      out.thiranBaselinePct = th.baselineUpdatePct ?? undefined;
      out.thiranBloPct = th.bloAttainmentPct ?? undefined;
      out.thiranAttainBLO = th.attainBLO;
      out.thiranNotTagged = th.notTagged;
    }

    const pa = pick<PalliReal>(this._palliReal());
    if (pa) {
      out.palliVisited = pa.visitedSchools;
      out.palliObservations = pa.observations;
      out.palliOfficials = pa.officials;
      out.palliBrte = pa.byDesignation['BRTE'] ?? 0;
      out.palliBeo = pa.byDesignation['BEO'] ?? 0;
    }

    const di = pick<DigitalInfraReal>(this._digitalReal());
    if (di) {
      out.ictSchools = di.ictSchools;
      out.ictInternet = di.internet;
      out.ictNoInternet = di.noInternet;
      out.ictFunctional = di.functional;
      out.ictPartial = di.partiallyFunctional;
      out.ictNotFunctional = di.notFunctional;
      out.ictFunctionalPct = di.functionalPct ?? undefined;
      out.ictInternetPct = di.internetPct ?? undefined;
    }

    const inf = pick<InfraReal>(this._infraReal());
    if (inf) {
      out.gaps = inf.schoolsWithGap;
      out.infNoToilet = inf.noToilet;
      out.infNoWater = inf.noWater;
      out.infNoCwsnToilet = inf.noCwsnToilet;
      out.infNoKitchen = inf.noKitchen;
      out.infDemolish = inf.classDemolish;
      out.infRepair = inf.classRepair;
      out.infNoPlayground = inf.noPlayground;
      out.infNoFirstAid = inf.noFirstAid;
      out.infNoFire = inf.noFire;
      out.infNoRamp = inf.noRamp;
      out.infClassShortage = inf.classShortage;
      out.infGapPct = inf.gapPct ?? undefined;
    }

    const smc = pick<SmcReal>(this._smcReal());
    if (smc) {
      out.smcRaised = smc.raised;
      out.smcClosed = smc.closed;
      out.smcPending = smc.pending;
      out.smcClosureRate = smc.closureRate ?? undefined;
      // Emergency KPI = emergency resolutions NOT closed (per requirement)
      out.smcEmergency = smc.emergencyOpen;
      out.smcEmergencyOpen = smc.emergencyOpen;
    }

    return out;
  }

  /** Palli designation target model (state-level reference), from the real asset. */
  readonly palliTargetModel = computed(() => this._palliReal()?.targetModel ?? []);

  private seriesChangePct(series: number[]): number {
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    return prev ? Math.round(((last - prev) / prev) * 1000) / 10 : 0;
  }

  private districtChangePct(district: string): number {
    const dt = this.ds.data()?.districtTrend.find((x) => x.name === district);
    return dt?.series?.length ? this.seriesChangePct(dt.series) : 0;
  }

  private blockChangePct(district: string, block: string): number {
    const bt = this.ds.data()?.blockTrend?.[`${district}||${block}`];
    return bt?.series?.length ? this.seriesChangePct(bt.series) : 0;
  }

  /**
   * Real infra gap summary (zero toilets/water/classrooms/urinals/furniture,
   * water not functional) for one or more district/block keys, aggregated
   * from the infra caution checks' per-school lists.
   */
  private infraGapForKeys(districtNames: string[]): { count: number; label: string } {
    const checks = this.inf.cautionChecks?.() ?? [];
    const wanted = new Set(districtNames.map((d) => this.ds.titleCase(d)));
    const tally = new Map<string, number>();
    const flaggedSchools = new Set<string>();
    for (const c of checks) {
      if (c.id === 'notEntered') continue; // not a physical gap
      for (const s of c.schools) {
        if (!wanted.has(s.district)) continue;
        tally.set(c.label, (tally.get(c.label) ?? 0) + 1);
        flaggedSchools.add(s.udise || `${s.district}|${s.block}|${s.school}`);
      }
    }
    let top = ''; let topN = 0;
    for (const [label, n] of tally) if (n > topN) { topN = n; top = label; }
    return { count: flaggedSchools.size, label: top || 'None' };
  }

  /** Real per-school infra gap chips, from the same checks minus "not submitted". */
  private infraGapForSchool(s: { udise: string } | undefined): { count: number; label: string; list: string[] } {
    if (!s) return { count: 0, label: 'None', list: [] };
    const checks = this.inf.cautionChecks?.() ?? [];
    const list: string[] = [];
    for (const c of checks) {
      if (c.id === 'notEntered') continue;
      if (c.schools.some((x) => x.udise === s.udise)) list.push(c.label);
    }
    return { count: list.length, label: list[0] ?? 'None', list };
  }

  // ---- sorting ----
  readonly sortCol = signal<string | null>(null);
  readonly sortDir = signal<1 | -1>(1);
  setSort(key: string): void {
    if (this.sortCol() === key) this.sortDir.update((d) => (d === 1 ? -1 : 1));
    else { this.sortCol.set(key); this.sortDir.set(1); }
  }

  /** Sorted rows, worst-first by default per column (matches the prototype). */
  readonly sortedDrillRows = computed<DrillRow[]>(() => {
    const rows = [...this.drillRows()];
    const cols = this.topicColumns();
    const col = this.sortCol() ?? cols[0]?.key ?? 'n';
    const defaultDir = this.activeTopic() === 'inf' ? -1 : 1;
    const dir = this.sortCol() === null ? defaultDir : this.sortDir();
    rows.sort((a, b) => {
      const x = (a as any)[col] ?? 0;
      const y = (b as any)[col] ?? 0;
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * dir;
      return (x - y) * dir;
    });
    return rows;
  });

  /** Drill one level deeper, or (at school level) open the profile drawer. */
  drillRow(row: DrillRow): void {
    const level = this.ds.level();
    if (level === 'state') this.ds.drillToDistrict(row.key);
    else if (level === 'district') this.ds.drillToBlock(row.key);
    else if (level === 'block') this.openDrawer(row);
  }

  // ================= SCHOOL PROFILE DRAWER =================
  readonly drawerRow = signal<DrillRow | null>(null);
  readonly drawerOpen = computed(() => this.drawerRow() !== null);
  openDrawer(row: DrillRow): void { this.drawerRow.set(row); }
  closeDrawer(): void { this.drawerRow.set(null); }

  /** Six metric tiles for the drawer, matching the prototype's layout. */
  readonly drawerMetrics = computed(() => {
    const r = this.drawerRow();
    if (!r) return [];
    return [
      { label: 'Attendance', icon: 'fa-solid fa-calendar-check', value: `${r.att}%` },
      { label: 'Potential dropout', icon: 'fa-solid fa-user-xmark', value: this.fmt(r.drop) },
      { label: `Academic (${this.examPeriod()})`, icon: 'fa-solid fa-graduation-cap', value: `${r.academicAvg}` },
      { label: 'Enrollment change', icon: 'fa-solid fa-arrow-trend-up', value: `${r.chg > 0 ? '+' : ''}${r.chg}%` },
      { label: 'Teachers on long leave', icon: 'fa-solid fa-chalkboard-user', value: this.fmt(r.tl) },
      { label: 'Scheme coverage', icon: 'fa-solid fa-gift', value: `${r.sch}%` },
    ];
  });

  /** Rule-based suggested actions, same conditions as the prototype. */
  readonly drawerActions = computed(() => {
    const r = this.drawerRow();
    if (!r) return [] as { text: string; assignee: string }[];
    const out: { text: string; assignee: string }[] = [];
    if (r.att < 90) out.push({ text: `Call the HM — attendance at ${r.att}%`, assignee: 'HM' });
    if (r.drop > 0) out.push({ text: `Home visits for ${this.fmt(r.drop)} student(s) absent 15+ days`, assignee: 'BEO' });
    for (const g of r.gapList ?? []) out.push({ text: `Fix: ${g.toLowerCase()}`, assignee: 'Engineer' });
    if (r.tl > 0) out.push({ text: `Arrange substitutes for ${r.tl} teacher(s) on long leave`, assignee: 'BEO' });
    if (r.academicChange < 0) out.push({ text: `Academic review — score fell ${Math.abs(r.academicChange)} pt`, assignee: 'DIET' });
    if (r.cases > 0) out.push({ text: `${r.cases} open case(s) to resolve`, assignee: 'DEO' });
    return out;
  });

  readonly assignToast = signal<string | null>(null);
  assignAction(assignee: string): void {
    this.assignToast.set(`Task assigned to ${assignee} with a 7-day due date (demo)`);
    setTimeout(() => this.assignToast.set(null), 2200);
  }

  // ================= NEEDS ATTENTION INSIGHTS =================
  /**
   * Six auto-generated insights from the current scope's rows, each clickable
   * to jump to the relevant topic (and drill in, for the district-specific ones).
   */
  readonly insights = computed<ReviewInsight[]>(() => {
    const rows = this.drillRows();
    if (!rows.length) return [];
    const out: ReviewInsight[] = [];
    const avg = <T extends keyof DrillRow>(k: T) => {
      let t = 0, s = 0;
      for (const r of rows) { t += (r[k] as number) * r.n; s += r.n; }
      return s ? t / s : 0;
    };

    // Lowest attendance
    const lowAtt = [...rows].sort((a, b) => a.att - b.att)[0];
    if (lowAtt) {
      const gap = Math.round((avg('att') - lowAtt.att) * 10) / 10;
      out.push({
        id: 'lowAtt', severity: 'bad', icon: 'fa-solid fa-calendar-check',
        text: `${lowAtt.name} attendance is ${lowAtt.att}%, ${gap} pts below the ${this.ds.level() === 'state' ? 'State' : 'scope'} average`,
        action: 'View attendance', topic: 'att', rowKey: lowAtt.key,
      });
    }

    // Steepest enrolment decline
    const worstChg = [...rows].sort((a, b) => a.chg - b.chg)[0];
    if (worstChg) {
      out.push({
        id: 'declEnr', severity: 'warn', icon: 'fa-solid fa-arrow-trend-down',
        text: `Enrollment ${worstChg.chg < 0 ? 'fell' : 'grew slowest'} ${Math.abs(worstChg.chg)}% in ${worstChg.name}`,
        action: 'View enrollment', topic: 'enr', rowKey: worstChg.key,
      });
    }

    // Weakest academic trend
    const worstAca = [...rows].sort((a, b) => a.academicChange - b.academicChange)[0];
    if (worstAca) {
      out.push({
        id: 'weakAca', severity: 'warn', icon: 'fa-solid fa-graduation-cap',
        text: `${worstAca.name} has the weakest academic trend (${worstAca.academicChange} pt, ${this.examPeriod()})`,
        action: 'View academic scores', topic: 'aca', rowKey: worstAca.key,
      });
    }

    // Infra gaps
    const gapTotal = rows.reduce((s, r) => s + r.gaps, 0);
    if (gapTotal > 0) {
      out.push({
        id: 'infraGaps', severity: 'bad', icon: 'fa-solid fa-building-columns',
        text: `${this.fmt(gapTotal)} schools have a critical infrastructure gap (toilet, water, classroom, furniture)`,
        action: 'View infrastructure gaps', topic: 'inf', rowKey: null,
      });
    }

    // Highest dropout
    const worstDrop = [...rows].sort((a, b) => b.drop - a.drop)[0];
    if (worstDrop) {
      out.push({
        id: 'dropout', severity: 'bad', icon: 'fa-solid fa-user-xmark',
        text: `${worstDrop.name} has the most potential dropouts: ${this.fmt(worstDrop.drop)} students absent 15+ days`,
        action: this.ds.level() === 'block' ? 'Open school' : 'Open unit', topic: 'att', rowKey: worstDrop.key,
      });
    }

    // Grievance load per school
    const worstCases = [...rows].sort((a, b) => (b.cases / Math.max(1, b.ns)) - (a.cases / Math.max(1, a.ns)))[0];
    if (worstCases && worstCases.cases > 0) {
      out.push({
        id: 'grievance', severity: 'warn', icon: 'fa-solid fa-comment-dots',
        text: `${worstCases.name} has the most open cases per school`,
        action: 'View schemes and grievances', topic: 'sch', rowKey: worstCases.key,
      });
    }

    return [...out, ...this.moduleInsights()];
  });

  /**
   * Insights drawn from the additional KPI modules. These have no drill-down
   * topic of their own, so they scroll to their module section instead.
   */
  readonly moduleInsights = computed<ReviewInsight[]>(() => {
    const m = this.moduleNode();
    if (!m) return [];
    const out: ReviewInsight[] = [];

    // ---- THIRAN+ : total students identified ----
    const t = m.thiran;
    if (t.students > 0) {
      const share = this.pct(t.students, this.enrolNode()?.students ?? 0);
      out.push({
        id: 'thiranTotal', severity: 'warn', icon: 'fa-solid fa-graduation-cap',
        text: `${this.fmt(this.scale(t.students))} students identified under THIRAN+ `
          + `(${share}% of enrolment) across ${this.fmt(this.scale(t.schools))} schools`,
        action: 'View THIRAN+', topic: 'aca', rowKey: null, anchor: 'rv-thiran',
      });
    }

    // ---- Scholarship : Aadhaar not updated blocks payment ----
    const s = this.scholarshipActive();
    if (s && s.aadhaarNotUpdated > 0) {
      const share = this.pct(s.aadhaarNotUpdated, s.eligible);
      out.push({
        id: 'aadhaarPending', severity: share >= 8 ? 'bad' : 'warn', icon: 'fa-solid fa-id-card',
        text: `${this.fmt(this.scale(s.aadhaarNotUpdated))} eligible students have Aadhaar not updated `
          + `(${share}% of eligible) — scholarship payment is blocked`,
        action: 'View scholarship verification', topic: 'sch', rowKey: null, anchor: 'rv-scholarship',
      });
    }

    // ---- SMC : resolution closure rate ----
    const smc = m.smc;
    if (smc.raised > 0) {
      const rate = smc.closureRate;
      out.push({
        id: 'smcClosure',
        severity: rate < 60 ? 'bad' : rate < 75 ? 'warn' : 'good',
        icon: 'fa-solid fa-people-group',
        text: `SMC resolution closure rate is ${rate}% — `
          + `${this.fmt(this.scale(smc.pending))} of ${this.fmt(this.scale(smc.raised))} resolutions still pending`,
        action: 'View SMC resolutions', topic: 'sch', rowKey: null, anchor: 'rv-smc',
      });
    }

    // ---- Palli Parvai : overall observation status ----
    const pp = m.palliParvai;
    if (pp.target > 0) {
      const obsPendingShare = this.pct(pp.pendingObservations, pp.observations);
      const zeroVisit = this.palliZeroVisitCount();
      out.push({
        id: 'palliStatus',
        severity: pp.completionPct < 60 ? 'bad' : pp.completionPct < 80 ? 'warn' : 'good',
        icon: 'fa-solid fa-clipboard-check',
        text: `Palli Parvai: ${pp.completionPct}% of schools visited `
          + `(${this.fmt(this.scale(pp.visited))} of ${this.fmt(this.scale(pp.target))}) · `
          + `${this.fmt(this.scale(pp.pendingObservations))} of ${this.fmt(this.scale(pp.observations))} observations pending (${obsPendingShare}%)`
          + (zeroVisit > 0 ? ` · ${this.fmt(zeroVisit)} officials made no visit` : ''),
        action: 'View Palli Parvai monitoring', topic: 'sch', rowKey: null, anchor: 'rv-palli',
      });
    }

    return out;
  });

  /** Click an insight: switch topic, and drill to/open the referenced row. */
  applyInsight(ins: ReviewInsight): void {
    // module insights have no drill row — scroll to their section instead
    if (ins.anchor) {
      this.setTopic(ins.topic);
      if (typeof document !== 'undefined') {
        document.getElementById(ins.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    this.setTopic(ins.topic);
    if (!ins.rowKey) return;
    const row = this.drillRows().find((r) => r.key === ins.rowKey);
    if (row) this.drillRow(row);
  }

  // ================= ADDITIONAL KPI MODULES (KPI.md) =================
  /**
   * Module figures for the current scope. Published per-district, so state uses
   * the rolled-up total, a district uses its own row, and block/school fall back
   * to the parent district's figures (there is no finer breakdown in the data).
   */
  readonly moduleNode = computed<KpiModuleNode | null>(() => {
    const m = this._modules();
    if (!m) return null;
    const dist = this.ds.selectedDistrict();
    if (dist) {
      const row = m.districts.find((d) => d.name === dist);
      if (row) return row;
    }
    return m.state;
  });
  readonly modulesReady = computed(() => this._modules() !== null);
  readonly moduleNote = computed(() => this._modules()?.note ?? '');

  // ---- 1. THIRAN+ ----
  readonly thiranKpis = computed(() => {
    const t = this.moduleNode()?.thiran;
    if (!t) return [];
    return [
      { label: 'THIRAN+ Students Identified', value: this.fmt(this.scale(t.students)), icon: 'fa-solid fa-user-graduate' },
      { label: 'Schools Covered', value: this.fmt(this.scale(t.schools)), icon: 'fa-solid fa-school' },
      { label: 'Boys', value: this.fmt(this.scale(t.boys)), icon: 'fa-solid fa-person' },
      { label: 'Girls', value: this.fmt(this.scale(t.girls)), icon: 'fa-solid fa-person-dress' },
    ];
  });
  readonly thiranByClass = computed(() =>
    (this.moduleNode()?.thiran.byClass ?? []).map((c) => ({ name: `Class ${c.cls}`, value: this.scale(c.students) })),
  );
  readonly thiranByCategory = computed(() =>
    (this.moduleNode()?.thiran.byCategory ?? []).map((c) => ({ name: c.name, value: this.scale(c.students) })),
  );
  readonly thiranGender = computed(() => {
    const t = this.moduleNode()?.thiran;
    if (!t) return [];
    return [
      { name: 'Boys', value: this.scale(t.boys) },
      { name: 'Girls', value: this.scale(t.girls) },
    ];
  });

  // ---- 2. SCHOLARSHIP ----
  /** Scheme filter; empty means "all schemes combined". */
  readonly scholarshipScheme = signal<string>('');
  setScholarshipScheme(s: string): void { this.scholarshipScheme.set(s); }
  readonly scholarshipSchemeOptions = computed(() => this._modules()?.scholarshipSchemes ?? []);

  /** The selected scheme, or all schemes summed when no scheme is picked. */
  readonly scholarshipActive = computed<ScholarshipScheme | null>(() => {
    const schemes = this.moduleNode()?.scholarship.schemes ?? [];
    if (!schemes.length) return null;
    const pick = this.scholarshipScheme();
    if (pick) return schemes.find((s) => s.name === pick) ?? null;

    // combine every scheme into one synthetic "All schemes" row
    const add = (k: keyof ScholarshipScheme) => schemes.reduce((a, s) => a + (s[k] as number), 0);
    const cats = this._modules()?.socialCategories ?? [];
    const total = add('total');
    const eligible = add('eligible');
    return {
      name: 'All schemes',
      total, eligible, notEligible: add('notEligible'), eligibilityPct: this.pct(eligible, total),
      paySuccess: add('paySuccess'), payFailed: add('payFailed'), payPending: add('payPending'),
      npciActive: add('npciActive'), npciInactive: add('npciInactive'),
      aadhaarNotUpdated: add('aadhaarNotUpdated'), verificationPending: add('verificationPending'),
      bySocialCategory: cats.map((c) => ({
        name: c,
        students: schemes.reduce((a, s) => a + (s.bySocialCategory.find((x) => x.name === c)?.students ?? 0), 0),
      })),
    };
  });

  readonly scholarshipEligibilityKpis = computed(() => {
    const s = this.scholarshipActive();
    if (!s) return [];
    return [
      { label: 'Total Students', value: this.fmt(this.scale(s.total)), icon: 'fa-solid fa-users' },
      { label: 'Eligible', value: this.fmt(this.scale(s.eligible)), icon: 'fa-solid fa-circle-check' },
      { label: 'Not Eligible', value: this.fmt(this.scale(s.notEligible)), icon: 'fa-solid fa-circle-xmark' },
      { label: 'Eligibility %', value: `${s.eligibilityPct}%`, icon: 'fa-solid fa-percent' },
    ];
  });
  readonly scholarshipPaymentKpis = computed(() => {
    const s = this.scholarshipActive();
    if (!s) return [];
    return [
      { label: 'Payment Success', value: this.fmt(this.scale(s.paySuccess)), icon: 'fa-solid fa-indian-rupee-sign', tone: '' },
      { label: 'Payment Failed', value: this.fmt(this.scale(s.payFailed)), icon: 'fa-solid fa-triangle-exclamation', tone: 'bad' },
      { label: 'Payment Pending', value: this.fmt(this.scale(s.payPending)), icon: 'fa-solid fa-hourglass-half', tone: 'warn' },
    ];
  });
  readonly scholarshipVerificationKpis = computed(() => {
    const s = this.scholarshipActive();
    if (!s) return [];
    return [
      { label: 'NPCI Active', value: this.fmt(this.scale(s.npciActive)), icon: 'fa-solid fa-link', tone: '' },
      { label: 'NPCI Inactive', value: this.fmt(this.scale(s.npciInactive)), icon: 'fa-solid fa-link-slash', tone: 'bad' },
      { label: 'Aadhaar Not Updated', value: this.fmt(this.scale(s.aadhaarNotUpdated)), icon: 'fa-solid fa-id-card', tone: 'warn' },
      { label: 'Verification Pending', value: this.fmt(this.scale(s.verificationPending)), icon: 'fa-solid fa-hourglass-half', tone: 'warn' },
    ];
  });
  readonly scholarshipSocialCategory = computed(() =>
    (this.scholarshipActive()?.bySocialCategory ?? []).map((c) => ({ name: c.name, value: this.scale(c.students) })),
  );

  // ---- 3. DIGITAL INFRASTRUCTURE ----
  readonly digitalKpis = computed(() => {
    const d = this.moduleNode()?.digital;
    if (!d) return [];
    return [
      { label: 'Schools with ICT Facilities', value: this.fmt(this.scale(d.ictSchools)), icon: 'fa-solid fa-desktop', tone: '' },
      { label: 'ICT Schools with Internet', value: this.fmt(this.scale(d.ictWithInternet)), icon: 'fa-solid fa-wifi', tone: '' },
      { label: 'ICT Schools without Internet', value: this.fmt(this.scale(d.ictWithoutInternet)), icon: 'fa-solid fa-ban', tone: 'bad' },
      { label: 'Schools with ICT Teacher', value: this.fmt(this.scale(d.ictWithTeacher)), icon: 'fa-solid fa-chalkboard-user', tone: '' },
      { label: 'ICT Schools without ICT Teacher', value: this.fmt(this.scale(d.ictWithoutTeacher)), icon: 'fa-solid fa-user-slash', tone: 'bad' },
    ];
  });
  readonly digitalBars = computed(() => {
    const d = this.moduleNode()?.digital;
    if (!d) return [];
    return [
      { name: 'Internet available', value: this.scale(d.ictWithInternet) },
      { name: 'Internet not available', value: this.scale(d.ictWithoutInternet) },
      { name: 'ICT teacher available', value: this.scale(d.ictWithTeacher) },
      { name: 'ICT teacher not available', value: this.scale(d.ictWithoutTeacher) },
    ];
  });

  // ---- 4. SMC ----
  readonly smcKpis = computed(() => {
    const s = this.moduleNode()?.smc;
    if (!s) return [];
    return [
      { label: 'Resolutions Raised', value: this.fmt(this.scale(s.raised)), icon: 'fa-solid fa-file-circle-plus', tone: '' },
      { label: 'Resolutions Closed', value: this.fmt(this.scale(s.closed)), icon: 'fa-solid fa-circle-check', tone: '' },
      { label: 'Pending Resolutions', value: this.fmt(this.scale(s.pending)), icon: 'fa-solid fa-hourglass-half', tone: 'bad' },
      { label: 'Closure Rate', value: `${s.closureRate}%`, icon: 'fa-solid fa-percent', tone: '' },
      { label: 'Emergency', value: this.fmt(this.scale(s.emergency)), icon: 'fa-solid fa-triangle-exclamation', tone: 'warn' },
      { label: 'Non-Emergency', value: this.fmt(this.scale(s.nonEmergency)), icon: 'fa-solid fa-clipboard-list', tone: '' },
      { label: 'Schools with Resolutions', value: this.fmt(this.scale(s.schools)), icon: 'fa-solid fa-school', tone: '' },
      { label: 'Students Covered', value: this.fmt(this.scale(s.studentsCovered)), icon: 'fa-solid fa-users', tone: '' },
    ];
  });
  /** Level filter for the SMC level-wise table. */
  readonly smcLevel = signal<string>('');
  setSmcLevel(l: string): void { this.smcLevel.set(l); }
  readonly smcLevelOptions = computed(() => this._modules()?.smcLevels ?? []);
  readonly smcByLevel = computed(() => {
    const rows = this.moduleNode()?.smc.byLevel ?? [];
    const pick = this.smcLevel();
    return (pick ? rows.filter((r) => r.name === pick) : rows).map((r) => ({
      ...r,
      raised: this.scale(r.raised), closed: this.scale(r.closed), pending: this.scale(r.pending),
    }));
  });
  readonly smcAgeing = computed(() =>
    (this.moduleNode()?.smc.ageing ?? []).map((a) => ({ name: a.name, value: this.scale(a.count) })),
  );
  readonly smcTypeSplit = computed(() => {
    const s = this.moduleNode()?.smc;
    if (!s) return [];
    return [
      { name: 'Emergency', value: this.scale(s.emergency) },
      { name: 'Non-Emergency', value: this.scale(s.nonEmergency) },
    ];
  });
  /** Show all departments, or just the top 5 by pending count. */
  readonly smcAllDepartments = signal(false);
  toggleSmcDepartments(): void { this.smcAllDepartments.update((v) => !v); }
  readonly smcDepartments = computed(() => {
    const rows = (this.moduleNode()?.smc.departments ?? []).map((d) => ({
      ...d,
      mapped: this.scale(d.mapped), resolved: this.scale(d.resolved), pending: this.scale(d.pending),
      schools: this.scale(d.schools), students: this.scale(d.students),
    }));
    return this.smcAllDepartments() ? rows : rows.slice(0, 5);
  });
  readonly smcDepartmentTotal = computed(() => (this.moduleNode()?.smc.departments ?? []).length);

  // ---- 5. PALLI PARVAI ----
  readonly palliKpis = computed(() => {
    const p = this.moduleNode()?.palliParvai;
    if (!p) return [];
    return [
      { label: 'Total Target Schools', value: this.fmt(this.scale(p.target)), icon: 'fa-solid fa-bullseye', tone: '' },
      { label: 'Schools Visited', value: this.fmt(this.scale(p.visited)), icon: 'fa-solid fa-circle-check', tone: '' },
      { label: 'Schools Not Visited', value: this.fmt(this.scale(p.notVisited)), icon: 'fa-solid fa-circle-xmark', tone: 'bad' },
      { label: 'Visit Completion %', value: `${p.completionPct}%`, icon: 'fa-solid fa-percent', tone: '' },
      { label: 'Total Observations', value: this.fmt(this.scale(p.observations)), icon: 'fa-solid fa-clipboard-check', tone: '' },
      { label: 'Pending Observations', value: this.fmt(this.scale(p.pendingObservations)), icon: 'fa-solid fa-hourglass-half', tone: 'warn' },
    ];
  });
  readonly palliByDesignation = computed(() => {
    const rows = (this.moduleNode()?.palliParvai.byDesignation ?? []).map((r) => ({
      ...r,
      target: this.scale(r.target), observed: this.scale(r.observed), pending: this.scale(r.pending),
    }));
    if (!rows.length) return rows;
    const target = rows.reduce((a, r) => a + r.target, 0);
    const observed = rows.reduce((a, r) => a + r.observed, 0);
    return [
      ...rows,
      {
        name: 'Total', target, observed, pending: Math.max(0, target - observed),
        completionPct: this.pct(observed, target),
      },
    ];
  });
  /** Officials with a target but no visits at all (target > 0 AND visited = 0). */
  readonly palliZeroVisitOfficials = computed(() =>
    (this.moduleNode()?.palliParvai.zeroVisitOfficials ?? []).filter((o) => o.target > 0 && o.visited === 0),
  );
  readonly palliZeroVisitCount = computed(() => this.palliZeroVisitOfficials().length);
  /** Whether the zero-visit official list is expanded. */
  readonly palliOfficialsOpen = signal(false);
  togglePalliOfficials(): void { this.palliOfficialsOpen.update((v) => !v); }
}

/** Topic tabs for the drill-down table, matching the prototype's lenses. */
export type DrillTopic = 'enr' | 'att' | 'inf' | 'aca' | 'sch'
  | 'thiran' | 'scholarship' | 'smc' | 'palli';

/** A row of KPI cards for one domain, rendered on a single line. */
export interface KpiSection {
  id: string;
  label: string;
  icon: string;
  topic: DrillTopic;
  cards: ProtoKpi[];
}

/** One KPI card in the prototype's exact shape (icon chip + value + sub + optional ring). */
export interface ProtoKpi {
  label: string;
  value: string;
  sub: string;
  /** 'up' | 'down' | '' — colours the sub-label like the prototype. */
  subClass: string;
  icon: string;
  topic: DrillTopic;
  /** '' | 'r' | 'a' — tints the icon chip like the prototype's .kpi.r / .kpi.a. */
  card: string;
  /** Present only for cards the spec marks with a progress ring. */
  ring?: number;
  ringRed?: number;
  ringAmber?: number;
}

export interface DrillColumn {
  key: string;
  label: string;
  fmt: 'num' | 'num1' | 'pct' | 'pctSigned' | 'ptSigned' | 'text';
  bar?: boolean;
  barMax?: number;
  tone?: (value: number, row: DrillRow) => 'bad' | 'warn' | 'good' | undefined;
}

/** One row of the drill-down table: a district, block, or school. */
export interface DrillRow {
  key: string;
  udise?: string;
  name: string;
  level: 'district' | 'block' | 'school';
  ns: number;
  n: number;
  chg: number;
  att: number;
  /** False only at school level when no attendance record matched by udise. */
  hasAtt?: boolean;
  drop: number;
  /** Estimated — no source field exists (see drillRows() doc comment). */
  tl: number;
  gaps: number;
  gapl: string;
  gapList?: string[];
  academicAvg: number;
  academicPrevAvg: number;
  academicChange: number;
  /** False only at school level when no academic record matched by udise. */
  hasAca?: boolean;
  /** Estimated below district level — see drillRows() doc comment. */
  sch: number;
  /** Estimated below district level — see drillRows() doc comment. */
  cases: number;

  // ---- additional KPI modules (per-district source; apportioned below district) ----
  thiranStudents?: number;
  thiranSchools?: number;
  thiranSharePct?: number;
  scholarEligible?: number;
  scholarEligibilityPct?: number;
  scholarAadhaar?: number;
  scholarPayPending?: number;
  smcRaised?: number;
  smcClosed?: number;
  smcPending?: number;
  smcClosureRate?: number;
  palliTarget?: number;
  palliVisited?: number;
  palliNotVisited?: number;
  palliCompletionPct?: number;

  // ---- extra real KPI fields for the KPI-catalog tile grid ----
  teaching?: number;
  teacherAtt?: number;
  compliance?: number;
  infraToilet?: number;
  infraWater?: number;
  tnSparkPct?: number;
  breakfastPct?: number;
  cmOpen?: number;
  h14417Open?: number;
  h14417Critical?: number;
  h14417ResPct?: number;
  girlsPct?: number;
  dropRate?: number;

  // ---- synthetic sample KPI fields (kpi-sample.json; see sampleFields) ----
  cwsnPct?: number;
  declSchools?: number;
  attPending?: number;
  infNoToilet?: number;
  infNoWater?: number;
  infNoCwsnToilet?: number;
  infNoEb?: number;
  infNoKitchen?: number;
  infDemolish?: number;
  infRepair?: number;
  ictSchools?: number;
  ictInternet?: number;
  ictNoInternet?: number;
  ictNoTeacher?: number;
  slasPct?: number;
  acaUp?: number;
  acaDown?: number;
  breakfastExcept?: number;
  cmCritical?: number;
  thiranBoys?: number;
  thiranGirls?: number;
  scholarPaySuccessPct?: number;
  scholarPayFailed?: number;
  scholarNpciInactive?: number;
  smcEmergency?: number;
  palliZeroVisits?: number;

  // ---- real EMIS fields (academic-real / thiran-real / palli-real / digital-infra-real) ----
  acaLanguageAvg?: number;
  acaEnglishAvg?: number;
  acaMathsAvg?: number;
  acaScienceAvg?: number;
  acaSocialAvg?: number;
  acaCompletionPct?: number;
  thiranBaselinePct?: number;
  thiranBloPct?: number;
  thiranAttainBLO?: number;
  thiranNotTagged?: number;
  palliObservations?: number;
  palliOfficials?: number;
  palliBrte?: number;
  palliBeo?: number;
  ictFunctional?: number;
  ictPartial?: number;
  ictNotFunctional?: number;
  ictFunctionalPct?: number;
  ictInternetPct?: number;
  infNoPlayground?: number;
  infNoFirstAid?: number;
  infNoFire?: number;
  infNoRamp?: number;
  infClassShortage?: number;
  infGapPct?: number;
  smcEmergencyOpen?: number;
}

/** One district's synthetic sample KPI values (kpi-sample.json). */
export interface KpiSampleDistrict {
  name: string;
  cwsnPct: number;
  declSchools: number;
  attPending: number;
  infNoToilet: number;
  infNoWater: number;
  infNoCwsnToilet: number;
  infNoEb: number;
  infNoKitchen: number;
  infDemolish: number;
  infRepair: number;
  ictSchools: number;
  ictInternet: number;
  ictNoInternet: number;
  ictNoTeacher: number;
  slasPct: number;
  acaUp: number;
  acaDown: number;
  breakfastExcept: number;
  cmCritical: number;
  thiranBoys: number;
  thiranGirls: number;
  scholarPaySuccessPct: number;
  scholarPayFailed: number;
  scholarNpciInactive: number;
  smcEmergency: number;
  palliZeroVisits: number;
}

export interface KpiSampleData {
  note?: string;
  generatedAt?: string;
  districts: KpiSampleDistrict[];
}

export interface ReviewInsight {
  id: string;
  severity: 'bad' | 'warn' | 'good';
  icon: string;
  text: string;
  action: string;
  topic: DrillTopic;
  rowKey: string | null;
  /**
   * Set for module insights (THIRAN+, Scholarship, SMC, Palli Parvai) that have
   * no drill-down topic of their own: clicking scrolls to this section id.
   */
  anchor?: string;
}
