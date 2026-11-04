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
  PalliObsAsset, PalliObsCol,
  AcademicReal, ThiranReal, PalliReal, DigitalInfraReal,
  InfraRealAsset, InfraReal,
  SmcRealAsset, SmcReal,
  SmcPeriodKey, SmcPeriodCol, SmcDetailAsset, SmcMeetingCol, SmcResolutionCol,
  DpsRealAsset, DpsReal, DpsApplication,
  AcisRealAsset, AcisReal, AcisStudentsAsset, AcisStudentRow, AcisStudentCol,
  AcisPdAsset, AcisPdReal, AcisPdCol,
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
  /** Palli observation line list — loaded lazily on first use. */
  private readonly _palliObs = signal<PalliObsAsset | null>(null);
  private palliObsRequested = false;
  private readonly _digitalReal = signal<DigitalInfraRealAsset | null>(null);
  private readonly _infraReal = signal<InfraRealAsset | null>(null);
  private readonly _smcReal = signal<SmcRealAsset | null>(null);
  private readonly _dpsReal = signal<DpsRealAsset | null>(null);
  private readonly _acisReal = signal<AcisRealAsset | null>(null);
  /** Real potential dropouts (EMIS PD report) — small, loaded eagerly. */
  private readonly _acisPd = signal<AcisPdAsset | null>(null);
  /** Per-student common-pool roster — ~6 MB gzipped, loaded on first drill. */
  private readonly _acisStudents = signal<AcisStudentsAsset | null>(null);
  private acisStudentsRequested = false;
  /** Per-meeting / per-resolution SMC detail — loaded on first SMC drill. */
  private readonly _smcDetail = signal<SmcDetailAsset | null>(null);
  private smcDetailRequested = false;
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
    loadAsset<DpsRealAsset>('assets/dps-real.json')
      .then((a) => this._dpsReal.set(a)).catch(() => {});
    loadAsset<AcisRealAsset>('assets/acis-real.json')
      .then((a) => this._acisReal.set(a)).catch(() => {});
    loadAsset<AcisPdAsset>('assets/acis-pd.json')
      .then((a) => this._acisPd.set(a)).catch(() => {});
  }

  /**
   * Fetch the per-student common-pool roster. Called when the ACiS drill opens
   * rather than at startup: it is by far the largest asset and only the drill
   * (which filters by school type / gender / class / CWSN / UMIS) needs it.
   */
  loadAcisStudents(): void {
    if (this.acisStudentsRequested) return;
    this.acisStudentsRequested = true;
    loadAsset<AcisStudentsAsset>('assets/acis-students.json')
      .then((a) => this._acisStudents.set(a))
      .catch(() => { this.acisStudentsRequested = false; });
  }

  /**
   * Fetch the per-meeting / per-resolution SMC detail. Only the SMC drill needs
   * it (school lists, department abstracts, period-exact filtering); the tiles
   * run off the pre-bucketed windows in `smc-real.json`.
   */
  loadSmcDetail(): void {
    if (this.smcDetailRequested) return;
    this.smcDetailRequested = true;
    loadAsset<SmcDetailAsset>('assets/smc-detail.json')
      .then((a) => this._smcDetail.set(a))
      .catch(() => { this.smcDetailRequested = false; });
  }

  /**
   * Fetch the Palli Parvai observation line list (~3 MB gzipped). Called when
   * the "Observation line list" tab opens; the other Palli views don't need it.
   */
  loadPalliObs(): void {
    if (this.palliObsRequested) return;
    this.palliObsRequested = true;
    this.palliObsError.set('');
    loadAsset<PalliObsAsset>('assets/palli-obs.json')
      .then((a) => {
        // An older palli-obs.json (pre user / duration columns) has no users[];
        // using it would leave the user-wise views silently empty.
        if (!Array.isArray(a?.users) || !a.fields?.includes('user') || !a.fields?.includes('durSec')) {
          this.palliObsError.set('The observation data on the server is an older version without user or duration details. Re-run the Palli ingest (node scripts/ingest-real.mjs palli-obs), rebuild, and reload.');
          this.palliObsRequested = false;
          return;
        }
        this._palliObs.set(a);
      })
      .catch(() => {
        this.palliObsError.set('Could not load the observation data (assets/palli-obs.json).');
        this.palliObsRequested = false;
      });
  }
  /** Why the observation data could not be used ('' when fine). */
  readonly palliObsError = signal('');

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
    { id: 'thiran', label: 'THIRAN', icon: 'fa-solid fa-user-graduate' },
    { id: 'scholarship', label: 'Scholarship', icon: 'fa-solid fa-award' },
    { id: 'smc', label: 'SMC', icon: 'fa-solid fa-people-group' },
    { id: 'palli', label: 'Palli Parvai', icon: 'fa-solid fa-clipboard-check' },
    { id: 'dps', label: 'Recognition Order', icon: 'fa-solid fa-file-circle-check' },
    { id: 'acis', label: 'All Children in School', icon: 'fa-solid fa-children' },
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
    this.dpsUnit.set(null);
    this.acisUnit.set(null);
    this.smcUnit.set(null);
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
          // TEMPORARILY DISABLED (on request): Low / Top performer columns
          // { key: 'palliLowPerformers', label: 'Low performers (<75%)', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          // { key: 'palliTopPerformers', label: 'Top performers (≥75%)', fmt: 'num', tone: (v) => (v > 0 ? 'good' : undefined) },
        ];
      case 'dps':
        return [
          { key: 'dpsTotal', label: 'Total pending applications', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'dpsDistrictPending', label: 'District pending', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'dpsStatePending', label: 'State pending', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'dpsLt15', label: 'Pending < 15 days', fmt: 'num' },
          { key: 'dpsD15to30', label: 'Pending 15–30 days', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'dpsGt30', label: 'Pending > 30 days', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
        ];
      case 'acis':
        return [
          { key: 'acisPool', label: 'Students in Common Pool', fmt: 'num', tone: (v) => (v > 0 ? 'warn' : 'good') },
          { key: 'acisSurveyed', label: 'Surveyed', fmt: 'num' },
          { key: 'acisPendingSurvey', label: 'Pending survey', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
          { key: 'acisSurveyPct', label: 'Survey completion %', fmt: 'pct', bar: true, barMax: 100, tone: (v) => (v < 80 ? 'bad' : v < 95 ? 'warn' : 'good') },
          { key: 'acisAdmitted', label: 'Admitted to schools', fmt: 'num', tone: (v) => (v > 0 ? 'good' : undefined) },
          { key: 'acisToBeAdmitted', label: 'To be admitted', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
          { key: 'acisPd', label: 'Potential dropouts', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
          { key: 'acisPdRepeat', label: 'PD repeaters', fmt: 'num', tone: (v) => (v > 0 ? 'bad' : 'good') },
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
    { key: 'stuPresentPct', label: 'Student present %', fmt: 'pct', tone: (v) => (v < 60 ? 'bad' : v < 85 ? 'warn' : 'good') },
    { key: 'boysAbsent', label: 'Boys absent', fmt: 'num' },
    { key: 'girlsAbsent', label: 'Girls absent', fmt: 'num' },
    { key: 'studentsAbsent', label: 'Total students absent', fmt: 'num' },
    { key: 'teaching', label: 'Total Teachers', fmt: 'num' },
    { key: 'tchPresentPct', label: 'Teacher present %', fmt: 'pct', tone: (v) => (v < 60 ? 'bad' : v < 90 ? 'warn' : 'good') },
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
        ...this.smcSchoolFields(this.ds.schoolRowsFor(key), key, null, undefined, 'district'),
        ...this.pdBaseFields(this.ds.schoolRowsFor(key)),
        ...this.enrolI12Fields(this.ds.schoolRowsFor(key)),
        ...this.enrollmentFields(this.ds.schoolRowsFor(key)),
        ...this.attendanceFields(atNode, d.boys, d.girls, d.teaching),
        ...this.attBelow60Counts(key),
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
        ...this.smcSchoolFields(this.ds.schoolRowsFor(dist, b.block), dist, b.block, undefined, 'block'),
        ...this.pdBaseFields(this.ds.schoolRowsFor(dist, b.block)),
        ...this.enrolI12Fields(this.ds.schoolRowsFor(dist, b.block)),
        ...this.enrollmentFields(this.ds.schoolRowsFor(dist, b.block)),
        ...this.attendanceFields(atNode, b.boys, b.girls, b.teaching),
        ...this.attBelow60Counts(dist, b.block),
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
        ...this.smcSchoolFields([s], dist, blk, s.udise, 'school'),
        ...this.pdBaseFields([s]),
        ...this.enrolI12Fields([s]),
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
   * Below-60% attendance rule, shared by the KPI predicate, the per-school
   * flag and the district/block roll-up so the three can never disagree.
   * Schools that never marked attendance (compliance 0) report 0% for both
   * students and teachers; that is "not marked", not "low attendance", and is
   * already its own KPI — so they are excluded here.
   */
  private isBelow60(atS: { attendance?: number; teacherAttendance?: number; compliance?: number } | undefined, who: 'student' | 'teacher'): boolean {
    if (!atS || (atS.compliance ?? 0) <= 0) return false;
    const v = who === 'student' ? atS.attendance : atS.teacherAttendance;
    return (v ?? 100) < 60;
  }

  /**
   * Count of schools under 60% student / teacher attendance for a district
   * (all its blocks) or a single block, from the REAL per-school attendance
   * roll. Schools with no attendance record are not counted.
   */
  private attBelow60Counts(district: string, block?: string): Pick<DrillRow, 'attStudentBelow60' | 'attTeacherBelow60'> {
    const roll = this.at.schoolsByBlock();
    if (!roll) return { attStudentBelow60: 0, attTeacherBelow60: 0 };
    const keys = block ? [`${district}||${block}`] : Object.keys(roll).filter((k) => k.startsWith(`${district}||`));
    let stu = 0, tch = 0;
    for (const k of keys) {
      for (const s of roll[k] ?? []) {
        if (this.isBelow60(s, 'student')) stu++;
        if (this.isBelow60(s, 'teacher')) tch++;
      }
    }
    return { attStudentBelow60: stu, attTeacherBelow60: tch };
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
   * Initiative module fields (THIRAN, Scholarship, SMC, Palli Parvai) for a
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
   * Real EMIS data fields (Academic, THIRAN, Palli, Digital Infra) for a row.
   * Looks up the matching scope: district rows by UPPERCASE name, block rows by
   * `DISTRICT||UPPERCASE_BLOCK`, school rows by UDISE. Returns only the fields
   * the real data supports; falls back to {} (keeping synthetic/other values)
   * when a dataset or key is missing. Real data takes precedence over synthetic.
   */
  private realFields(
    dist: string | null, block: string | null, udise: string | undefined,
    level: 'district' | 'block' | 'school',
  ): Partial<DrillRow> {
    const pick = <T>(asset: { districts: Record<string, T>; blocks: Record<string, T>; schools: Record<string, T> } | null): T | null =>
      this.pickScope<T>(asset, dist, block, udise, level);

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
      // Everything SMC is read through the active rolling window. `all` is the
      // full export and is the default, so the headline figures are unchanged.
      const K = SmcPeriodCol;
      const a = smc.p?.[this.smcPeriod()] ?? smc.p?.all ?? null;
      const rate = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : undefined);
      if (a) {
        const closed = a[K.resolved] + a[K.withdrawn];
        out.smcRaised = a[K.raised];
        out.smcClosed = closed;
        out.smcPending = Math.max(0, a[K.raised] - closed);
        out.smcClosureRate = rate(closed, a[K.raised]);
        // Emergency KPI = emergency resolutions NOT closed (per requirement)
        out.smcEmergency = a[K.emgUnresolved];
        out.smcEmergencyOpen = a[K.emgUnresolved];
        out.smcEmergencyRaised = a[K.emgRaised];
        out.smcEmergencyResolved = a[K.emgResolved];
        // completion % excludes withdrawn resolutions from the base
        out.smcEmergencyClosureRate = rate(a[K.emgResolved], a[K.emgResolved] + a[K.emgUnresolved]);
        out.smcOtherRaised = a[K.othRaised];
        out.smcOtherResolved = a[K.othResolved];
        out.smcOtherOpen = a[K.othUnresolved];
        out.smcOtherClosureRate = rate(a[K.othResolved], a[K.othResolved] + a[K.othUnresolved]);
        out.smcMeetings = a[K.meetings];
        out.smcSchoolsHeld = a[K.schoolsHeld];
        out.smcPresent = a[K.present];
        out.smcAbsent = a[K.absent];
        out.smcVacant = a[K.vacant];
        // vacant seats are not absences, so they stay out of the denominator
        out.smcMeetAttendPct = rate(a[K.present], a[K.present] + a[K.absent]);
      } else {
        out.smcRaised = smc.raised;
        out.smcClosed = smc.closed;
        out.smcPending = smc.pending;
        out.smcClosureRate = smc.closureRate ?? undefined;
        out.smcEmergency = smc.emergencyOpen;
        out.smcEmergencyOpen = smc.emergencyOpen;
      }
    }

    const dps = pick<DpsReal>(this._dpsReal());
    if (dps) {
      out.dpsTotal = dps.total;
      out.dpsDistrictPending = dps.districtPending;
      out.dpsStatePending = dps.statePending;
      out.dpsLt15 = dps.lt15;
      out.dpsD15to30 = dps.d15to30;
      out.dpsGt30 = dps.gt30;
      out.dpsAvgDays = dps.avgDays ?? undefined;
      out.dpsMaxDays = dps.maxDays;
    }

    const acis = pick<AcisReal>(this._acisReal());
    if (acis) {
      out.acisPool = acis.pool;
      out.acisSurveyed = acis.surveyed;
      out.acisPendingSurvey = acis.pendingSurvey;
      out.acisSurveyPct = acis.surveyPct ?? undefined;
      out.acisAdmitted = acis.admitted;
      out.acisBridged = acis.bridged;
      out.acisBridgeDays = acis.bridgeDays ?? undefined;
      out.acisToBeAdmitted = acis.toBeAdmitted;
      out.acisToBeValidated = acis.toBeValidated;
      out.acisWithReason = acis.withReason;
      out.acisDeptTaken = acis.deptTaken;
      out.acisDeptPending = acis.deptPending;
      out.acisCwsn = acis.cwsn;
      out.acisUmis = acis.umis;
      // dropouts not re-enrolled = in the common pool and not admitted back
      out.acisDropOut = Math.max(0, acis.pool - acis.admitted);
    }

    // Real potential dropouts. Units with no PD node have zero PD students
    // (the report lists every PD child), so default to 0 rather than blank.
    if (this._acisPd()) {
      const pd = pick<AcisPdReal>(this._acisPd());
      out.acisPd = pd?.pd ?? 0;
      out.acisPdRepeat = pd?.repeaters ?? 0;
      out.acisPdWithReason = pd?.withReason ?? 0;
    }

    return out;
  }

  /**
   * Look a real asset up at the row's scope: districts by UPPERCASE name,
   * blocks by `DISTRICT||UPPERCASE_BLOCK`, schools by UDISE.
   */
  private pickScope<T>(
    asset: { districts: Record<string, T>; blocks: Record<string, T>; schools: Record<string, T> } | null,
    dist: string | null, block: string | null, udise: string | undefined,
    level: 'district' | 'block' | 'school',
  ): T | null {
    if (!asset) return null;
    if (level === 'school') return (udise && asset.schools[udise]) || null;
    if (level === 'block') {
      return asset.blocks[`${(dist ?? '').toUpperCase()}||${(block ?? '').toUpperCase()}`] ?? null;
    }
    return (dist && asset.districts[dist.toUpperCase()]) || null;
  }

  /**
   * Managements the SMC programme covers. The export only ever contains
   * government / local-body / welfare schools, and this set is the denominator
   * for "schools where meetings were NOT held" — using the whole enrolment roll
   * would count private schools that never had an SMC to begin with.
   */
  private readonly smcManagements = computed(
    () => new Set(this._smcReal()?.managements ?? []),
  );

  /**
   * Composite school grant slab for a school, in rupees. These are the
   * published enrolment slabs; the allocation is therefore a real rule applied
   * to the real roll. (Only the utilised share is synthesized — see below.)
   */
  private compositeGrant(students: number): number {
    if (students <= 0) return 0;
    if (students <= 30) return 10_000;
    if (students <= 100) return 25_000;
    if (students <= 250) return 50_000;
    if (students <= 1000) return 75_000;
    return 100_000;
  }

  /**
   * SMC fields that need the enrolment roll for the scope (which `realFields`
   * does not have): the "meetings not held" denominator, and the maintenance /
   * composite grant figures.
   *
   * **Grant utilisation is ASSUMED.** No grant ledger exists in the SMC export,
   * so the utilised share is a deterministic 55–95% of the allocation per
   * school (stable across renders). The allocation itself is the real slab rule
   * above applied to real enrolment. Rupee figures are reported in ₹ lakh.
   */
  private smcSchoolFields(
    rows: SchoolRow[], dist: string | null, block: string | null,
    udise: string | undefined, level: 'district' | 'block' | 'school',
  ): Partial<DrillRow> {
    const mgmts = this.smcManagements();
    if (!mgmts.size) return {};
    let eligible = 0, alloc = 0, used = 0;
    for (const s of rows) {
      if (!mgmts.has(s.mgmt ?? '')) continue;
      eligible++;
      const a = this.compositeGrant(s.students ?? 0);
      alloc += a;
      used += a * (0.55 + this.hash01(s.udise, 'smc-grant') * 0.4);
    }
    const node = this.pickScope<SmcReal>(this._smcReal(), dist, block, udise, level);
    const held = node?.p?.[this.smcPeriod()]?.[SmcPeriodCol.schoolsHeld] ?? 0;
    const lakh = (n: number) => Math.round((n / 100_000) * 10) / 10;
    return {
      smcEligibleSchools: eligible,
      smcSchoolsNotHeld: Math.max(0, eligible - held),
      smcGrantAllocated: lakh(alloc),
      smcGrantUtilised: lakh(used),
      smcGrantUtilPct: alloc ? Math.round((used / alloc) * 1000) / 10 : undefined,
    };
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
    // Below 60% student / teacher attendance (real per-school record; unmarked schools excluded)
    a_s60: ({ atS }) => this.isBelow60(atS, 'student'),
    a_t60: ({ atS }) => this.isBelow60(atS, 'teacher'),

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
    // Schemes & grievance
    bx: ({ row }) => this.assume(row.udise, 'bx'),
    cm_o: ({ row }) => this.assume(row.udise, 'cm_o'),
    cm_c: ({ row }) => this.assume(row.udise, 'cm_c'),
    h_o: ({ row }) => this.assume(row.udise, 'h_o'),
    h_c: ({ row }) => this.assume(row.udise, 'h_c'),
    // THIRAN / Scholarship
    t_sc: ({ row }) => this.assume(row.udise, 't_sc'),
    sh_f: ({ row }) => this.assume(row.udise, 'sh_f'),
    sh_w: ({ row }) => this.assume(row.udise, 'sh_w'),
    sh_n: ({ row }) => this.assume(row.udise, 'sh_n'),
    sh_a: ({ row }) => this.assume(row.udise, 'sh_a'),
    // SMC / Palli
    m_e: ({ row }) => this.assume(row.udise, 'm_e'),
    // Palli Parvai low/top performer flags — TEMPORARILY DISABLED (on request)
    // p_low: ({ row }) => this.assume(row.udise, 'p_low'),
    // p_top: ({ row }) => !this.assume(row.udise, 'p_low'),
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
    // Schemes & grievance
    bx: 0.06, cm_o: 0.09, cm_c: 0.03, h_o: 0.07, h_c: 0.02,
    // THIRAN / Scholarship
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
    atS?: { attendance?: number; teacherAttendance?: number; compliance?: number; absentees?: number; dropoutRisk?: number } | undefined,
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
      // below-60% flags (1 = this school is below the line); roll up as counts
      attStudentBelow60: this.isBelow60(atS, 'student') ? 1 : 0,
      attTeacherBelow60: this.isBelow60(atS, 'teacher') ? 1 : 0,
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
  private readonly REAL_SOURCE_KPIS = new Set(['zenr', 'ztea', 'stea', 'u10', 'ptr60', 'einc', 'edec', 'a_s', 'a_t', 'a_nm', 'a_s60', 'a_t60', 'i_t', 'i_w', 'i_cl', 'i_d', 'gap', 'i_need', 'g_i', 'g_y', 'g_n', 'g_nf', 'g_fp', 'g_ip']);

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
        ...this.smcSchoolFields([s], dist, blk, s.udise, 'school'),
        ...this.pdBaseFields([s]),
        ...this.enrolI12Fields([s]),
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

    // ---- THIRAN : total students identified ----
    const t = m.thiran;
    if (t.students > 0) {
      const share = this.pct(t.students, this.enrolNode()?.students ?? 0);
      out.push({
        id: 'thiranTotal', severity: 'warn', icon: 'fa-solid fa-graduation-cap',
        text: `${this.fmt(this.scale(t.students))} students identified under THIRAN `
          + `(${share}% of enrolment) across ${this.fmt(this.scale(t.schools))} schools`,
        action: 'View THIRAN', topic: 'aca', rowKey: null, anchor: 'rv-thiran',
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

  // ---- 1. THIRAN ----
  readonly thiranKpis = computed(() => {
    const t = this.moduleNode()?.thiran;
    if (!t) return [];
    return [
      { label: 'THIRAN Students Identified', value: this.fmt(this.scale(t.students)), icon: 'fa-solid fa-user-graduate' },
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

  // 'p_low' / 'p_top' TEMPORARILY DISABLED (on request) — see kpi-catalog.model.ts
  readonly palliDrillKpis = new Set(['p_co', 'p_sno', 'p_ono', 'p_s3', 'p_dur']);
  hasPalliDrill(id: string): boolean { return this.palliDrillKpis.has(id); }
  /** The Palli KPI tabs (id + short label) for switching tables within the drill. */
  readonly palliKpiTabs: { id: string; label: string }[] = [
    { id: 'p_co', label: '% Class Observation' },
    { id: 'p_sno', label: '% Schools Not Observed' },
    { id: 'p_ono', label: '% Officials Not Observed' },
    { id: 'p_s3', label: '% Schools 3+ Times' },
    { id: 'p_dur', label: 'Observation duration' },
    // TEMPORARILY DISABLED (on request):
    // { id: 'p_low', label: 'Low performers' },
    // { id: 'p_top', label: 'Top performers' },
  ];
  setPalliKpi(id: string): void { this.palliKpiId.set(id); this.palliDesignation.set(null); this.palliSnoReset(); this.palliOnoReset(); this.palliLlClose(); this.palliCloseDurList(); if (id === 'p_dur') { this.palliDurDesig.set(''); this.loadPalliObs(); } }
  openPalliDrill(id: string): void { if (this.hasPalliDrill(id)) { this.palliKpiId.set(id); this.palliDesignation.set(null); this.palliSnoReset(); this.palliOnoReset(); this.palliLlClose(); this.palliCloseDurList(); if (id === 'p_dur') { this.palliDurDesig.set(''); this.loadPalliObs(); } } }
  closePalliDrill(): void { this.palliKpiId.set(null); this.palliDesignation.set(null); this.palliSnoReset(); this.palliOnoReset(); this.palliObsPopup.set(null); this.palliLlClose(); this.palliCloseDurList(); }
  /** Opening a designation (matrix level) loads the real observation data for the levels below. */
  selectPalliDesignation(d: string | null): void { this.palliLlClose(); this.palliDesignation.set(d); if (d) this.loadPalliObs(); }

  /** Human label for the open Palli KPI (from the catalog). */
  readonly palliKpiLabel = computed(() => {
    const id = this.palliKpiId();
    if (!id) return '';
    if (id === 'p_dur') return 'Observation duration';   // a view, not a catalog KPI
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

  // ================= PALLI — USER-WISE DRILL + DURATION KPI (REAL, User Stories 4–8) =================
  /**
   * Source: `palli-obs.json`, built from PP_Oct_2026_Start and End 20261103.xlsx —
   * one row per observation in October 2026 WITH observer and start / end time.
   *
   * "% of Class Observation" drill (US 8 breadcrumb):
   *   All Designations (district × designation matrix — still ASSUMED, unchanged)
   *   → Designation (district rows — REAL from this file)
   *   → District   (user list, US 4)
   *   → User       (the user's school observations, US 5)
   *   → View Report (observation details, US 6)
   * plus the "Observation duration" tab (US 7).
   *
   * Counting rules (applied identically at every level so totals reconcile):
   *   Visited   = observation records in the date range (every row counts)
   *   Duration  = end − start; valid when 0 < duration ≤ maxValidMinutes (8 h).
   *               Invalid rows are excluded from all duration categories and
   *               shown separately as "Invalid duration".
   *   Target    = per-officer monthly target from the designation target sheet
   *               (classes per month ÷ sanctioned posts) × officers, prorated by
   *               the number of days in the date range ÷ 31.
   *   Officers  = distinct users with ≥ 1 observation (officers who never
   *               observed are not in the export and cannot be counted).
   *   District  = from the enrolment roll by UDISE (export text as fallback).
   * Not in the export: Section, report findings, observation id.
   */
  readonly palliLlLoading = computed(() => !this._palliObs());
  /** Sessions longer than this (minutes) count as invalid timestamps. */
  readonly palliMaxValidMinutes = computed(() => this._palliObs()?.maxValidMinutes ?? 480);
  /** True when the Palli card is showing real data (the drill below the matrix, or the duration tab). */
  readonly palliShowingReal = computed(() => this.palliKpiId() === 'p_dur'
    || (this.palliKpiId() === 'p_co' && !!this.palliDesignation()));

  /** Drill designation label → the export's raw `stackholders` values. */
  private readonly PALLI_DESIG_EXPORT: Record<string, (raw: string) => boolean> = {
    'CEO': (r) => r === 'CEO',
    'DEO – Secondary': (r) => r === 'DEO (Secondary)',
    'DEO – Primary': (r) => r === 'DEO (Elementary)',
    'APO': (r) => /^APO\b/i.test(r),
    'DC': (r) => /^DC(\s*-\s*\d+)?$/i.test(r),
    'BEO': (r) => r === 'BEO',
    'BRTE': (r) => r === 'BRTE',
    'DIET Principal': (r) => /^DIET PRINCIPAL$/i.test(r),
  };
  /** Drill designation label → its row in the designation target sheet. */
  private readonly PALLI_TARGET_OFFICIAL: Record<string, string> = {
    'CEO': 'CEO', 'DEO – Secondary': 'DEO (Secondary)', 'DEO – Primary': 'DEO (Elementary)',
    'APO': 'APO Secondary', 'DC': 'DC', 'BEO': 'BEO', 'BRTE': 'BRTE', 'DIET Principal': 'DIET Principal',
  };

  /** Monthly observation target per officer, by drill designation. */
  readonly palliMonthlyTarget = computed(() => {
    const out: Record<string, number> = {};
    const model = this._palliReal()?.targetModel ?? [];
    for (const [desig, official] of Object.entries(this.PALLI_TARGET_OFFICIAL)) {
      const t = model.find((m) => m.official === official);
      out[desig] = t && t.sanctionedPosts ? Math.round(t.classesPerMonth / t.sanctionedPosts) : 0;
    }
    return out;
  });

  /** Drill designation for each export designation index (null = not one of the 8). */
  private readonly palliDesigOf = computed(() => {
    const a = this._palliObs();
    if (!a) return [] as (string | null)[];
    return a.desigs.map((raw) => this.PALLI_DESIGNATIONS.find((d) => this.PALLI_DESIG_EXPORT[d](raw)) ?? null);
  });

  /** District (roll name) of each school in the asset. */
  private readonly palliSchoolDistrict = computed(() => {
    const a = this._palliObs();
    if (!a) return [] as (string | null)[];
    const byUdise = new Map<string, string>();
    for (const blk of this.ds.data()?.blocks ?? []) {
      for (const row of this.ds.schoolRowsFor(blk.district, blk.block)) byUdise.set(row.udise, blk.district);
    }
    const byName = new Map(this.ds.districts().map((d) => [d.name.toUpperCase(), d.name] as const));
    return a.schools.map((s) => byUdise.get(s.u) ?? byName.get(s.d.toUpperCase()) ?? null);
  });

  // ---- filters (US 4 / 5 / 7 / 8) ----
  readonly palliDateFrom = signal('');
  readonly palliDateTo = signal('');
  /** Search box of the current level (user name / id, or school / UDISE). */
  readonly palliSearch = signal('');
  /** Duration category filter for the observation lists. */
  readonly palliDurFilter = signal<'all' | 'lt15' | '15to30' | 'ge30' | 'invalid'>('all');
  readonly palliDurOptions = [
    { label: 'All durations', value: 'all' },
    { label: 'Under 15 min', value: 'lt15' },
    { label: '15 to under 30 min', value: '15to30' },
    { label: '30 min or more', value: 'ge30' },
  ];
  palliClearFilters(): void {
    this.palliDateFrom.set(''); this.palliDateTo.set('');
    this.palliSearch.set(''); this.palliDurFilter.set('all');
  }
  readonly palliFiltered = computed(() => !!(this.palliDateFrom() || this.palliDateTo() || this.palliSearch())
    || this.palliDurFilter() !== 'all');

  private palliDayIso(day: number): string {
    const a = this._palliObs();
    return a ? new Date(Date.parse(`${a.baseDate}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10) : '';
  }
  private palliIsoDay(iso: string): number {
    const a = this._palliObs();
    return a ? Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${a.baseDate}T00:00:00Z`)) / 86400000) : 0;
  }
  /** Data window of the export (for the date pickers' min / max). */
  readonly palliObsWindow = computed(() => {
    const a = this._palliObs();
    if (!a || !a.observations.length) return { from: '', to: '' };
    let lo = Infinity, hi = -Infinity;
    for (const o of a.observations) { const d = o[PalliObsCol.day]; if (d < lo) lo = d; if (d > hi) hi = d; }
    return { from: this.palliDayIso(lo), to: this.palliDayIso(hi) };
  });
  /** Day bounds of the active date range. */
  private readonly palliDayRange = computed(() => {
    const w = this.palliObsWindow();
    const from = this.palliDateFrom() || w.from;
    const to = this.palliDateTo() || w.to;
    return { lo: from ? this.palliIsoDay(from) : -Infinity, hi: to ? this.palliIsoDay(to) : Infinity, from, to };
  });
  /** Target proration: days in range ÷ 31 (the export is one month, October). */
  readonly palliPeriodFactor = computed(() => {
    const r = this.palliDayRange();
    if (!Number.isFinite(r.lo) || !Number.isFinite(r.hi)) return 1;
    return Math.max(0, Math.min(31, r.hi - r.lo + 1)) / 31;
  });

  /** Observations in the date range whose observer is one of the 8 drill designations. */
  private readonly palliRangeObs = computed(() => {
    const a = this._palliObs();
    if (!a) return [] as number[][];
    const C = PalliObsCol;
    const { lo, hi } = this.palliDayRange();
    const desigOf = this.palliDesigOf();
    return a.observations.filter((o) => o[C.day] >= lo && o[C.day] <= hi && desigOf[o[C.desig]] !== null);
  });

  /** Duration category of a duration in seconds (null = invalid). */
  palliDurCat(sec: number): 'lt15' | '15to30' | 'ge30' | null {
    if (!(sec > 0)) return null;
    return sec < 900 ? 'lt15' : sec < 1800 ? '15to30' : 'ge30';
  }
  /** Visit % RAG (US 2): ≥ 90 green · 75–90 amber · < 75 red. */
  palliVisitRag(pct: number | null): 'good' | 'warn' | 'bad' | 'none' {
    if (pct === null) return 'none';
    return pct >= 90 ? 'good' : pct >= 75 ? 'warn' : 'bad';
  }
  /** Short-duration RAG (US 2): < 20% green · 20–30% amber · > 30% red. */
  palliShortRag(pct: number | null): 'good' | 'warn' | 'bad' | 'none' {
    if (pct === null) return 'none';
    return pct < 20 ? 'good' : pct <= 30 ? 'warn' : 'bad';
  }

  /** Counter bag for a set of observations. */
  private palliBag() {
    return { visited: 0, lt15: 0, b15: 0, ge30: 0, invalid: 0, durSum: 0, users: new Set<number>() };
  }
  private palliAdd(b: ReturnType<ReviewService['palliBag']>, o: number[]): void {
    const C = PalliObsCol;
    b.visited++;
    b.users.add(o[C.user]);
    const cat = this.palliDurCat(o[C.durSec]);
    if (cat === 'lt15') b.lt15++; else if (cat === '15to30') b.b15++; else if (cat === 'ge30') b.ge30++; else b.invalid++;
    if (cat) b.durSum += o[C.durSec];
  }
  /** Shared metrics for a bag (target = officers × per-officer target × period). */
  private palliMetrics(b: ReturnType<ReviewService['palliBag']>, perOfficer: number, officers = b.users.size) {
    const target = Math.round(officers * perOfficer * this.palliPeriodFactor());
    const pct = target ? Math.round((b.visited / target) * 1000) / 10 : null;
    const validN = b.lt15 + b.b15 + b.ge30;
    const lt15Pct = validN ? Math.round((b.lt15 / validN) * 1000) / 10 : null;
    return {
      officers, target, visited: b.visited, pct, rag: this.palliVisitRag(pct),
      lt15: b.lt15, b15: b.b15, ge30: b.ge30, invalid: b.invalid, lt15Pct,
      shortRag: this.palliShortRag(lt15Pct),
      avgMin: validN ? Math.round((b.durSum / validN / 60) * 10) / 10 : null,
    };
  }

  /** Level 2 — districts for the selected designation (REAL). */
  readonly palliDesignationDrill = computed(() => {
    const des = this.palliDesignation();
    const a = this._palliObs();
    if (!des || !a) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const scope = new Set(this.palliScopeDistricts());
    const bags = new Map<string, ReturnType<ReviewService['palliBag']>>();
    for (const d of scope) bags.set(d, this.palliBag());
    for (const o of this.palliRangeObs()) {
      if (desigOf[o[C.desig]] !== des) continue;
      const bag = bags.get(distOf[o[C.school]] ?? '');
      if (bag) this.palliAdd(bag, o);
    }
    const per = this.palliMonthlyTarget()[des] ?? 0;
    return [...bags.entries()]
      .map(([key, b]) => ({ key, district: this.ds.titleCase(key), designation: des, ...this.palliMetrics(b, per) }))
      .sort((x, y) => y.visited - x.visited || x.district.localeCompare(y.district))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });
  readonly palliDesignationTotals = computed(() => {
    const rows = this.palliDesignationDrill();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const target = s((r) => r.target), visited = s((r) => r.visited);
    const lt15 = s((r) => r.lt15), b15 = s((r) => r.b15), ge30 = s((r) => r.ge30);
    const pct = target ? Math.round((visited / target) * 1000) / 10 : null;
    const lt15Pct = lt15 + b15 + ge30 ? Math.round((lt15 / (lt15 + b15 + ge30)) * 1000) / 10 : null;
    return { count: rows.length, officers: s((r) => r.officers), target, visited, pct, rag: this.palliVisitRag(pct),
      lt15, b15, ge30, invalid: s((r) => r.invalid), lt15Pct };
  });

  // ---- drill state (US 8) ----
  /** District opened under the selected designation (roll name). */
  readonly palliLlDistrict = signal<string | null>(null);
  /** User (index into palli-obs users[]) opened in the district. */
  readonly palliUser = signal<number | null>(null);
  /** Observation (the row array) whose report is open. */
  readonly palliReport = signal<number[] | null>(null);

  palliLlOpen(district: string): void { this.palliLlDistrict.set(district); this.palliUser.set(null); this.palliReport.set(null); this.palliSearch.set(''); this.loadPalliObs(); }
  palliLlClose(): void { this.palliLlDistrict.set(null); this.palliUser.set(null); this.palliReport.set(null); this.palliSearch.set(''); }
  palliOpenUser(u: number): void { this.palliUser.set(u); this.palliReport.set(null); this.palliSearch.set(''); }
  palliOpenReport(o: number[]): void { this.palliReport.set(o); }
  selectPalliDesignationAndClose(d: string | null): void { this.palliLlClose(); this.palliDesignation.set(d); if (d) this.loadPalliObs(); }

  /** Breadcrumb: All Designations → Designation → District → User → School Observations → View Report. */
  readonly palliCrumbs = computed(() => {
    const a = this._palliObs();
    const crumbs: { label: string; level: number }[] = [{ label: 'All Designations', level: 0 }];
    const des = this.palliDesignation();
    if (!des) return crumbs;
    crumbs.push({ label: des, level: 1 });
    const dist = this.palliLlDistrict();
    if (!dist) return crumbs;
    crumbs.push({ label: this.ds.titleCase(dist), level: 2 });
    const u = this.palliUser();
    if (u === null || !a) return crumbs;
    crumbs.push({ label: a.users[u]?.n || a.users[u]?.id || 'User', level: 3 });
    crumbs.push({ label: 'School Observations', level: 4 });
    if (this.palliReport()) crumbs.push({ label: 'View Report', level: 5 });
    return crumbs;
  });
  /** Jump to a breadcrumb level; filters (date range, duration) are preserved. */
  palliGoCrumb(level: number): void {
    if (level <= 0) { this.selectPalliDesignationAndClose(null); return; }
    if (level === 1) { this.palliLlClose(); return; }
    if (level === 2) { this.palliUser.set(null); this.palliReport.set(null); this.palliSearch.set(''); return; }
    if (level <= 4) { this.palliReport.set(null); }
  }

  /** Level 3 (US 4) — users of the selected designation in the selected district. */
  readonly palliUserRows = computed(() => {
    const a = this._palliObs();
    const des = this.palliDesignation();
    const dist = this.palliLlDistrict();
    if (!a || !des || !dist) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const bags = new Map<number, ReturnType<ReviewService['palliBag']>>();
    for (const o of this.palliRangeObs()) {
      if (desigOf[o[C.desig]] !== des || distOf[o[C.school]] !== dist) continue;
      let b = bags.get(o[C.user]);
      if (!b) { b = this.palliBag(); bags.set(o[C.user], b); }
      this.palliAdd(b, o);
    }
    const per = this.palliMonthlyTarget()[des] ?? 0;
    const q = this.palliSearch().trim().toLowerCase();
    return [...bags.entries()]
      .map(([u, b]) => ({ user: u, name: a.users[u]?.n || '—', userId: a.users[u]?.id || '', designation: des, ...this.palliMetrics(b, per, 1) }))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.userId.includes(q))
      .sort((x, y) => (x.pct ?? -1) - (y.pct ?? -1) || x.name.localeCompare(y.name))   // lowest achievement first
      .map((r, i) => ({ sno: i + 1, ...r }));
  });
  readonly palliUserTotals = computed(() => {
    const rows = this.palliUserRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const target = s((r) => r.target), visited = s((r) => r.visited);
    const pct = target ? Math.round((visited / target) * 1000) / 10 : null;
    return { count: rows.length, target, visited, pct, lt15: s((r) => r.lt15), b15: s((r) => r.b15), ge30: s((r) => r.ge30), invalid: s((r) => r.invalid) };
  });

  /** Observation-row projection shared by the user's list (US 5) and the duration list (US 7). */
  private palliObsRow(o: number[], i: number) {
    const a = this._palliObs()!;
    const C = PalliObsCol;
    const s = a.schools[o[C.school]];
    const sec = o[C.durSec];
    const sod = o[C.startSecOfDay];
    const hm = (x: number) => `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`;
    const cat = this.palliDurCat(sec);
    return {
      sno: i + 1, obs: o, date: this.palliDayIso(o[C.day]), udise: s.u, school: s.s, cls: o[C.cls],
      observer: a.users[o[C.user]]?.n || '—', district: this.ds.titleCase(this.palliSchoolDistrict()[o[C.school]] ?? s.d),
      start: sod >= 0 ? hm(sod) : '—', end: sod >= 0 && sec > 0 ? hm((sod + sec) % 86400) : '—',
      durMin: sec > 0 ? Math.round((sec / 60) * 10) / 10 : null,
      durLabel: cat === 'lt15' ? 'Under 15 min' : cat === '15to30' ? '15 to under 30 min' : cat === 'ge30' ? '30 min or more' : 'Invalid',
      // SAMPLE — the export has no section; derived deterministically per observation
      section: this.palliSampleSection(o),
    };
  }

  // ---- SAMPLE fill-ins for fields the export does not carry (Section, report findings) ----
  /** Stable key for one observation (day · school · class · user · start). */
  private palliObsKey(o: number[]): string {
    const C = PalliObsCol;
    return `${o[C.day]}|${o[C.school]}|${o[C.cls]}|${o[C.user]}|${o[C.startSecOfDay]}`;
  }
  /** SAMPLE section A–D (mostly A / B), stable for the same observation. */
  private palliSampleSection(o: number[]): string {
    const h = this.hash01(this.palliObsKey(o), 'pp-section');
    return h < 0.45 ? 'A' : h < 0.8 ? 'B' : h < 0.95 ? 'C' : 'D';
  }

  /** Rubric used for the SAMPLE observation report (Palli Paarvai classroom observation areas). */
  private readonly PALLI_SAMPLE_AREAS = [
    'Lesson planning & preparation',
    'Teaching–learning materials used',
    'Student participation',
    'Use of textbook / workbook',
    'Learning outcome checks (questioning)',
    'Classroom management',
    'Notebook / homework correction',
    'Use of digital / smart class resources',
  ];
  private readonly PALLI_SAMPLE_GRADES = ['Needs improvement', 'Satisfactory', 'Good', 'Excellent'];

  /**
   * SAMPLE observation report for one observation (US 6). The export has no
   * report content, so the responses are generated deterministically from the
   * observation (same observation → same report). Shorter observations lean
   * lower, matching the intent of the duration KPI. Always badged "Sample".
   */
  private palliSampleReport(o: number[]) {
    const key = this.palliObsKey(o);
    const sec = o[PalliObsCol.durSec];
    // short (< 15 min) observations skew lower; ≥ 30 min skew higher
    const tilt = !(sec > 0) ? 0 : sec < 900 ? -0.18 : sec >= 1800 ? 0.12 : 0;
    const areas = this.PALLI_SAMPLE_AREAS.map((area, i) => {
      const h = Math.min(0.999, Math.max(0, this.hash01(key, `pp-area-${i}`) + tilt));
      const g = Math.floor(h * this.PALLI_SAMPLE_GRADES.length);
      return { area, score: g + 1, grade: this.PALLI_SAMPLE_GRADES[g] };
    });
    const total = areas.reduce((t, a) => t + a.score, 0);
    const max = areas.length * this.PALLI_SAMPLE_GRADES.length;
    const present = 20 + Math.round(this.hash01(key, 'pp-enrol') * 25);       // 20–45
    const attending = Math.round(present * (0.78 + this.hash01(key, 'pp-att') * 0.2));
    const weakest = [...areas].sort((x, y) => x.score - y.score)[0];
    const strongest = [...areas].sort((x, y) => y.score - x.score)[0];
    return {
      areas,
      score: total, maxScore: max, scorePct: Math.round((total / max) * 100),
      enrolled: present, attending,
      strength: `${strongest.area} was ${strongest.grade.toLowerCase()}.`,
      improvement: weakest.score <= 2
        ? `Focus on ${weakest.area.toLowerCase()} — rated ${weakest.grade.toLowerCase()}.`
        : 'No critical gaps observed.',
      followUp: weakest.score <= 1 ? 'Revisit within 2 weeks' : weakest.score <= 2 ? 'Revisit next month' : 'Routine monitoring',
    };
  }
  private palliPassDur(sec: number): boolean {
    const f = this.palliDurFilter();
    if (f === 'all') return true;
    const cat = this.palliDurCat(sec);
    return f === 'invalid' ? cat === null : cat === f;
  }

  /** Level 4 (US 5) — the selected user's observations, newest first. */
  readonly palliUserObsRows = computed(() => {
    const a = this._palliObs();
    const u = this.palliUser();
    const dist = this.palliLlDistrict();
    const des = this.palliDesignation();
    if (!a || u === null || !dist || !des) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const q = this.palliSearch().trim().toLowerCase();
    return this.palliRangeObs()
      .filter((o) => o[C.user] === u && distOf[o[C.school]] === dist && desigOf[o[C.desig]] === des && this.palliPassDur(o[C.durSec]))
      .filter((o) => { if (!q) return true; const s = a.schools[o[C.school]]; return s.s.toLowerCase().includes(q) || s.u.includes(q); })
      .map((o, i) => this.palliObsRow(o, i));
  });

  /** Level 5 (US 6) — the selected observation's details. */
  readonly palliReportView = computed(() => {
    const o = this.palliReport();
    const a = this._palliObs();
    if (!o || !a) return null;
    const r = this.palliObsRow(o, 0);
    return {
      ...r, observerId: a.users[o[PalliObsCol.user]]?.id ?? '', designation: a.desigs[o[PalliObsCol.desig]] ?? '',
      report: this.palliSampleReport(o),
    };
  });

  // ---- US 7: Observation duration KPI (tab p_dur) ----
  readonly palliDurDistrict = signal('');
  readonly palliDurDesig = signal('');
  readonly palliDurDistrictOptions = computed(() => [
    { label: 'All districts', value: '' },
    ...this.palliScopeDistricts().map((d) => ({ label: this.ds.titleCase(d), value: d })),
  ]);
  readonly palliDurDesigOptions = computed(() => [
    { label: 'All designations', value: '' },
    ...this.PALLI_DESIGNATIONS.map((d) => ({ label: d, value: d })),
  ]);

  /**
   * Designation abstract (first level of the duration tab): one row per
   * designation, all districts in scope (or the district filter). Clicking a
   * designation sets `palliDurDesig` and opens the district × designation table.
   */
  readonly palliDurAbstract = computed(() => {
    const a = this._palliObs();
    if (!a) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const fD = this.palliDurDistrict();
    const scope = new Set(this.palliScopeDistricts());
    const bags = new Map<string, { bag: ReturnType<ReviewService['palliBag']>; districts: Set<string> }>();
    for (const o of this.palliRangeObs()) {
      const d = distOf[o[C.school]];
      const g = desigOf[o[C.desig]];
      if (!d || !g || !scope.has(d) || (fD && d !== fD)) continue;
      let e = bags.get(g);
      if (!e) { e = { bag: this.palliBag(), districts: new Set() }; bags.set(g, e); }
      this.palliAdd(e.bag, o);
      e.districts.add(d);
    }
    return this.PALLI_DESIGNATIONS.filter((g) => bags.has(g)).map((g, i) => {
      const e = bags.get(g)!;
      const m = this.palliMetrics(e.bag, 0);
      return { sno: i + 1, designation: g, districts: e.districts.size,
        total: m.lt15 + m.b15 + m.ge30, lt15: m.lt15, b15: m.b15, ge30: m.ge30, avgMin: m.avgMin };
    });
  });
  readonly palliDurAbstractTotals = computed(() => {
    const rows = this.palliDurAbstract();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const total = s((r) => r.total);
    const durSum = rows.reduce((t, r) => t + (r.avgMin ?? 0) * r.total, 0);
    return { count: rows.length, total, lt15: s((r) => r.lt15), b15: s((r) => r.b15), ge30: s((r) => r.ge30),
      avgMin: total ? Math.round((durSum / total) * 10) / 10 : null };
  });
  palliDurOpenDesig(g: string): void { this.palliDurDesig.set(g); this.palliCloseDurList(); }

  /** District × designation duration rows. */
  readonly palliDurRows = computed(() => {
    const a = this._palliObs();
    if (!a) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const fD = this.palliDurDistrict();
    const fG = this.palliDurDesig();
    const scope = new Set(this.palliScopeDistricts());
    const bags = new Map<string, ReturnType<ReviewService['palliBag']>>();
    for (const o of this.palliRangeObs()) {
      const d = distOf[o[C.school]];
      const g = desigOf[o[C.desig]];
      if (!d || !g || !scope.has(d) || (fD && d !== fD) || (fG && g !== fG)) continue;
      const k = `${d}||${g}`;
      let b = bags.get(k);
      if (!b) { b = this.palliBag(); bags.set(k, b); }
      this.palliAdd(b, o);
    }
    return [...bags.entries()]
      .map(([k, b]) => {
        const [d, g] = k.split('||');
        const m = this.palliMetrics(b, 0);
        return { key: k, districtKey: d, district: this.ds.titleCase(d), designation: g,
          total: m.lt15 + m.b15 + m.ge30, lt15: m.lt15, b15: m.b15, ge30: m.ge30,
          lt15Pct: m.lt15Pct, shortRag: m.shortRag, avgMin: m.avgMin, invalid: m.invalid };
      })
      .sort((x, y) => x.district.localeCompare(y.district)
        || this.PALLI_DESIGNATIONS.indexOf(x.designation) - this.PALLI_DESIGNATIONS.indexOf(y.designation))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });
  readonly palliDurTotals = computed(() => {
    const rows = this.palliDurRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const total = s((r) => r.total), lt15 = s((r) => r.lt15);
    const durSum = rows.reduce((t, r) => t + (r.avgMin ?? 0) * r.total, 0);
    return { count: rows.length, total, lt15, b15: s((r) => r.b15), ge30: s((r) => r.ge30), invalid: s((r) => r.invalid),
      lt15Pct: total ? Math.round((lt15 / total) * 1000) / 10 : null, avgMin: total ? Math.round((durSum / total) * 10) / 10 : null };
  });

  /** A clicked duration count (US 7 AC 4) → its underlying observation list (optionally one user's). */
  readonly palliDurPick = signal<{ district: string; designation: string; cat: 'lt15' | '15to30' | 'ge30' | 'invalid' | 'all'; user?: number | null } | null>(null);
  palliOpenDurList(district: string, designation: string, cat: 'lt15' | '15to30' | 'ge30' | 'invalid' | 'all', user: number | null = null): void {
    this.palliDurPick.set({ district, designation, cat, user }); this.palliReport.set(null); this.palliSearch.set('');
  }
  /** Close the observation list; `all` also leaves the user-wise level. */
  palliCloseDurList(all = true): void {
    this.palliDurPick.set(null); this.palliReport.set(null);
    if (all) this.palliDurUserPick.set(null);
  }

  /** Clicked district row (designation selected) → user-wise duration table. */
  readonly palliDurUserPick = signal<{ district: string; designation: string } | null>(null);
  palliDurOpenUsers(district: string, designation: string): void {
    this.palliDurPick.set(null); this.palliReport.set(null); this.palliSearch.set('');
    this.palliDurUserPick.set({ district, designation });
  }
  readonly palliDurUserRows = computed(() => {
    const p = this.palliDurUserPick();
    const a = this._palliObs();
    if (!p || !a) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const bags = new Map<number, ReturnType<ReviewService['palliBag']>>();
    for (const o of this.palliRangeObs()) {
      if (desigOf[o[C.desig]] !== p.designation || distOf[o[C.school]] !== p.district) continue;
      let b = bags.get(o[C.user]);
      if (!b) { b = this.palliBag(); bags.set(o[C.user], b); }
      this.palliAdd(b, o);
    }
    const q = this.palliSearch().trim().toLowerCase();
    return [...bags.entries()]
      .map(([u, b]) => {
        const m = this.palliMetrics(b, 0);
        return { user: u, name: a.users[u]?.n || '—', userId: a.users[u]?.id || '', designation: p.designation,
          total: m.lt15 + m.b15 + m.ge30, lt15: m.lt15, b15: m.b15, ge30: m.ge30, avgMin: m.avgMin };
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.userId.includes(q))
      .sort((x, y) => y.lt15 - x.lt15 || x.name.localeCompare(y.name))   // most short sessions first
      .map((r, i) => ({ sno: i + 1, ...r }));
  });
  readonly palliDurUserTotals = computed(() => {
    const rows = this.palliDurUserRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const total = s((r) => r.total);
    const durSum = rows.reduce((t, r) => t + (r.avgMin ?? 0) * r.total, 0);
    return { count: rows.length, total, lt15: s((r) => r.lt15), b15: s((r) => r.b15), ge30: s((r) => r.ge30),
      avgMin: total ? Math.round((durSum / total) * 10) / 10 : null };
  });
  readonly palliDurListRows = computed(() => {
    const p = this.palliDurPick();
    const a = this._palliObs();
    if (!p || !a) return [];
    const C = PalliObsCol;
    const desigOf = this.palliDesigOf();
    const distOf = this.palliSchoolDistrict();
    const q = this.palliSearch().trim().toLowerCase();
    return this.palliRangeObs()
      .filter((o) => distOf[o[C.school]] === p.district && desigOf[o[C.desig]] === p.designation)
      .filter((o) => p.user == null || o[C.user] === p.user)
      .filter((o) => { const c = this.palliDurCat(o[C.durSec]);
        return p.cat === 'invalid' ? c === null : p.cat === 'all' ? c !== null : c === p.cat; })
      .filter((o) => { if (!q) return true; const s = a.schools[o[C.school]]; const n = (a.users[o[C.user]]?.n ?? '').toLowerCase();
        return s.s.toLowerCase().includes(q) || s.u.includes(q) || n.includes(q); })
      .map((o, i) => this.palliObsRow(o, i));
  });
  readonly palliDurCatLabel: Record<string, string> = {
    lt15: 'Under 15 min', '15to30': '15 to under 30 min', ge30: '30 min or more', invalid: 'Invalid duration', all: 'All valid observations',
  };

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
    // KPI 4 (spec clarified): a school qualifies when ANY SINGLE designation
    // visited it 3+ times in the month (e.g. BRTE visited the same school 3+
    // times) — a per-designation threshold, not the sum across designations.
    const rows = this.scopeSchoolRows();
    return rows.map((e) => {
      const cells: Record<string, number> = {};
      let total = 0;
      const qualified: string[] = [];
      for (const des of this.PALLI_DESIGNATIONS) {
        // 0–5 visits by this designation this month (deterministic, stable)
        const c = Math.round(this.hash01(e.row.udise, 'p_s3-' + des) * 5);
        cells[des] = c; total += c;
        if (c >= 3) qualified.push(des);
      }
      return {
        district: this.ds.titleCase(e.district), block: this.ds.titleCase(e.block),
        udise: e.row.udise, school: e.row.name, category: e.row.ctype ?? '—',
        cells, total, qualified, qualifiedLabel: qualified.join(', '), maxByDesignation: Math.max(0, ...this.PALLI_DESIGNATIONS.map((d) => cells[d])),
      };
    })
    .filter((r) => r.qualified.length > 0)   // at least one designation with ≥3 visits
    .map((r, i) => ({ sno: i + 1, ...r }));
  });

  // ---- KPI 4 observation-detail popup (user details for a school + designation) ----
  readonly palliObsPopup = signal<{
    school: string; udise: string; district: string; designation: string;
    officials: { sno: number; emisId: string; staffName: string; office: string; target: number; observed: number }[];
  } | null>(null);
  readonly palliObsPopupOpen = computed(() => this.palliObsPopup() !== null);
  closePalliObsPopup(): void { this.palliObsPopup.set(null); }

  /**
   * Open the official-detail popup for a KPI-4 cell (school × designation).
   * `count` = how many times this designation visited the school this month,
   * modelled as that many officials each with EMIS id, office, target and the
   * observations they made this month. Deterministic (seeded by UDISE).
   */
  openPalliObsPopup(row: { udise: string; school: string; district: string }, designation: string, count: number): void {
    if (!count) return;
    const code = designation.replace(/[^A-Z]/g, '').slice(0, 3) || 'OFF';
    const officials = Array.from({ length: count }, (_, i) => {
      const seed = this.hash01(`${row.udise}|${designation}|${i}`, 'p_s3_u');
      // monthly observation target per official (assumed 15–40), observed ≤ target
      const target = 15 + Math.round(this.hash01(`${row.udise}|${designation}|${i}`, 'tgt') * 25);
      const observed = Math.max(1, Math.round(target * (0.4 + this.hash01(`${row.udise}|${designation}|${i}`, 'obs') * 0.6)));
      return {
        sno: i + 1,
        emisId: `EMIS${(100000 + Math.floor(seed * 899999))}`,
        staffName: this.palliOfficialName(row.district, designation, i),
        office: `${designation} Office, ${this.ds.titleCase(row.district)}`,
        target,
        observed,
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

  // ================= RECOGNITION ORDER — DPS =================
  /**
   * Pending Recognition Certificate (RC) applications for private schools.
   * Unlike the other components the unit of analysis is an APPLICATION, not a
   * school, so this gets its own drill: a district/block summary that opens the
   * underlying application list. All figures are REAL (dps-real.json) — no
   * assumed data.
   */
  readonly dpsKpiTabs: { id: string; label: string }[] = [
    { id: 'dp_tot', label: 'Total pending' },
    { id: 'dp_dist', label: 'District pending' },
    { id: 'dp_state', label: 'State pending' },
    { id: 'dp_l15', label: 'Pending < 15 days' },
    { id: 'dp_l30', label: 'Pending 15–30 days' },
    { id: 'dp_g30', label: 'Pending > 30 days' },
  ];
  private readonly DPS_KPI_IDS = new Set(this.dpsKpiTabs.map((t) => t.id));

  /** Active DPS KPI; null when the DPS drill is closed. */
  readonly dpsKpiId = signal<string | null>(null);
  /** Unit (district or block name) drilled into for the application list. */
  readonly dpsUnit = signal<string | null>(null);

  hasDpsDrill(kpiId: string): boolean { return this.DPS_KPI_IDS.has(kpiId); }
  openDpsDrill(kpiId: string): void {
    this.dpsKpiId.set(this.DPS_KPI_IDS.has(kpiId) ? kpiId : 'dp_tot');
    this.dpsUnit.set(null);
  }
  closeDpsDrill(): void { this.dpsKpiId.set(null); this.dpsUnit.set(null); }
  setDpsKpi(id: string): void { this.dpsKpiId.set(id); this.dpsUnit.set(null); }
  dpsSelectUnit(u: string | null): void { this.dpsUnit.set(u); }
  dpsResetUnit(): void { this.dpsUnit.set(null); }

  readonly dpsKpiLabel = computed(() => {
    const id = this.dpsKpiId();
    if (!id) return '';
    for (const m of KPI_MODULES) { const def = m.kpis.find((k) => k.id === id); if (def) return def.label; }
    return '';
  });

  /** Which summary metric the active KPI highlights / filters by. */
  private dpsKpiFilter(id: string | null): (a: DpsApplication) => boolean {
    switch (id) {
      case 'dp_dist': return (a) => a.level === 'District';
      case 'dp_state': return (a) => a.level === 'State';
      case 'dp_l15': return (a) => a.bucket === '<15';
      case 'dp_l30': return (a) => a.bucket === '15-30';
      case 'dp_g30': return (a) => a.bucket === '>30';
      default: return () => true;   // dp_tot — everything pending
    }
  }

  /**
   * All pending applications inside the current dashboard scope
   * (state = all, district = that district, block = that block).
   */
  private readonly dpsScopeApps = computed<DpsApplication[]>(() => {
    const all = this._dpsReal()?.applications ?? [];
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    if (!dist) return all;
    const dU = dist.toUpperCase();
    const out = all.filter((a) => a.district.toUpperCase() === dU);
    if (!blk) return out;
    const bU = blk.toUpperCase();
    return out.filter((a) => a.block.toUpperCase() === bU);
  });

  /** Applications matching the active KPI, inside scope. */
  private readonly dpsKpiApps = computed<DpsApplication[]>(() => {
    const pred = this.dpsKpiFilter(this.dpsKpiId());
    return this.dpsScopeApps().filter(pred);
  });

  /** Grouping unit for the DPS summary: districts at state level, else blocks. */
  readonly dpsUnitLabel = computed(() => (this.ds.selectedDistrict() ? 'Block' : 'District'));

  /**
   * Summary rows for the DPS drill — one row per district (state scope) or per
   * block (inside a district), with every KPI metric so the grid matches the
   * component's KPI set. Sorted by the active KPI's metric, descending.
   */
  readonly dpsSummaryRows = computed(() => {
    const byBlock = !!this.ds.selectedDistrict();
    const init = () => ({ total: 0, districtPending: 0, statePending: 0, lt15: 0, d15to30: 0, gt30: 0, daysSum: 0 });
    const map = new Map<string, ReturnType<typeof init>>();
    for (const a of this.dpsScopeApps()) {
      const key = (byBlock ? a.block : a.district) || '—';
      if (!map.has(key)) map.set(key, init());
      const o = map.get(key)!;
      o.total++;
      if (a.level === 'State') o.statePending++;
      else if (a.level === 'District') o.districtPending++;
      if (a.bucket === '>30') o.gt30++;
      else if (a.bucket === '15-30') o.d15to30++;
      else o.lt15++;
      o.daysSum += a.days;
    }
    const metric = this.dpsSortKey(this.dpsKpiId());
    return [...map.entries()]
      .map(([key, o]) => ({
        key,
        unit: this.ds.titleCase(key),
        total: o.total,
        districtPending: o.districtPending,
        statePending: o.statePending,
        lt15: o.lt15,
        d15to30: o.d15to30,
        gt30: o.gt30,
        avgDays: o.total ? Math.round((o.daysSum / o.total) * 10) / 10 : 0,
      }))
      .sort((a, b) => (b[metric] as number) - (a[metric] as number) || a.unit.localeCompare(b.unit))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });

  /** Summary-row field the active KPI ranks by. */
  private dpsSortKey(id: string | null): 'total' | 'districtPending' | 'statePending' | 'lt15' | 'd15to30' | 'gt30' {
    switch (id) {
      case 'dp_dist': return 'districtPending';
      case 'dp_state': return 'statePending';
      case 'dp_l15': return 'lt15';
      case 'dp_l30': return 'd15to30';
      case 'dp_g30': return 'gt30';
      default: return 'total';
    }
  }

  /** Grand-total row for the DPS summary grid. */
  readonly dpsSummaryTotals = computed(() => {
    const rows = this.dpsSummaryRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const total = s((r) => r.total);
    return {
      count: rows.length,
      total,
      districtPending: s((r) => r.districtPending),
      statePending: s((r) => r.statePending),
      lt15: s((r) => r.lt15),
      d15to30: s((r) => r.d15to30),
      gt30: s((r) => r.gt30),
      // student-less dataset: weight the average by application count
      avgDays: total ? Math.round((rows.reduce((t, r) => t + r.avgDays * r.total, 0) / total) * 10) / 10 : 0,
    };
  });

  /**
   * The application list: KPI-filtered, scope-filtered and narrowed to the
   * drilled district/block when one is selected. Oldest pending first, so the
   * most overdue files surface at the top.
   */
  readonly dpsApplicationRows = computed(() => {
    const unit = this.dpsUnit();
    const byBlock = !!this.ds.selectedDistrict();
    let apps = this.dpsKpiApps();
    if (unit) {
      const u = unit.toUpperCase();
      apps = apps.filter((a) => ((byBlock ? a.block : a.district) || '—').toUpperCase() === u);
    }
    return apps
      .slice()
      .sort((a, b) => b.days - a.days || a.district.localeCompare(b.district))
      .map((a, i) => ({ sno: i + 1, ...a }));
  });

  /** Footer figures for the application list. */
  readonly dpsApplicationTotals = computed(() => {
    const rows = this.dpsApplicationRows();
    const total = rows.length;
    return {
      count: total,
      districtPending: rows.filter((r) => r.level === 'District').length,
      statePending: rows.filter((r) => r.level === 'State').length,
      avgDays: total ? Math.round((rows.reduce((t, r) => t + r.days, 0) / total) * 10) / 10 : 0,
    };
  });

  // ================= ALL CHILDREN IN SCHOOL (ACiS) =================
  /**
   * The common pool: every child who left universal data (TC issued) and is not
   * yet back in a school. The unit of analysis is a CHILD, not a school, so this
   * gets its own drill with the five filters the metric sheet asks for (school
   * type, gender, class, CWSN status, UMIS admit status).
   *
   * Which KPI is active decides the view:
   *   summary  District → Block → School counts, then the student list
   *   reason   reason → sub-reason counts (metric 8)
   *   dept     department-wise action taken / to be taken (metric 9)
   *   pd       potential dropouts per unit: count, %, repeaters (REAL)
   *   pdreason potential-dropout reason-wise counts (REAL)
   *   pdgrade  potential dropouts grade-wise by reason category (REAL)
   *
   * Everything is real: `acis-real.json` + `acis-students.json` for the
   * common pool, `acis-pd.json` (EMIS Potential Dropout report) for PD.
   */
  readonly acisKpiTabs: { id: string; label: string }[] = [
    { id: 'ac_pool', label: 'District summary' },
    { id: 'ac_dr', label: 'Dropout rate' },
    { id: 'ac_rsn', label: 'Dropout reasons' },
    { id: 'ac_dact', label: 'Department action' },
    { id: 'ac_pdrs', label: 'PD reasons' },
    { id: 'ac_pdg', label: 'PD grade-wise' },
  ];
  /**
   * Every ACiS KPI that routes into this drill. The ones that are columns of
   * the summary grid (pool, surveyed, pending, %, admitted, to be admitted,
   * dept pending, PD, PD %, PD repeaters) open the summary grid sorted by
   * that column — there is one grid, not one tab per column.
   */
  private readonly ACIS_KPI_IDS = new Set([
    'ac_pool', 'ac_surv', 'ac_pend', 'ac_sp', 'ac_adm', 'ac_tba', 'ac_rsn',
    'ac_dact', 'ac_dpnd', 'ac_pd', 'ac_pdp', 'ac_pdr', 'ac_pdrs', 'ac_pdg', 'ac_dr', 'ac_drc',
  ]);

  /** Which tab is lit: summary-column KPIs all light "District summary". */
  readonly acisActiveTab = computed(() => {
    const id = this.acisKpiId() ?? 'ac_pool';
    return this.acisKpiTabs.some((t) => t.id === id) ? id : 'ac_pool';
  });

  /** Active ACiS KPI; null when the drill is closed. */
  readonly acisKpiId = signal<string | null>(null);
  /** District / block / school name drilled into for the student list. */
  readonly acisUnit = signal<string | null>(null);
  /** Expanded reason row in the reason view. */
  readonly acisReason = signal<string | null>(null);

  // ---- the five metric-sheet filters ----
  readonly acisFSchoolType = signal<string>('all');
  readonly acisFGender = signal<string>('all');
  readonly acisFClass = signal<string>('all');
  /** 'all' | 'cwsn' | 'non' */
  readonly acisFCwsn = signal<string>('all');
  /** 'all' | 'joined' | 'not' — UMIS (higher education) admit status. */
  readonly acisFUmis = signal<string>('all');

  hasAcisDrill(kpiId: string): boolean { return this.ACIS_KPI_IDS.has(kpiId); }
  openAcisDrill(kpiId: string): void {
    this.loadAcisStudents();
    this.acisKpiId.set(this.ACIS_KPI_IDS.has(kpiId) ? kpiId : 'ac_pool');
    this.acisUnit.set(null);
    this.acisReason.set(null);
  }
  closeAcisDrill(): void {
    this.acisKpiId.set(null);
    this.acisUnit.set(null);
    this.acisReason.set(null);
    this.acisPdSchool.set(null);
  }
  setAcisKpi(id: string): void {
    this.acisKpiId.set(id);
    this.acisUnit.set(null);
    this.acisReason.set(null);
    this.acisPdSchool.set(null);
  }
  acisSelectUnit(u: string | null): void { this.acisUnit.set(u); }

  /**
   * Common-pool grid row click — walk District → Block → School → children.
   * District/block clicks move the dashboard scope (so tiles, charts and the
   * breadcrumb follow); at block level the rows are schools, and a click opens
   * that school's children with their dropout reason. ACiS spells names in its
   * own casing, so they are resolved to the enrolment roll's canonical name.
   */
  acisDrillSummaryRow(row: { key: string }): void {
    const level = this.ds.level();
    if (level === 'state') {
      const d = this.canonicalDistrict(row.key);
      if (d) { this.acisUnit.set(null); this.ds.drillToDistrict(d); }
    } else if (level === 'district') {
      const b = this.canonicalBlock(row.key);
      if (b) { this.acisUnit.set(null); this.ds.drillToBlock(b); }
    } else {
      // block level: rows are schools (key = UDISE) → open that school's lists
      this.acisUnit.set(row.key);
      this.acisPdSchool.set(row.key);
      this.acisSchoolList.set('drop');
    }
  }

  /**
   * At school level the two populations are separate lists, with a switch:
   * 'drop' = common-pool children (dropouts), 'pd' = potential dropouts.
   */
  readonly acisSchoolList = signal<'drop' | 'pd'>('drop');

  /** Name of the opened school (from either population). */
  readonly acisUnitName = computed(() => {
    const u = this.acisUnit();
    if (!u) return '';
    return this._acisStudents()?.schools.find((s) => s.u === u)?.s
      ?? this._acisPd()?.schoolRefs.find((s) => s.u === u)?.s ?? u;
  });

  /** Children list shows only once a school inside the current block is open. */
  readonly acisShowChildren = computed(() => !!this.acisUnit() && !!this.ds.selectedBlock());

  private canonicalDistrict(name: string): string | null {
    const u = name.toUpperCase();
    return this.ds.districts().find((d) => d.name.toUpperCase() === u)?.name ?? null;
  }
  private canonicalBlock(name: string): string | null {
    const u = name.toUpperCase();
    return this.ds.blocksForDistrict().find((b) => b.block.toUpperCase() === u)?.block ?? null;
  }

  /** Potential-dropout school opened for its student list (UDISE), or null. */
  readonly acisPdSchool = signal<string | null>(null);
  /** PD student list shows only once a school inside the current block is open. */
  readonly acisShowPdStudents = computed(() => !!this.acisPdSchool() && !!this.ds.selectedBlock());

  /** Students of the opened PD school, with reason — most days absent first. */
  readonly acisPdStudentRows = computed(() => {
    const a = this._acisPd();
    const u = this.acisPdSchool();
    if (!a || !u) return [];
    const C = AcisPdCol;
    return this.pdScopeStudents()
      .filter((r) => a.schoolRefs[r[C.school] as number]?.u === u)
      .map((r) => ({
        emis: String(r[C.emis] ?? ''),
        name: String(r[C.name] ?? ''),
        cls: String(r[C.cls] ?? '—'),
        section: String(r[C.section] ?? '') || '—',
        gender: r[C.gender] === 1 ? 'Male' : r[C.gender] === 2 ? 'Female' : '—',
        category: a.categories[r[C.category] as number] ?? '—',
        reason: a.reasons[r[C.reason] as number] ?? '—',
        absentDays: r[C.absentDays] as number,
        repeater: r[C.repeater] === 1 ? 'Repeater' : r[C.repeater] === 0 ? 'Not repeater' : 'Not updated',
      }))
      .sort((x, y) => y.absentDays - x.absentDays || x.name.localeCompare(y.name))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });
  acisSelectReason(r: string | null): void { this.acisReason.set(r === this.acisReason() ? null : r); }
  acisResetFilters(): void {
    this.acisFSchoolType.set('all');
    this.acisFGender.set('all');
    this.acisFClass.set('all');
    this.acisFCwsn.set('all');
    this.acisFUmis.set('all');
  }
  /** True when any of the five filters is narrowing the figures. */
  readonly acisFiltered = computed(() => this.acisFSchoolType() !== 'all'
    || this.acisFGender() !== 'all' || this.acisFClass() !== 'all'
    || this.acisFCwsn() !== 'all' || this.acisFUmis() !== 'all');

  /** Still fetching the ~6 MB student roster. */
  readonly acisStudentsLoading = computed(() => !this._acisStudents());

  readonly acisKpiLabel = computed(() => {
    const id = this.acisKpiId();
    if (!id) return '';
    for (const m of KPI_MODULES) { const def = m.kpis.find((k) => k.id === id); if (def) return def.label; }
    return '';
  });

  /** Which table the active KPI renders. */
  readonly acisView = computed<'summary' | 'reason' | 'dept' | 'pdreason' | 'pdgrade' | 'droprate'>(() => {
    switch (this.acisKpiId()) {
      case 'ac_rsn': return 'reason';
      case 'ac_dact': return 'dept';
      case 'ac_pdrs': return 'pdreason';
      case 'ac_pdg': return 'pdgrade';
      case 'ac_dr': case 'ac_drc': return 'droprate';
      default: return 'summary';   // every summary-grid column KPI
    }
  });

  /** Potential-dropout-only views (PD report; no CWSN / UMIS fields). */
  readonly acisIsPdView = computed(() => ['pdreason', 'pdgrade'].includes(this.acisView()));
  /** CWSN / UMIS filters can't apply: PD report and the enrolment roll lack them. */
  readonly acisHideCwsnUmis = computed(() => this.acisIsPdView() || this.acisView() === 'droprate');
  /** Report window of the potential-dropout export, for the caption. */
  readonly acisPdWindow = computed(() => {
    const a = this._acisPd();
    return a ? `${a.reportFrom} → ${a.reportTo}` : '';
  });

  // ---- filter option lists (from the real roster) ----
  readonly acisSchoolTypeOptions = computed(() => {
    const a = this._acisStudents();
    const set = new Set<string>();
    for (const s of a?.schools ?? []) if (s.t) set.add(s.t);
    return [{ label: 'All school types', value: 'all' },
      ...[...set].sort().map((t) => ({ label: t, value: t }))];
  });
  readonly acisClassOptions = computed(() => {
    const rows = this._acisReal()?.classWise ?? [];
    return [{ label: 'All classes', value: 'all' },
      ...rows.map((r) => ({ label: `Class ${r.cls}`, value: r.cls }))];
  });
  readonly acisGenderOptions = [
    { label: 'All genders', value: 'all' },
    { label: 'Male', value: '1' },
    { label: 'Female', value: '2' },
  ];
  readonly acisCwsnOptions = [
    { label: 'All (CWSN & others)', value: 'all' },
    { label: 'CWSN only', value: 'cwsn' },
    { label: 'Non-CWSN only', value: 'non' },
  ];
  readonly acisUmisOptions = [
    { label: 'Any UMIS status', value: 'all' },
    { label: 'Joined higher education', value: 'joined' },
    { label: 'Not joined higher education', value: 'not' },
  ];

  /**
   * Students in the current dashboard scope with the five filters applied.
   * Rows stay as the raw positional arrays — 291k of them — and are only
   * projected into objects for the (paged) student list.
   */
  private readonly acisScopeStudents = computed<AcisStudentRow[]>(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const C = AcisStudentCol;
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    const fType = this.acisFSchoolType();
    const fGender = this.acisFGender();
    const fClass = this.acisFClass();
    const fCwsn = this.acisFCwsn();
    const fUmis = this.acisFUmis();

    // pre-resolve which school indexes pass the scope + school-type filter
    const ok = new Uint8Array(a.schools.length);
    for (let i = 0; i < a.schools.length; i++) {
      const s = a.schools[i];
      if (dist && s.d.toUpperCase() !== dist) continue;
      if (blk && s.b.toUpperCase() !== blk) continue;
      if (fType !== 'all' && s.t !== fType) continue;
      ok[i] = 1;
    }

    const out: AcisStudentRow[] = [];
    for (const r of a.students) {
      if (!ok[r[C.school] as number]) continue;
      if (fGender !== 'all' && String(r[C.gender]) !== fGender) continue;
      if (fClass !== 'all' && r[C.cls] !== fClass) continue;
      if (fCwsn === 'cwsn' && r[C.cwsn] !== 1) continue;
      if (fCwsn === 'non' && r[C.cwsn] === 1) continue;
      if (fUmis === 'joined' && r[C.umis] !== 1) continue;
      if (fUmis === 'not' && r[C.umis] === 1) continue;
      out.push(r);
    }
    return out;
  });

  /** Grouping unit for the ACiS summary: district → block → school. */
  readonly acisUnitLabel = computed(() => (this.ds.selectedBlock() ? 'School'
    : this.ds.selectedDistrict() ? 'Block' : 'District'));

  /** Blank counter bag for one summary unit. */
  private acisInit() {
    return {
      pool: 0, surveyed: 0, admitted: 0, bridged: 0, toBeAdmitted: 0, toBeValidated: 0,
      withReason: 0, deptTaken: 0, deptPending: 0, cwsn: 0, umis: 0, bridgeSum: 0, bridgeN: 0,
    };
  }

  /** Accumulate one student row into a counter bag. */
  private acisAccum(o: ReturnType<ReviewService['acisInit']>, r: AcisStudentRow, deadDept: number): void {
    const C = AcisStudentCol;
    const surveyed = r[C.surveyed] === 1;
    const admitted = r[C.admitted] === 1;
    const days = r[C.days] as number;
    o.pool++;
    if (surveyed) o.surveyed++;
    if (admitted) o.admitted++;
    if (admitted && days >= 0) { o.bridged++; o.bridgeSum += days; o.bridgeN++; }
    if (r[C.bucket] === 2) o.toBeAdmitted++;
    if (r[C.bucket] === 1) o.toBeValidated++;
    if ((r[C.reason] as number) >= 0) o.withReason++;
    if (r[C.cwsn] === 1) o.cwsn++;
    if (r[C.umis] === 1) o.umis++;
    if (surveyed) {
      if (admitted || r[C.umis] === 1 || r[C.dept] === deadDept) o.deptTaken++;
      else o.deptPending++;
    }
  }

  /** Index of the "no action — deceased" department, or -1. */
  private readonly acisDeadDept = computed(() => {
    const d = this._acisStudents()?.depts ?? [];
    return d.findIndex((x) => /deceased/i.test(x));
  });

  /**
   * The ACiS summary grid — one row per district / block / school, with both
   * populations side by side:
   *   dropout columns     the common pool (all five filters apply)
   *   potential dropouts  the PD report (school type / gender / class apply;
   *                       it has no CWSN or UMIS fields, so those two do not)
   * Rows are keyed by UPPERCASE district / block name, or UDISE at school level,
   * so a unit with children in only one population still gets a row. Sorted by
   * the active KPI's column (a headline-tile click = sort by that column).
   */
  readonly acisSummaryRows = computed(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const pdA = this._acisPd();
    const C = AcisStudentCol;
    const P = AcisPdCol;
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    const dead = this.acisDeadDept();
    type Bag = ReturnType<ReviewService['acisInit']> & { name: string; udise: string; pd: number; pdRepeaters: number };
    const map = new Map<string, Bag>();
    const bag = (key: string, name: string, udise: string): Bag => {
      let o = map.get(key);
      if (!o) { o = { ...this.acisInit(), name, udise, pd: 0, pdRepeaters: 0 }; map.set(key, o); }
      return o;
    };
    const unitOf = (s: { d: string; b: string; u: string; s: string }) => blk
      ? { key: s.u || s.s.toUpperCase(), name: s.s, udise: s.u }
      : dist
        ? { key: s.b.toUpperCase(), name: this.ds.titleCase(s.b), udise: '' }
        : { key: s.d.toUpperCase(), name: this.ds.titleCase(s.d), udise: '' };

    for (const r of this.acisScopeStudents()) {
      const u = unitOf(a.schools[r[C.school] as number]);
      this.acisAccum(bag(u.key, u.name, u.udise), r, dead);
    }
    if (pdA) {
      for (const r of this.pdScopeStudents()) {
        const u = unitOf(pdA.schoolRefs[r[P.school] as number]);
        const o = bag(u.key, u.name, u.udise);
        o.pd++;
        if (r[P.repeater] === 1) o.pdRepeaters++;
      }
    }

    // PD % denominator: the unit's enrolment in the school types the PD report covers
    const rollFor = (key: string): SchoolRow[] => {
      if (blk) return this.ds.schoolsForBlock().filter((s) => s.udise === key);
      if (dist) { const b = this.canonicalBlock(key); return b ? this.ds.schoolRowsFor(dist, b) : []; }
      const d = this.canonicalDistrict(key);
      return d ? this.ds.schoolRowsFor(d) : [];
    };

    const metric = this.acisSortKey(this.acisKpiId());
    return [...map.entries()]
      .map(([key, o]) => {
        const pdEnrolled = this.pdEnrolled(rollFor(key));
        return {
          key,
          unit: o.name,
          udise: o.udise,
          pool: o.pool,
          surveyed: o.surveyed,
          pendingSurvey: o.pool - o.surveyed,
          surveyPct: o.pool ? Math.round((o.surveyed / o.pool) * 1000) / 10 : 0,
          admitted: o.admitted,
          toBeAdmitted: o.toBeAdmitted,
          withReason: o.withReason,
          deptTaken: o.deptTaken,
          deptPending: o.deptPending,
          pd: o.pd,
          pdEnrolled,
          pdPct: pdEnrolled ? Math.round((o.pd / pdEnrolled) * 10000) / 100 : 0,
          pdRepeaters: o.pdRepeaters,
        };
      })
      .sort((x, y) => (y[metric] as number) - (x[metric] as number) || x.unit.localeCompare(y.unit))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });

  /** Summary-grid column the active KPI sorts by (tile click = sort). */
  private acisSortKey(id: string | null) {
    switch (id) {
      case 'ac_surv': return 'surveyed' as const;
      case 'ac_pend': return 'pendingSurvey' as const;
      case 'ac_sp': return 'surveyPct' as const;
      case 'ac_adm': return 'admitted' as const;
      case 'ac_tba': return 'toBeAdmitted' as const;
      case 'ac_dpnd': return 'deptPending' as const;
      case 'ac_pd': return 'pd' as const;
      case 'ac_pdp': return 'pdPct' as const;
      case 'ac_pdr': return 'pdRepeaters' as const;
      default: return 'pool' as const;
    }
  }
  /** The column currently driving the sort, for header highlighting. */
  readonly acisSortColumn = computed(() => this.acisSortKey(this.acisKpiId()));

  /** Grand-total row for the ACiS summary grid. */
  readonly acisSummaryTotals = computed(() => {
    const rows = this.acisSummaryRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const pool = s((r) => r.pool);
    const surveyed = s((r) => r.surveyed);
    const pd = s((r) => r.pd);
    const pdEnrolled = s((r) => r.pdEnrolled);
    return {
      count: rows.length,
      pool,
      surveyed,
      pendingSurvey: pool - surveyed,
      surveyPct: pool ? Math.round((surveyed / pool) * 1000) / 10 : 0,
      admitted: s((r) => r.admitted),
      toBeAdmitted: s((r) => r.toBeAdmitted),
      deptPending: s((r) => r.deptPending),
      pd,
      pdPct: pdEnrolled ? Math.round((pd / pdEnrolled) * 10000) / 100 : 0,
      pdRepeaters: s((r) => r.pdRepeaters),
    };
  });

  /**
   * The opened school's common-pool children (dropouts), with their dropout
   * reason — every child of that school within the five filters. Matched by
   * UDISE (the summary grid's school-level key).
   */
  readonly acisStudentRows = computed(() => {
    const a = this._acisStudents();
    const unit = this.acisUnit();
    if (!a || !unit) return [];
    const C = AcisStudentCol;
    const reason = this.acisReason();

    const out = [] as {
      sno: number; emis: string; name: string; district: string; block: string;
      udise: string; school: string; schoolType: string; category: string; cls: string;
      gender: string; cwsn: string; disability: string; surveyStatus: string;
      admitStatus: string; bucket: string; reason: string; subReason: string;
      dept: string; umis: string; days: number; transferDate: string; surveyDate: string;
    }[];
    for (const r of this.acisScopeStudents()) {
      const s = a.schools[r[C.school] as number];
      if ((s.u || s.s.toUpperCase()) !== unit) continue;
      const ri = r[C.reason] as number;
      if (reason && (ri < 0 || a.reasons[ri] !== reason)) continue;
      const si = r[C.subReason] as number;
      const di = r[C.dept] as number;
      out.push({
        sno: 0,
        emis: String(r[C.emis] ?? ''),
        name: String(r[C.name] ?? ''),
        district: this.ds.titleCase(s.d),
        block: this.ds.titleCase(s.b),
        udise: s.u,
        school: s.s,
        schoolType: s.t,
        category: s.c,
        cls: String(r[C.cls] ?? '—'),
        gender: r[C.gender] === 1 ? 'Male' : r[C.gender] === 2 ? 'Female' : '—',
        cwsn: r[C.cwsn] === 1 ? 'Yes' : 'No',
        disability: String(r[C.disability] ?? '') || '—',
        surveyStatus: r[C.surveyed] === 1 ? 'Surveyed' : 'Not surveyed',
        admitStatus: r[C.admitted] === 1 ? 'Admitted' : 'Not admitted',
        bucket: r[C.bucket] === 1 ? 'To be validated' : r[C.bucket] === 2 ? 'To be admitted' : '—',
        reason: ri >= 0 ? a.reasons[ri] : '—',
        subReason: si >= 0 ? a.subReasons[si] : '—',
        dept: di >= 0 ? a.depts[di] : '—',
        umis: r[C.umis] === 1 ? 'Joined higher edu.' : '—',
        days: (r[C.days] as number) >= 0 ? (r[C.days] as number) : 0,
        transferDate: String(r[C.transferDate] ?? ''),
        surveyDate: String(r[C.surveyDate] ?? ''),
      });
    }
    const clsN = (c: string) => parseInt(c, 10) || 99;
    out.sort((x, y) => clsN(x.cls) - clsN(y.cls) || x.name.localeCompare(y.name));
    return out.map((r, i) => ({ ...r, sno: i + 1 }));
  });

  readonly acisStudentTotals = computed(() => {
    const rows = this.acisStudentRows();
    const withDays = rows.filter((r) => r.days > 0);
    return {
      count: rows.length,
      admitted: rows.filter((r) => r.admitStatus === 'Admitted').length,
      cwsn: rows.filter((r) => r.cwsn === 'Yes').length,
      avgDays: withDays.length
        ? Math.round((withDays.reduce((t, r) => t + r.days, 0) / withDays.length) * 10) / 10 : 0,
    };
  });

  /**
   * Class × gender matrix (metric 1 — TC dropouts class/gender/district wise,
   * and metric 5.c — class-wise average bridging duration). Computed from the
   * filtered roster so the five filters apply here too.
   */
  readonly acisClassRows = computed(() => {
    const C = AcisStudentCol;
    const init = () => ({ pool: 0, boys: 0, girls: 0, cwsn: 0, surveyed: 0, admitted: 0, bridgeSum: 0, bridgeN: 0 });
    const map = new Map<string, ReturnType<typeof init>>();
    for (const r of this.acisScopeStudents()) {
      const cls = String(r[C.cls] ?? '') || '—';
      if (!map.has(cls)) map.set(cls, init());
      const o = map.get(cls)!;
      o.pool++;
      if (r[C.gender] === 1) o.boys++; else if (r[C.gender] === 2) o.girls++;
      if (r[C.cwsn] === 1) o.cwsn++;
      if (r[C.surveyed] === 1) o.surveyed++;
      const days = r[C.days] as number;
      if (r[C.admitted] === 1) { o.admitted++; if (days >= 0) { o.bridgeSum += days; o.bridgeN++; } }
    }
    const clsNum = (c: string) => (parseInt(c, 10) || 99);
    return [...map.entries()]
      .sort((a, b) => clsNum(a[0]) - clsNum(b[0]))
      .map(([cls, o], i) => ({
        sno: i + 1,
        cls: cls === '—' ? '—' : `Class ${cls}`,
        pool: o.pool,
        boys: o.boys,
        girls: o.girls,
        cwsn: o.cwsn,
        surveyed: o.surveyed,
        admitted: o.admitted,
        pendingAdmission: o.pool - o.admitted,
        bridgeDays: o.bridgeN ? Math.round((o.bridgeSum / o.bridgeN) * 10) / 10 : 0,
      }));
  });

  readonly acisClassTotals = computed(() => {
    const rows = this.acisClassRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const pool = s((r) => r.pool);
    const admitted = s((r) => r.admitted);
    const wN = rows.reduce((t, r) => t + (r.bridgeDays ? r.admitted : 0), 0);
    return {
      count: rows.length,
      pool,
      boys: s((r) => r.boys),
      girls: s((r) => r.girls),
      cwsn: s((r) => r.cwsn),
      surveyed: s((r) => r.surveyed),
      admitted,
      pendingAdmission: pool - admitted,
      bridgeDays: wN
        ? Math.round((rows.reduce((t, r) => t + r.bridgeDays * r.admitted, 0) / wN) * 10) / 10 : 0,
    };
  });

  /** Reason-wise dropout counts (metric 8), with the sub-reason breakdown. */
  readonly acisReasonRows = computed(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const C = AcisStudentCol;
    const init = () => ({ total: 0, admitted: 0, pending: 0, cwsn: 0, subs: new Map<string, number>() });
    const map = new Map<string, ReturnType<typeof init>>();
    let withReason = 0;
    for (const r of this.acisScopeStudents()) {
      const ri = r[C.reason] as number;
      if (ri < 0) continue;
      withReason++;
      const label = a.reasons[ri];
      if (!map.has(label)) map.set(label, init());
      const o = map.get(label)!;
      o.total++;
      if (r[C.admitted] === 1) o.admitted++; else o.pending++;
      if (r[C.cwsn] === 1) o.cwsn++;
      const si = r[C.subReason] as number;
      const sub = si >= 0 ? a.subReasons[si] : '—';
      o.subs.set(sub, (o.subs.get(sub) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((x, y) => y[1].total - x[1].total)
      .map(([reason, o], i) => ({
        sno: i + 1,
        reason,
        total: o.total,
        share: withReason ? Math.round((o.total / withReason) * 1000) / 10 : 0,
        admitted: o.admitted,
        pending: o.pending,
        cwsn: o.cwsn,
        topSub: [...o.subs.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? '—',
        subs: [...o.subs.entries()].sort((p, q) => q[1] - p[1]).map(([sub, count]) => ({ sub, count })),
      }));
  });

  readonly acisReasonTotals = computed(() => {
    const rows = this.acisReasonRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    return {
      count: rows.length,
      total: s((r) => r.total),
      admitted: s((r) => r.admitted),
      pending: s((r) => r.pending),
      cwsn: s((r) => r.cwsn),
      share: 100,
    };
  });

  /** Sub-reasons of the expanded reason row. */
  readonly acisSubReasonRows = computed(() => {
    const reason = this.acisReason();
    if (!reason) return [];
    const row = this.acisReasonRows().find((r) => r.reason === reason);
    if (!row) return [];
    return row.subs.map((s, i) => ({
      sno: i + 1,
      sub: s.sub,
      count: s.count,
      share: row.total ? Math.round((s.count / row.total) * 1000) / 10 : 0,
    }));
  });

  /** Department-wise action taken / to be taken (metric 9). */
  readonly acisDeptRows = computed(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const C = AcisStudentCol;
    const dead = this.acisDeadDept();
    const init = () => ({ total: 0, taken: 0, pending: 0, cwsn: 0 });
    const map = new Map<string, ReturnType<typeof init>>();
    for (const r of this.acisScopeStudents()) {
      const di = r[C.dept] as number;
      if (di < 0 || r[C.surveyed] !== 1) continue;
      const label = a.depts[di];
      if (!map.has(label)) map.set(label, init());
      const o = map.get(label)!;
      o.total++;
      if (r[C.admitted] === 1 || r[C.umis] === 1 || di === dead) o.taken++; else o.pending++;
      if (r[C.cwsn] === 1) o.cwsn++;
    }
    return [...map.entries()]
      .sort((x, y) => y[1].pending - x[1].pending || y[1].total - x[1].total)
      .map(([dept, o], i) => ({
        sno: i + 1,
        dept,
        total: o.total,
        taken: o.taken,
        pending: o.pending,
        cwsn: o.cwsn,
        takenPct: o.total ? Math.round((o.taken / o.total) * 1000) / 10 : 0,
      }));
  });

  readonly acisDeptTotals = computed(() => {
    const rows = this.acisDeptRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const total = s((r) => r.total);
    const taken = s((r) => r.taken);
    return {
      count: rows.length,
      total,
      taken,
      pending: s((r) => r.pending),
      cwsn: s((r) => r.cwsn),
      takenPct: total ? Math.round((taken / total) * 1000) / 10 : 0,
    };
  });

  /**
   * Month-wise common-pool entries from the start of the academic year
   * (metric 12). Real: counted off transfer_date / common_pool_date. The
   * potential-dropout series on the same view is the assumed one.
   */
  readonly acisTrendRows = computed(() => {
    const C = AcisStudentCol;
    const init = () => ({ entered: 0, surveyed: 0, admitted: 0 });
    const map = new Map<string, ReturnType<typeof init>>();
    for (const r of this.acisScopeStudents()) {
      const d = String(r[C.transferDate] ?? '') || String(r[C.surveyDate] ?? '');
      const m = d.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) continue;
      if (!map.has(m)) map.set(m, init());
      const o = map.get(m)!;
      o.entered++;
      if (r[C.surveyed] === 1) o.surveyed++;
      if (r[C.admitted] === 1) o.admitted++;
    }
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const rows = [...map.entries()].sort();
    let running = 0;
    return rows.map(([month, o], i) => {
      running += o.entered;
      const mi = parseInt(month.slice(5), 10) - 1;
      return {
        sno: i + 1,
        month,
        label: `${MONTHS[mi] ?? month} ${month.slice(0, 4)}`,
        entered: o.entered,
        surveyed: o.surveyed,
        admitted: o.admitted,
        pending: o.entered - o.admitted,
        cumulative: running,
      };
    });
  });

  readonly acisTrendTotals = computed(() => {
    const rows = this.acisTrendRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    return {
      count: rows.length,
      entered: s((r) => r.entered),
      surveyed: s((r) => r.surveyed),
      admitted: s((r) => r.admitted),
      pending: s((r) => r.pending),
      cumulative: rows.length ? rows[rows.length - 1].cumulative : 0,
    };
  });

  /**
   * Potential dropouts per unit (REAL — EMIS Potential Dropout report): PD =
   * students absent 15+ days in the last 30.
   *
   *   PD % = PD students / enrolled students × 100
   *
   * The PD report only covers the school types it lists (government schools),
   * so the denominator is enrolment in those school types — dividing by the
   * whole roll would dilute PD % with private schools the report never covers.
   * School type / gender / class filters narrow numerator AND denominator.
   */
  /** School types the PD report covers (its denominator universe). */
  private readonly pdSchoolTypes = computed(
    () => new Set((this._acisPd()?.schoolRefs ?? []).map((s) => s.t)),
  );

  /** Enrolled students in `rows` that match the PD filters (PD % denominator). */
  private pdEnrolled(rows: SchoolRow[]): number {
    const fType = this.acisFSchoolType();
    const fGender = this.acisFGender();
    const fClass = this.acisFClass();
    const types = this.pdSchoolTypes();
    const gi = fClass !== 'all' ? (parseInt(fClass, 10) || 0) + 2 : -1; // GRADE_ORDER: I = index 3
    let n = 0;
    for (const s of rows) {
      if (fType === 'all' ? !types.has(s.stype) : s.stype !== fType) continue;
      if (gi >= 3) {
        if (fGender !== '2') n += s.gb?.[gi] ?? 0;
        if (fGender !== '1') n += s.gg?.[gi] ?? 0;
      } else {
        n += fGender === '1' ? (s.boys ?? 0) : fGender === '2' ? (s.girls ?? 0) : (s.students ?? 0);
      }
    }
    return n;
  }

  /** PD students in the current scope with school type / gender / class applied. */
  private readonly pdScopeStudents = computed<(number | string)[][]>(() => {
    const a = this._acisPd();
    if (!a) return [];
    const C = AcisPdCol;
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    const fType = this.acisFSchoolType();
    const fGender = this.acisFGender();
    const fClass = this.acisFClass();
    const ok = new Uint8Array(a.schoolRefs.length);
    for (let i = 0; i < a.schoolRefs.length; i++) {
      const s = a.schoolRefs[i];
      if (dist && s.d.toUpperCase() !== dist) continue;
      if (blk && s.b.toUpperCase() !== blk) continue;
      if (fType !== 'all' && s.t !== fType) continue;
      ok[i] = 1;
    }
    return a.students.filter((r) => ok[r[C.school] as number] === 1
      && (fGender === 'all' || String(r[C.gender]) === fGender)
      && (fClass === 'all' || r[C.cls] === fClass));
  });

  /** PD reason-wise counts (reason category → reason), within the filters. */
  readonly acisPdReasonRows = computed(() => {
    const a = this._acisPd();
    if (!a) return [];
    const C = AcisPdCol;
    const map = new Map<string, { category: string; reason: string; pd: number; repeaters: number; boys: number; girls: number }>();
    const all = this.pdScopeStudents();
    for (const r of all) {
      const category = a.categories[r[C.category] as number] ?? '—';
      const reason = a.reasons[r[C.reason] as number] ?? '—';
      const k = `${category}||${reason}`;
      let o = map.get(k);
      if (!o) { o = { category, reason, pd: 0, repeaters: 0, boys: 0, girls: 0 }; map.set(k, o); }
      o.pd++;
      if (r[C.repeater] === 1) o.repeaters++;
      if (r[C.gender] === 1) o.boys++; else if (r[C.gender] === 2) o.girls++;
    }
    const total = all.length;
    return [...map.values()]
      .sort((x, y) => y.pd - x.pd)
      .map((o, i) => ({ sno: i + 1, ...o, share: total ? Math.round((o.pd / total) * 1000) / 10 : 0 }));
  });

  readonly acisPdReasonTotals = computed(() => {
    const rows = this.acisPdReasonRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    return { count: rows.length, pd: s((r) => r.pd), repeaters: s((r) => r.repeaters), boys: s((r) => r.boys), girls: s((r) => r.girls) };
  });

  /** Reason categories, largest first — the columns of the grade-wise matrix. */
  readonly acisPdCategories = computed(() => {
    const a = this._acisPd();
    if (!a) return [] as string[];
    const C = AcisPdCol;
    const n = new Map<string, number>();
    for (const r of this.pdScopeStudents()) {
      const c = a.categories[r[C.category] as number] ?? '—';
      n.set(c, (n.get(c) ?? 0) + 1);
    }
    return [...n.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
  });

  /** Potential dropouts grade-wise, split by reason category. */
  readonly acisPdGradeRows = computed(() => {
    const a = this._acisPd();
    if (!a) return [];
    const C = AcisPdCol;
    const map = new Map<string, { pd: number; boys: number; girls: number; repeaters: number; cats: Record<string, number> }>();
    for (const r of this.pdScopeStudents()) {
      const cls = String(r[C.cls] || '—');
      let o = map.get(cls);
      if (!o) { o = { pd: 0, boys: 0, girls: 0, repeaters: 0, cats: {} }; map.set(cls, o); }
      o.pd++;
      if (r[C.gender] === 1) o.boys++; else if (r[C.gender] === 2) o.girls++;
      if (r[C.repeater] === 1) o.repeaters++;
      const c = a.categories[r[C.category] as number] ?? '—';
      o.cats[c] = (o.cats[c] ?? 0) + 1;
    }
    const num = (c: string) => parseInt(c, 10) || 99;
    return [...map.entries()]
      .sort((x, y) => num(x[0]) - num(y[0]))
      .map(([cls, o], i) => ({ sno: i + 1, cls: cls === '—' ? '—' : `Class ${cls}`, ...o }));
  });

  readonly acisPdGradeTotals = computed(() => {
    const rows = this.acisPdGradeRows();
    const cats: Record<string, number> = {};
    for (const r of rows) for (const [c, v] of Object.entries(r.cats)) cats[c] = (cats[c] ?? 0) + v;
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    return { count: rows.length, pd: s((r) => r.pd), boys: s((r) => r.boys), girls: s((r) => r.girls), repeaters: s((r) => r.repeaters), cats };
  });

  // ---- infographic breakdowns (ACiS dashboard charts) ----
  /**
   * Management-wise and grade-wise splits for the two populations:
   *   potential dropouts  PD report (absent 15+ of the last 30 days)
   *   dropouts            the common pool (children who left school)
   * Both read the scoped + filtered rows, so they follow the dashboard scope
   * and the school type / gender / class filters. Grade rows carry a
   * boys/girls split for a stacked chart.
   */
  private gradeSplit(rows: (number | string)[][], clsCol: number, genderCol: number) {
    const m = new Map<string, { boys: number; girls: number }>();
    for (const r of rows) {
      const c = String(r[clsCol] || '—');
      let o = m.get(c);
      if (!o) { o = { boys: 0, girls: 0 }; m.set(c, o); }
      if (r[genderCol] === 1) o.boys++; else if (r[genderCol] === 2) o.girls++;
    }
    const n = (c: string) => parseInt(c, 10) || 99;
    return [...m.entries()].sort((a, b) => n(a[0]) - n(b[0]))
      .map(([c, o]) => ({ label: c === '—' ? '—' : `Class ${c}`, ...o }));
  }

  /**
   * The four management groups the dashboard reports on, from school type:
   * Government (incl. Central Govt), Fully Aided, Partially Aided, Private
   * (Un-aided). Anything unrecognised is shown as "Not recorded".
   */
  readonly ACIS_MGMT_GROUPS = ['Government', 'Fully Aided', 'Partially Aided', 'Private'] as const;
  private mgmtGroup(schoolType: string): string {
    const t = (schoolType ?? '').toLowerCase();
    if (t.startsWith('government') || t.startsWith('central')) return 'Government';
    if (t.startsWith('fully')) return 'Fully Aided';
    if (t.startsWith('partial')) return 'Partially Aided';
    if (t.startsWith('un-aided') || t.startsWith('unaided') || t.startsWith('private')) return 'Private';
    return 'Not recorded';
  }

  /** Count rows per management group, in the fixed group order (zeros kept). */
  private byMgmtGroup(types: string[]): { label: string; value: number }[] {
    const m = new Map<string, number>();
    for (const t of types) { const g = this.mgmtGroup(t); m.set(g, (m.get(g) ?? 0) + 1); }
    const out = this.ACIS_MGMT_GROUPS.map((g) => ({ label: g as string, value: m.get(g) ?? 0 }));
    const other = m.get('Not recorded');
    if (other) out.push({ label: 'Not recorded', value: other });
    return out;
  }

  readonly acisPdByManagement = computed(() => {
    const a = this._acisPd();
    if (!a) return [];
    return this.byMgmtGroup(this.pdScopeStudents().map((r) => a.schoolRefs[r[AcisPdCol.school] as number]?.t ?? ''));
  });
  readonly acisPdByGrade = computed(() =>
    this.gradeSplit(this.pdScopeStudents(), AcisPdCol.cls, AcisPdCol.gender));

  readonly acisDropByManagement = computed(() => {
    const a = this._acisStudents();
    if (!a) return [];
    return this.byMgmtGroup(this.acisScopeStudents().map((r) => a.schools[r[AcisStudentCol.school] as number]?.t ?? ''));
  });
  readonly acisDropByGrade = computed(() =>
    this.gradeSplit(this.acisScopeStudents(), AcisStudentCol.cls, AcisStudentCol.gender));

  /**
   * School category groups: Primary / Middle / High / Hr. Secondary, from the
   * `School_Category` / `Category` field. Anything else (pre-primary, "Others")
   * is reported as "Others" only when it is non-zero.
   */
  readonly ACIS_CATEGORY_GROUPS = ['Primary', 'Middle', 'High', 'Hr. Secondary'] as const;
  private categoryGroup(cat: string): string {
    const c = (cat ?? '').toLowerCase();
    if (c.startsWith('higher secondary') || c.startsWith('hr')) return 'Hr. Secondary';
    if (c.startsWith('high')) return 'High';
    if (c.startsWith('middle')) return 'Middle';
    if (c.startsWith('primary')) return 'Primary';
    return 'Others';
  }
  private byCategory(cats: string[]): Record<string, number> {
    const m: Record<string, number> = {};
    for (const c of cats) { const g = this.categoryGroup(c); m[g] = (m[g] ?? 0) + 1; }
    return m;
  }
  /** Common-pool students and potential dropouts per school category, same scope + filters. */
  readonly acisByCategory = computed(() => {
    const cp = this._acisStudents();
    const pdA = this._acisPd();
    const pool = cp ? this.byCategory(this.acisScopeStudents().map((r) => cp.schools[r[AcisStudentCol.school] as number]?.c ?? '')) : {};
    const pd = pdA ? this.byCategory(this.pdScopeStudents().map((r) => pdA.schoolRefs[r[AcisPdCol.school] as number]?.c ?? '')) : {};
    const groups: string[] = [...this.ACIS_CATEGORY_GROUPS];
    if ((pool['Others'] ?? 0) + (pd['Others'] ?? 0) > 0) groups.push('Others');
    return groups.map((g) => ({ label: g, pool: pool[g] ?? 0, pd: pd[g] ?? 0 }));
  });

  // ================= ACiS — DROPOUT RATE =================
  /**
   * Dropout rate (REAL):  N ÷ D × 100
   *   N  common-pool children of the class / level who have NOT been
   *      re-enrolled (Admit_status ≠ Admitted) — they left school and are
   *      still out.
   *   D  students enrolled in that class / level, from the 2026-27 enrolment
   *      roll (grade-wise boys + girls), in the same scope.
   * School type, gender and class filters narrow both N and D. CWSN and UMIS
   * cannot apply here — the enrolment roll has neither — so the dropout-rate
   * view hides those two filters and ignores them.
   *
   * Reason groups (metric sheet): Migration · CWSN · Illness · Child marriage ·
   * Other; children not surveyed yet have no reason ("Not recorded").
   */
  readonly ACIS_LEVELS = [
    { label: 'Primary (I–V)', from: 1, to: 5 },
    { label: 'Upper Primary (VI–VIII)', from: 6, to: 8 },
    { label: 'Secondary (IX–X)', from: 9, to: 10 },
    { label: 'Hr. Secondary (XI–XII)', from: 11, to: 12 },
  ] as const;
  readonly ACIS_DROP_REASONS = ['Migration', 'CWSN', 'Illness', 'Child marriage', 'Other', 'Not recorded'] as const;

  private dropReasonGroup(reason: string | undefined, sub: string | undefined): string {
    if (!reason || reason === '—') return 'Not recorded';
    if (/child marriage/i.test(sub ?? '')) return 'Child marriage';
    if (/MIGRATION/i.test(reason)) return 'Migration';
    if (/DIFFERENTLY/i.test(reason)) return 'CWSN';
    if (/HEALTH/i.test(reason)) return 'Illness';
    return 'Other';
  }

  /** Enrolment roll for the current scope (all schools at state level). */
  private scopeRoll(): SchoolRow[] {
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    if (blk) return this.ds.schoolsForBlock();
    if (dist) return this.ds.schoolRowsFor(dist);
    return this.ds.districts().flatMap((d) => this.ds.schoolRowsFor(d.name));
  }

  /** Grade-wise enrolment (classes I–XII) of `rows`, with school type + gender filters. */
  private enrolByGrade(rows: SchoolRow[], typeOk: (stype: string) => boolean): number[] {
    const fGender = this.acisFGender();
    const out = new Array(13).fill(0);              // index = class 1..12
    for (const s of rows) {
      if (!typeOk(s.stype)) continue;
      for (let c = 1; c <= 12; c++) {
        const gi = c + 2;                           // GRADE_ORDER: I = index 3
        if (fGender !== '2') out[c] += s.gb?.[gi] ?? 0;
        if (fGender !== '1') out[c] += s.gg?.[gi] ?? 0;
      }
    }
    return out;
  }

  /** Not-re-enrolled common-pool children in scope, with type / gender / class filters only. */
  private readonly dropScopeStudents = computed<AcisStudentRow[]>(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const C = AcisStudentCol;
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    const fType = this.acisFSchoolType();
    const fGender = this.acisFGender();
    const fClass = this.acisFClass();
    const ok = new Uint8Array(a.schools.length);
    for (let i = 0; i < a.schools.length; i++) {
      const s = a.schools[i];
      if (dist && s.d.toUpperCase() !== dist) continue;
      if (blk && s.b.toUpperCase() !== blk) continue;
      if (fType !== 'all' && s.t !== fType) continue;
      ok[i] = 1;
    }
    return a.students.filter((r) => ok[r[C.school] as number] === 1
      && r[C.admitted] !== 1
      && (fGender === 'all' || String(r[C.gender]) === fGender)
      && (fClass === 'all' || r[C.cls] === fClass));
  });

  /** Grade-wise dropout rate rows (classes I–XII) with the reason split. */
  readonly acisDropGradeRows = computed(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const C = AcisStudentCol;
    const fType = this.acisFSchoolType();
    const fClass = this.acisFClass();
    const D = this.enrolByGrade(this.scopeRoll(), (t) => fType === 'all' || t === fType);
    const blank = () => Object.fromEntries(this.ACIS_DROP_REASONS.map((g) => [g, 0])) as Record<string, number>;
    const N = Array.from({ length: 13 }, () => ({ n: 0, reasons: blank() }));
    for (const r of this.dropScopeStudents()) {
      const c = parseInt(String(r[C.cls]), 10);
      if (!(c >= 1 && c <= 12)) continue;
      const ri = r[C.reason] as number;
      const si = r[C.subReason] as number;
      const g = this.dropReasonGroup(ri >= 0 ? a.reasons[ri] : undefined, si >= 0 ? a.subReasons[si] : undefined);
      N[c].n++;
      N[c].reasons[g]++;
    }
    const rows = [];
    for (let c = 1; c <= 12; c++) {
      if (fClass !== 'all' && String(c) !== fClass) continue;
      rows.push({
        cls: c, label: `Class ${c}`, enrolled: D[c], dropouts: N[c].n,
        rate: D[c] ? Math.round((N[c].n / D[c]) * 10000) / 100 : 0,
        reasons: N[c].reasons,
      });
    }
    return rows;
  });

  /** Level-wise roll-up of the grade rows (Primary / Upper Primary / Secondary / Hr. Sec). */
  readonly acisDropLevelRows = computed(() => {
    const g = this.acisDropGradeRows();
    return this.ACIS_LEVELS.map((lv) => {
      const rows = g.filter((r) => r.cls >= lv.from && r.cls <= lv.to);
      const enrolled = rows.reduce((t, r) => t + r.enrolled, 0);
      const dropouts = rows.reduce((t, r) => t + r.dropouts, 0);
      const reasons = Object.fromEntries(this.ACIS_DROP_REASONS.map((k) =>
        [k, rows.reduce((t, r) => t + (r.reasons[k] ?? 0), 0)])) as Record<string, number>;
      return { label: lv.label, enrolled, dropouts, rate: enrolled ? Math.round((dropouts / enrolled) * 10000) / 100 : 0, reasons };
    }).filter((r) => r.enrolled > 0 || r.dropouts > 0);
  });

  /** Totals across classes I–XII. */
  readonly acisDropTotals = computed(() => {
    const g = this.acisDropGradeRows();
    const enrolled = g.reduce((t, r) => t + r.enrolled, 0);
    const dropouts = g.reduce((t, r) => t + r.dropouts, 0);
    const reasons = Object.fromEntries(this.ACIS_DROP_REASONS.map((k) =>
      [k, g.reduce((t, r) => t + (r.reasons[k] ?? 0), 0)])) as Record<string, number>;
    return { enrolled, dropouts, rate: enrolled ? Math.round((dropouts / enrolled) * 10000) / 100 : 0, reasons };
  });

  /** Dropout rate per management group (Government / Fully Aided / Partially Aided / Private). */
  readonly acisDropTypeRows = computed(() => {
    const a = this._acisStudents();
    if (!a) return [];
    const C = AcisStudentCol;
    const fClass = this.acisFClass();
    const roll = this.scopeRoll();
    const n: Record<string, number> = {};
    for (const r of this.dropScopeStudents()) {
      const c = parseInt(String(r[C.cls]), 10);
      if (!(c >= 1 && c <= 12)) continue;
      const g = this.mgmtGroup(a.schools[r[C.school] as number]?.t ?? '');
      n[g] = (n[g] ?? 0) + 1;
    }
    return this.ACIS_MGMT_GROUPS.map((g) => {
      const D = this.enrolByGrade(roll, (t) => this.mgmtGroup(t) === g && (this.acisFSchoolType() === 'all' || t === this.acisFSchoolType()));
      const enrolled = fClass === 'all' ? D.reduce((t, v) => t + v, 0) : D[parseInt(fClass, 10)] ?? 0;
      const dropouts = n[g] ?? 0;
      return { label: g as string, enrolled, dropouts, rate: enrolled ? Math.round((dropouts / enrolled) * 10000) / 100 : 0 };
    });
  });

  /** Tile-level denominator: enrolment in classes I–XII (all school types). */
  enrolI12Fields(rows: SchoolRow[]): Partial<DrillRow> {
    let n = 0;
    for (const s of rows) for (let gi = 3; gi <= 14; gi++) n += (s.gb?.[gi] ?? 0) + (s.gg?.[gi] ?? 0);
    return { acisEnrolI12: n };
  }

  /** PD class options (from the PD report itself). */
  readonly acisPdClassOptions = computed(() => {
    const set = new Set<string>();
    for (const r of this._acisPd()?.students ?? []) if (r[AcisPdCol.cls]) set.add(String(r[AcisPdCol.cls]));
    return [{ label: 'All classes', value: 'all' },
      ...[...set].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99))
        .map((c) => ({ label: `Class ${c}`, value: c }))];
  });

  /** PD school-type options (the types the PD report covers). */
  readonly acisPdSchoolTypeOptions = computed(() => [
    { label: 'All school types', value: 'all' },
    ...[...this.pdSchoolTypes()].sort().map((t) => ({ label: t, value: t })),
  ]);

  /** Enrolment denominator for the tile-level PD % (government-school roll). */
  pdBaseFields(rows: SchoolRow[]): Partial<DrillRow> {
    if (!this._acisPd()) return {};
    const types = this.pdSchoolTypes();
    let n = 0;
    for (const s of rows) if (types.has(s.stype)) n += s.students ?? 0;
    return { acisPdBase: n };
  }

  // ================= SMC (meetings, resolutions, grants) =================
  /**
   * The SMC component covers two units of analysis — the MEETING and the
   * RESOLUTION — plus the school composite grant, all over the same scopes, so
   * it gets its own drill.
   *
   * Every figure is read through the active rolling window (`smcPeriod`): the
   * metric sheet asks for last 12 / 9 / 6 / 3 months, and `all` (the full
   * export) is the default so the headline tiles are stable. The windows are
   * anchored to the latest date in the export, not to the clock.
   *
   * `smcView()` picks the table from the active KPI:
   *   meetings   unit summary (eligible / held / not held / attendance) → school list
   *   emergency  emergency resolved vs unresolved + department-wise abstract
   *   other      the same for non-emergency resolutions
   *   all        every resolution, same shape
   *   grant      allocated vs utilised (utilisation is ASSUMED)
   */
  readonly smcPeriod = signal<SmcPeriodKey>('all');
  readonly smcPeriodOptions: { label: string; value: SmcPeriodKey }[] = [
    { label: 'All (full export)', value: 'all' },
    { label: 'Last 1 year', value: 'p12' },
    { label: 'Last 9 months', value: 'p9' },
    { label: 'Last 6 months', value: 'p6' },
    { label: 'Last 3 months', value: 'p3' },
  ];
  setSmcPeriod(p: SmcPeriodKey): void { this.smcPeriod.set(p); }
  /** Label + window start, for the "showing X since Y" caption. */
  readonly smcPeriodLabel = computed(
    () => this.smcPeriodOptions.find((o) => o.value === this.smcPeriod())?.label ?? '',
  );
  readonly smcPeriodFrom = computed(() => {
    const p = this.smcPeriod();
    if (p === 'all') return '';
    return this._smcReal()?.cutoffs?.[p] ?? '';
  });
  readonly smcAnchorDate = computed(() => this._smcReal()?.anchorDate ?? '');

  readonly smcKpiTabs: { id: string; label: string }[] = [
    { id: 'm_mh', label: 'Meetings held' },
    { id: 'm_mn', label: 'Meetings not held' },
    { id: 'm_ma', label: 'Meeting attendance' },
    { id: 'm_r', label: 'All resolutions' },
    { id: 'm_e', label: 'Emergency' },
    { id: 'm_or', label: 'Other resolutions' },
    { id: 'm_ga', label: 'Grant utilisation' },
  ];
  /** Every SMC KPI id that routes into this drill, mapped to its view. */
  private readonly SMC_KPI_VIEW: Record<string, 'meetings' | 'emergency' | 'other' | 'all' | 'grant'> = {
    m_mh: 'meetings', m_mn: 'meetings', m_ma: 'meetings', m_mt: 'meetings',
    m_r: 'all', m_c: 'all', m_p: 'all', m_k: 'all',
    m_e: 'emergency', m_er: 'emergency', m_ek: 'emergency',
    m_or: 'other', m_ou: 'other', m_ok: 'other',
    m_ga: 'grant', m_gu: 'grant', m_gp: 'grant',
  };

  readonly smcKpiId = signal<string | null>(null);
  /** District / block / school name drilled into for the school list. */
  readonly smcUnit = signal<string | null>(null);

  hasSmcDrill(kpiId: string): boolean { return !!this.SMC_KPI_VIEW[kpiId]; }
  openSmcDrill(kpiId: string): void {
    this.loadSmcDetail();
    this.smcKpiId.set(this.SMC_KPI_VIEW[kpiId] ? kpiId : 'm_mh');
    this.smcUnit.set(null);
  }
  closeSmcDrill(): void { this.smcKpiId.set(null); this.smcUnit.set(null); }
  setSmcKpi(id: string): void { this.smcKpiId.set(id); this.smcUnit.set(null); }
  smcSelectUnit(u: string | null): void { this.smcUnit.set(u); }

  /**
   * Drill the SMC grid one level deeper: state → district → block → school.
   * This moves the dashboard scope (same as the generic drill), so the grid,
   * the tiles and the breadcrumb all follow. At block level the rows are
   * already schools, so a click there opens the school profile drawer.
   */
  smcDrillRow(row: { key: string }): void {
    const level = this.ds.level();
    this.smcUnit.set(null);
    if (level === 'state') this.ds.drillToDistrict(row.key);
    else if (level === 'district') this.ds.drillToBlock(row.key);
  }

  /**
   * True when the meetings view should render the per-school table rather than
   * the unit summary: either the scope is already a block (so the children ARE
   * schools), or a unit was opened explicitly.
   */
  readonly smcShowSchools = computed(() => !!this.smcUnit() || !!this.ds.selectedBlock());

  readonly smcKpiLabel = computed(() => {
    const id = this.smcKpiId();
    if (!id) return '';
    for (const m of KPI_MODULES) { const def = m.kpis.find((k) => k.id === id); if (def) return def.label; }
    return '';
  });

  readonly smcView = computed(() => this.SMC_KPI_VIEW[this.smcKpiId() ?? ''] ?? 'meetings');
  /**
   * Which KPI tab to highlight. Several KPIs share a view (m_mh/m_mn/m_ma/m_mt
   * are all "meetings"), and the tile grid can open any of the 17 SMC KPIs, so
   * fall back to the first tab belonging to the active view.
   */
  readonly smcActiveTab = computed(() => {
    const id = this.smcKpiId() ?? 'm_mh';
    if (this.smcKpiTabs.some((t) => t.id === id)) return id;
    const view = this.smcView();
    return this.smcKpiTabs.find((t) => this.SMC_KPI_VIEW[t.id] === view)?.id ?? 'm_mh';
  });
  /** Only the grant view carries synthesized figures. */
  readonly smcAssumed = computed(() => this.smcView() === 'grant');
  /** The detail asset backs the school lists and department abstracts. */
  readonly smcDetailLoading = computed(() => !this._smcDetail());

  readonly smcUnitLabel = computed(() => (this.ds.selectedBlock() ? 'School'
    : this.ds.selectedDistrict() ? 'Block' : 'District'));

  /** Active window as a day-offset floor into the detail asset's `day` column. */
  private readonly smcDayFloor = computed(() => {
    const d = this._smcDetail();
    const p = this.smcPeriod();
    if (!d || p === 'all') return -1;
    const cut = d.cutoffs?.[p];
    if (!cut) return -1;
    return Math.round((Date.parse(cut) - Date.parse(d.baseDate)) / 86400000);
  });

  /** Turn a detail-asset day offset back into an ISO date. */
  private smcDayToIso(day: number): string {
    const d = this._smcDetail();
    if (!d || day < 0) return '';
    return new Date(Date.parse(d.baseDate) + day * 86400000).toISOString().slice(0, 10);
  }

  /** Detail-asset school indexes inside the current dashboard scope. */
  private readonly smcScopeSchoolMask = computed<Uint8Array>(() => {
    const d = this._smcDetail();
    if (!d) return new Uint8Array(0);
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    const mask = new Uint8Array(d.schools.length);
    for (let i = 0; i < d.schools.length; i++) {
      const s = d.schools[i];
      if (dist && s.d.toUpperCase() !== dist) continue;
      if (blk && s.b.toUpperCase() !== blk) continue;
      mask[i] = 1;
    }
    return mask;
  });

  /** Meeting rows inside scope and inside the active window. */
  private readonly smcScopeMeetings = computed<number[][]>(() => {
    const d = this._smcDetail();
    if (!d) return [];
    const M = SmcMeetingCol;
    const mask = this.smcScopeSchoolMask();
    const floor = this.smcDayFloor();
    return d.meetings.filter((m) => mask[m[M.school]] === 1 && m[M.day] >= floor);
  });

  /** Resolution rows inside scope and inside the active window. */
  private readonly smcScopeResolutions = computed<number[][]>(() => {
    const d = this._smcDetail();
    if (!d) return [];
    const R = SmcResolutionCol;
    const mask = this.smcScopeSchoolMask();
    const floor = this.smcDayFloor();
    return d.resolutions.filter((r) => mask[r[R.school]] === 1 && r[R.day] >= floor);
  });

  /**
   * Meetings-held abstract per unit (metric 1a/1b/1c). Built from `drillRows()`,
   * which already carries the window-aware counters plus the eligible-school
   * denominator, so this needs no detail asset.
   */
  readonly smcMeetingRows = computed(() => {
    return this.drillRows()
      .map((r) => {
        const eligible = r.smcEligibleSchools ?? 0;
        const held = r.smcSchoolsHeld ?? 0;
        const present = r.smcPresent ?? 0;
        const absent = r.smcAbsent ?? 0;
        return {
          key: r.key,
          unit: r.name,
          eligible,
          held,
          notHeld: r.smcSchoolsNotHeld ?? Math.max(0, eligible - held),
          heldPct: eligible ? Math.round((held / eligible) * 1000) / 10 : 0,
          meetings: r.smcMeetings ?? 0,
          avgMeetings: held ? Math.round(((r.smcMeetings ?? 0) / held) * 10) / 10 : 0,
          present,
          absent,
          vacant: r.smcVacant ?? 0,
          attendancePct: present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.notHeld - a.notHeld || a.unit.localeCompare(b.unit))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });

  readonly smcMeetingTotals = computed(() => {
    const rows = this.smcMeetingRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const eligible = s((r) => r.eligible);
    const held = s((r) => r.held);
    const present = s((r) => r.present);
    const absent = s((r) => r.absent);
    return {
      count: rows.length,
      eligible,
      held,
      notHeld: s((r) => r.notHeld),
      heldPct: eligible ? Math.round((held / eligible) * 1000) / 10 : 0,
      meetings: s((r) => r.meetings),
      avgMeetings: held ? Math.round((s((r) => r.meetings) / held) * 10) / 10 : 0,
      present,
      absent,
      vacant: s((r) => r.vacant),
      attendancePct: present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : 0,
    };
  });

  /**
   * Per-school meeting detail for the drilled unit (metric 1c, and the actual
   * list behind "meetings not held"). The eligible universe comes from the
   * enrolment roll; meeting counts come from the detail asset.
   */
  readonly smcSchoolRows = computed(() => {
    const d = this._smcDetail();
    if (!d || !this.smcShowSchools()) return [];
    const M = SmcMeetingCol;
    const unit = this.smcUnit();
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    const mgmts = this.smcManagements();

    // Which schools to list: an explicitly opened unit wins, otherwise the
    // current scope (which smcShowSchools() guarantees is a block).
    let roll: SchoolRow[];
    if (unit && blk) roll = this.ds.schoolsForBlock().filter((s) => s.name === unit);
    else if (unit && dist) roll = this.ds.schoolRowsFor(dist, unit);
    else if (unit) roll = this.ds.schoolRowsFor(unit);
    else roll = this.ds.schoolsForBlock();
    roll = roll.filter((s) => mgmts.has(s.mgmt ?? ''));

    // meeting totals per UDISE for the unit, inside the active window
    const byUdise = new Map<string, { meetings: number; present: number; absent: number; vacant: number; last: number }>();
    for (const m of this.smcScopeMeetings()) {
      const s = d.schools[m[M.school]];
      if (!s.u) continue;
      let o = byUdise.get(s.u);
      if (!o) { o = { meetings: 0, present: 0, absent: 0, vacant: 0, last: -1 }; byUdise.set(s.u, o); }
      o.meetings++;
      o.present += m[M.present];
      o.absent += m[M.absent];
      o.vacant += m[M.vacant];
      if (m[M.day] > o.last) o.last = m[M.day];
    }

    const notHeldOnly = this.smcKpiId() === 'm_mn';
    const out = roll.map((s) => {
      const o = byUdise.get(s.udise);
      const present = o?.present ?? 0;
      const absent = o?.absent ?? 0;
      return {
        udise: s.udise,
        school: s.name,
        management: s.mgmt,
        category: s.ctype,
        students: s.students ?? 0,
        meetings: o?.meetings ?? 0,
        held: (o?.meetings ?? 0) > 0 ? 'Yes' : 'No',
        present,
        absent,
        vacant: o?.vacant ?? 0,
        attendancePct: present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : 0,
        lastMeeting: o && o.last >= 0 ? this.smcDayToIso(o.last) : '—',
      };
    }).filter((r) => !notHeldOnly || r.held === 'No');

    out.sort((a, b) => a.meetings - b.meetings || a.school.localeCompare(b.school));
    return out.map((r, i) => ({ sno: i + 1, ...r }));
  });

  readonly smcSchoolTotals = computed(() => {
    const rows = this.smcSchoolRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const present = s((r) => r.present);
    const absent = s((r) => r.absent);
    return {
      count: rows.length,
      held: rows.filter((r) => r.held === 'Yes').length,
      notHeld: rows.filter((r) => r.held === 'No').length,
      students: s((r) => r.students),
      meetings: s((r) => r.meetings),
      present,
      absent,
      vacant: s((r) => r.vacant),
      attendancePct: present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : 0,
    };
  });

  /**
   * Resolution completion status per unit (metrics 2 and 3). The active view
   * decides whether emergency, non-emergency or all resolutions are counted;
   * all three come off `drillRows()` and so respect the active window.
   */
  readonly smcResolutionRows = computed(() => {
    const view = this.smcView();
    return this.drillRows()
      .map((r) => {
        const raised = view === 'emergency' ? (r.smcEmergencyRaised ?? 0)
          : view === 'other' ? (r.smcOtherRaised ?? 0) : (r.smcRaised ?? 0);
        const resolved = view === 'emergency' ? (r.smcEmergencyResolved ?? 0)
          : view === 'other' ? (r.smcOtherResolved ?? 0) : (r.smcClosed ?? 0);
        const unresolved = view === 'emergency' ? (r.smcEmergencyOpen ?? 0)
          : view === 'other' ? (r.smcOtherOpen ?? 0) : (r.smcPending ?? 0);
        const base = resolved + unresolved;
        return {
          key: r.key,
          unit: r.name,
          schools: r.ns ?? 0,
          raised,
          resolved,
          unresolved,
          withdrawn: Math.max(0, raised - base),
          completionPct: base ? Math.round((resolved / base) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.unresolved - a.unresolved || a.unit.localeCompare(b.unit))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });

  readonly smcResolutionTotals = computed(() => {
    const rows = this.smcResolutionRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const resolved = s((r) => r.resolved);
    const unresolved = s((r) => r.unresolved);
    return {
      count: rows.length,
      schools: s((r) => r.schools),
      raised: s((r) => r.raised),
      resolved,
      unresolved,
      withdrawn: s((r) => r.withdrawn),
      completionPct: resolved + unresolved ? Math.round((resolved / (resolved + unresolved)) * 1000) / 10 : 0,
    };
  });

  /**
   * Department-wise abstract (the second half of metrics 2 and 3). Computed
   * from the detail asset so it works at every scope, filtered to the active
   * view's emergency flag and to the active window.
   */
  readonly smcDeptRows = computed(() => {
    const d = this._smcDetail();
    if (!d) return [];
    const R = SmcResolutionCol;
    const view = this.smcView();
    const init = () => ({ raised: 0, resolved: 0, unresolved: 0, withdrawn: 0, emergency: 0 });
    const map = new Map<string, ReturnType<typeof init>>();
    for (const r of this.smcScopeResolutions()) {
      const emg = r[R.emergency] === 1;
      if (view === 'emergency' && !emg) continue;
      if (view === 'other' && emg) continue;
      const label = d.depts[r[R.dept]] ?? '—';
      let o = map.get(label);
      if (!o) { o = init(); map.set(label, o); }
      o.raised++;
      if (emg) o.emergency++;
      const st = r[R.status];
      if (st === 1) o.resolved++;
      else if (st === 2) o.withdrawn++;
      else o.unresolved++;        // unresolved + work in progress
    }
    return [...map.entries()]
      .sort((a, b) => b[1].unresolved - a[1].unresolved || b[1].raised - a[1].raised)
      .map(([dept, o], i) => ({
        sno: i + 1,
        dept,
        raised: o.raised,
        resolved: o.resolved,
        unresolved: o.unresolved,
        withdrawn: o.withdrawn,
        emergency: o.emergency,
        completionPct: o.resolved + o.unresolved
          ? Math.round((o.resolved / (o.resolved + o.unresolved)) * 1000) / 10 : 0,
      }));
  });

  readonly smcDeptTotals = computed(() => {
    const rows = this.smcDeptRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const resolved = s((r) => r.resolved);
    const unresolved = s((r) => r.unresolved);
    return {
      count: rows.length,
      raised: s((r) => r.raised),
      resolved,
      unresolved,
      withdrawn: s((r) => r.withdrawn),
      emergency: s((r) => r.emergency),
      completionPct: resolved + unresolved ? Math.round((resolved / (resolved + unresolved)) * 1000) / 10 : 0,
    };
  });

  /**
   * Maintenance / composite grant utilisation per unit (metric 4). Allocation
   * is the published enrolment slab rule applied to the real roll; the utilised
   * share is ASSUMED (deterministic per school) because the export carries no
   * grant ledger. Figures are in ₹ lakh.
   */
  readonly smcGrantRows = computed(() => {
    return this.drillRows()
      .map((r) => {
        const alloc = r.smcGrantAllocated ?? 0;
        const used = r.smcGrantUtilised ?? 0;
        return {
          key: r.key,
          unit: r.name,
          schools: r.smcEligibleSchools ?? 0,
          students: r.n ?? 0,
          allocated: alloc,
          utilised: used,
          balance: Math.round((alloc - used) * 10) / 10,
          utilPct: alloc ? Math.round((used / alloc) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => a.utilPct - b.utilPct || a.unit.localeCompare(b.unit))
      .map((r, i) => ({ sno: i + 1, ...r }));
  });

  readonly smcGrantTotals = computed(() => {
    const rows = this.smcGrantRows();
    const s = (f: (r: typeof rows[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
    const alloc = Math.round(s((r) => r.allocated) * 10) / 10;
    const used = Math.round(s((r) => r.utilised) * 10) / 10;
    return {
      count: rows.length,
      schools: s((r) => r.schools),
      students: s((r) => r.students),
      allocated: alloc,
      utilised: used,
      balance: Math.round((alloc - used) * 10) / 10,
      utilPct: alloc ? Math.round((used / alloc) * 1000) / 10 : 0,
    };
  });
}

/** Topic tabs for the drill-down table, matching the prototype's lenses. */
export type DrillTopic = 'enr' | 'att' | 'inf' | 'dinf' | 'aca' | 'sch'
  | 'thiran' | 'scholarship' | 'smc' | 'palli' | 'dps' | 'acis';

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
  attStudentBelow60?: number;     // schools with student attendance < 60% (real)
  attTeacherBelow60?: number;     // schools with teacher attendance < 60% (real)

  // ---- Recognition Order — DPS (pending RC applications) ----
  dpsTotal?: number;
  dpsDistrictPending?: number;
  dpsStatePending?: number;
  dpsLt15?: number;
  dpsD15to30?: number;
  dpsGt30?: number;
  dpsAvgDays?: number;
  dpsMaxDays?: number;

  // ---- All Children in School (ACiS) — common pool ----
  acisPool?: number;              // children in the common pool (TC dropouts)
  acisSurveyed?: number;
  acisPendingSurvey?: number;
  acisSurveyPct?: number;
  acisAdmitted?: number;
  acisBridged?: number;
  acisBridgeDays?: number;        // mean days: common pool → survey/admission
  acisToBeAdmitted?: number;
  acisToBeValidated?: number;     // pending SMC validation
  acisWithReason?: number;
  acisDeptTaken?: number;
  acisDeptPending?: number;
  acisCwsn?: number;
  acisUmis?: number;              // joined higher education (UMIS)
  acisPdRepeat?: number;          // PD repeaters (real Red_Flag_Status)
  acisPd?: number;                // potential dropouts — absent 15+ of last 30 days (real)
  acisPdWithReason?: number;      // PD students with a reason recorded
  acisPdBase?: number;            // enrolment in PD-covered school types (PD % denominator)
  acisPdPct?: number;             // tile-level PD %, via scopeValues RATIO
  acisDropOut?: number;           // dropouts not re-enrolled (common pool − admitted)
  acisEnrolI12?: number;          // enrolment classes I–XII (dropout-rate denominator)

  // ---- SMC meetings, emergency/other split, grants ----
  smcEmergencyRaised?: number;
  smcEmergencyResolved?: number;
  smcEmergencyClosureRate?: number;
  smcOtherRaised?: number;
  smcOtherResolved?: number;
  smcOtherOpen?: number;
  smcOtherClosureRate?: number;
  smcMeetings?: number;           // meetings held in the active window
  smcSchoolsHeld?: number;        // distinct schools that held a meeting
  smcSchoolsNotHeld?: number;     // eligible schools with no meeting
  smcEligibleSchools?: number;    // SMC-covered schools in scope (denominator)
  smcPresent?: number;
  smcAbsent?: number;
  smcVacant?: number;
  smcMeetAttendPct?: number;      // present / (present + absent)
  smcGrantAllocated?: number;     // ₹ lakh — real slab rule on real enrolment
  smcGrantUtilised?: number;      // ₹ lakh — ASSUMED utilisation share
  smcGrantUtilPct?: number;
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
   * Set for module insights (THIRAN, Scholarship, SMC, Palli Parvai) that have
   * no drill-down topic of their own: clicking scrolls to this section id.
   */
  anchor?: string;
}
