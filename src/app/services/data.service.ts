import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { loadAsset } from '../utils/asset-loader';
import { schoolsInScope } from '../utils/scope';
import { inr } from '../utils/format';
import { CautionCheck } from '../models/caution.model';
import {
  AggregateNode,
  BlockNode,
  DistrictNode,
  DonutDimension,
  DrillLevel,
  EMPTY_FILTERS,
  EnrollmentData,
  FilterState,
  GRADE_ORDER,
  MapMetric,
  GerLevel,
  GerSeries,
  TransitionStage,
  NamedValue,
  SchoolRow,
  SchoolsData,
} from '../models/enrollment.model';

@Injectable({ providedIn: 'root' })
export class DataService {
  /**
   * Which system the School Dashboard is reading from.
   * EMIS and UDISE+ maintain separate rolls with different inclusion rules,
   * so switching source swaps the entire dataset rather than rescaling it.
   */
  readonly source = signal<'EMIS' | 'UDISE+'>('EMIS');

  private readonly _emis = signal<EnrollmentData | null>(null);
  private readonly _emisSchools = signal<SchoolsData | null>(null);
  private readonly _udise = signal<EnrollmentData | null>(null);
  private readonly _udiseSchools = signal<SchoolsData | null>(null);
  private readonly _loaded = signal(false);

  /** Active dataset for the selected source. */
  private readonly _data = computed<EnrollmentData | null>(() =>
    this.source() === 'UDISE+' ? this._udise() ?? this._emis() : this._emis(),
  );
  private readonly _schools = computed<SchoolsData | null>(() =>
    this.source() === 'UDISE+' ? this._udiseSchools() ?? this._emisSchools() : this._emisSchools(),
  );

  /** True once the UDISE+ roll is available. */
  readonly udiseReady = computed(() => !!this._udise());

  /**
   * Raw SchoolRow[] for an explicit scope, independent of the current drill.
   * Pass a block to get that block's schools, or just a district to get every
   * school in the district. Used for school-count KPIs (zero enrolment, PTR>60…).
   */
  schoolRowsFor(district: string, block?: string | null): SchoolRow[] {
    const s = this._schools();
    if (!s) return [];
    if (block) return s[`${district}||${block}`] ?? [];
    const prefix = district + '||';
    const out: SchoolRow[] = [];
    for (const k in s) if (k.startsWith(prefix)) out.push(...s[k]);
    return out;
  }

  /** Drill state */
  readonly selectedDistrict = signal<string | null>(null);
  readonly selectedBlock = signal<string | null>(null);
  readonly selectedSchool = signal<string | null>(null);

  /**
   * Locate a school's { district, block } by UDISE across the active roll.
   * Used to drill directly to a school from a flat per-KPI list (which carries
   * only the UDISE, not the block). Returns null when the UDISE is unknown.
   */
  findSchoolLocation(udise: string): { district: string; block: string; name: string } | null {
    const s = this._schools();
    if (!s || !udise) return null;
    for (const key in s) {
      const row = s[key].find((r) => r.udise === udise);
      if (row) {
        const sep = key.indexOf('||');
        return { district: key.slice(0, sep), block: key.slice(sep + 2), name: row.name };
      }
    }
    return null;
  }

  /** Map / KPI metric */
  readonly metric = signal<MapMetric>('students');

  /** Which dimension the primary donut shows. */
  readonly donutDimension = signal<DonutDimension>('management');

  /** Multi-select filters */
  readonly filters = signal<FilterState>({ ...EMPTY_FILTERS });

  readonly data = this._data;
  readonly loaded = this._loaded.asReadonly();

  constructor(private http: HttpClient) {}

  async load(): Promise<void> {
    if (this._loaded()) return;
    const [data, schools] = await Promise.all([
      loadAsset<EnrollmentData>('assets/enrollment.json'),
      loadAsset<SchoolsData>('assets/schools.json'),
    ]);
    this._emis.set(data);
    this._emisSchools.set(schools);
    this._loaded.set(true);
    // UDISE+ roll loads behind the scenes; the toggle enables once it arrives
    this.loadUdise();
  }

  private async loadUdise(): Promise<void> {
    if (this._udise()) return;
    try {
      const [d, s] = await Promise.all([
        loadAsset<EnrollmentData>('assets/enrollment-udise.json'),
        loadAsset<SchoolsData>('assets/schools-udise.json'),
      ]);
      this._udise.set(d);
      this._udiseSchools.set(s);
    } catch {
      /* UDISE+ view unavailable; the toggle stays disabled */
    }
  }

  /** Switch source and reset the drill, since school rolls differ between systems. */
  setSource(s: 'EMIS' | 'UDISE+'): void {
    if (s === this.source()) return;
    if (s === 'UDISE+' && !this._udise()) return;
    this.source.set(s);
    this.goToState();
    this.clearFilters();
  }

  // ================= drill level =================
  readonly level = computed<DrillLevel>(() => {
    if (this.selectedSchool()) return 'school';
    if (this.selectedBlock()) return 'block';
    if (this.selectedDistrict()) return 'district';
    return 'state';
  });

  readonly hasFilters = computed(() => {
    const f = this.filters();
    return f.mgmt.length > 0 || f.cat.length > 0 || f.stype.length > 0;
  });

  // ================= filter helpers =================
  /** Filter option lists, derived from the state-level dimension arrays. */
  readonly mgmtOptions = computed(() => this.optionList(this._data()?.state.byManagement));
  readonly catOptions = computed(() => this.optionList(this._data()?.state.byCategory));
  readonly stypeOptions = computed(() => this.optionList(this._data()?.state.bySchoolType));

  private optionList(arr?: NamedValue[]) {
    return (arr ?? []).map((x) => ({ label: x.name, value: x.name }));
  }

  private matches(s: SchoolRow, f: FilterState): boolean {
    if (f.mgmt.length && !f.mgmt.includes(s.mgmt)) return false;
    if (f.cat.length && !f.cat.includes(s.cat)) return false;
    if (f.stype.length && !f.stype.includes(s.stype)) return false;
    return true;
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS });
  }

  // ================= school row access =================
  readonly schoolsForBlock = computed<SchoolRow[]>(() => {
    const s = this._schools();
    const dist = this.selectedDistrict();
    const blk = this.selectedBlock();
    if (!s || !dist || !blk) return [];
    const rows = s[`${dist}||${blk}`] ?? [];
    const f = this.filters();
    return this.hasFilters() ? rows.filter((r) => this.matches(r, f)) : rows;
  });

  /**
   * Flat per-school list for the current scope, used by the Raw export.
   * Active filters are honoured so the download matches what's on screen.
   */
  readonly rawSchoolRows = computed(() => {
    const all = schoolsInScope(
      this._schools(), this.level(),
      this.selectedDistrict(), this.selectedBlock(), this.selectedSchool(),
    );
    const f = this.filters();
    const rows = this.hasFilters() ? all.filter((r) => this.matches(r, f)) : all;
    return rows.map((r) => ({
      district: this.titleCase(r.__district),
      block: this.titleCase(r.__block),
      school: r.name,
      udise: r.udise,
      mgmt: r.mgmt,
      ctype: r.ctype,
      cat: r.cat,
      stype: r.stype,
      students: r.students,
      boys: r.boys,
      girls: r.girls,
      transgen: r.transgen,
      teaching: r.teaching,
      nonTeaching: r.nonTeaching,
      staff: r.staff,
      ptr: r.teaching ? Math.round((r.students / r.teaching) * 10) / 10 : 0,
    }));
  });

  readonly currentSchool = computed<SchoolRow | null>(() => {
    if (this.level() !== 'school') return null;
    const s = this._schools();
    const dist = this.selectedDistrict();
    const blk = this.selectedBlock();
    if (!s || !dist || !blk) return null;
    const rows = s[`${dist}||${blk}`] ?? [];
    return rows.find((x) => x.name === this.selectedSchool()) ?? null;
  });

  /** All school rows in the current scope (before filtering). */
  private rowsInScope(): SchoolRow[] {
    const s = this._schools();
    if (!s) return [];
    const level = this.level();
    if (level === 'school') {
      const sc = this.currentSchool();
      return sc ? [sc] : [];
    }
    if (level === 'block') return s[`${this.selectedDistrict()}||${this.selectedBlock()}`] ?? [];
    if (level === 'district') {
      const prefix = this.selectedDistrict() + '||';
      const out: SchoolRow[] = [];
      for (const k in s) if (k.startsWith(prefix)) out.push(...s[k]);
      return out;
    }
    const out: SchoolRow[] = [];
    for (const k in s) out.push(...s[k]);
    return out;
  }

  // ================= aggregation =================
  private emptyNode(): AggregateNode {
    return {
      schools: 0, boys: 0, girls: 0, transgen: 0, students: 0,
      teaching: 0, nonTeaching: 0, staff: 0,
      caste: { OC: 0, BC: 0, MBC: 0, DNC: 0, SC: 0, ST: 0 },
      byManagement: [], byCategory: [], byCategoryType: [], bySchoolType: [],
      byGrade: GRADE_ORDER.map((name) => ({ name, boys: 0, girls: 0 })),
    };
  }

  /** Aggregate a set of school rows into a node (used when filters are active). */
  private aggregate(rows: SchoolRow[]): AggregateNode {
    const n = this.emptyNode();
    const gb = new Array(15).fill(0);
    const gg = new Array(15).fill(0);
    const mgmt = new Map<string, number>();
    const cat = new Map<string, number>();
    const ctype = new Map<string, number>();
    const stype = new Map<string, number>();

    for (const r of rows) {
      n.schools += 1;
      n.boys += r.boys; n.girls += r.girls; n.transgen += r.transgen ?? 0;
      n.students += r.students;
      n.teaching += r.teaching; n.nonTeaching += r.nonTeaching ?? 0; n.staff += r.staff ?? 0;
      const c = r.caste ?? [0, 0, 0, 0, 0, 0];
      n.caste.OC += c[0]; n.caste.BC += c[1]; n.caste.MBC += c[2];
      n.caste.DNC += c[3]; n.caste.SC += c[4]; n.caste.ST += c[5];
      for (let i = 0; i < 15; i++) { gb[i] += r.gb?.[i] ?? 0; gg[i] += r.gg?.[i] ?? 0; }
      if (r.mgmt) mgmt.set(r.mgmt, (mgmt.get(r.mgmt) ?? 0) + r.students);
      if (r.cat) cat.set(r.cat, (cat.get(r.cat) ?? 0) + r.students);
      if (r.ctype) ctype.set(r.ctype, (ctype.get(r.ctype) ?? 0) + r.students);
      if (r.stype) stype.set(r.stype, (stype.get(r.stype) ?? 0) + r.students);
    }
    n.byGrade = GRADE_ORDER.map((name, i) => ({ name, boys: gb[i], girls: gg[i] }));
    n.byManagement = this.toSorted(mgmt);
    n.byCategory = this.toSorted(cat);
    n.byCategoryType = this.toSorted(ctype);
    n.bySchoolType = this.toSorted(stype);
    return n;
  }

  private toSorted(m: Map<string, number>): NamedValue[] {
    return [...m.entries()].map(([name, students]) => ({ name, students })).sort((a, b) => b.students - a.students);
  }

  private nodeFromSchool(s: SchoolRow): AggregateNode {
    return this.aggregate([s]);
  }

  /** The aggregate node for the current level, respecting filters. */
  readonly current = computed<AggregateNode | null>(() => {
    const d = this._data();
    if (!d) return null;
    const level = this.level();

    if (this.hasFilters()) {
      const f = this.filters();
      return this.aggregate(this.rowsInScope().filter((r) => this.matches(r, f)));
    }

    if (level === 'state') return d.state;
    if (level === 'district') return d.districts.find((x) => x.name === this.selectedDistrict()) ?? d.state;
    if (level === 'block') {
      return d.blocks.find((b) => b.district === this.selectedDistrict() && b.block === this.selectedBlock()) ?? d.state;
    }
    const s = this.currentSchool();
    return s ? this.nodeFromSchool(s) : d.state;
  });

  // ================= district / block listings =================
  /** Per-district aggregates (filtered on demand). */
  readonly districtAggregates = computed<DistrictNode[]>(() => {
    const d = this._data();
    if (!d) return [];
    if (!this.hasFilters()) return d.districts;
    const s = this._schools();
    if (!s) return [];
    const f = this.filters();
    const groups = new Map<string, SchoolRow[]>();
    for (const k in s) {
      const dist = k.slice(0, k.indexOf('||'));
      let arr = groups.get(dist);
      if (!arr) { arr = []; groups.set(dist, arr); }
      for (const r of s[k]) if (this.matches(r, f)) arr.push(r);
    }
    const out: DistrictNode[] = [];
    for (const [name, rows] of groups) out.push({ ...this.aggregate(rows), name });
    return out.sort((a, b) => b.students - a.students);
  });

  readonly districts = computed<DistrictNode[]>(() => this.districtAggregates());

  readonly blocksForDistrict = computed<BlockNode[]>(() => {
    const d = this._data();
    const dist = this.selectedDistrict();
    if (!d || !dist) return [];
    if (!this.hasFilters()) {
      return d.blocks.filter((b) => b.district === dist).sort((a, b) => b.students - a.students);
    }
    const s = this._schools();
    if (!s) return [];
    const f = this.filters();
    const prefix = dist + '||';
    const out: BlockNode[] = [];
    for (const k in s) {
      if (!k.startsWith(prefix)) continue;
      const rows = s[k].filter((r) => this.matches(r, f));
      if (!rows.length) continue;
      out.push({ ...this.aggregate(rows), district: dist, block: k.slice(prefix.length) });
    }
    return out.sort((a, b) => b.students - a.students);
  });

  // ================= table =================
  readonly tableRows = computed(() => {
    const level = this.level();
    if (level === 'state') return this.districts().map((x) => this.row(x.name, x));
    if (level === 'district') return this.blocksForDistrict().map((x) => this.row(x.block, x));
    return this.schoolsForBlock().map((x) => ({
      key: x.name, name: x.name, schools: 1,
      boys: x.boys, girls: x.girls, students: x.students,
      teaching: x.teaching, extra: x.ctype,
    }));
  });

  private row(key: string, x: AggregateNode) {
    return {
      key, name: key, schools: x.schools, boys: x.boys, girls: x.girls,
      students: x.students, teaching: x.teaching, extra: '',
    };
  }

  // ================= map =================
  readonly mapSeries = computed(() => {
    const m = this.metric();
    return this.districts().map((d) => ({ name: d.name, value: (d as any)[m] as number }));
  });

  readonly metricLabel = computed(() => {
    switch (this.metric()) {
      case 'schools': return 'Total Schools';
      case 'boys': return 'Boys Enrolment';
      case 'girls': return 'Girls Enrolment';
      case 'teaching': return 'Teachers';
      default: return 'Total Students';
    }
  });

  readonly scopeLabel = computed(() => {
    const level = this.level();
    if (level === 'state') return 'Tamil Nadu';
    if (level === 'district') return this.titleCase(this.selectedDistrict()!);
    if (level === 'block') return `${this.titleCase(this.selectedBlock()!)}, ${this.titleCase(this.selectedDistrict()!)}`;
    return `${this.selectedSchool()}`;
  });

  // ================= trends =================
  readonly years = computed(() => this._data()?.years ?? []);
  readonly stateTrend = computed(() => this._data()?.trendState ?? []);

  // ================= transition rate & GER =================
  /**
   * Grade index map (GRADE_ORDER): 0 Pre-KG,1 LKG,2 UKG,3 I,4 II,5 III,6 IV,
   * 7 V,8 VI,9 VII,10 VIII,11 IX,12 X,13 XI,14 XII.
   * Transition stages track movement to the next schooling stage.
   */
  private readonly TRANSITION_STAGES: { key: string; label: string; from: number; to: number }[] = [
    { key: 'v_vi',    label: 'Class V → VI (Primary → Upper Primary)',        from: 7,  to: 8 },
    { key: 'viii_ix', label: 'Class VIII → IX (Upper Primary → Secondary)',   from: 10, to: 11 },
    { key: 'x_xi',    label: 'Class X → XI (Secondary → Higher Secondary)',   from: 12, to: 13 },
  ];

  /** GER levels with their constituent grade indices and display labels. */
  private readonly GER_LEVELS: { level: GerLevel; label: string; grades: number[] }[] = [
    { level: 'primary',         label: 'Primary (I-V)',            grades: [3, 4, 5, 6, 7] },
    { level: 'upperPrimary',    label: 'Upper Primary (VI-VIII)',  grades: [8, 9, 10] },
    { level: 'secondary',       label: 'Secondary (IX-X)',         grades: [11, 12] },
    { level: 'higherSecondary', label: 'Higher Secondary (XI-XII)', grades: [13, 14] },
  ];

  /** True once the active source carries a per-year grade history. */
  readonly hasGradeYear = computed(() => {
    const gy = this._data()?.gradeYear;
    return !!gy && gy.years.length > 0 && gy.boys.length > 0;
  });

  /**
   * Transition Rate per stage, from 2021 to the current year.
   * rate(t) = enrolment in the next grade at year t
   *           / enrolment in the previous grade at year (t-1) x 100.
   * A cohort that fully progresses sits near 100%; leakage drops it below.
   */
  readonly transitionRate = computed<{ years: string[]; stages: TransitionStage[] }>(() => {
    const gy = this._data()?.gradeYear;
    if (!gy || !gy.years.length) return { years: [], stages: [] };

    const total = (row: number[] | undefined, g: number) =>
      row && g < row.length ? row[g] : 0;
    const gradeTotal = (yi: number, g: number) =>
      total(gy.boys[yi], g) + total(gy.girls[yi], g);

    // start the axis at 2021-22 where possible, but never before index 1
    // (year t needs year t-1), so the first comparable point is index 1.
    const startIdx = Math.max(1, gy.years.findIndex((y) => y.startsWith('2021')));
    const years = gy.years.slice(startIdx);

    const stages: TransitionStage[] = this.TRANSITION_STAGES.map((s) => ({
      key: s.key, label: s.label, fromGrade: s.from, toGrade: s.to,
      rate: years.map((_, i) => {
        const yi = startIdx + i;
        const prev = gradeTotal(yi - 1, s.from);
        const cur = gradeTotal(yi, s.to);
        return prev > 0 ? +((cur / prev) * 100).toFixed(1) : 0;
      }),
    }));
    return { years, stages };
  });

  /** Whether the current source can report GER (needs age-group population). */
  readonly hasPopulation = computed(() => !!this._data()?.population);
  /** True for EMIS, where population must still come from the departments' API. */
  readonly gerNeedsApi = computed(() => this.hasGradeYear() && !this.hasPopulation());

  /**
   * Gross Enrolment Ratio per level, per year.
   * GER = enrolment in the level's grades / projected age-group population x 100.
   * Empty when the source has no population (EMIS, pending API).
   */
  readonly gerByLevel = computed<{ years: string[]; series: GerSeries[] }>(() => {
    const d = this._data();
    const gy = d?.gradeYear;
    const pop = d?.population;
    if (!gy || !pop) return { years: [], series: [] };

    const years = gy.years;
    const gradeTotal = (yi: number, g: number) =>
      (gy.boys[yi]?.[g] ?? 0) + (gy.girls[yi]?.[g] ?? 0);

    const series: GerSeries[] = this.GER_LEVELS.map((lv) => {
      const enrolment = years.map((_, yi) => lv.grades.reduce((s, g) => s + gradeTotal(yi, g), 0));
      const population = years.map((y) => pop.byLevel[lv.level]?.[y] ?? 0);
      const ger = years.map((_, yi) =>
        population[yi] > 0 ? +((enrolment[yi] / population[yi]) * 100).toFixed(1) : 0);
      return { level: lv.level, label: lv.label, ger, enrolment, population };
    });
    return { years, series };
  });

  readonly scopeTrend = computed(() => {
    const d = this._data();
    const empty = { years: [] as string[], students: [] as number[], boys: [] as number[], girls: [] as number[] };
    if (!d) return empty;
    const level = this.level();
    if (level === 'school') {
      const s = this.currentSchool();
      return { years: d.years, students: s?.series ?? [], boys: s?.bseries ?? [], girls: s?.gseries ?? [] };
    }
    if (level === 'block') {
      const bt = d.blockTrend?.[`${this.selectedDistrict()}||${this.selectedBlock()}`];
      return { years: d.years, students: bt?.series ?? [], boys: bt?.boys ?? [], girls: bt?.girls ?? [] };
    }
    if (level === 'district') {
      const dt = d.districtTrend.find((x) => x.name === this.selectedDistrict());
      return { years: d.years, students: dt?.series ?? [], boys: dt?.boys ?? [], girls: dt?.girls ?? [] };
    }
    return {
      years: d.years,
      students: d.trendState.map((t) => t.students),
      boys: d.trendState.map((t) => t.boys),
      girls: d.trendState.map((t) => t.girls),
    };
  });

  /** Baseline year for trend comparison (defaults to the earliest year). */
  readonly fromYear = signal<string | null>(null);
  /** Show the best or worst performers in the trend comparison. */
  readonly trendRank = signal<'top' | 'bottom'>('top');
  /** How many children to plot (max 20). */
  readonly trendCount = signal(12);

  /** Resolved baseline year + its index, falling back to the first year. */
  readonly fromYearInfo = computed(() => {
    const years = this._data()?.years ?? [];
    if (!years.length) return { year: '', index: 0 };
    const sel = this.fromYear();
    const idx = sel ? years.indexOf(sel) : 0;
    return idx >= 0 ? { year: years[idx], index: idx } : { year: years[0], index: 0 };
  });

  /** Year options selectable as the baseline (all but the current year). */
  readonly fromYearOptions = computed(() => {
    const years = this._data()?.years ?? [];
    return years.slice(0, Math.max(0, years.length - 1)).map((y) => ({ label: y, value: y }));
  });

  /**
   * Multi-year series for the CHILDREN of the current scope, so Trend Analysis
   * can be drilled: state -> districts, district -> blocks, block -> schools.
   * A school is a leaf, so it returns its own series.
   */
  readonly childTrends = computed(() => {
    const d = this._data();
    if (!d) return { years: [] as string[], childLabel: '', items: [] as { key: string; name: string; series: number[] }[] };
    const level = this.level();
    // Trim the x-axis to start at the chosen baseline year
    const cut = this.fromYearInfo().index;
    const years = d.years.slice(cut);
    const clip = (s: number[]) => s.slice(cut);

    if (level === 'state') {
      return {
        years,
        childLabel: 'Districts',
        items: d.districtTrend.map((x) => ({ key: x.name, name: this.titleCase(x.name), series: clip(x.series) })),
      };
    }

    if (level === 'district') {
      const dist = this.selectedDistrict()!;
      const prefix = dist + '||';
      const items = Object.keys(d.blockTrend ?? {})
        .filter((k) => k.startsWith(prefix))
        .map((k) => {
          const block = k.slice(prefix.length);
          return { key: block, name: this.titleCase(block), series: clip(d.blockTrend[k].series) };
        })
        .sort((a, b) => (b.series[b.series.length - 1] ?? 0) - (a.series[a.series.length - 1] ?? 0));
      return { years, childLabel: 'Blocks', items };
    }

    if (level === 'block') {
      const items = this.schoolsForBlock()
        .filter((s) => (s.series ?? []).some((v) => v > 0))
        .map((s) => ({ key: s.name, name: s.name, series: clip(s.series ?? []) }))
        .sort((a, b) => (b.series[b.series.length - 1] ?? 0) - (a.series[a.series.length - 1] ?? 0));
      return { years, childLabel: 'Schools', items };
    }

    const s = this.currentSchool();
    return {
      years,
      childLabel: 'This School',
      items: s ? [{ key: s.name, name: s.name, series: clip(s.series ?? []) }] : [],
    };
  });

  /** Child trend rows with baseline/current/change, ranked by the chosen direction. */
  readonly childTrendRows = computed(() => {
    const { years, items } = this.childTrends();
    if (!years.length) return [];
    const rows = items.map((it) => {
      const first = it.series[0] ?? 0;
      const last = it.series[it.series.length - 1] ?? 0;
      const change = first > 0 ? ((last - first) / first) * 100 : 0;
      return {
        key: it.key, name: it.name, first, last,
        diff: last - first, change: +change.toFixed(1), series: it.series,
      };
    });
    // Rank by % change so "bottom" surfaces the steepest decliners
    return rows.sort((a, b) => (this.trendRank() === 'top' ? b.change - a.change : a.change - b.change));
  });

  /** The subset actually plotted, honouring top/bottom and the count limit. */
  readonly childTrendPlot = computed(() => {
    const rows = this.childTrendRows();
    const n = Math.min(20, Math.max(1, this.trendCount()));
    const picked = rows.slice(0, n);
    return {
      years: this.childTrends().years,
      childLabel: this.childTrends().childLabel,
      items: picked.map((r) => ({ key: r.key, name: r.name, series: r.series })),
      total: rows.length,
      shown: picked.length,
    };
  });

  /** True while the trend view can still be drilled deeper. */
  readonly canDrillTrend = computed(() => this.level() !== 'school');

  // ================= comparison =================
  /** Rows for the comparison view: current scope's children with derived indicators. */
  readonly comparisonRows = computed(() => {
    const level = this.level();
    const src: { key: string; node: AggregateNode }[] =
      level === 'state'
        ? this.districts().map((d) => ({ key: d.name, node: d }))
        : this.blocksForDistrict().map((b) => ({ key: b.block, node: b }));

    return src.map(({ key, node }) => {
      const gpi = node.boys ? node.girls / node.boys : 0;
      const ptr = node.teaching ? node.students / node.teaching : 0;
      const avg = node.schools ? node.students / node.schools : 0;
      return {
        key,
        name: key,
        schools: node.schools,
        students: node.students,
        boys: node.boys,
        girls: node.girls,
        teaching: node.teaching,
        gpi: +gpi.toFixed(2),
        ptr: +ptr.toFixed(1),
        avgPerSchool: Math.round(avg),
        girlsPct: +((node.girls / (node.boys + node.girls || 1)) * 100).toFixed(1),
      };
    });
  });

  /** State-level averages used as comparison baselines. */
  readonly baseline = computed(() => {
    const s = this._data()?.state;
    if (!s) return { gpi: 0, ptr: 0, avgPerSchool: 0, girlsPct: 0 };
    return {
      gpi: +(s.boys ? s.girls / s.boys : 0).toFixed(2),
      ptr: +(s.teaching ? s.students / s.teaching : 0).toFixed(1),
      avgPerSchool: Math.round(s.schools ? s.students / s.schools : 0),
      girlsPct: +((s.girls / (s.boys + s.girls || 1)) * 100).toFixed(1),
    };
  });

  // ================= alarming =================
  /**
   * Districts flagged on data-driven thresholds. Each alert states the measured
   * value and the threshold it breached so the reason is auditable.
   */
  readonly alerts = computed(() => {
    const d = this._data();
    if (!d) return [];
    const base = this.baseline();
    const out: {
      district: string;
      kind: string;
      severity: 'high' | 'medium';
      detail: string;
      value: number;
      metric: string;
    }[] = [];

    for (const dist of d.districts) {
      const dt = d.districtTrend.find((x) => x.name === dist.name);

      // 1. Sustained enrolment decline over the full period
      if (dt && dt.series.length >= 2) {
        const first = dt.series[0];
        const last = dt.series[dt.series.length - 1];
        if (first > 0) {
          const pct = ((last - first) / first) * 100;
          if (pct <= -15) {
            out.push({
              district: dist.name, kind: 'Enrolment Decline',
              severity: pct <= -25 ? 'high' : 'medium',
              detail: `${pct.toFixed(1)}% change from ${d.years[0]} to ${d.currentYear}`,
              value: +pct.toFixed(1), metric: 'decline',
            });
          }
        }
      }

      // 2. Gender parity below 0.95 (fewer girls than boys)
      const gpi = dist.boys ? dist.girls / dist.boys : 0;
      if (gpi > 0 && gpi < 0.95) {
        out.push({
          district: dist.name, kind: 'Low Gender Parity',
          severity: gpi < 0.9 ? 'high' : 'medium',
          detail: `GPI ${gpi.toFixed(2)} vs state ${base.gpi.toFixed(2)}`,
          value: +gpi.toFixed(2), metric: 'gpi',
        });
      }

      // 3. Pupil-teacher ratio above 30:1
      const ptr = dist.teaching ? dist.students / dist.teaching : 0;
      if (ptr > 30) {
        out.push({
          district: dist.name, kind: 'High Pupil-Teacher Ratio',
          severity: ptr > 40 ? 'high' : 'medium',
          detail: `${ptr.toFixed(1)}:1 vs state ${base.ptr.toFixed(1)}:1`,
          value: +ptr.toFixed(1), metric: 'ptr',
        });
      }

      // 4. Very small average school size (viability concern)
      const avg = dist.schools ? dist.students / dist.schools : 0;
      if (avg > 0 && avg < 100) {
        out.push({
          district: dist.name, kind: 'Low Average School Size',
          severity: avg < 75 ? 'high' : 'medium',
          detail: `${Math.round(avg)} students/school vs state ${base.avgPerSchool}`,
          value: Math.round(avg), metric: 'avg',
        });
      }
    }

    const rank = { high: 0, medium: 1 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.district.localeCompare(b.district));
  });

  readonly alertSummary = computed(() => {
    const a = this.alerts();
    const byKind = new Map<string, number>();
    for (const x of a) byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + 1);
    return {
      total: a.length,
      high: a.filter((x) => x.severity === 'high').length,
      medium: a.filter((x) => x.severity === 'medium').length,
      districts: new Set(a.map((x) => x.district)).size,
      byKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count })).sort((x, y) => y.count - x.count),
    };
  });

  // ================= navigation =================
  drillToDistrict(name: string): void {
    this.selectedDistrict.set(name); this.selectedBlock.set(null); this.selectedSchool.set(null);
  }
  drillToBlock(block: string): void {
    if (!this.selectedDistrict()) return;
    this.selectedBlock.set(block); this.selectedSchool.set(null);
  }
  drillToSchool(name: string): void {
    if (!this.selectedBlock()) return;
    this.selectedSchool.set(name);
  }
  goToState(): void { this.selectedDistrict.set(null); this.selectedBlock.set(null); this.selectedSchool.set(null); }
  goToDistrict(): void { this.selectedBlock.set(null); this.selectedSchool.set(null); }
  goToBlock(): void { this.selectedSchool.set(null); }

  /** True when there is a parent level to return to. */
  readonly canGoBack = computed(() => this.level() !== 'state');

  /** Label describing where the back button goes. */
  readonly backLabel = computed(() => {
    switch (this.level()) {
      case 'school':
        return `Back to ${this.titleCase(this.selectedBlock()!)} — Schools`;
      case 'block':
        return `Back to ${this.titleCase(this.selectedDistrict()!)} — Blocks`;
      case 'district':
        return 'Back to Tamil Nadu — Districts';
      default:
        return '';
    }
  });

  /** Step up exactly one drill level: school → block → district → state. */
  goUp(): void {
    switch (this.level()) {
      case 'school': this.goToBlock(); break;
      case 'block': this.goToDistrict(); break;
      case 'district': this.goToState(); break;
      default: break;
    }
  }

  titleCase(s: string): string {
    return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Caution checks for the School Dashboard: hard zero/extreme conditions in
   * enrolment and staffing. Each check carries the full matching school list so
   * the download is the actionable output, not just the count.
   */
  readonly cautionChecks = computed<CautionCheck[]>(() => {
    const rows = this.rawSchoolRows();
    type Row = (typeof rows)[number];

    const defs: {
      id: string; label: string; icon: string; hint: string;
      severity: 'high' | 'medium';
      test: (r: Row) => boolean;
      detail: (r: Row) => string;
    }[] = [
      {
        id: 'zeroEnrolment', label: 'Zero Enrolment', icon: 'fa-solid fa-user-slash',
        hint: 'No students on roll — school may be non-functional or pending closure',
        severity: 'high',
        test: (r) => r.students === 0,
        detail: () => '0 students on roll',
      },
      {
        id: 'zeroTeachers', label: 'Zero Teachers', icon: 'fa-solid fa-user-xmark',
        hint: 'Students on roll but no teaching staff posted',
        severity: 'high',
        test: (r) => r.teaching === 0 && r.students > 0,
        detail: (r) => `${inr(r.students)} students, no teacher`,
      },
      {
        id: 'zeroStaff', label: 'No Staff At All', icon: 'fa-solid fa-users-slash',
        hint: 'Neither teaching nor non-teaching staff recorded',
        severity: 'high',
        test: (r) => r.staff === 0 && r.students > 0,
        detail: (r) => `${inr(r.students)} students, no staff`,
      },
      {
        id: 'extremePtr', label: 'Pupil-Teacher Ratio Over 60', icon: 'fa-solid fa-triangle-exclamation',
        hint: 'Well past the 30:1 norm — severe teacher shortage',
        severity: 'high',
        test: (r) => r.teaching > 0 && r.ptr > 60,
        detail: (r) => `PTR ${r.ptr}:1 (${inr(r.students)} students, ${inr(r.teaching)} teachers)`,
      },
      {
        id: 'singleTeacher', label: 'Single-Teacher School', icon: 'fa-solid fa-user',
        hint: 'Only one teacher for the whole school',
        severity: 'medium',
        test: (r) => r.teaching === 1,
        detail: (r) => `1 teacher for ${inr(r.students)} students`,
      },
      {
        id: 'tinyEnrolment', label: 'Under 10 Students', icon: 'fa-solid fa-child',
        hint: 'Very low roll — viability and consolidation review',
        severity: 'medium',
        test: (r) => r.students > 0 && r.students < 10,
        detail: (r) => `${inr(r.students)} students on roll`,
      },
      {
        id: 'zeroGirls', label: 'Zero Girls Enrolled', icon: 'fa-solid fa-person-dress',
        hint: 'No girls on roll despite students being present',
        severity: 'medium',
        test: (r) => r.students > 0 && r.girls === 0,
        detail: (r) => `${inr(r.students)} students, 0 girls`,
      },
      {
        id: 'zeroBoys', label: 'Zero Boys Enrolled', icon: 'fa-solid fa-person',
        hint: 'No boys on roll despite students being present',
        severity: 'medium',
        test: (r) => r.students > 0 && r.boys === 0,
        detail: (r) => `${inr(r.students)} students, 0 boys`,
      },
    ];

    return defs.map((d) => {
      const hits = rows.filter(d.test);
      return {
        id: d.id, label: d.label, icon: d.icon, hint: d.hint, severity: d.severity,
        count: hits.length,
        schools: hits
          .map((r) => ({
            district: r.district, block: r.block, school: r.school, udise: r.udise,
            mgmt: r.mgmt, stype: r.stype, students: r.students, detail: d.detail(r),
          }))
          .sort((a, b) => b.students - a.students || a.school.localeCompare(b.school)),
      };
    });
  });

  /** Distinct schools flagged by at least one caution check. */
  readonly cautionTotal = computed(() => {
    const seen = new Set<string>();
    for (const c of this.cautionChecks()) {
      for (const s of c.schools) seen.add(s.udise || `${s.district}|${s.block}|${s.school}`);
    }
    return seen.size;
  });
}
