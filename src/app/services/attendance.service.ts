import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { loadAsset } from '../utils/asset-loader';
import { schoolsInScope } from '../utils/scope';
import { inr } from '../utils/format';
import { CautionCheck } from '../models/caution.model';
import {
  AttendanceData,
  AttendanceMetric,
  AttendanceNode,
  AttendanceSchool,
  AttendanceSchoolsData,
} from '../models/attendance.model';
import { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly ds = inject(DataService);

  private readonly _data = signal<AttendanceData | null>(null);
  private readonly _schools = signal<AttendanceSchoolsData | null>(null);
  private readonly _loaded = signal(false);

  readonly data = this._data.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** Rolling window in working days: 3, 5, 7, 15 or 30. */
  readonly window = signal(30);
  /**
   * View mode for the Numbers page:
   *   'period' = rolling window, 'day' = a single working day.
   */
  readonly mode = signal<'period' | 'day'>('period');
  /** The selected working day (ISO date); defaults to the latest. */
  readonly day = signal<string>('');
  /** Metric driving comparison / alerts. */
  readonly metric = signal<AttendanceMetric>('attendance');
  /** Ranking direction and size. */
  readonly rank = signal<'top' | 'bottom'>('bottom');
  readonly count = signal(12);
  /** Which comparison sub-view is active. */
  readonly compareMode = signal<'districts' | 'days'>('districts');
  /** Head-to-head day selection. */
  readonly dayA = signal<string>('');
  readonly dayB = signal<string>('');

  async load(): Promise<void> {
    if (this._loaded()) return;
    const [d, s] = await Promise.all([
      loadAsset<AttendanceData>('assets/attendance.json'),
      loadAsset<AttendanceSchoolsData>('assets/attendance-schools.json'),
    ]);
    this._data.set(d);
    this._schools.set(s);
    this._loaded.set(true);
  }

  readonly windowOptions = computed(() => this._data()?.windows ?? [3, 5, 7, 15, 30]);
  readonly asOf = computed(() => this._data()?.asOf ?? '');
  readonly note = computed(() => this._data()?.note ?? '');
  readonly dropoutThreshold = computed(() => this._data()?.dropoutThreshold ?? 15);

  /** Selectable working days, newest first. */
  readonly dayOptions = computed(() => [...(this._data()?.dates ?? [])].reverse());

  /** Resolved selected day, defaulting to the latest working day. */
  readonly activeDay = computed(() => {
    const dates = this._data()?.dates ?? [];
    if (!dates.length) return '';
    const sel = this.day();
    return dates.includes(sel) ? sel : dates[dates.length - 1];
  });

  /** True when the Numbers page is showing one specific day. */
  readonly isDayMode = computed(() => this.mode() === 'day');

  /** The day record for the current scope and selected date. */
  readonly activeDayRecord = computed(() => {
    const n = this.current();
    if (!n) return null;
    const d = this.activeDay();
    return n.daily.find((x) => x.date === d) ?? null;
  });

  /** Label describing whatever period is in effect. */
  readonly periodLabel = computed(() =>
    this.isDayMode() ? this.activeDay() : `Last ${this.window()} working days`,
  );

  /** Node for the current drill scope. */
  readonly current = computed<AttendanceNode | null>(() => {
    const d = this._data();
    if (!d) return null;
    const level = this.ds.level();
    if (level === 'state') return d.state;
    if (level === 'district') return d.districts[this.ds.selectedDistrict()!] ?? d.state;
    const key = `${this.ds.selectedDistrict()}||${this.ds.selectedBlock()}`;
    if (level === 'block') return d.blocks[key] ?? d.state;

    const sc = this.currentSchool();
    if (sc) {
      // reconstruct this school's daily series from its compact array
      const dates = d.dates;
      const daily = (sc.dailyAtt ?? []).map((att, i) => {
        const marked = att >= 0;
        const present = marked ? Math.round(sc.enrolled * att / 100) : 0;
        return {
          date: dates[i] ?? '',
          attendance: marked ? att : 0,
          compliance: marked ? 100 : 0,
          teacher: marked ? sc.teacherAttendance : 0,
          absentees: marked ? sc.enrolled - present : 0,
          schools: 1,
          marked: marked ? 1 : 0,
          unmarked: marked ? 0 : 1,
          expected: marked ? sc.enrolled : 0,
          present,
          tExpected: 0,
          tPresent: 0,
        };
      });
      return {
        schools: 1, enrolled: sc.enrolled,
        compliance: sc.compliance, unmarkedDays: sc.unmarkedDays,
        markedDays: 0, expectedDays: 0,
        attendance: sc.attendance, absentees: sc.absentees,
        teacherAttendance: sc.teacherAttendance, teacherAbsentees: 0,
        dropoutRisk: sc.dropoutRisk, dropoutRate: sc.dropoutRate,
        windows: sc.windows,
        daily: daily.length ? daily : (d.blocks[key]?.daily ?? d.state.daily),
      };
    }
    return d.blocks[key] ?? d.state;
  });

  readonly stateNode = computed(() => this._data()?.state ?? null);

  readonly schoolsForBlock = computed<AttendanceSchool[]>(() => {
    const s = this._schools();
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    if (!s || !dist || !blk) return [];
    return s[`${dist}||${blk}`] ?? [];
  });

  /**
   * Every school inside the current scope. State level walks all blocks,
   * district level only that district's blocks, block level one block.
   */
  readonly scopeSchools = computed<AttendanceSchool[]>(() => {
    const s = this._schools();
    if (!s) return [];
    const level = this.ds.level();
    if (level === 'school') {
      const one = this.currentSchool();
      return one ? [one] : [];
    }
    if (level === 'block') return this.schoolsForBlock();
    if (level === 'district') {
      const dist = this.ds.selectedDistrict();
      const out: AttendanceSchool[] = [];
      for (const k of Object.keys(s)) {
        if (k.startsWith(`${dist}||`)) out.push(...s[k]);
      }
      return out;
    }
    const all: AttendanceSchool[] = [];
    for (const k of Object.keys(s)) all.push(...s[k]);
    return all;
  });

  /**
   * Distribution of schools across attendance bands. An average hides shape —
   * two districts can both sit at 88% with very different tails — so Numbers
   * shows how many schools actually fall where.
   */
  readonly attendanceBands = computed(() => {
    const bands = [
      { label: 'Below 60%', min: -1, max: 60, color: '#8e1b1b' },
      { label: '60-75%', min: 60, max: 75, color: '#c0392b' },
      { label: '75-85%', min: 75, max: 85, color: '#e8973a' },
      { label: '85-90%', min: 85, max: 90, color: '#c9c433' },
      { label: '90-95%', min: 90, max: 95, color: '#52a447' },
      { label: '95% & above', min: 95, max: 101, color: '#2f7d32' },
    ];
    const schools = this.scopeSchools();
    const rows = bands.map((b) => {
      const inBand = schools.filter((s) => s.attendance >= b.min && s.attendance < b.max);
      return {
        label: b.label, color: b.color,
        schools: inBand.length,
        students: inBand.reduce((a, s) => a + s.enrolled, 0),
      };
    });
    const total = schools.length || 1;
    const totalStu = rows.reduce((a, r) => a + r.students, 0) || 1;
    return rows.map((r) => ({
      ...r,
      pct: Math.round((r.schools / total) * 1000) / 10,
      studentPct: Math.round((r.students / totalStu) * 1000) / 10,
    }));
  });

  /** Count of schools sitting below the 85% attendance mark. */
  readonly belowMark = computed(() => {
    const b = this.attendanceBands();
    const low = b.slice(0, 3);
    return {
      schools: low.reduce((a, r) => a + r.schools, 0),
      students: low.reduce((a, r) => a + r.students, 0),
      pct: Math.round(low.reduce((a, r) => a + r.pct, 0) * 10) / 10,
    };
  });

  /**
   * Attendance split by broad school type. Attendance is only collected
   * for Government, Partially Aided and Fully Aided schools, so comparing
   * those three is the meaningful breakdown at this level.
   */
  readonly byManagement = computed(() => {
    const schools = this.scopeSchools();
    const groups = new Map<string, AttendanceSchool[]>();
    for (const s of schools) {
      const k = s.stype || s.mgmt || 'Unspecified';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }
    const wAvg = (list: AttendanceSchool[], pick: (s: AttendanceSchool) => number) => {
      const tot = list.reduce((a, s) => a + s.enrolled, 0);
      if (!tot) return 0;
      return Math.round((list.reduce((a, s) => a + pick(s) * s.enrolled, 0) / tot) * 10) / 10;
    };
    return [...groups.entries()]
      .map(([name, list]) => ({
        name,
        schools: list.length,
        enrolled: list.reduce((a, s) => a + s.enrolled, 0),
        attendance: wAvg(list, (s) => s.attendance),
        compliance: wAvg(list, (s) => s.compliance),
        teacherAttendance: wAvg(list, (s) => s.teacherAttendance),
        dropoutRate: wAvg(list, (s) => s.dropoutRate),
      }))
      .sort((a, b) => b.enrolled - a.enrolled);
  });

  readonly currentSchool = computed<AttendanceSchool | null>(() => {
    if (this.ds.level() !== 'school') return null;
    return this.schoolsForBlock().find((x) => x.name === this.ds.selectedSchool()) ?? null;
  });

  readonly schoolHasData = computed(() => this.ds.level() !== 'school' || !!this.currentSchool());

  /** The selected rolling window for the current scope. */
  readonly activeWindow = computed(() => {
    const n = this.current();
    if (!n) return null;
    return n.windows.find((w) => w.days === this.window()) ?? n.windows[n.windows.length - 1] ?? null;
  });

  /** Daily series trimmed to the selected window. */
  readonly dailySeries = computed(() => {
    const n = this.current();
    if (!n) return [];
    const w = this.window();
    return n.daily.slice(Math.max(0, n.daily.length - w));
  });

  readonly childLabel = computed(() => {
    switch (this.ds.level()) {
      case 'state': return 'Districts';
      case 'district': return 'Blocks';
      case 'block': return 'Schools';
      default: return 'This School';
    }
  });

  /** Children of the current scope with attendance metrics. */
  readonly children = computed(() => {
    const d = this._data();
    if (!d) return [] as { key: string; name: string; node: AttendanceNode }[];
    const level = this.ds.level();
    if (level === 'state') {
      return Object.keys(d.districts).map((k) => ({ key: k, name: this.ds.titleCase(k), node: d.districts[k] }));
    }
    if (level === 'district') {
      const prefix = this.ds.selectedDistrict() + '||';
      return Object.keys(d.blocks)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k.slice(prefix.length), name: this.ds.titleCase(k.slice(prefix.length)), node: d.blocks[k] }));
    }
    if (level === 'block') {
      return this.schoolsForBlock().map((s) => ({
        key: s.name, name: s.name,
        node: {
          schools: 1, enrolled: s.enrolled, compliance: s.compliance,
          unmarkedDays: s.unmarkedDays, markedDays: 0, expectedDays: 0,
          attendance: s.attendance, absentees: s.absentees,
          teacherAttendance: s.teacherAttendance, teacherAbsentees: 0,
          dropoutRisk: s.dropoutRisk, dropoutRate: s.dropoutRate,
          windows: s.windows, daily: [],
        } as AttendanceNode,
      }));
    }
    return [];
  });

  readonly metricLabel = computed(() => {
    switch (this.metric()) {
      case 'compliance': return 'Marking Compliance';
      case 'teacherAttendance': return 'Teacher Attendance';
      case 'dropoutRate': return 'Dropout Risk Rate';
      default: return 'Student Attendance';
    }
  });

  /** Comparison rows, honouring either the selected day or the rolling window. */
  readonly comparisonRows = computed(() => {
    const w = this.window();
    const dayMode = this.isDayMode();
    const day = this.activeDay();
    return this.children().map((c) => {
      const win = c.node.windows.find((x) => x.days === w);
      const dd = dayMode ? c.node.daily.find((x) => x.date === day) : null;
      return {
        key: c.key,
        name: c.name,
        enrolled: c.node.enrolled,
        attendance: dd ? dd.attendance : win ? win.attendance : c.node.attendance,
        compliance: dd ? dd.compliance : win ? win.compliance : c.node.compliance,
        absentees: dd ? dd.absentees : win ? win.absentees : c.node.absentees,
        unmarked: dd ? dd.unmarked : win ? win.unmarked : c.node.unmarkedDays,
        teacherAttendance: dd ? dd.teacher : c.node.teacherAttendance,
        dropoutRisk: c.node.dropoutRisk,
        dropoutRate: c.node.dropoutRate,
      };
    });
  });

  /** Child daily series for the trend comparison. */
  readonly childTrends = computed(() => {
    const d = this._data();
    if (!d) return { dates: [] as string[], items: [], total: 0, shown: 0 };
    const level = this.ds.level();
    if (level !== 'state' && level !== 'district') return { dates: [], items: [], total: 0, shown: 0 };
    const w = this.window();
    const dates = d.dates.slice(Math.max(0, d.dates.length - w));
    const m = this.metric();
    const field = m === 'compliance' ? 'compliance' : m === 'teacherAttendance' ? 'teacher' : 'attendance';

    const src = level === 'state'
      ? Object.keys(d.districts).map((k) => ({ key: k, name: this.ds.titleCase(k), node: d.districts[k] }))
      : Object.keys(d.blocks)
          .filter((k) => k.startsWith(this.ds.selectedDistrict() + '||'))
          .map((k) => ({
            key: k.slice((this.ds.selectedDistrict() + '||').length),
            name: this.ds.titleCase(k.slice((this.ds.selectedDistrict() + '||').length)),
            node: d.blocks[k],
          }));

    const items = src.map((x) => ({
      key: x.key, name: x.name,
      series: x.node.daily.slice(Math.max(0, x.node.daily.length - w)).map((dd: any) => dd[field] ?? 0),
    }));
    // rank by the window average
    const scored = items.map((it) => ({
      it,
      avg: it.series.length ? it.series.reduce((s, v) => s + v, 0) / it.series.length : 0,
    }));
    scored.sort((a, b) => (this.rank() === 'top' ? b.avg - a.avg : a.avg - b.avg));
    const n = Math.min(20, Math.max(1, this.count()));
    const picked = scored.slice(0, n).map((x) => x.it);
    return { dates, items: picked, total: items.length, shown: picked.length };
  });

  // ---------------- day vs day comparison ----------------
  /** Resolved day A, defaulting to the second-newest working day. */
  readonly resolvedDayA = computed(() => {
    const dates = this._data()?.dates ?? [];
    if (!dates.length) return '';
    const sel = this.dayA();
    if (dates.includes(sel)) return sel;
    return dates.length > 1 ? dates[dates.length - 2] : dates[0];
  });

  /** Resolved day B, defaulting to the newest and never equal to A. */
  readonly resolvedDayB = computed(() => {
    const dates = this._data()?.dates ?? [];
    if (!dates.length) return '';
    const a = this.resolvedDayA();
    const sel = this.dayB();
    if (dates.includes(sel) && sel !== a) return sel;
    const other = [...dates].reverse().find((d) => d !== a);
    return other ?? dates[dates.length - 1];
  });

  /**
   * Head-to-head comparison of two working days for the current scope,
   * with a per-district breakdown so movement can be traced.
   */
  readonly dayHeadToHead = computed(() => {
    const d = this._data();
    const n = this.current();
    if (!d || !n) return null;
    const aDate = this.resolvedDayA();
    const bDate = this.resolvedDayB();
    const a = n.daily.find((x) => x.date === aDate);
    const b = n.daily.find((x) => x.date === bDate);
    if (!a || !b) return null;

    // per-child movement between the two days
    const children = this.children().map((c) => {
      const ca = c.node.daily.find((x) => x.date === aDate);
      const cb = c.node.daily.find((x) => x.date === bDate);
      return {
        key: c.key,
        name: c.name,
        aAtt: ca?.attendance ?? 0,
        bAtt: cb?.attendance ?? 0,
        attDiff: +(((cb?.attendance ?? 0) - (ca?.attendance ?? 0))).toFixed(1),
        aComp: ca?.compliance ?? 0,
        bComp: cb?.compliance ?? 0,
        compDiff: +(((cb?.compliance ?? 0) - (ca?.compliance ?? 0))).toFixed(1),
        aMarked: ca?.marked ?? 0,
        bMarked: cb?.marked ?? 0,
      };
    }).sort((x, y) => x.attDiff - y.attDiff);

    return {
      aDate, bDate, a, b, children,
      attDiff: +(b.attendance - a.attendance).toFixed(1),
      compDiff: +(b.compliance - a.compliance).toFixed(1),
      teacherDiff: +(b.teacher - a.teacher).toFixed(1),
      absDiff: b.absentees - a.absentees,
      markedDiff: b.marked - a.marked,
    };
  });

  /**
   * Attendance alerts with explicit thresholds:
   *   compliance < 80%, attendance < 85%, teacher attendance < 90%,
   *   dropout risk rate > 5%.
   */
  readonly alerts = computed(() => {
    const d = this._data();
    if (!d) return [];
    const w = this.window();
    const st = d.state;
    const out: {
      district: string; kind: string; severity: 'high' | 'medium';
      detail: string; value: number;
    }[] = [];

    for (const k of Object.keys(d.districts)) {
      const n = d.districts[k];
      const win = n.windows.find((x) => x.days === w);
      const att = win ? win.attendance : n.attendance;
      const comp = win ? win.compliance : n.compliance;

      if (comp < 80) {
        out.push({
          district: k, kind: 'Low Marking Compliance',
          severity: comp < 70 ? 'high' : 'medium',
          detail: `${comp}% marked over last ${w} days (state ${st.compliance}%)`, value: comp,
        });
      }
      if (att < 85) {
        out.push({
          district: k, kind: 'Low Student Attendance',
          severity: att < 80 ? 'high' : 'medium',
          detail: `${att}% over last ${w} days (state ${st.attendance}%)`, value: att,
        });
      }
      if (n.teacherAttendance < 90) {
        out.push({
          district: k, kind: 'Low Teacher Attendance',
          severity: n.teacherAttendance < 85 ? 'high' : 'medium',
          detail: `${n.teacherAttendance}% (state ${st.teacherAttendance}%)`, value: n.teacherAttendance,
        });
      }
      if (n.dropoutRate > 5) {
        out.push({
          district: k, kind: 'High Dropout Risk',
          severity: n.dropoutRate > 8 ? 'high' : 'medium',
          detail: `${n.dropoutRate}% absent ${d.dropoutThreshold}+ days (${n.dropoutRisk.toLocaleString('en-IN')} students)`,
          value: n.dropoutRate,
        });
      }
    }
    const order = { high: 0, medium: 1 };
    return out.sort((a, b) => order[a.severity] - order[b.severity] || a.value - b.value);
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

  /** Risk scatter: compliance (x) vs attendance (y), bubble = dropout risk. */
  readonly riskScatter = computed(() => {
    const d = this._data();
    if (!d) return [];
    const w = this.window();
    return Object.keys(d.districts).map((k) => {
      const n = d.districts[k];
      const win = n.windows.find((x) => x.days === w);
      return {
        key: k, name: this.ds.titleCase(k),
        x: win ? win.compliance : n.compliance,
        y: win ? win.attendance : n.attendance,
        size: n.dropoutRisk,
      };
    });
  });

  /** Districts ranked by dropout risk for the alarming view. */
  readonly dropoutRanking = computed(() => {
    const d = this._data();
    if (!d) return [];
    return Object.keys(d.districts)
      .map((k) => ({
        key: k, name: this.ds.titleCase(k),
        risk: d.districts[k].dropoutRisk,
        rate: d.districts[k].dropoutRate,
        enrolled: d.districts[k].enrolled,
      }))
      .sort((a, b) => b.rate - a.rate);
  });

  /**
   * Caution checks for Attendance. The headline check is zero compliance:
   * schools that never marked attendance on any working day in the window, so
   * they contribute nothing to the attendance percentages shown elsewhere.
   */
  readonly cautionChecks = computed<CautionCheck[]>(() => {
    const rows = schoolsInScope(
      this._schools(), this.ds.level(),
      this.ds.selectedDistrict(), this.ds.selectedBlock(), this.ds.selectedSchool(),
    );
    type Row = (typeof rows)[number];
    const days = this._data()?.days ?? 30;

    const defs: {
      id: string; label: string; icon: string; hint: string;
      severity: 'high' | 'medium';
      test: (r: Row) => boolean;
      detail: (r: Row) => string;
    }[] = [
      {
        id: 'zeroCompliance', label: 'Zero Marking Compliance', icon: 'fa-solid fa-calendar-xmark',
        hint: `Attendance never marked on any of the last ${days} working days`,
        severity: 'high',
        test: (r) => r.compliance === 0,
        detail: (r) => `${inr(r.enrolled)} students, 0 of ${days} days marked`,
      },
      {
        id: 'nearZeroCompliance', label: 'Marking Under 25%', icon: 'fa-solid fa-calendar-day',
        hint: 'Attendance marked on barely any working day',
        severity: 'high',
        test: (r) => r.compliance > 0 && r.compliance < 25,
        detail: (r) => `${r.compliance}% marked, ${inr(r.unmarkedDays)} days missed`,
      },
      {
        id: 'zeroAttendance', label: 'Zero Attendance Recorded', icon: 'fa-solid fa-user-slash',
        hint: 'No student ever recorded present',
        severity: 'high',
        test: (r) => r.attendance === 0,
        detail: (r) => `${inr(r.enrolled)} students, none recorded present`,
      },
      {
        id: 'zeroTeacherAtt', label: 'Zero Teacher Attendance', icon: 'fa-solid fa-user-xmark',
        hint: 'No teacher ever recorded present',
        severity: 'high',
        test: (r) => r.teacherAttendance === 0,
        detail: () => 'no teacher attendance recorded',
      },
      {
        id: 'lowCompliance', label: 'Marking Under 50%', icon: 'fa-solid fa-calendar-minus',
        hint: 'Attendance marked on less than half the working days',
        severity: 'medium',
        test: (r) => r.compliance > 0 && r.compliance < 50,
        detail: (r) => `${r.compliance}% marked, ${inr(r.unmarkedDays)} days missed`,
      },
      {
        id: 'highDropout', label: 'Dropout Risk Over 20%', icon: 'fa-solid fa-person-walking-arrow-right',
        hint: `More than a fifth of students absent ${this.dropoutThreshold()}+ days`,
        severity: 'medium',
        test: (r) => r.dropoutRate > 20,
        detail: (r) => `${r.dropoutRate}% at risk (${inr(r.dropoutRisk)} students)`,
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
            school: r.name, udise: r.udise, mgmt: r.mgmt, stype: r.stype ?? '',
            students: r.enrolled, detail: d.detail(r),
          }))
          .sort((a, b) => b.students - a.students || a.school.localeCompare(b.school)),
      };
    });
  });

  /** Distinct schools flagged by at least one attendance caution check. */
  readonly cautionTotal = computed(() => {
    const seen = new Set<string>();
    for (const c of this.cautionChecks()) {
      for (const s of c.schools) seen.add(s.udise || `${s.district}|${s.block}|${s.school}`);
    }
    return seen.size;
  });
}
