import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { loadAsset } from '../utils/asset-loader';
import { schoolsInScope } from '../utils/scope';
import { inr } from '../utils/format';
import { CautionCheck } from '../models/caution.model';
import {
  AcademicData,
  AcademicMetric,
  AcademicNode,
  AcademicSchool,
  AcademicSchoolsData,
} from '../models/academic.model';
import { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class AcademicService {
  private readonly http = inject(HttpClient);
  private readonly ds = inject(DataService);

  private readonly _data = signal<AcademicData | null>(null);
  private readonly _schools = signal<AcademicSchoolsData | null>(null);
  private readonly _loaded = signal(false);

  readonly data = this._data.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** Year selected for the point-in-time views (Numbers / Comparison / Alarming). */
  readonly year = signal<string>('');
  /** Trend range endpoints. */
  readonly fromYear = signal<string | null>(null);
  readonly toYear = signal<string | null>(null);
  /** Metric driving comparison / alerts. */
  readonly metric = signal<AcademicMetric>('avgMark');
  /** Exam type filter; '' = all. */
  readonly examFilter = signal<string>('');
  /** Ranking direction and size for trends. */
  readonly rank = signal<'top' | 'bottom'>('top');
  readonly count = signal(12);
  /** Which comparison sub-view is active. */
  readonly compareMode = signal<'districts' | 'exams'>('districts');
  /** Which subject set to show: core (6-10) or higher secondary (11-12). */
  readonly subjectSet = signal<'core' | 'hs'>('core');
  /** Class filter for the exam sittings overview; 0 = all classes. */
  readonly examClassFilter = signal<number>(0);
  /**
   * Trend-view filters. Empty array = all exam types / all classes.
   * When set, the trend metrics are recomputed from the matching exam sittings
   * instead of the node-level headline figures.
   */
  readonly trendExams = signal<string[]>([]);
  readonly trendClasses = signal<number[]>([]);
  /** Head-to-head selection: class + exam type per side, plus optional subject. */
  readonly aClass = signal<number>(0);
  readonly aExam = signal<string>('');
  readonly bClass = signal<number>(0);
  readonly bExam = signal<string>('');
  /** Optional subject focus; '' = all shared subjects. */
  readonly subjectFilter = signal<string>('');

  async load(): Promise<void> {
    if (this._loaded()) return;
    const [d, s] = await Promise.all([
      loadAsset<AcademicData>('assets/academic.json'),
      loadAsset<AcademicSchoolsData>('assets/academic-schools.json'),
    ]);
    this._data.set(d);
    this._schools.set(s);
    if (!this.year()) this.year.set(d.currentYear);
    this._loaded.set(true);
  }

  readonly years = computed(() => this._data()?.years ?? []);
  readonly subjects = computed(() => this._data()?.subjects ?? []);
  readonly hsSubjects = computed(() => this._data()?.hsSubjects ?? []);
  readonly streams = computed(() => this._data()?.streams ?? []);
  readonly examTypes = computed(() => this._data()?.examTypes ?? []);
  readonly note = computed(() => this._data()?.note ?? '');
  readonly coreClasses = computed(() => this._data()?.coreClasses ?? []);
  readonly hsClasses = computed(() => this._data()?.hsClasses ?? []);

  /** Subjects for the selected set, with a label describing the classes. */
  readonly activeSubjects = computed(() => {
    const n = this.current();
    if (!n) return [];
    return this.subjectSet() === 'hs' ? n.byHsSubject : n.bySubject;
  });
  readonly subjectSetLabel = computed(() =>
    this.subjectSet() === 'hs'
      ? `Higher Secondary (Class ${this.hsClasses().join(' & ')})`
      : `Core Subjects (Class ${this.coreClasses()[0]}-${this.coreClasses()[this.coreClasses().length - 1]})`,
  );

  // ---------------- exam comparison ----------------
  /** All sittings, unfiltered, for the A/B selectors. */
  readonly allSittings = computed(() => this.current()?.examClass ?? []);

  /** Classes that have any exam sitting. */
  readonly sittingClasses = computed(() => {
    const set = new Set(this.allSittings().map((s) => s.cls));
    return [...set].sort((a, b) => a - b);
  });

  /** Exam types available for a given class (class 10/12 only have Annual). */
  examsForClass(cls: number): string[] {
    return this.allSittings().filter((s) => s.cls === cls).map((s) => s.exam);
  }
  readonly aExamOptions = computed(() => this.examsForClass(this.resolvedA().cls));
  readonly bExamOptions = computed(() => this.examsForClass(this.resolvedB().cls));

  /** Resolve side A: fall back to the first class/exam when unset or invalid. */
  private resolvedA = computed(() => {
    const all = this.allSittings();
    if (!all.length) return { cls: 0, exam: '' };
    const classes = this.sittingClasses();
    let cls = this.aClass();
    if (!classes.includes(cls)) cls = classes[0];
    const exams = all.filter((s) => s.cls === cls).map((s) => s.exam);
    let exam = this.aExam();
    if (!exams.includes(exam)) exam = exams[0];
    return { cls, exam };
  });

  /** Resolve side B: default to the last class/exam, and avoid matching A. */
  private resolvedB = computed(() => {
    const all = this.allSittings();
    if (!all.length) return { cls: 0, exam: '' };
    const classes = this.sittingClasses();
    let cls = this.bClass();
    if (!classes.includes(cls)) cls = classes[classes.length - 1];
    const exams = all.filter((s) => s.cls === cls).map((s) => s.exam);
    let exam = this.bExam();
    if (!exams.includes(exam)) exam = exams[exams.length - 1];
    const a = this.resolvedA();
    // if identical to A, nudge to any other sitting so the comparison is meaningful
    if (cls === a.cls && exam === a.exam) {
      const other = all.find((s) => !(s.cls === a.cls && s.exam === a.exam));
      if (other) return { cls: other.cls, exam: other.exam };
    }
    return { cls, exam };
  });

  readonly sittingA = computed(() => {
    const r = this.resolvedA();
    return this.allSittings().find((s) => s.cls === r.cls && s.exam === r.exam) ?? null;
  });
  readonly sittingB = computed(() => {
    const r = this.resolvedB();
    return this.allSittings().find((s) => s.cls === r.cls && s.exam === r.exam) ?? null;
  });

  /** Subjects common to both selected sittings, for the optional subject filter. */
  readonly sharedSubjects = computed(() => {
    const a = this.sittingA();
    const b = this.sittingB();
    if (!a || !b) return [];
    return a.subjects.filter((s) => b.subjects.some((t) => t.name === s.name)).map((s) => s.name);
  });

  /**
   * Head-to-head comparison of the two selected sittings, subject by subject.
   * Honours the optional subject filter.
   */
  readonly examHeadToHead = computed(() => {
    const a = this.sittingA();
    const b = this.sittingB();
    if (!a || !b) return null;
    const focus = this.subjectFilter();
    const names = this.sharedSubjects().filter((n) => !focus || n === focus);
    const subjects = names.map((n) => {
      const sa = a.subjects.find((s) => s.name === n)!;
      const sb = b.subjects.find((s) => s.name === n)!;
      return {
        name: n,
        aAvg: sa.avg, bAvg: sb.avg, avgDiff: +(sb.avg - sa.avg).toFixed(1),
        aPass: sa.pass, bPass: sb.pass, passDiff: +(sb.pass - sa.pass).toFixed(1),
      };
    });
    // when a single subject is focused, headline numbers should reflect it
    const headline = focus && subjects.length === 1
      ? {
          aAvg: subjects[0].aAvg, bAvg: subjects[0].bAvg,
          aPass: subjects[0].aPass, bPass: subjects[0].bPass,
        }
      : { aAvg: a.avg, bAvg: b.avg, aPass: a.pass, bPass: b.pass };
    return {
      a, b, subjects, focus, headline,
      avgDiff: +(headline.bAvg - headline.aAvg).toFixed(1),
      passDiff: +(headline.bPass - headline.aPass).toFixed(1),
      complianceDiff: +(b.compliance - a.compliance).toFixed(1),
      mixedKind: a.board !== b.board,
      sameClass: a.cls === b.cls,
    };
  });

  /** Every exam sitting (exam type + class) for the current scope. */
  readonly examSittings = computed(() => {
    const n = this.current();
    if (!n) return [];
    const f = this.examClassFilter();
    const rows = n.examClass ?? [];
    return f ? rows.filter((r) => r.cls === f) : rows;
  });

  /** Classes that actually have exam records, for the class filter. */
  readonly examClassOptions = computed(() => {
    const n = this.current();
    if (!n) return [];
    const set = new Set((n.examClass ?? []).map((r) => r.cls));
    return [...set].sort((a, b) => a - b);
  });

  /** Board sittings only (class 10 & 12 Annual). */
  readonly boardSittings = computed(() => (this.current()?.examClass ?? []).filter((r) => r.board));
  /** Internal EMIS sittings (all other class/exam combinations). */
  readonly internalSittings = computed(() => (this.current()?.examClass ?? []).filter((r) => !r.board));

  /** Exam x subject matrix for the current scope, pivoted for charting. */
  readonly examSubjectMatrix = computed(() => {
    const n = this.current();
    const exams = this.examTypes();
    const subs = this.subjects();
    if (!n) return { exams, subjects: subs, rows: [] as { exam: string; values: number[]; pass: number[] }[] };
    const rows = exams.map((e) => ({
      exam: e,
      values: subs.map((s) => n.examSubject.find((x) => x.exam === e && x.subject === s)?.avg ?? 0),
      pass: subs.map((s) => n.examSubject.find((x) => x.exam === e && x.subject === s)?.pass ?? 0),
    }));
    return { exams, subjects: subs, rows };
  });

  /** Exam-level summary rows, with deltas against the first exam. */
  readonly examRows = computed(() => {
    const n = this.current();
    if (!n) return [];
    const order = this.examTypes();
    const rows = order.map((e) => n.byExam.find((x) => x.name === e)).filter(Boolean) as any[];
    const baseAvg = rows.length ? rows[0].avg : 0;
    const basePass = rows.length ? rows[0].pass : 0;
    return rows.map((r, i) => ({
      ...r,
      avgDelta: i === 0 ? 0 : +(r.avg - baseAvg).toFixed(1),
      passDelta: i === 0 ? 0 : +(r.pass - basePass).toFixed(1),
      isBase: i === 0,
    }));
  });

  /** Per-district improvement from the first exam to the last. */
  readonly examSpreadByDistrict = computed(() => {
    const d = this._data();
    if (!d) return [];
    const map = d.districts[this.activeYear()] ?? {};
    const exams = this.examTypes();
    const first = exams[0];
    const last = exams[exams.length - 1];
    return Object.keys(map)
      .map((k) => {
        const q = map[k].byExam.find((x) => x.name === first);
        const a = map[k].byExam.find((x) => x.name === last);
        return {
          key: k,
          name: this.ds.titleCase(k),
          quarterly: q?.avg ?? 0,
          annual: a?.avg ?? 0,
          gain: +((a?.avg ?? 0) - (q?.avg ?? 0)).toFixed(1),
        };
      })
      .sort((x, y) => y.gain - x.gain);
  });

  readonly activeYear = computed(() => {
    const d = this._data();
    if (!d) return '';
    const y = this.year();
    return d.years.includes(y) ? y : d.currentYear;
  });

  /** Node for the current drill scope at the active year. */
  readonly current = computed<AcademicNode | null>(() => {
    const d = this._data();
    if (!d) return null;
    const y = this.activeYear();
    const level = this.ds.level();

    if (level === 'state') return d.state[y] ?? null;
    if (level === 'district') return d.districts[y]?.[this.ds.selectedDistrict()!] ?? d.state[y] ?? null;

    const key = `${this.ds.selectedDistrict()}||${this.ds.selectedBlock()}`;
    if (level === 'block') return d.blocks[y]?.[key] ?? d.state[y] ?? null;

    // school: use its own record (current year only)
    const sc = this.currentSchool();
    if (sc) {
      return {
        records: 0, total: sc.total, updated: sc.updated, compliance: sc.compliance,
        avgMark: sc.avgMark, passPct: sc.passPct,
        bySubject: sc.bySubject, byHsSubject: sc.byHsSubject ?? [],
        byExam: sc.byExam, byClass: sc.byClass,
        examSubject: sc.examSubject ?? [], byStream: sc.byStream ?? [], examClass: sc.examClass ?? [],
      };
    }
    return d.blocks[y]?.[key] ?? d.state[y] ?? null;
  });

  readonly stateNode = computed<AcademicNode | null>(() => {
    const d = this._data();
    return d ? d.state[this.activeYear()] ?? null : null;
  });

  readonly schoolsForBlock = computed<AcademicSchool[]>(() => {
    const s = this._schools();
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    if (!s || !dist || !blk) return [];
    return s[`${dist}||${blk}`] ?? [];
  });

  readonly currentSchool = computed<AcademicSchool | null>(() => {
    if (this.ds.level() !== 'school') return null;
    return this.schoolsForBlock().find((x) => x.name === this.ds.selectedSchool()) ?? null;
  });

  /** Whether the school we drilled into has academic data at all. */
  readonly schoolHasData = computed(() => this.ds.level() !== 'school' || !!this.currentSchool());

  // ---------------- children (for drill + comparison) ----------------
  readonly childLabel = computed(() => {
    switch (this.ds.level()) {
      case 'state': return 'Districts';
      case 'district': return 'Blocks';
      case 'block': return 'Schools';
      default: return 'This School';
    }
  });

  /** Children of the current scope with their academic metrics. */
  readonly children = computed(() => {
    const d = this._data();
    if (!d) return [] as { key: string; name: string; node: AcademicNode }[];
    const y = this.activeYear();
    const level = this.ds.level();

    if (level === 'state') {
      const m = d.districts[y] ?? {};
      return Object.keys(m).map((k) => ({ key: k, name: this.ds.titleCase(k), node: m[k] }));
    }
    if (level === 'district') {
      const prefix = this.ds.selectedDistrict() + '||';
      const m = d.blocks[y] ?? {};
      return Object.keys(m)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k.slice(prefix.length), name: this.ds.titleCase(k.slice(prefix.length)), node: m[k] }));
    }
    if (level === 'block') {
      return this.schoolsForBlock().map((s) => ({
        key: s.name, name: s.name,
        node: {
          records: 0, total: s.total, updated: s.updated, compliance: s.compliance,
          avgMark: s.avgMark, passPct: s.passPct,
          bySubject: s.bySubject, byHsSubject: s.byHsSubject ?? [],
          byExam: s.byExam, byClass: s.byClass,
          examSubject: s.examSubject ?? [], byStream: s.byStream ?? [], examClass: s.examClass ?? [],
        } as AcademicNode,
      }));
    }
    return [];
  });

  readonly metricLabel = computed(() => {
    switch (this.metric()) {
      case 'passPct': return 'Pass Percentage';
      case 'compliance': return 'Compliance';
      default: return 'Average Mark';
    }
  });
  readonly metricSuffix = computed(() => (this.metric() === 'avgMark' ? '' : '%'));

  /** Comparison rows: children ranked with all three headline metrics. */
  readonly comparisonRows = computed(() =>
    this.children().map((c) => ({
      key: c.key,
      name: c.name,
      avgMark: c.node.avgMark,
      passPct: c.node.passPct,
      compliance: c.node.compliance,
      total: c.node.total,
      updated: c.node.updated,
      weakest: [...c.node.bySubject].sort((a, b) => a.avg - b.avg)[0]?.name ?? '-',
      weakestAvg: [...c.node.bySubject].sort((a, b) => a.avg - b.avg)[0]?.avg ?? 0,
    })),
  );

  // ---------------- trends ----------------
  readonly fromYearInfo = computed(() => {
    const ys = this.years();
    if (!ys.length) return { year: '', index: 0 };
    const sel = this.fromYear();
    let idx = sel ? ys.indexOf(sel) : 0;
    if (idx < 0) idx = 0;
    // never allow from >= to
    const toIdx = this.toIndexRaw();
    if (idx >= toIdx) idx = Math.max(0, toIdx - 1);
    return { year: ys[idx], index: idx };
  });

  private toIndexRaw(): number {
    const ys = this.years();
    if (!ys.length) return 0;
    const sel = this.toYear();
    const idx = sel ? ys.indexOf(sel) : ys.length - 1;
    return idx < 0 ? ys.length - 1 : idx;
  }

  readonly toYearInfo = computed(() => {
    const ys = this.years();
    if (!ys.length) return { year: '', index: 0 };
    const idx = this.toIndexRaw();
    return { year: ys[idx], index: idx };
  });

  /** Valid "from" options: every year before the selected "to". */
  readonly fromYearOptions = computed(() => this.years().slice(0, Math.max(1, this.toYearInfo().index)));
  /** Valid "to" options: every year after the selected "from". */
  readonly toYearOptions = computed(() => this.years().slice(this.fromYearInfo().index + 1));

  /** Label describing the active trend range. */
  readonly rangeLabel = computed(() => `${this.fromYearInfo().year} to ${this.toYearInfo().year}`);

  // ---- trend exam / class filters ----
  /** Exam-type options for the trend multiselect. */
  readonly trendExamOptions = computed(() =>
    this.examTypes().map((e) => ({ label: e, value: e })),
  );

  /** Class options for the trend multiselect: every class that has a sitting anywhere. */
  readonly trendClassOptions = computed(() => {
    const d = this._data();
    if (!d) return [] as { label: string; value: number }[];
    const set = new Set<number>();
    for (const y of d.years) {
      const n = d.state[y];
      if (n) for (const r of n.examClass ?? []) set.add(r.cls);
    }
    return [...set]
      .sort((a, b) => a - b)
      .map((c) => ({ label: `Class ${c}`, value: c }));
  });

  /**
   * A node's metric value, filtered to the selected exam types and classes.
   * Empty filters fall back to the node's headline figure. Otherwise the
   * matching exam sittings are aggregated, weighting avg/pass by students
   * entered (updated) and compliance by students expected (total).
   */
  private filteredMetric(node: AcademicNode | null | undefined, metric: AcademicMetric): number {
    if (!node) return 0;
    const exams = this.trendExams();
    const classes = this.trendClasses();
    if (!exams.length && !classes.length) return (node as any)[metric] ?? 0;

    const rows = (node.examClass ?? []).filter(
      (r) => (!exams.length || exams.includes(r.exam)) && (!classes.length || classes.includes(r.cls)),
    );
    if (!rows.length) return 0;

    if (metric === 'compliance') {
      const total = rows.reduce((s, r) => s + (r.total ?? 0), 0);
      const updated = rows.reduce((s, r) => s + (r.updated ?? 0), 0);
      return total > 0 ? +((updated / total) * 100).toFixed(1) : 0;
    }
    // avgMark / passPct: weight by students actually entered
    const wSum = rows.reduce((s, r) => s + (r.updated ?? 0), 0);
    if (wSum <= 0) {
      const vals = rows.map((r) => (metric === 'passPct' ? r.pass : r.avg));
      return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : 0;
    }
    const weighted = rows.reduce(
      (s, r) => s + (metric === 'passPct' ? r.pass : r.avg) * (r.updated ?? 0),
      0,
    );
    return +(weighted / wSum).toFixed(1);
  }

  /** Scope trend across the selected range for all three metrics. */
  readonly scopeTrend = computed(() => {
    const d = this._data();
    if (!d) return { years: [] as string[], avgMark: [] as number[], passPct: [] as number[], compliance: [] as number[] };
    const a = this.fromYearInfo().index;
    const b = this.toYearInfo().index;
    const years = d.years.slice(a, b + 1);
    const level = this.ds.level();
    const pick = (y: string): AcademicNode | null => {
      if (level === 'state') return d.state[y] ?? null;
      if (level === 'district') return d.districts[y]?.[this.ds.selectedDistrict()!] ?? null;
      return d.blocks[y]?.[`${this.ds.selectedDistrict()}||${this.ds.selectedBlock()}`] ?? null;
    };
    return {
      years,
      avgMark: years.map((y) => this.filteredMetric(pick(y), 'avgMark')),
      passPct: years.map((y) => this.filteredMetric(pick(y), 'passPct')),
      compliance: years.map((y) => this.filteredMetric(pick(y), 'compliance')),
    };
  });

  /** Children trend series for the selected metric, ranked and limited. */
  readonly childTrends = computed(() => {
    const d = this._data();
    if (!d) return { years: [] as string[], items: [] as { key: string; name: string; series: number[] }[], total: 0, shown: 0 };
    const a = this.fromYearInfo().index;
    const b = this.toYearInfo().index;
    const years = d.years.slice(a, b + 1);
    const m = this.metric();
    const level = this.ds.level();
    // list children from the range end, so the set matches what is being compared
    const refYear = d.years[b];

    let keys: { key: string; name: string }[] = [];
    if (level === 'state') {
      keys = Object.keys(d.districts[refYear] ?? {}).map((k) => ({ key: k, name: this.ds.titleCase(k) }));
    } else if (level === 'district') {
      const prefix = this.ds.selectedDistrict() + '||';
      keys = Object.keys(d.blocks[refYear] ?? {})
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k.slice(prefix.length), name: this.ds.titleCase(k.slice(prefix.length)) }));
    } else {
      return { years, items: [], total: 0, shown: 0 };
    }

    const items = keys.map(({ key, name }) => ({
      key, name,
      series: years.map((y) => {
        const node = level === 'state'
          ? d.districts[y]?.[key]
          : d.blocks[y]?.[`${this.ds.selectedDistrict()}||${key}`];
        return this.filteredMetric(node, m);
      }),
    }));

    const scored = items.map((it) => {
      const f = it.series[0] ?? 0;
      const l = it.series[it.series.length - 1] ?? 0;
      return { it, delta: l - f };
    });
    scored.sort((x, y) => (this.rank() === 'top' ? y.delta - x.delta : x.delta - y.delta));
    const n = Math.min(20, Math.max(1, this.count()));
    const picked = scored.slice(0, n).map((x) => x.it);
    return { years, items: picked, total: items.length, shown: picked.length };
  });

  /** Child change rows for the trend table. */
  readonly childTrendRows = computed(() => {
    const d = this._data();
    if (!d) return [];
    const a = this.fromYearInfo().index;
    const b = this.toYearInfo().index;
    const years = d.years.slice(a, b + 1);
    const m = this.metric();
    const level = this.ds.level();
    if (level !== 'state' && level !== 'district') return [];
    const refYear = d.years[b];

    const keys = level === 'state'
      ? Object.keys(d.districts[refYear] ?? {})
      : Object.keys(d.blocks[refYear] ?? {})
          .filter((k) => k.startsWith(this.ds.selectedDistrict() + '||'))
          .map((k) => k.slice((this.ds.selectedDistrict() + '||').length));

    const rows = keys.map((key) => {
      const series = years.map((y) => {
        const node = level === 'state'
          ? d.districts[y]?.[key]
          : d.blocks[y]?.[`${this.ds.selectedDistrict()}||${key}`];
        return this.filteredMetric(node, m);
      });
      const first = series[0] ?? 0;
      const last = series[series.length - 1] ?? 0;
      return {
        key, name: this.ds.titleCase(key), first, last,
        diff: +(last - first).toFixed(1),
        change: first > 0 ? +(((last - first) / first) * 100).toFixed(1) : 0,
      };
    });
    return rows.sort((x, y) => (this.rank() === 'top' ? y.diff - x.diff : x.diff - y.diff));
  });

  // ---------------- alerts ----------------
  /**
   * Academic alerts with explicit, auditable thresholds:
   *   pass % < 70, average mark < 50, compliance < 85,
   *   any subject averaging < 40 (subject-level learning gap).
   */
  readonly alerts = computed(() => {
    const d = this._data();
    if (!d) return [];
    const y = this.activeYear();
    const map = d.districts[y] ?? {};
    const state = d.state[y];
    const out: {
      district: string; kind: string; severity: 'high' | 'medium';
      detail: string; value: number;
    }[] = [];

    for (const dist of Object.keys(map)) {
      const n = map[dist];
      if (n.passPct < 70) {
        out.push({
          district: dist, kind: 'Low Pass Percentage',
          severity: n.passPct < 60 ? 'high' : 'medium',
          detail: `${n.passPct}% vs state ${state?.passPct ?? 0}%`, value: n.passPct,
        });
      }
      if (n.avgMark < 50) {
        out.push({
          district: dist, kind: 'Low Average Mark',
          severity: n.avgMark < 42 ? 'high' : 'medium',
          detail: `${n.avgMark} vs state ${state?.avgMark ?? 0}`, value: n.avgMark,
        });
      }
      if (n.compliance < 85) {
        out.push({
          district: dist, kind: 'Low Data Compliance',
          severity: n.compliance < 75 ? 'high' : 'medium',
          detail: `${n.compliance}% of ${n.total.toLocaleString('en-IN')} students entered`,
          value: n.compliance,
        });
      }
      const weak = [...n.bySubject].sort((a, b) => a.avg - b.avg)[0];
      if (weak && weak.avg < 40) {
        out.push({
          district: dist, kind: `Subject Risk: ${weak.name}`,
          severity: weak.avg < 33 ? 'high' : 'medium',
          detail: `${weak.name} averaging ${weak.avg}`, value: weak.avg,
        });
      }
    }
    const rank = { high: 0, medium: 1 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.value - b.value);
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

  /** Risk quadrant: compliance (x) vs pass % (y) per district. */
  readonly riskScatter = computed(() => {
    const d = this._data();
    if (!d) return [];
    const map = d.districts[this.activeYear()] ?? {};
    return Object.keys(map).map((k) => ({
      name: this.ds.titleCase(k),
      key: k,
      x: map[k].compliance,
      y: map[k].passPct,
      size: map[k].total,
    }));
  });

  /** Subject x district matrix for the heatmap. */
  readonly heatmap = computed(() => {
    const d = this._data();
    if (!d) return { districts: [] as string[], subjects: [] as string[], cells: [] as [number, number, number][] };
    const y = this.activeYear();
    const map = d.districts[y] ?? {};
    const dists = Object.keys(map).sort((a, b) => map[b].avgMark - map[a].avgMark);
    const subs = d.subjects;
    const cells: [number, number, number][] = [];
    dists.forEach((dn, di) => {
      subs.forEach((s, si) => {
        const rec = map[dn].bySubject.find((x) => x.name === s);
        cells.push([si, di, rec ? rec.avg : 0]);
      });
    });
    return { districts: dists.map((x) => this.ds.titleCase(x)), subjects: subs, cells };
  });

  /** Every academic school row inside the current scope. */
  readonly scopeSchools = computed(() =>
    schoolsInScope(
      this._schools(), this.ds.level(),
      this.ds.selectedDistrict(), this.ds.selectedBlock(), this.ds.selectedSchool(),
    ),
  );

  /**
   * Caution checks for Academic Scores. The headline check is zero compliance:
   * schools that have uploaded no marks at all, so every average shown
   * elsewhere silently excludes them.
   */
  readonly cautionChecks = computed<CautionCheck[]>(() => {
    const rows = this.scopeSchools();
    type Row = (typeof rows)[number];

    const defs: {
      id: string; label: string; icon: string; hint: string;
      severity: 'high' | 'medium';
      test: (r: Row) => boolean;
      detail: (r: Row) => string;
    }[] = [
      {
        id: 'zeroCompliance', label: 'Zero Mark Entry Compliance', icon: 'fa-solid fa-file-circle-xmark',
        hint: `No marks uploaded at all for ${this.activeYear()} — excluded from every average`,
        severity: 'high',
        test: (r) => r.compliance === 0,
        detail: (r) => `0 of ${inr(r.total)} assessments entered`,
      },
      {
        id: 'nearZeroCompliance', label: 'Mark Entry Under 25%', icon: 'fa-solid fa-file-pen',
        hint: 'Barely any marks uploaded, so the school average is not meaningful',
        severity: 'high',
        test: (r) => r.compliance > 0 && r.compliance < 25,
        detail: (r) => `${r.compliance}% entered (${inr(r.updated)} of ${inr(r.total)})`,
      },
      {
        id: 'zeroAvg', label: 'Zero Average Mark', icon: 'fa-solid fa-circle-xmark',
        hint: 'No mark recorded against any subject',
        severity: 'high',
        test: (r) => r.avgMark === 0,
        detail: (r) => `${inr(r.total)} assessments, no marks`,
      },
      {
        id: 'lowCompliance', label: 'Mark Entry Under 50%', icon: 'fa-solid fa-clipboard-question',
        hint: 'Less than half the assessments uploaded',
        severity: 'medium',
        test: (r) => r.compliance > 0 && r.compliance < 50,
        detail: (r) => `${r.compliance}% entered (${inr(r.updated)} of ${inr(r.total)})`,
      },
    ];

    return defs.map((d) => {
      const hits = rows.filter(d.test);
      return {
        id: d.id, label: d.label, icon: d.icon, hint: d.hint, severity: d.severity,
        count: hits.length,
        schools: hits
          .map((r) => ({
            district: this.ds.titleCase(r.__district),
            block: this.ds.titleCase(r.__block),
            school: r.name, udise: r.udise, mgmt: r.mgmt, stype: r.ctype ?? '',
            students: r.total, detail: d.detail(r),
          }))
          .sort((a, b) => b.students - a.students || a.school.localeCompare(b.school)),
      };
    });
  });

  /** Distinct schools flagged by at least one academic caution check. */
  readonly cautionTotal = computed(() => {
    const seen = new Set<string>();
    for (const c of this.cautionChecks()) {
      for (const s of c.schools) seen.add(s.udise || `${s.district}|${s.block}|${s.school}`);
    }
    return seen.size;
  });
}
