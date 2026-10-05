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
import { KPI_MODULES, KpiDef } from '../models/kpi-catalog.model';
import { SchoolRow } from '../models/enrollment.model';
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

  // ================= ACADEMIC SCHOOL → CLASS → SUBJECT DRILL (spec) =================
  /** Which school's academic class/subject detail is open (UDISE), + selected class. */
  readonly acaDrillUdise = signal<string | null>(null);
  readonly acaDrillSchool = signal<string>('');
  readonly acaDrillClass = signal<number | null>(null);
  readonly acaDrillOpen = computed(() => this.acaDrillUdise() !== null);
  openAcademicDrill(udise: string, school: string): void { this.acaDrillUdise.set(udise); this.acaDrillSchool.set(school); this.acaDrillClass.set(null); }
  closeAcademicDrill(): void { this.acaDrillUdise.set(null); this.acaDrillClass.set(null); }
  selectAcaClass(cls: number | null): void { this.acaDrillClass.set(cls); }

  /** The open school's AcademicSchool record (by UDISE, current scope). */
  private readonly acaDrillRecord = computed(() => {
    const u = this.acaDrillUdise();
    if (!u) return null;
    return (this.ac.scopeSchools() as any[]).find((s) => s.udise === u) ?? null;
  });

  /** The exam period to use for the drill (All → latest/Annual). */
  private acaDrillPeriod(order: string[]): string {
    const p = this.examPeriod();
    return (p && p !== 'All' && order.includes(p)) ? p : (order[order.length - 1] ?? 'Annual');
  }

  /** Class-wise rows for the open school (Pass % / Average Mark / Improvement). */
  readonly acaClassRows = computed(() => {
    const rec: any = this.acaDrillRecord();
    const u = this.acaDrillUdise();
    const ec: any[] = rec?.examClass ?? [];
    if (!ec.length) {
      if (rec?.byClass?.length) {
        return rec.byClass.map((c: any) => ({
          cls: Number(c.name) || 0, label: `Class ${c.name}`,
          pass: Math.round((c.pass ?? 0) * 10) / 10, avg: Math.round((c.avg ?? 0) * 10) / 10, improve: 0,
        })).sort((a: any, b: any) => a.cls - b.cls);
      }
      // No per-school academic record → assume deterministically from UDISE.
      return this.assumedClassRows(u ?? '');
    }
    const order = [...new Set(ec.map((x) => x.exam))];
    const period = this.acaDrillPeriod(order);
    const idx = order.indexOf(period);
    const prevPeriod = idx > 0 ? order[idx - 1] : null;
    const cur = ec.filter((x) => x.exam === period);
    const prevByCls = new Map((prevPeriod ? ec.filter((x) => x.exam === prevPeriod) : []).map((x) => [x.cls, x] as const));
    return cur.map((x) => {
      const prev = prevByCls.get(x.cls);
      return {
        cls: x.cls, label: x.label ?? `Class ${x.cls}`,
        pass: Math.round((x.pass ?? 0) * 10) / 10,
        avg: Math.round((x.avg ?? 0) * 10) / 10,
        improve: prev ? Math.round(((x.avg ?? 0) - (prev.avg ?? 0)) * 10) / 10 : 0,
      };
    }).sort((a, b) => a.cls - b.cls);
  });

  /** True when the open school's class/subject figures are assumed (no record). */
  readonly acaDrillAssumed = computed(() => {
    const rec: any = this.acaDrillRecord();
    return !rec?.examClass?.length && !rec?.byClass?.length;
  });

  /** Deterministic assumed class rows for a school with no academic record. */
  private assumedClassRows(udise: string): { cls: number; label: string; pass: number; avg: number; improve: number }[] {
    const classes = [6, 7, 8, 9, 10];
    return classes.map((cls) => {
      const avg = Math.round((45 + this.hash01(udise, 'aca-avg-' + cls) * 45) * 10) / 10;
      const pass = Math.round((55 + this.hash01(udise, 'aca-pass-' + cls) * 42) * 10) / 10;
      const improve = Math.round((this.hash01(udise, 'aca-imp-' + cls) * 16 - 8) * 10) / 10;
      return { cls, label: `Class ${cls}`, pass, avg, improve };
    });
  }

  /** Subject-wise rows for the open school + selected class. */
  readonly acaSubjectRows = computed(() => {
    const rec: any = this.acaDrillRecord();
    const cls = this.acaDrillClass();
    const u = this.acaDrillUdise();
    if (cls == null) return [] as { subject: string; pass: number; avg: number; improve: number }[];
    const ec: any[] = rec?.examClass ?? [];
    if (ec.length) {
      const order = [...new Set(ec.map((x) => x.exam))];
      const period = this.acaDrillPeriod(order);
      const idx = order.indexOf(period);
      const prevPeriod = idx > 0 ? order[idx - 1] : null;
      const curCell = ec.find((x) => x.exam === period && x.cls === cls);
      const prevCell = prevPeriod ? ec.find((x) => x.exam === prevPeriod && x.cls === cls) : null;
      const prevSub = new Map((prevCell?.subjects ?? []).map((s: any) => [s.name, s] as const));
      if (curCell?.subjects?.length) {
        return curCell.subjects.map((s: any) => {
          const prev: any = prevSub.get(s.name);
          return {
            subject: s.name,
            pass: Math.round((s.pass ?? 0) * 10) / 10,
            avg: Math.round((s.avg ?? 0) * 10) / 10,
            improve: prev ? Math.round(((s.avg ?? 0) - (prev.avg ?? 0)) * 10) / 10 : 0,
          };
        });
      }
    }
    // No real subject data → assume deterministically from UDISE + class.
    return this.assumedSubjectRows(u ?? '', cls);
  });

  /** Deterministic assumed subject rows for a school/class with no record. */
  private assumedSubjectRows(udise: string, cls: number): { subject: string; pass: number; avg: number; improve: number }[] {
    const subjects = ['Tamil', 'English', 'Mathematics', 'Science', 'Social Science'];
    return subjects.map((subject) => {
      const avg = Math.round((40 + this.hash01(udise, `s-avg-${cls}-${subject}`) * 50) * 10) / 10;
      const pass = Math.round((50 + this.hash01(udise, `s-pass-${cls}-${subject}`) * 48) * 10) / 10;
      const improve = Math.round((this.hash01(udise, `s-imp-${cls}-${subject}`) * 18 - 9) * 10) / 10;
      return { subject, pass, avg, improve };
    });
  }

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
    { id: 'dinf', label: 'Digital Infra', icon: 'fa-solid fa-desktop' },
    { id: 'aca', label: 'Academic', icon: 'fa-solid fa-graduation-cap' },
    // 'sch' (Schemes & Grievances) temporarily removed — re-add when those
    // modules are re-enabled in the KPI catalog.
    { id: 'thiran', label: 'THIRAN+', icon: 'fa-solid fa-user-graduate' },
    { id: 'scholarship', label: 'Scholarship', icon: 'fa-solid fa-award' },
    { id: 'smc', label: 'SMC', icon: 'fa-solid fa-people-group' },
    { id: 'palli', label: 'Palli Parvai', icon: 'fa-solid fa-clipboard-check' },
  ];
  readonly activeTopic = signal<DrillTopic>('att');
  setTopic(t: DrillTopic): void {
    this.activeTopic.set(t);
    this.sortCol.set(null);
    // Switching topic tabs exits any open per-KPI school list so the header,
    // columns and rows follow the newly selected topic.
    this.kpiListId.set(null);
    this.acaDrillUdise.set(null);
    this.acaDrillClass.set(null);
  }

  /**
   * The main-dashboard module whose "View details" / KPI opened the drill-down.
   * Drives the KPI filter so it lists exactly the module's KPIs (same labels as
   * the tile on the landing grid), rather than a separate per-topic column set.
   * null = no module context (falls back to the per-topic columns).
   */
  readonly selectedModuleTitle = signal<string | null>(null);
  setSelectedModule(title: string | null): void { this.selectedModuleTitle.set(title); }

  /** The KPI definitions of the selected module, if any. */
  private readonly selectedModuleKpis = computed<KpiDef[]>(() => {
    const title = this.selectedModuleTitle();
    if (!title) return [];
    return KPI_MODULES.find((m) => m.title === title)?.kpis ?? [];
  });

  /**
   * Drill columns derived from the selected module's KPIs — one column per KPI
   * that maps to a real DrillRow field, labelled exactly as on the main
   * dashboard tile. Empty when there is no module context.
   */
  private readonly moduleColumns = computed<DrillColumn[]>(() => {
    const kpis = this.selectedModuleKpis();
    if (!kpis.length) return [];
    // Only drive columns from the module while its own topic is active; once the
    // user switches to another topic tab, fall back to that topic's columns.
    const moduleTopic = kpis[0]?.topic;
    if (moduleTopic && moduleTopic !== this.activeTopic()) return [];
    const seen = new Set<string>();
    const cols: DrillColumn[] = [];
    for (const def of kpis) {
      const field = def.field;
      if (!field || field === 'DERIVED' || seen.has(field)) continue;
      seen.add(field);
      cols.push({
        key: field,
        label: def.label,
        fmt: def.fmt === 'pct' ? 'pct' : 'num',
        tone: this.moduleKpiTone(def),
      });
    }
    return cols;
  });

  /**
   * Cell colour for a module-driven column, honouring the KPI's good direction:
   *  - percentage KPIs use the catalog lo/hi band (red below lo, green above hi);
   *  - "lower is better" flags/counts turn amber when > 0 (an exception exists);
   *  - "higher is better" flags/counts turn green when > 0, amber when 0;
   *  - neutral KPIs (dir 0) get no colour.
   */
  private moduleKpiTone(def: KpiDef): DrillColumn['tone'] {
    if (def.dir === 0) return undefined;
    if (def.fmt === 'pct' && def.lo != null && def.hi != null) {
      const lo = def.lo, hi = def.hi, dir = def.dir;
      return (v: number) => {
        let s = (v - lo) / ((hi - lo) || 1);
        if (dir < 0) s = 1 - s;
        s = Math.max(0, Math.min(1, s));
        return s > 0.66 ? 'good' : s > 0.33 ? 'warn' : 'bad';
      };
    }
    // counts / flags
    if (def.dir < 0) return (v: number) => (v > 0 ? 'warn' : 'good');
    return (v: number) => (v > 0 ? 'good' : 'warn');
  }

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

  /**
   * The columns the drill table and KPI filter use. When a main-dashboard
   * module opened the drill-down, these are the module's KPIs (so the filter
   * lists exactly the same KPIs as the tile); otherwise they fall back to the
   * per-topic prototype columns.
   */
  readonly allTopicColumns = computed<DrillColumn[]>(() => {
    const mod = this.moduleColumns();
    return mod.length ? mod : this.defaultTopicColumns();
  });

  /** Column model per topic, matching the prototype's per-lens columns. */
  private readonly defaultTopicColumns = computed<DrillColumn[]>(() => {
    switch (this.activeTopic()) {
      case 'enr':
        return [
          { key: 'boys', label: 'Boys', fmt: 'num' },
          { key: 'girls', label: 'Girls', fmt: 'num' },
          { key: 'n', label: 'Total Students', fmt: 'num' },
          { key: 'teaching', label: 'Teachers', fmt: 'num' },
          { key: 'notMoved', label: 'Not moved to next class', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'chg', label: 'Enrollment change', fmt: 'pctSigned', tone: (v) => (v < -2 ? 'bad' : v < 0 ? 'warn' : 'good') },
          { key: 'ptr', label: 'PTR', fmt: 'num1', tone: (v) => (v > 40 ? 'bad' : v > 30 ? 'warn' : 'good') },
          { key: 'dropRate', label: 'Dropout rate', fmt: 'pct', tone: (v) => (v > 4 ? 'bad' : v > 2 ? 'warn' : 'good') },
          { key: 'drop', label: 'Dropout students', fmt: 'num' },
        ];
      case 'att':
        return [
          { key: 'boysAbsent', label: 'Boys absent', fmt: 'num' },
          { key: 'girlsAbsent', label: 'Girls absent', fmt: 'num' },
          { key: 'n', label: 'Total Students', fmt: 'num' },
          { key: 'teaching', label: 'Total Teachers', fmt: 'num' },
          { key: 'teacherAbsent', label: 'Teachers absent', fmt: 'num' },
          { key: 'markedStatus', label: 'Marked status', fmt: 'text' },
          { key: 'drop', label: 'Potential dropout (15d)', fmt: 'num' },
          { key: 'teacherLong30', label: 'Teacher absent 30+ days (est.)', fmt: 'num' },
        ];
      case 'inf':
        return [
          { key: 'gaps', label: 'Schools with gaps', fmt: 'num', tone: (v, r) => (r.ns > 1 ? (v / r.ns > 0.3 ? 'bad' : 'warn') : (v >= 2 ? 'bad' : v ? 'warn' : 'good')) },
          { key: 'gapl', label: 'Main gap', fmt: 'text' },
          { key: 'n', label: 'Students', fmt: 'num' },
        ];
      case 'dinf':
        return [
          { key: 'ictSchools', label: 'ICT schools', fmt: 'num', tone: (v) => (v > 0 ? 'good' : 'bad') },
          { key: 'ictInternet', label: 'With internet', fmt: 'num' },
          { key: 'ictNoInternet', label: 'Without internet', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'ictFunctionalPct', label: 'Functional %', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 50 ? 'bad' : v < 75 ? 'warn' : 'good') },
          { key: 'ictNotFunctional', label: 'Not functional', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
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
          { key: 'palliClassObsPct', label: '% Class Observation', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 75 ? 'bad' : v < 85 ? 'warn' : 'good') },
          { key: 'palliSchoolsNotObsPct', label: '% Schools Not Observed', fmt: 'pct', tone: (v) => (v > 30 ? 'bad' : v > 15 ? 'warn' : 'good') },
          { key: 'palliOfficialsNotObsPct', label: '% Officials Not Observed', fmt: 'pct', tone: (v) => (v > 20 ? 'bad' : v > 10 ? 'warn' : 'good') },
          { key: 'palliSchools3PlusPct', label: '% Schools Observed 3+ Times', fmt: 'pct', tone: (v) => (v < 40 ? 'bad' : v < 60 ? 'warn' : 'good') },
          { key: 'palliLowPerformers', label: 'Low performers (<75%)', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'palliTopPerformers', label: 'Top performers (≥75%)', fmt: 'num', tone: (v) => (v > 0 ? 'good' : undefined) },
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

  /**
   * Columns for the per-KPI school list. For an Infrastructure KPI the grid
   * uses a dedicated FACILITY column set (classrooms, toilets, water, lab,
   * compound wall, demolition, kitchen…). For every other module it uses that
   * module's KPIs. The KPI column filter applies on top.
   */
  readonly kpiListColumns = computed<DrillColumn[]>(() => {
    const all = this.kpiListBaseColumns();
    const sel = this.colFilterKeys();
    if (!sel.length) return all;
    const keep = new Set(sel);
    const filtered = all.filter((c) => keep.has(c.key));
    return filtered.length ? filtered : all;
  });

  /** Column options for the per-KPI school-list filter. */
  readonly kpiListColumnOptions = computed(() =>
    this.kpiListBaseColumns().map((c) => ({ label: c.label, value: c.key })),
  );

  /** Unfiltered base columns for the per-KPI school list (per-topic layout). */
  private readonly kpiListBaseColumns = computed<DrillColumn[]>(() => {
    switch (this.activeTopic()) {
      case 'enr': return this.enrollmentListColumns;
      case 'att': return this.attendanceListColumns;
      case 'inf': {
        // Digital Infrastructure (ICT) KPIs share the 'inf' topic but need a
        // dedicated ICT facility column set; plain Infrastructure KPIs use the
        // physical facility columns.
        const id = this.kpiListId();
        return (id && this.ICT_KPIS.has(id)) ? this.ictFacilityColumns : this.infraFacilityColumns;
      }
      case 'dinf': return this.ictFacilityColumns;
      default: {
        const base = this.moduleKpiColumns();
        return base.length ? base : this.defaultTopicColumns();
      }
    }
  });

  /** KPI ids that belong to the Digital Infrastructure (ICT) module. */
  private readonly ICT_KPIS = new Set(['g_i', 'g_y', 'g_n', 'g_fp', 'g_ip', 'g_nf']);

  /** Digital Infrastructure (ICT) school-list columns (requested layout). */
  private readonly ictFacilityColumns: DrillColumn[] = [
    { key: 'ictFunctionalStatus', label: 'Functional Status', fmt: 'text' },
    { key: 'ictSchools', label: 'School with ICT facilities', fmt: 'yesno', tone: (v) => (v > 0 ? 'good' : 'bad') },
    { key: 'ictInternetStatus', label: 'Internet Status', fmt: 'text' },
    { key: 'facLabs', label: 'Lab Count', fmt: 'num' },
  ];

  /** Enrollment school-list columns (requested layout, real per-school values). */
  private readonly enrollmentListColumns: DrillColumn[] = [
    { key: 'boys', label: 'Boys', fmt: 'num' },
    { key: 'girls', label: 'Girls', fmt: 'num' },
    { key: 'teaching', label: 'Teachers', fmt: 'num' },
    { key: 'notMoved', label: 'Students not moved to next class', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
    { key: 'chg', label: 'Enrollment change', fmt: 'pctSigned', tone: (v) => (v < -2 ? 'bad' : v < 0 ? 'warn' : 'good') },
    { key: 'ptr', label: 'PTR', fmt: 'num1', tone: (v) => (v > 40 ? 'bad' : v > 30 ? 'warn' : 'good') },
    { key: 'dropRate', label: 'Dropout rate', fmt: 'pct', tone: (v) => (v > 4 ? 'bad' : v > 2 ? 'warn' : 'good') },
    { key: 'drop', label: 'Dropout students', fmt: 'num' },
  ];

  /** Attendance school-list columns (requested layout). */
  private readonly attendanceListColumns: DrillColumn[] = [
    { key: 'stuPresentPct', label: 'Student present %', fmt: 'pct', tone: (v) => (v < 85 ? 'bad' : v < 90 ? 'warn' : 'good') },
    { key: 'boysAbsent', label: 'Boys absent', fmt: 'num' },
    { key: 'girlsAbsent', label: 'Girls absent', fmt: 'num' },
    { key: 'studentsAbsent', label: 'Total students absent', fmt: 'num' },
    { key: 'teaching', label: 'Total Teachers', fmt: 'num' },
    { key: 'teacherPresent', label: 'Teacher present', fmt: 'num' },
    { key: 'teacherAbsent', label: 'Teacher absent', fmt: 'num' },
    { key: 'markedStatus', label: 'Marked status', fmt: 'text' },
    { key: 'drop', label: 'Potential dropout', fmt: 'num' },
    { key: 'teacherLong30', label: 'Teacher absent 30+ days', fmt: 'num' },
  ];

  /**
   * Dedicated facility columns for the Infrastructure school list, matching the
   * requested layout. Real per-school values where the infra return has them
   * (classrooms, toilets, water, lab, demolition); the rest are assumed.
   */
  private readonly infraFacilityColumns: DrillColumn[] = [
    { key: 'facClassrooms', label: 'Classroom Available', fmt: 'num' },
    { key: 'facBoysToilet', label: 'Boys Toilet Available', fmt: 'num' },
    { key: 'facGirlsToilet', label: 'Girls Toilet Available', fmt: 'num' },
    { key: 'facCwsnToilet', label: 'CWSN Toilet', fmt: 'num' },
    { key: 'facLabs', label: 'Lab Available', fmt: 'num' },
    { key: 'facWater', label: 'Drinking Water', fmt: 'num' },
    { key: 'facCompoundWall', label: 'Compound Wall', fmt: 'yesno' },
    { key: 'facDemolish', label: 'Building to be Demolished', fmt: 'num' },
    { key: 'facKitchen', label: 'Kitchen Shed', fmt: 'yesno' },
  ];

  /** The selected module's KPIs as columns (same labels as the tile, real fmt). */
  private readonly moduleKpiColumns = computed<DrillColumn[]>(() => {
    const kpis = this.selectedModuleKpis();
    if (!kpis.length) return [];
    const seen = new Set<string>();
    const cols: DrillColumn[] = [];
    for (const def of kpis) {
      const field = def.field;
      if (!field || field === 'DERIVED' || seen.has(field)) continue;
      seen.add(field);
      cols.push({
        key: field,
        label: def.label,
        fmt: def.fmt === 'pct' ? 'pct' : def.id === 'ptr60' ? 'num1' : def.id === 'einc' || def.id === 'edec' ? 'pctSigned' : 'num',
        // Tone only percentage KPIs by their band; raw per-school counts carry
        // no reliable good/bad direction here, so leave them untinted.
        tone: def.fmt === 'pct' ? this.moduleKpiTone(def) : undefined,
      });
    }
    return cols;
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
        ...this.academicKpiFields(examStat, examPrev),
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
        ...this.enrollmentFields(this.ds.schoolRowsFor(key)),
        ...this.attendanceFields(atNode, d.boys, d.girls, d.teaching),
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
        ...this.academicKpiFields(examStat, examPrev),
        sch: sc ? this.pct(sc.thiran.assessed, sc.thiran.eligible) : 0,
        cases: sc ? this.scale(Math.round((sc.cmCell.pending + sc.helpline14417.critical) * share)) : 0,
        ...this.moduleFields(dist, share, b.schools),
        ...this.sampleFields(dist, share, b.schools),
        ...this.realFields(dist, b.block, undefined, 'block'),
        ...this.enrollmentFields(this.ds.schoolRowsFor(dist, b.block)),
        ...this.attendanceFields(atNode, b.boys, b.girls, b.teaching),
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
        district: this.ds.titleCase(dist),
        block: this.ds.titleCase(blk),
        ctype: s.ctype ?? '',
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
        ...this.academicKpiFields(examStat, examPrev),
        hasAca: !!acS,
        sch: sc ? this.pct(sc.thiran.assessed, sc.thiran.eligible) : 0,
        cases: sc ? this.scale(Math.round((sc.cmCell.pending + sc.helpline14417.critical) * share)) : 0,
        ...this.moduleFields(dist, share, 1),
        ...this.sampleFields(dist, share, 1),
        ...this.realFields(dist, blk, s.udise, 'school'),
        ...this.enrollmentFieldsSchool(s),
        ...this.schoolKpiValues(s, infS, (this._digitalReal()?.schools as any)?.[s.udise], atS),
        ...this.attendanceFields(
          atS ? {
            attendance: atS.attendance, teacherAttendance: atS.teacherAttendance,
            compliance: atS.compliance, absentees: atS.absentees,
            teacherAbsentees: Math.round((s.teaching ?? 0) * (1 - (atS.teacherAttendance ?? 100) / 100)),
          } : undefined,
          s.boys ?? 0, s.girls ?? 0, s.teaching ?? 0,
        ),
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

  /**
   * Academic Performance KPI fields (per the Academic Performance KPI – Final
   * spec) derived from the current and previous exam-period stats:
   *   acaPassPct      Pass Percentage %   (students passed / appeared)
   *   academicAvg     Average Mark
   *   academicChange  Year-on-Year Improvement % (vs previous period as proxy)
   *   acaExamToExam   Exam-to-Exam Improvement (PP) = current − previous avg
   *   acaCoveragePct  Assessment Coverage % (students assessed / expected)
   *   acaCompletionPct Mark Entry Completion % (marks entered / expected)
   */
  private academicKpiFields(
    examStat: { name: string; avg: number; pass: number; compliance: number } | null,
    examPrev: { name: string; avg: number; pass: number; compliance: number } | null,
  ): Partial<DrillRow> {
    if (!examStat) return { acaPassPct: 0, acaExamToExam: 0, acaCoveragePct: 0 };
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      acaPassPct: r1(examStat.pass),
      acaExamToExam: examPrev ? r1(examStat.avg - examPrev.avg) : 0,
      acaCoveragePct: r1(examStat.compliance),
    };
  }

  /** Teachers on long leave has no source field anywhere in the data; estimated at ~2% of teaching staff. */
  private estimateLongLeave(teaching: number): number {
    return Math.round(this.scale(teaching) * 0.02);
  }

  /** Teachers absent 30+ days — no source field; estimated at ~2% of teaching staff. */
  private estimateLong30(teaching: number): number {
    return Math.round(this.scale(teaching) * 0.02);
  }

  /**
   * Enrollment school-count aggregates + per-row gender/PTR/transition fields
   * for a set of school rows in a scope. `rows` is the raw SchoolRow[] for the
   * district or block. Counts mirror the School-Dashboard caution checks:
   * zero enrolment, zero teacher, single teacher, under-10, PTR>60; plus
   * enrolment increase/decline school counts (year-over-year via each school's
   * series) and students-not-moved (transition leakage estimate).
   */
  private enrollmentFields(rows: SchoolRow[]): Partial<DrillRow> {
    let zeroEnrol = 0, zeroTeacher = 0, singleTeacher = 0, under10 = 0, ptrOver60 = 0;
    let increase = 0, declined = 0;
    let boys = 0, girls = 0, students = 0, teaching = 0;
    let notMoved = 0;
    let transitionPendingSchools = 0; // schools not meeting 100% transition (any pending students)
    let schools = 0;

    for (const r of rows) {
      schools++;
      boys += r.boys ?? 0;
      girls += r.girls ?? 0;
      students += r.students ?? 0;
      teaching += r.teaching ?? 0;

      if ((r.students ?? 0) === 0) zeroEnrol++;
      if ((r.teaching ?? 0) === 0 && (r.students ?? 0) > 0) zeroTeacher++;
      if ((r.teaching ?? 0) === 1) singleTeacher++;
      if ((r.students ?? 0) > 0 && (r.students ?? 0) < 10) under10++;
      const ptr = r.teaching ? r.students / r.teaching : 0;
      if (r.teaching && ptr > 60) ptrOver60++;

      // enrolment change vs previous year from each school's series
      const series = r.series ?? [];
      if (series.length >= 2) {
        const last = series[series.length - 1];
        const prev = series[series.length - 2];
        if (last > prev) increase++;
        else if (last < prev) {
          declined++;
          // students "not moved" ~ the drop in roll between years (lower bound of leakage)
          notMoved += prev - last;
          transitionPendingSchools++;
        }
      }
    }

    const ptr = teaching ? Math.round((students / teaching) * 10) / 10 : 0;
    return {
      boys: this.scale(boys),
      girls: this.scale(girls),
      ptr,
      notMoved: this.scale(notMoved),
      transitionPendingPct: schools ? Math.round((transitionPendingSchools / schools) * 1000) / 10 : 0,
      zeroEnrol: this.scale(zeroEnrol),
      zeroTeacher: this.scale(zeroTeacher),
      singleTeacher: this.scale(singleTeacher),
      under10: this.scale(under10),
      ptrOver60: this.scale(ptrOver60),
      enrolIncreaseSchools: this.scale(increase),
      enrolDeclinedSchools: this.scale(declined),
    };
  }

  /** Per-school enrolment fields (school-level drill row). */
  private enrollmentFieldsSchool(r: SchoolRow): Partial<DrillRow> {
    const ptr = r.teaching ? Math.round((r.students / r.teaching) * 10) / 10 : 0;
    const series = r.series ?? [];
    let notMoved = 0;
    if (series.length >= 2) {
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      if (last < prev) notMoved = prev - last;
    }
    return {
      boys: this.scale(r.boys ?? 0),
      girls: this.scale(r.girls ?? 0),
      ptr,
      notMoved: this.scale(notMoved),
      transitionPendingPct: notMoved > 0 ? 100 : 0,
    };
  }

  /**
   * Attendance absence fields for a scope. Boys/girls absent are apportioned
   * from the student absentee pool by the scope's gender split (no gender-split
   * absentee field exists in the source). Teacher absent uses teacherAbsentees;
   * 30+ day long absence is estimated at ~2% of teaching staff.
   */
  private attendanceFields(
    atNode: { attendance: number; teacherAttendance: number; compliance: number; absentees: number; teacherAbsentees: number } | undefined,
    boys: number, girls: number, teaching: number,
  ): Partial<DrillRow> {
    if (!atNode) {
      return {
        boysAbsent: 0, girlsAbsent: 0, teacherAbsent: 0,
        teacherLong30: this.estimateLong30(teaching),
        schoolsNotMarkedPct: 0, markedStatus: 'Not marked',
      };
    }
    const total = (boys + girls) || 1;
    const absent = this.scale(atNode.absentees ?? 0);
    const comp = Math.round((atNode.compliance ?? 0) * 10) / 10;
    return {
      boysAbsent: Math.round(absent * (boys / total)),
      girlsAbsent: Math.round(absent * (girls / total)),
      teacherAbsent: this.scale(atNode.teacherAbsentees ?? 0),
      teacherLong30: this.estimateLong30(teaching),
      schoolsNotMarkedPct: Math.round((100 - comp) * 10) / 10,
      markedStatus: comp >= 99 ? 'Marked' : comp > 0 ? 'Partial' : 'Not marked',
    };
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

    // ---- Palli Parvai KPIs (spec: Palli Parvai – KPI & Drill-Down Structure) ----
    // Real where derivable from the module data; assumed deterministically from
    // the district name where the source has no equivalent field.
    const pp = d.palliParvai;
    const classObsPct = this.pct(pp.visited, pp.target); // observed / target
    const schoolsNotObsPct = Math.round((100 - classObsPct) * 10) / 10;
    const byDes = pp.byDesignation ?? [];
    const lowPerf = byDes.filter((x) => (x.completionPct ?? 0) < 75).length;
    const topPerf = byDes.filter((x) => (x.completionPct ?? 0) >= 75).length;
    const h = (salt: string) => this.hash01(d.name, salt);
    const officialsNotObsPct = Math.round((8 + h('p_ono') * 24) * 10) / 10;   // ~8–32% assumed
    const schools3PlusPct = Math.round((35 + h('p_s3') * 50) * 10) / 10;      // ~35–85% assumed

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
      // new Palli KPIs
      palliClassObsPct: classObsPct,
      palliSchoolsNotObsPct: schoolsNotObsPct,
      palliOfficialsNotObsPct: officialsNotObsPct,
      palliSchools3PlusPct: schools3PlusPct,
      palliLowPerformers: lowPerf,
      palliTopPerformers: topPerf,
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

  /** Grand-total student count across the current drill rows (footer). */
  readonly totalN = computed(() => this.sortedDrillRows().reduce((s, r) => s + ((r.n as number) || 0), 0));
  /** Grand-total student count across the per-KPI school list (footer). */
  readonly kpiListTotalN = computed(() => this.kpiDrillRows().reduce((s, r) => s + ((r.n as number) || 0), 0));

  /** Aggregate one drill column across a set of rows for the grand-total footer.
   * Counts (num/num1) are summed; percentages (pct/pctSigned) and PTR-like
   * num1 ratios are averaged weighted by each row's student count (`n`), which
   * is the correct roll-up for a rate; text columns return ''. Returns the
   * display string already formatted for the column.
   */
  aggregateColumn(rows: DrillRow[], col: DrillColumn): string {
    if (!rows.length) return '';
    const key = col.key as keyof DrillRow;
    // percentages & signed-percent & ratios → student-weighted average
    const WEIGHTED = new Set<DrillColumn['fmt']>(['pct', 'pctSigned', 'ptSigned']);
    if (col.fmt === 'text' || col.fmt === 'yesno' || col.fmt === 'presAbs') return '';
    if (WEIGHTED.has(col.fmt) || col.key === 'ptr') {
      let num = 0, den = 0;
      for (const r of rows) {
        const w = (r.n as number) || 0;
        num += ((r[key] as number) || 0) * w;
        den += w;
      }
      const v = den ? num / den : 0;
      if (col.fmt === 'pctSigned') return `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;
      if (col.fmt === 'ptSigned') return `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} pt`;
      if (col.key === 'ptr') return (Math.round(v * 10) / 10).toString();
      return `${Math.round(v * 10) / 10}%`;
    }
    // counts → sum
    const sum = rows.reduce((s, r) => s + ((r[key] as number) || 0), 0);
    if (col.fmt === 'num1') return (Math.round(sum * 10) / 10).toString();
    return Math.round(sum).toLocaleString('en-IN');
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
    // at school level the main table uses the rich KPI-list columns, so sort by those
    const cols = this.ds.selectedBlock() ? this.kpiListColumns() : this.topicColumns();
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
    // A school row (block-level listing): Academic opens the class→subject
    // drill; every other topic opens the shared school profile drawer.
    if (row.level === 'school' || level === 'block') {
      if (this.activeTopic() === 'aca' && row.udise) { this.openAcademicDrill(row.udise, row.name); return; }
      this.openDrawer(row); return;
    }
    if (level === 'state') this.ds.drillToDistrict(row.key);
    else if (level === 'district') this.ds.drillToBlock(row.key);
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

  // ================= PER-KPI SCHOOL LIST (flag drill) =================
  /**
   * The flag KPI whose matching schools are being shown (e.g. "Zero enrolment
   * schools"). null means the school list is closed. Set via openKpiSchoolList.
   */
  readonly kpiListId = signal<string | null>(null);

  /**
   * Predicates for the Enrollment flag KPIs — each returns true for a school
   * that the KPI counts. Keyed by the KPI catalog id. Enrolment-change KPIs use
   * the school's own year-over-year series.
   */
  private readonly KPI_SCHOOL_PREDICATES: Record<string, (c: KpiSchoolCtx) => boolean> = {
    // ---- Enrollment (real per-school roll) ----
    // Zero enrolment schools
    zenr: ({ row: r }) => (r.students ?? 0) === 0,
    // Zero teacher schools (students on roll, no teaching staff)
    ztea: ({ row: r }) => (r.teaching ?? 0) === 0 && (r.students ?? 0) > 0,
    // Single teacher schools
    stea: ({ row: r }) => (r.teaching ?? 0) === 1,
    // Under 10 students schools
    u10: ({ row: r }) => (r.students ?? 0) > 0 && (r.students ?? 0) < 10,
    // PTR over 60 schools
    ptr60: ({ row: r }) => (r.teaching ?? 0) > 0 && (r.students ?? 0) / (r.teaching ?? 1) > 60,
    // Enrollment increase schools (latest year > previous year)
    einc: ({ row: r }) => this.seriesDelta(r.series) > 0,
    // Schools with declined enrollment (latest year < previous year)
    edec: ({ row: r }) => this.seriesDelta(r.series) < 0,

    // ---- Attendance (real per-school attendance record) ----
    // Student attendance %: schools below 75% student attendance
    a_s: ({ atS }) => !!atS && (atS.attendance ?? 100) < 75,
    // Teacher attendance %: schools below 75% teacher attendance
    a_t: ({ atS }) => !!atS && (atS.teacherAttendance ?? 100) < 75,
    // Schools marked attendance %: schools that marked less than 25% (low compliance)
    a_nm: ({ atS }) => !!atS && (atS.compliance ?? 100) < 25,

    // ---- Infrastructure (real per-school infra return where a field exists;
    //      otherwise assumed deterministically) ----
    // Zero toilet school: submitted school with zero toilets available
    i_t: ({ infS }) => !!infS && infS.entered === 1 && (infS.types?.['toilets']?.available ?? 0) === 0,
    // No drinking water school: zero water source available
    i_w: ({ infS }) => !!infS && infS.entered === 1 && (infS.types?.['water']?.available ?? 0) === 0,
    // Zero classroom: no classroom of its own
    i_cl: ({ infS }) => !!infS && infS.entered === 1 && (infS.types?.['classrooms']?.available ?? 0) === 0,
    // Building to be demolished: at least one block marked for demolition
    i_d: ({ infS, row }) => infS && infS.entered === 1
      ? (infS.types?.['building']?.demolish ?? 0) > 0
      : this.assume(row.udise, 'i_d'),
    // School with critical gap: any of toilet / water / classroom missing
    gap: ({ infS }) => !!infS && infS.entered === 1 && (
      (infS.types?.['toilets']?.available ?? 0) === 0 ||
      (infS.types?.['water']?.available ?? 0) === 0 ||
      (infS.types?.['classrooms']?.available ?? 0) === 0
    ),
    // Schools needing any infra facility: any core facility (classroom/toilet/
    // water/lab/furniture) missing
    i_need: ({ infS }) => !!infS && infS.entered === 1 && (
      (infS.types?.['classrooms']?.available ?? 0) === 0 ||
      (infS.types?.['toilets']?.available ?? 0) === 0 ||
      (infS.types?.['water']?.available ?? 0) === 0 ||
      (infS.types?.['labs']?.available ?? 0) === 0 ||
      (infS.types?.['furniture']?.available ?? 0) === 0
    ),
    // No EB connection / no compound wall / no kitchen shed: no per-school field
    // in the infra return — assumed deterministically.
    i_e: ({ row }) => this.assume(row.udise, 'i_e'),
    i_cw: ({ row }) => this.assume(row.udise, 'i_cw'),
    i_k: ({ row }) => this.assume(row.udise, 'i_k'),

    // ---- Digital Infrastructure (ICT) ----
    // Real per-school digital return where present; otherwise assumed (see below).
    // ICT KPIs: use the real per-school digital return only, so the drill count
    // matches the published figure (no assumed inflation for unmatched schools).
    g_i: ({ dig }) => (dig?.ictSchools ?? 0) > 0,
    g_y: ({ dig }) => (dig?.internet ?? 0) > 0,
    g_n: ({ dig }) => (dig?.noInternet ?? 0) > 0,
    g_nf: ({ dig }) => (dig?.notFunctional ?? 0) > 0,
    // ICT functional % → schools whose ICT is functional
    g_fp: ({ dig }) => (dig?.functional ?? 0) > 0,
    // ICT internet % → schools with internet available
    g_ip: ({ dig }) => (dig?.internet ?? 0) > 0,

    // ---- Assumed-only flag KPIs (no per-school source; deterministic subset) ----
    // Attendance: schools that marked only one of student/teacher attendance
    a_os: ({ row }) => this.assume(row.udise, 'a_os'),
    a_ot: ({ row }) => this.assume(row.udise, 'a_ot'),
    // Schemes & grievance
    bx: ({ row }) => this.assume(row.udise, 'bx'),
    cm_o: ({ row }) => this.assume(row.udise, 'cm_o'),
    cm_c: ({ row }) => this.assume(row.udise, 'cm_c'),
    h_o: ({ row }) => this.assume(row.udise, 'h_o'),
    h_c: ({ row }) => this.assume(row.udise, 'h_c'),
    // THIRAN+ / Scholarship
    t_sc: ({ row }) => this.assume(row.udise, 't_sc'),
    sh_f: ({ row }) => this.assume(row.udise, 'sh_f'),
    sh_w: ({ row }) => this.assume(row.udise, 'sh_w'),
    sh_n: ({ row }) => this.assume(row.udise, 'sh_n'),
    sh_a: ({ row }) => this.assume(row.udise, 'sh_a'),
    // SMC / Palli
    m_e: ({ row }) => this.assume(row.udise, 'm_e'),
    // Palli Parvai low/top performer flags (assumed per-school deterministic)
    p_low: ({ row }) => this.assume(row.udise, 'p_low'),
    p_top: ({ row }) => !this.assume(row.udise, 'p_low'),
  };

  /**
   * Assumed per-KPI flag rate for schools that have no real per-school source.
   * Deterministic (hash of UDISE) so the same schools are always flagged, and
   * sized to a plausible share. These lists are ESTIMATES — the UI labels them
   * "(assumed)" so they are never mistaken for the real roll.
   */
  private readonly ASSUMED_RATE: Record<string, number> = {
    // Digital infrastructure
    g_i: 0.62, g_y: 0.48, g_n: 0.22, g_nf: 0.14, g_fp: 0.55, g_ip: 0.48,
    // Infrastructure (no per-school field — assumed)
    i_e: 0.08, i_cw: 0.12, i_k: 0.15, i_d: 0.05,
    // Attendance (no per-school field — assumed)
    a_os: 0.07, a_ot: 0.05,
    // Schemes & grievance
    bx: 0.06, cm_o: 0.09, cm_c: 0.03, h_o: 0.07, h_c: 0.02,
    // THIRAN+ / Scholarship
    t_sc: 0.70, sh_f: 0.05, sh_w: 0.08, sh_n: 0.04, sh_a: 0.06,
    // SMC / Palli
    m_e: 0.04, p_low: 0.35,
  };

  /** Deterministic 0..1 hash from a UDISE + KPI id (stable across renders). */
  private hash01(udise: string, salt: string): number {
    let h = 2166136261;
    const s = `${udise}|${salt}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }

  /**
   * Real per-school values for the module-KPI columns, so each KPI column in
   * the school list shows DATA (not a yes/no). Flag KPIs resolve to the actual
   * underlying figure for that school (e.g. "Zero teacher schools" -> teacher
   * count; "PTR over 60" -> the PTR). Fields with no real per-school source are
   * assumed deterministically from the UDISE so the column still shows a value.
   */
  private schoolKpiValues(
    r: SchoolRow,
    infS: { entered?: number; types?: Record<string, { available?: number; good?: number; demolish?: number }> } | undefined,
    dig: { ictSchools?: number; internet?: number; noInternet?: number; functional?: number; notFunctional?: number } | undefined,
    atS?: { attendance?: number; teacherAttendance?: number; absentees?: number; dropoutRisk?: number } | undefined,
  ): Partial<DrillRow> {
    const students = r.students ?? 0;
    const teaching = r.teaching ?? 0;
    const boys = r.boys ?? 0;
    const girls = r.girls ?? 0;
    const ptr = teaching ? Math.round((students / teaching) * 10) / 10 : 0;
    const delta = this.seriesDelta(r.series);
    const prevYear = (r.series && r.series.length >= 2) ? r.series[r.series.length - 2] : 0;
    const chgPct = prevYear ? Math.round((delta / prevYear) * 1000) / 10 : 0;
    const av = (t: string) => infS?.types?.[t]?.available ?? 0;
    const good = (t: string) => (infS?.types?.[t] as any)?.good ?? 0;
    const demolishUnits = (infS?.types?.['building'] as any)?.demolish ?? 0;
    // deterministic assumed count 0..n for a UDISE+salt (small whole numbers)
    const aCount = (salt: string, max: number) => Math.round(this.hash01(r.udise, salt) * max);
    const toilets = av('toilets');
    // toilets are not sex-split in the source; apportion deterministically
    const boysToilet = Math.round(toilets * (0.45 + this.hash01(r.udise, 'bt') * 0.1));

    // ---- Attendance per-school derived values ----
    const stuAtt = atS ? Math.round((atS.attendance ?? 0) * 10) / 10 : 0;
    const tchAtt = atS ? Math.round((atS.teacherAttendance ?? 0) * 10) / 10 : 0;
    const absentTotal = atS ? this.scale(atS.absentees ?? 0) : 0;
    const totalEnr = (boys + girls) || 1;
    const boysAbsent = Math.round(absentTotal * (boys / totalEnr));
    const girlsAbsent = Math.max(0, absentTotal - boysAbsent);
    const teacherAbsent = atS ? Math.round(teaching * (1 - (atS.teacherAttendance ?? 100) / 100)) : 0;

    return {
      // ---- Enrollment list columns (real) ----
      boys, girls, teaching,
      dropRate: students ? Math.round(((this.scale(atS?.dropoutRisk ?? 0) / students) * 100) * 10) / 10 : 0,
      // ---- Attendance list columns ----
      stuPresentPct: stuAtt,
      stuAbsentPct: atS ? Math.round((100 - stuAtt) * 10) / 10 : 0,
      boysAbsent,
      girlsAbsent,
      studentsAbsent: absentTotal,
      tchPresentPct: tchAtt,
      tchAbsentPct: atS ? Math.round((100 - tchAtt) * 10) / 10 : 0,
      teacherPresent: Math.max(0, teaching - teacherAbsent),
      teacherAbsent,
      // ---- Enrollment flag KPI values (real) ----
      zeroEnrol: students,
      zeroTeacher: teaching,
      singleTeacher: teaching,
      under10: students,
      ptrOver60: ptr,
      enrolIncreaseSchools: chgPct,
      enrolDeclinedSchools: chgPct,
      // ---- Infrastructure flag KPI values (toilets/water real; others assumed) ----
      infNoToilet: toilets,
      infNoWater: av('water'),
      infZeroClassroom: av('classrooms'),
      infNeedsAny: av('classrooms') + toilets + av('water') + av('labs'),
      infNoCwsnToilet: aCount('i_c', 1),
      infNoEb: aCount('i_e', 1),
      infNoKitchen: aCount('i_k', 1),
      infNoCompound: aCount('i_cw', 1),
      infDemolish: demolishUnits || aCount('i_d', 3),
      infRepair: aCount('i_r', 5),
      // ---- Infra facility availability columns (real where present, else assumed) ----
      facClassrooms: av('classrooms'),
      facBoysToilet: boysToilet,
      facGirlsToilet: Math.max(0, toilets - boysToilet),
      facCwsnToilet: good('toilets') > 0 ? aCount('cwsn', 1) : 0,
      facLabs: av('labs'),
      facWater: av('water'),
      facCompoundWall: this.assume(r.udise, 'i_cw') ? 0 : 1,
      facDemolish: demolishUnits,
      facKitchen: this.assume(r.udise, 'i_k') ? 0 : 1,
      // ---- Digital (ICT) real where present, else assumed small counts ----
      ictSchools: dig ? (dig.ictSchools ?? 0) : aCount('g_i', 1),
      ictInternet: dig ? (dig.internet ?? 0) : aCount('g_y', 1),
      ictNoInternet: dig ? (dig.noInternet ?? 0) : aCount('g_n', 1),
      ictNotFunctional: dig ? (dig.notFunctional ?? 0) : aCount('g_nf', 2),
      // ICT status labels for the Digital Infrastructure school list
      ictFunctionalStatus: dig
        ? ((dig.functional ?? 0) > 0 ? 'Functional' : (dig.notFunctional ?? 0) > 0 ? 'Not functional' : 'Partially functional')
        : (this.hash01(r.udise, 'g_fs') < 0.7 ? 'Functional' : this.hash01(r.udise, 'g_fs') < 0.88 ? 'Partially functional' : 'Not functional'),
      ictInternetStatus: dig
        ? ((dig.internet ?? 0) > 0 ? 'Available' : 'Not available')
        : (this.hash01(r.udise, 'g_is') < 0.55 ? 'Available' : 'Not available'),
    };
  }

  /** Whether a school is flagged for an assumed KPI (deterministic subset). */
  private assume(udise: string, kpiId: string): boolean {
    const rate = this.ASSUMED_RATE[kpiId] ?? 0.1;
    return this.hash01(udise, kpiId) < rate;
  }

  /** KPI ids whose school list is backed by a real per-school source. */
  private readonly REAL_SOURCE_KPIS = new Set(['zenr', 'ztea', 'stea', 'u10', 'ptr60', 'einc', 'edec', 'a_s', 'a_t', 'a_nm', 'i_t', 'i_w', 'i_cl', 'i_d', 'gap', 'i_need', 'g_i', 'g_y', 'g_n', 'g_nf', 'g_fp', 'g_ip']);

  /**
   * True when the open KPI's school list is at least partly ASSUMED (no real
   * per-school source). Drives the "(assumed)" badge in the grid header.
   */
  readonly kpiListAssumed = computed(() => {
    const id = this.kpiListId();
    return !!id && !this.REAL_SOURCE_KPIS.has(id);
  });

  /** Latest-year minus previous-year enrolment for a school's series. */
  private seriesDelta(series: number[] | undefined): number {
    if (!series || series.length < 2) return 0;
    return series[series.length - 1] - series[series.length - 2];
  }

  /** Whether a KPI id has a school-level predicate (i.e. can show a school list). */
  hasKpiSchoolList(id: string): boolean {
    return id in this.KPI_SCHOOL_PREDICATES;
  }

  /** Open the per-KPI school list for a flag KPI; no-op if it has no predicate. */
  openKpiSchoolList(id: string): void {
    if (this.hasKpiSchoolList(id)) this.kpiListId.set(id);
  }
  /** Close the per-KPI school list. */
  closeKpiSchoolList(): void { this.kpiListId.set(null); }

  /** Human label for the open KPI school list (from the catalog). */
  readonly kpiListLabel = computed(() => {
    const id = this.kpiListId();
    if (!id) return '';
    for (const m of KPI_MODULES) {
      const def = m.kpis.find((k) => k.id === id);
      if (def) return def.label;
    }
    return '';
  });

  /**
   * The schools matching the open flag KPI, scoped to the current drill level
   * (State = all districts, District = that district, Block = that block).
   * Each row carries the fields the drill-down asks for: district, school,
   * boys, girls, total enrolment, change vs last year, teachers, PTR and the
   * potential dropouts joined from the attendance roll by UDISE.
   */
  /**
   * Full school-level DrillRows for only the schools matching the open flag
   * KPI, scoped to the current drill level. These carry every module KPI field
   * (enrolment flags, attendance, academic, infra, schemes…) so the drill table
   * can render the matching schools against the SAME columns as the module —
   * letting you compare each flagged school's full performance.
   */
  readonly kpiDrillRows = computed<DrillRow[]>(() => {
    const id = this.kpiListId();
    if (!id) return [];
    const pred = this.KPI_SCHOOL_PREDICATES[id];
    if (!pred) return [];

    // Scope-wide per-school lookups by UDISE (read-only accessors on the
    // sibling services; no change to those dashboards).
    const atByUdise = new Map(this.at.scopeSchools().map((s) => [s.udise, s] as const));
    const acByUdise = new Map(this.ac.scopeSchools().map((s: any) => [s.udise, s] as const));
    const infByUdise = new Map(this.inf.scopeSchools().map((s: any) => [s.udise, s] as const));
    const digByUdise = this._digitalReal()?.schools ?? {};

    const matches = this.scopeSchoolRows().filter((e) => pred({
      row: e.row,
      infS: infByUdise.get(e.row.udise),
      dig: (digByUdise as any)[e.row.udise],
      atS: atByUdise.get(e.row.udise),
    }));
    // district student totals for scheme apportioning (same basis as schoolRows)
    const schemesByDist = new Map((this._schemes()?.districts ?? []).map((d) => [d.name, d] as const));

    const rows = matches.map(({ row: s, district: dist, block: blk }) => {
      const atS = atByUdise.get(s.udise);
      const acS: any = acByUdise.get(s.udise);
      const infS: any = infByUdise.get(s.udise);
      const gapInfo = this.infraGapForSchool(infS);
      const examStat = this.examStat(acS?.byExam);
      const examPrev = this.examStatPrev(acS?.byExam);
      const sc = schemesByDist.get(dist) ?? null;
      const distStudents = sc?.students || 1;
      const share = distStudents ? (s.students ?? 0) / distStudents : 0;

      return {
        key: s.name, udise: s.udise, name: s.name, level: 'school',
        district: this.ds.titleCase(dist),
        block: this.ds.titleCase(blk),
        ctype: s.ctype ?? '',
        ns: 1, n: this.scale(s.students ?? 0),
        chg: (s.series?.length ?? 0) >= 2 ? this.seriesChangePct(s.series!) : 0,
        att: atS ? Math.round(atS.attendance * 10) / 10 : 0,
        hasAtt: !!atS,
        drop: this.scale(atS?.dropoutRisk ?? 0),
        tl: this.estimateLongLeave(s.teaching ?? 0),
        gaps: gapInfo.count,
        gapl: gapInfo.label,
        gapList: gapInfo.list,
        academicAvg: examStat ? Math.round(examStat.avg * 10) / 10 : 0,
        academicPrevAvg: examPrev ? Math.round(examPrev.avg * 10) / 10 : 0,
        academicChange: examStat && examPrev ? Math.round((examStat.avg - examPrev.avg) * 10) / 10 : 0,
        ...this.academicKpiFields(examStat, examPrev),
        hasAca: !!acS,
        sch: sc ? this.pct(sc.thiran.assessed, sc.thiran.eligible) : 0,
        cases: sc ? this.scale(Math.round((sc.cmCell.pending + sc.helpline14417.critical) * share)) : 0,
        ...this.moduleFields(dist, share, 1),
        ...this.sampleFields(dist, share, 1),
        ...this.realFields(dist, blk, s.udise, 'school'),
        ...this.enrollmentFieldsSchool(s),
        ...this.schoolKpiValues(s, infS, (digByUdise as any)[s.udise], atS),
        ...this.attendanceFields(
          atS ? {
            attendance: atS.attendance, teacherAttendance: atS.teacherAttendance,
            compliance: atS.compliance, absentees: atS.absentees,
            teacherAbsentees: Math.round((s.teaching ?? 0) * (1 - (atS.teacherAttendance ?? 100) / 100)),
          } : undefined,
          s.boys ?? 0, s.girls ?? 0, s.teaching ?? 0,
        ),
      } as DrillRow & { district: string };
    });

    // apply the shared column sort (same controls as the main drill table);
    // default to the first per-school column, worst-first.
    const cols = this.kpiListColumns();
    const col = this.sortCol() ?? cols[0]?.key ?? 'n';
    const defaultDir = this.activeTopic() === 'inf' ? -1 : 1;
    const dir = this.sortCol() === null ? defaultDir : this.sortDir();
    return rows.sort((a, b) => {
      const x = (a as any)[col] ?? 0;
      const y = (b as any)[col] ?? 0;
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * dir;
      return (x - y) * dir;
    });
  });

  /** Count of schools in the open KPI list. */
  readonly kpiSchoolListCount = computed(() => this.kpiDrillRows().length);

  /**
   * All SchoolRow for the current drill scope, each paired with its district
   * and block keys. State -> every school; District -> that district's blocks;
   * Block -> that block.
   */
  private scopeSchoolRows(): { row: SchoolRow; district: string; block: string }[] {
    const level = this.ds.level();
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    const out: { row: SchoolRow; district: string; block: string }[] = [];

    if (level === 'block' && dist && blk) {
      for (const row of this.ds.schoolRowsFor(dist, blk)) out.push({ row, district: dist, block: blk });
      return out;
    }
    if (level === 'school' && dist && blk) {
      for (const row of this.ds.schoolRowsFor(dist, blk)) {
        if (row.name === this.ds.selectedSchool()) out.push({ row, district: dist, block: blk });
      }
      return out;
    }
    // district or state: walk the relevant blocks so each school keeps its block
    const blocks = this.ds.data()?.blocks ?? [];
    const wantDistricts = level === 'district' && dist
      ? new Set([dist])
      : new Set(this.ds.districts().map((d) => d.name));
    for (const b of blocks) {
      if (!wantDistricts.has(b.district)) continue;
      for (const row of this.ds.schoolRowsFor(b.district, b.block)) {
        out.push({ row, district: b.district, block: b.block });
      }
    }
    return out;
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
    const classObs = this.pct(p.visited, p.target);
    const notObs = Math.round((100 - classObs) * 10) / 10;
    const scopeKey = this.ds.selectedDistrict() ?? 'TN';
    const officialsNotObs = Math.round((8 + this.hash01(scopeKey, 'p_ono') * 24) * 10) / 10;
    const schools3Plus = Math.round((35 + this.hash01(scopeKey, 'p_s3') * 50) * 10) / 10;
    const byDes = p.byDesignation ?? [];
    const low = byDes.filter((x) => (x.completionPct ?? 0) < 75).length;
    const top = byDes.filter((x) => (x.completionPct ?? 0) >= 75).length;
    return [
      { label: '% of Class Observation', value: `${classObs}%`, icon: 'fa-solid fa-chalkboard-user', tone: classObs < 75 ? 'bad' : '' },
      { label: '% of Schools Not Observed (term)', value: `${notObs}%`, icon: 'fa-solid fa-building-circle-xmark', tone: notObs > 30 ? 'bad' : notObs > 15 ? 'warn' : '' },
      { label: '% of Officials Not Observed (month)', value: `${officialsNotObs}%`, icon: 'fa-solid fa-user-xmark', tone: officialsNotObs > 20 ? 'bad' : officialsNotObs > 10 ? 'warn' : '' },
      { label: '% of Schools Observed 3+ Times', value: `${schools3Plus}%`, icon: 'fa-solid fa-repeat', tone: schools3Plus < 40 ? 'bad' : schools3Plus < 60 ? 'warn' : '' },
      { label: 'Low performers (< 75%)', value: this.fmt(low), icon: 'fa-solid fa-arrow-trend-down', tone: low > 0 ? 'warn' : '' },
      { label: 'Top performers (≥ 75%)', value: this.fmt(top), icon: 'fa-solid fa-arrow-trend-up', tone: '' },
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

  // ================= PALLI PARVAI — DEDICATED DRILL (spec structure) =================
  /**
   * Stakeholder designations (columns) for the Palli Parvai drill-downs, from
   * the spec "Palli Parvai – KPI & Drill-Down Structure".
   */
  readonly PALLI_DESIGNATIONS = ['CEO', 'DEO – Secondary', 'DEO – Primary', 'APO', 'DC', 'BEO', 'BRTE', 'DIET Principal'];

  /** Which Palli KPI's drill is open (null = none). Set from openKpi. */
  readonly palliKpiId = signal<string | null>(null);
  /** Optional designation selected within KPI 1 (opens the designation drill). */
  readonly palliDesignation = signal<string | null>(null);

  readonly palliDrillKpis = new Set(['p_co', 'p_sno', 'p_ono', 'p_s3', 'p_low', 'p_top']);
  hasPalliDrill(id: string): boolean { return this.palliDrillKpis.has(id); }
  /** The Palli KPI tabs (id + short label) for switching tables within the drill. */
  readonly palliKpiTabs: { id: string; label: string }[] = [
    { id: 'p_co', label: '% Class Observation' },
    { id: 'p_sno', label: '% Schools Not Observed' },
    { id: 'p_ono', label: '% Officials Not Observed' },
    { id: 'p_s3', label: '% Schools 3+ Times' },
    { id: 'p_low', label: 'Low performers' },
    { id: 'p_top', label: 'Top performers' },
  ];
  setPalliKpi(id: string): void { this.palliKpiId.set(id); this.palliDesignation.set(null); this.palliSnoReset(); this.palliOnoReset(); }
  openPalliDrill(id: string): void { if (this.hasPalliDrill(id)) { this.palliKpiId.set(id); this.palliDesignation.set(null); this.palliSnoReset(); this.palliOnoReset(); } }
  closePalliDrill(): void { this.palliKpiId.set(null); this.palliDesignation.set(null); this.palliSnoReset(); this.palliOnoReset(); this.palliObsPopup.set(null); }
  selectPalliDesignation(d: string | null): void { this.palliDesignation.set(d); }

  /** Human label for the open Palli KPI (from the catalog). */
  readonly palliKpiLabel = computed(() => {
    const id = this.palliKpiId();
    if (!id) return '';
    for (const m of KPI_MODULES) { const def = m.kpis.find((k) => k.id === id); if (def) return def.label; }
    return '';
  });

  /** Districts in the current scope (state = all; district = just that one). */
  private palliScopeDistricts(): string[] {
    const dist = this.ds.selectedDistrict();
    if (dist) return [dist];
    return this.ds.districts().map((d) => d.name);
  }

  /** Deterministic observation % for a district+designation (stable, 60–95%). */
  private palliObsPct(district: string, designation: string): number {
    return Math.round((60 + this.hash01(`${district}|${designation}`, 'obs') * 35) * 10) / 10;
  }

  /** KPI 1 — District rows with a % per designation (stakeholder columns). */
  readonly palliDistrictMatrix = computed(() =>
    this.palliScopeDistricts().map((d, i) => {
      const cells: Record<string, number> = {};
      let sum = 0;
      for (const des of this.PALLI_DESIGNATIONS) { cells[des] = this.palliObsPct(d, des); sum += cells[des]; }
      const overall = Math.round((sum / this.PALLI_DESIGNATIONS.length) * 10) / 10;
      return { sno: i + 1, district: this.ds.titleCase(d), cells, overall };
    }),
  );

  /** KPI 1 designation drill — one row per district for the clicked designation. */
  readonly palliDesignationDrill = computed(() => {
    const des = this.palliDesignation();
    if (!des) return [];
    return this.palliScopeDistricts().map((d, i) => {
      const officials = 8 + Math.round(this.hash01(`${d}|${des}`, 'off') * 14); // 8–22
      const target = officials * 40; // 40 target classes per official (assumed)
      const pct = this.palliObsPct(d, des);
      const observed = Math.round(target * pct / 100);
      return { sno: i + 1, district: this.ds.titleCase(d), designation: des, officials, target, observed, pct };
    });
  });

  /** KPI 2 — schools with zero observations in the term (assumed subset). */
  readonly palliSchoolsNotObserved = computed(() => {
    const rows = this.scopeSchoolRows().filter((e) => this.hash01(e.row.udise, 'p_sno') < 0.28);
    return rows.map((e, i) => ({
      sno: i + 1, district: this.ds.titleCase(e.district), block: this.ds.titleCase(e.block),
      udise: e.row.udise, school: e.row.name, category: e.row.ctype ?? '—', observationCount: 0,
    }));
  });

  // ---- KPI 2 District → Block → School drill ----
  /** Selected district / block within the KPI-2 not-observed drill. */
  readonly palliSnoDistrict = signal<string | null>(null);
  readonly palliSnoBlock = signal<string | null>(null);
  palliSnoSelectDistrict(d: string | null): void { this.palliSnoDistrict.set(d); this.palliSnoBlock.set(null); }
  palliSnoSelectBlock(b: string | null): void { this.palliSnoBlock.set(b); }
  palliSnoReset(): void { this.palliSnoDistrict.set(null); this.palliSnoBlock.set(null); }

  /** All not-observed school entries across the whole scope (raw, with keys). */
  private palliSnoAll = computed(() =>
    this.scopeSchoolRows()
      .filter((e) => this.hash01(e.row.udise, 'p_sno') < 0.28)
      .map((e) => ({ districtKey: e.district, blockKey: e.block, row: e.row })),
  );

  /** KPI 2 level 1 — not-observed school COUNT per district. */
  readonly palliSnoByDistrict = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.palliSnoAll()) map.set(e.districtKey, (map.get(e.districtKey) ?? 0) + 1);
    return [...map.entries()]
      .map(([key, count], i) => ({ sno: i + 1, key, district: this.ds.titleCase(key), count }))
      .sort((a, b) => b.count - a.count)
      .map((r, i) => ({ ...r, sno: i + 1 }));
  });

  /** KPI 2 level 2 — not-observed school COUNT per block in the selected district. */
  readonly palliSnoByBlock = computed(() => {
    const dist = this.palliSnoDistrict();
    if (!dist) return [];
    const map = new Map<string, number>();
    for (const e of this.palliSnoAll()) if (e.districtKey === dist) map.set(e.blockKey, (map.get(e.blockKey) ?? 0) + 1);
    return [...map.entries()]
      .map(([key, count]) => ({ key, district: this.ds.titleCase(dist), block: this.ds.titleCase(key), count }))
      .sort((a, b) => b.count - a.count)
      .map((r, i) => ({ ...r, sno: i + 1 }));
  });

  /** KPI 2 level 3 — the school list for the selected district + block. */
  readonly palliSnoSchools = computed(() => {
    const dist = this.palliSnoDistrict();
    const blk = this.palliSnoBlock();
    if (!dist || !blk) return [];
    return this.palliSnoAll()
      .filter((e) => e.districtKey === dist && e.blockKey === blk)
      .map((e, i) => ({
        sno: i + 1, district: this.ds.titleCase(dist), block: this.ds.titleCase(blk),
        udise: e.row.udise, school: e.row.name, category: e.row.ctype ?? '—', observationCount: 0,
      }));
  });

  /** KPI 3 — officials-not-observed per district (assumed counts). */
  readonly palliOfficialsNotObserved = computed(() =>
    this.palliScopeDistricts().map((d, i) => {
      const total = 25 + Math.round(this.hash01(d, 'p_tot') * 25); // 25–50
      const notObs = Math.round(total * (0.08 + this.hash01(d, 'p_ono') * 0.22)); // 8–30%
      const observed = total - notObs;
      const pct = total ? Math.round((notObs / total) * 1000) / 10 : 0;
      return { sno: i + 1, district: this.ds.titleCase(d), total, observed, notObs, pct };
    }),
  );

  // ---- KPI 3 District → Designation → Officials drill ----
  /** Selected district + designation within the KPI-3 officials-not-observed drill. */
  readonly palliOnoDistrict = signal<string | null>(null);
  readonly palliOnoDesignation = signal<string | null>(null);
  palliOnoSelect(district: string, designation: string): void { this.palliOnoDistrict.set(district); this.palliOnoDesignation.set(designation); }
  palliOnoReset(): void { this.palliOnoDistrict.set(null); this.palliOnoDesignation.set(null); }

  /** Number of officials of a designation in a district who made 0 observations. */
  private palliOnoCount(district: string, designation: string): number {
    const base = 2 + Math.round(this.hash01(`${district}|${designation}`, 'p_ono_n') * 6); // 2–8
    return base;
  }

  /** KPI 3 level 1 — District × designation not-observed counts (+ district total). */
  readonly palliOnoMatrix = computed(() =>
    this.palliScopeDistricts().map((d, i) => {
      const cells: Record<string, number> = {};
      let total = 0;
      for (const des of this.PALLI_DESIGNATIONS) { cells[des] = this.palliOnoCount(d, des); total += cells[des]; }
      return { sno: i + 1, key: d, district: this.ds.titleCase(d), cells, total };
    }),
  );

  /** KPI 3 level 2 — the officials (by name) who made 0 observations. */
  readonly palliOnoOfficials = computed(() => {
    const d = this.palliOnoDistrict();
    const des = this.palliOnoDesignation();
    if (!d || !des) return [];
    const n = this.palliOnoCount(d, des);
    const out: { sno: number; district: string; userName: string; designation: string; target: number; observed: number }[] = [];
    for (let i = 0; i < n; i++) {
      const seed = this.hash01(`${d}|${des}|${i}`, 'p_ono_u');
      const target = 20 + Math.round(seed * 40); // 20–60 target classes
      out.push({
        sno: i + 1, district: this.ds.titleCase(d),
        userName: this.palliOfficialName(d, des, i),
        designation: des, target, observed: 0,
      });
    }
    return out;
  });

  /** Deterministic official display name for the KPI-3 drill. */
  private palliOfficialName(district: string, designation: string, idx: number): string {
    const first = ['Arun', 'Priya', 'Kumar', 'Devi', 'Raja', 'Lakshmi', 'Suresh', 'Meena', 'Vijay', 'Geetha'];
    const code = designation.replace(/[^A-Z]/g, '').slice(0, 3) || 'OFF';
    const h = Math.floor(this.hash01(`${district}|${designation}|${idx}`, 'nm') * first.length);
    return `${first[h]} (${code}-${100 + idx})`;
  }

  /** KPI 4 — schools observed 3+ times, with per-designation observation counts. */
  readonly palliSchools3Plus = computed(() => {
    const rows = this.scopeSchoolRows().filter((e) => this.hash01(e.row.udise, 'p_s3') < 0.6);
    return rows.map((e, i) => {
      const cells: Record<string, number> = {};
      let total = 0;
      for (const des of this.PALLI_DESIGNATIONS) {
        const c = Math.round(this.hash01(e.row.udise, des) * 4); // 0–4 observations
        cells[des] = c; total += c;
      }
      return {
        sno: i + 1, district: this.ds.titleCase(e.district), block: this.ds.titleCase(e.block),
        udise: e.row.udise, school: e.row.name, category: e.row.ctype ?? '—', cells, total,
      };
    }).filter((r) => r.total >= 3);
  });

  // ---- KPI 4 observation-detail popup (user details for a school + designation) ----
  readonly palliObsPopup = signal<{
    school: string; udise: string; district: string; designation: string;
    officials: { sno: number; userName: string; date: string; classObserved: string }[];
  } | null>(null);
  readonly palliObsPopupOpen = computed(() => this.palliObsPopup() !== null);
  closePalliObsPopup(): void { this.palliObsPopup.set(null); }

  /** Open the user-detail popup for a KPI-4 cell (school × designation count). */
  openPalliObsPopup(row: { udise: string; school: string; district: string }, designation: string, count: number): void {
    if (!count) return;
    const classes = ['Class 1-A', 'Class 2-B', 'Class 3-A', 'Class 4-B', 'Class 5-A', 'Class 6-B', 'Class 7-A', 'Class 8-B'];
    const officials = Array.from({ length: count }, (_, i) => {
      const seed = this.hash01(`${row.udise}|${designation}|${i}`, 'p_s3_u');
      const day = 1 + Math.floor(seed * 27);
      return {
        sno: i + 1,
        userName: this.palliOfficialName(row.district, designation, i),
        date: `${String(day).padStart(2, '0')}-09-2026`,
        classObserved: classes[Math.floor(this.hash01(`${row.udise}|${designation}|${i}`, 'cls') * classes.length)],
      };
    });
    this.palliObsPopup.set({
      school: row.school, udise: row.udise, district: row.district, designation, officials,
    });
  }

  /** KPI 5/6 — district+designation combos below / at-or-above 75%. */
  private palliPerformerRows(low: boolean) {
    const out: { sno: number; district: string; designation: string; target: number; observed: number; pct: number }[] = [];
    let n = 0;
    for (const d of this.palliScopeDistricts()) {
      for (const des of this.PALLI_DESIGNATIONS) {
        const pct = this.palliObsPct(d, des);
        if (low ? pct < 75 : pct >= 75) {
          const officials = 8 + Math.round(this.hash01(`${d}|${des}`, 'off') * 14);
          const target = officials * 40;
          out.push({ sno: ++n, district: this.ds.titleCase(d), designation: des, target, observed: Math.round(target * pct / 100), pct });
        }
      }
    }
    return out;
  }
  readonly palliLowPerformerRows = computed(() => this.palliPerformerRows(true));
  readonly palliTopPerformerRows = computed(() => this.palliPerformerRows(false));

  // ---- Palli footer totals ----
  private sumBy<T>(rows: T[], pick: (r: T) => number): number { return rows.reduce((s, r) => s + (pick(r) || 0), 0); }
  private avgBy<T>(rows: T[], pick: (r: T) => number): number { return rows.length ? Math.round((this.sumBy(rows, pick) / rows.length) * 10) / 10 : 0; }

  /** Column totals for the KPI-1 district × designation matrix (avg % per designation + overall). */
  readonly palliMatrixTotals = computed(() => {
    const rows = this.palliDistrictMatrix();
    const cells: Record<string, number> = {};
    for (const des of this.PALLI_DESIGNATIONS) cells[des] = this.avgBy(rows, (r) => r.cells[des]);
    return { cells, overall: this.avgBy(rows, (r) => r.overall) };
  });
  readonly palliOnoMatrixTotals = computed(() => {
    const rows = this.palliOnoMatrix();
    const cells: Record<string, number> = {};
    for (const des of this.PALLI_DESIGNATIONS) cells[des] = this.sumBy(rows, (r) => r.cells[des]);
    return { cells, total: this.sumBy(rows, (r) => r.total) };
  });
  readonly palliOnoTotals = computed(() => {
    const rows = this.palliOfficialsNotObserved();
    return { total: this.sumBy(rows, (r) => r.total), observed: this.sumBy(rows, (r) => r.observed), notObs: this.sumBy(rows, (r) => r.notObs), pct: this.avgBy(rows, (r) => r.pct) };
  });
  readonly palliS3Totals = computed(() => {
    const rows = this.palliSchools3Plus();
    const cells: Record<string, number> = {};
    for (const des of this.PALLI_DESIGNATIONS) cells[des] = this.sumBy(rows, (r) => r.cells[des]);
    return { cells, total: this.sumBy(rows, (r) => r.total), count: rows.length };
  });
}

/** Topic tabs for the drill-down table, matching the prototype's lenses. */
export type DrillTopic = 'enr' | 'att' | 'inf' | 'dinf' | 'aca' | 'sch'
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
  fmt: 'num' | 'num1' | 'pct' | 'pctSigned' | 'ptSigned' | 'text' | 'yesno' | 'presAbs';
  bar?: boolean;
  barMax?: number;
  tone?: (value: number, row: DrillRow) => 'bad' | 'warn' | 'good' | undefined;
}

/**
 * Context passed to a per-KPI school predicate: the enrolment roll row plus the
 * school's infrastructure return (joined by UDISE), so infra flag KPIs can be
 * evaluated against real per-school data.
 */
export interface KpiSchoolCtx {
  row: SchoolRow;
  infS?: { entered?: number; types?: Record<string, { available?: number; good?: number; functional?: number; demolish?: number; needRepair?: number }> } | undefined;
  dig?: { ictSchools?: number; internet?: number; noInternet?: number; functional?: number; notFunctional?: number } | undefined;
  atS?: { attendance?: number; teacherAttendance?: number; compliance?: number } | undefined;
}

/** One row of the drill-down table: a district, block, or school. */
export interface DrillRow {
  key: string;
  udise?: string;
  name: string;
  level: 'district' | 'block' | 'school';
  /** Parent district (title-cased) — only set for per-KPI school-list rows. */
  district?: string;
  /** Parent block (title-cased) — only set for per-KPI school-list rows. */
  block?: string;
  /** School category type (e.g. Primary / Upper Primary …) — per-KPI list rows. */
  ctype?: string;
  /** Infra flag KPI per-school values (per-KPI list rows). */
  infZeroClassroom?: number;
  infNeedsAny?: number;
  infNoCompound?: number;
  /** Infra facility availability columns (per-KPI list rows). */
  facClassrooms?: number;
  facBoysToilet?: number;
  facGirlsToilet?: number;
  facCwsnToilet?: number;
  facLabs?: number;
  facWater?: number;
  facCompoundWall?: number;
  facDemolish?: number;
  facKitchen?: number;
  /** Attendance list derived columns (per-KPI list rows). */
  stuPresentPct?: number;
  stuAbsentPct?: number;
  studentsAbsent?: number;
  tchPresentPct?: number;
  tchAbsentPct?: number;
  teacherPresent?: number;
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
  /** Palli Parvai KPI fields (spec-driven). */
  palliClassObsPct?: number;
  palliSchoolsNotObsPct?: number;
  palliOfficialsNotObsPct?: number;
  palliSchools3PlusPct?: number;
  palliLowPerformers?: number;
  palliTopPerformers?: number;

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
  /** Academic Performance (spec) fields. */
  acaPassPct?: number;
  acaExamToExam?: number;
  acaCoveragePct?: number;
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
  /** ICT status labels for the Digital Infrastructure school list. */
  ictFunctionalStatus?: string;
  ictInternetStatus?: string;
  ictFunctionalPct?: number;
  ictInternetPct?: number;
  infNoPlayground?: number;
  infNoFirstAid?: number;
  infNoFire?: number;
  infNoRamp?: number;
  infClassShortage?: number;
  infGapPct?: number;
  smcEmergencyOpen?: number;

  // ---- new Enrollment drill + KPI fields ----
  boys?: number;
  girls?: number;
  ptr?: number;                 // pupil-teacher ratio (students/teaching)
  notMoved?: number;            // students not moved to next class (transition leakage)
  transitionPendingPct?: number; // % of schools not meeting 100% transition
  schoolsNotMarkedPct?: number; // attendance: 100 - compliance
  // school-count aggregates (counted over schools in scope)
  zeroEnrol?: number;
  zeroTeacher?: number;
  singleTeacher?: number;
  under10?: number;
  ptrOver60?: number;
  enrolIncreaseSchools?: number;  // schools with enrollment increase vs last year
  enrolDeclinedSchools?: number;  // schools with declined enrollment vs last year

  // ---- new Attendance drill fields ----
  boysAbsent?: number;
  girlsAbsent?: number;
  teacherAbsent?: number;         // teachers absent (today / latest)
  teacherLong30?: number;         // teachers absent 30+ days (est.)
  markedStatus?: string;          // 'Marked' | 'Partial' | 'Not marked'
}

/** One row of the per-KPI school list (flag-KPI drill-down). */
export interface KpiSchoolRow {
  district: string;
  school: string;
  udise: string;
  boys: number;
  girls: number;
  students: number;
  teaching: number;
  ptr: number;
  /** Year-over-year enrolment change, percent (signed). */
  changePct: number;
  /** Year-over-year enrolment change, absolute students (signed). */
  changeAbs: number;
  /** Potential dropouts (students absent 15+ days), joined from attendance. */
  drop: number;
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
