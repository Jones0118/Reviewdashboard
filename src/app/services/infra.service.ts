import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { loadAsset } from '../utils/asset-loader';
import { schoolsInScope } from '../utils/scope';
import { inr } from '../utils/format';
import { CautionCheck } from '../models/caution.model';
import {
  InfraData,
  InfraMetric,
  InfraNode,
  InfraSchool,
  InfraSchoolsData,
  InfraType,
} from '../models/infra.model';
import { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class InfraService {
  private readonly http = inject(HttpClient);
  private readonly ds = inject(DataService);

  private readonly _emis = signal<InfraData | null>(null);
  private readonly _udise = signal<InfraData | null>(null);
  private readonly _emisSchools = signal<InfraSchoolsData | null>(null);
  private readonly _udiseSchools = signal<InfraSchoolsData | null>(null);
  private readonly _loaded = signal(false);
  readonly loaded = this._loaded.asReadonly();

  /** Infrastructure has its own source toggle. */
  readonly source = signal<'EMIS' | 'UDISE+'>('EMIS');
  /** Selected infrastructure type, shown in the left sidebar. */
  readonly type = signal('classrooms');
  /** Selected data-entry period (month for EMIS, academic year for UDISE+). */
  readonly period = signal('');
  /** Metric driving comparison and ranking. */
  readonly metric = signal<InfraMetric>('availabilityPct');
  readonly rank = signal<'top' | 'bottom'>('bottom');
  readonly count = signal(12);

  private readonly _data = computed<InfraData | null>(() =>
    this.source() === 'UDISE+' ? this._udise() ?? this._emis() : this._emis(),
  );
  private readonly _schools = computed<InfraSchoolsData | null>(() =>
    this.source() === 'UDISE+' ? this._udiseSchools() ?? this._emisSchools() : this._emisSchools(),
  );
  readonly data = this._data;
  readonly udiseReady = computed(() => !!this._udise());

  async load(): Promise<void> {
    if (this._loaded()) return;
    const [d, s] = await Promise.all([
      loadAsset<InfraData>('assets/infra.json'),
      loadAsset<InfraSchoolsData>('assets/infra-schools.json'),
    ]);
    this._emis.set(d);
    this._emisSchools.set(s);
    this._loaded.set(true);
    this.loadUdise();
  }

  private async loadUdise(): Promise<void> {
    if (this._udise()) return;
    try {
      const [d, s] = await Promise.all([
        loadAsset<InfraData>('assets/infra-udise.json'),
        loadAsset<InfraSchoolsData>('assets/infra-schools-udise.json'),
      ]);
      this._udise.set(d);
      this._udiseSchools.set(s);
    } catch {
      /* UDISE+ infra view unavailable */
    }
  }

  setSource(s: 'EMIS' | 'UDISE+'): void {
    if (s === this.source()) return;
    if (s === 'UDISE+' && !this._udise()) return;
    this.source.set(s);
  }

  readonly types = computed(() => this._data()?.types ?? []);
  readonly note = computed(() => this._data()?.note ?? '');
  readonly academicYear = computed(() => this._data()?.academicYear ?? '');
  readonly periods = computed(() => this._data()?.periods ?? []);
  /** 'year' for both EMIS and UDISE+ now — drives the selector label. */
  readonly cadence = computed(() => this._data()?.cadence ?? 'year');
  /** Both EMIS and UDISE+ report year-wise now, so the period is always a year. */
  readonly periodLabel = computed(() => 'Academic Year');

  /**
   * Resolved period. "Latest" means the most recent period the source has
   * submissions for: the newest month for EMIS, the newest academic year for
   * UDISE+. Switching source re-resolves, since the period lists differ.
   */
  readonly activePeriod = computed(() => {
    const d = this._data();
    if (!d) return '';
    const p = this.period();
    return d.periods.includes(p) ? p : d.latestPeriod;
  });

  /** The selected period's slice of the dataset. */
  private readonly periodData = computed(() => {
    const d = this._data();
    if (!d) return null;
    return d.byPeriod[this.activePeriod()] ?? d.byPeriod[d.latestPeriod] ?? null;
  });

  /** Month-by-month data entry compliance, for the compliance chart. */
  readonly entryTrend = computed(() => this._data()?.entryTrend ?? []);

  readonly typeLabel = computed(() => {
    const t = this.types().find((x) => x.id === this.type());
    return t ? t.label : 'Classrooms';
  });

  /** Node for the current drill scope, within the selected month. */
  readonly currentNode = computed<InfraNode | null>(() => {
    const md = this.periodData();
    if (!md) return null;
    const level = this.ds.level();
    if (level === 'state') return md.state;
    if (level === 'district') return md.districts[this.ds.selectedDistrict()!] ?? md.state;
    const key = `${this.ds.selectedDistrict()}||${this.ds.selectedBlock()}`;
    if (level === 'block') return md.blocks[key] ?? md.state;
    const sc = this.currentSchool();
    if (sc) {
      return {
        schools: 1, students: sc.students,
        expected: 1, entered: sc.entered, notEntered: 1 - sc.entered,
        entryPct: sc.entryPct,
        types: sc.types,
      };
    }
    return md.blocks[key] ?? md.state;
  });

  /** Data entry compliance for the current scope and month. */
  readonly entry = computed(() => {
    const n = this.currentNode();
    if (!n) return { expected: 0, entered: 0, notEntered: 0, entryPct: 0 };
    return {
      expected: n.expected, entered: n.entered,
      notEntered: n.notEntered, entryPct: n.entryPct,
    };
  });

  /** The selected type's metrics for the current scope. */
  readonly current = computed<InfraType | null>(() => {
    const n = this.currentNode();
    return n ? n.types[this.type()] ?? null : null;
  });

  readonly stateNode = computed(() => this.periodData()?.state ?? null);
  readonly stateType = computed<InfraType | null>(() => {
    const s = this.stateNode();
    return s ? s.types[this.type()] ?? null : null;
  });

  readonly schoolsForBlock = computed<InfraSchool[]>(() => {
    const s = this._schools();
    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();
    if (!s || !dist || !blk) return [];
    return s[`${dist}||${blk}`] ?? [];
  });

  /** Every infrastructure school row inside the current scope. */
  readonly scopeSchools = computed(() =>
    schoolsInScope(
      this._schools(), this.ds.level(),
      this.ds.selectedDistrict(), this.ds.selectedBlock(), this.ds.selectedSchool(),
    ),
  );

  /**
   * Caution checks for Infrastructure: facilities that are missing outright.
   *
   * Only schools that actually submitted for the selected period are tested.
   * An unsubmitted school has zeros across the board, so including them would
   * report tens of thousands of schools as having no toilet when they simply
   * have not reported yet. Those are surfaced as their own check instead.
   */
  readonly cautionChecks = computed<CautionCheck[]>(() => {
    const all = this.scopeSchools();
    const submitted = all.filter((s) => s.entered === 1);
    const avail = (s: (typeof all)[number], t: string) => s.types?.[t]?.available ?? 0;
    const good = (s: (typeof all)[number], t: string) => s.types?.[t]?.good ?? 0;

    const defs: {
      id: string; label: string; icon: string; hint: string;
      severity: 'high' | 'medium';
      rows: typeof all;
      test: (s: (typeof all)[number]) => boolean;
      detail: (s: (typeof all)[number]) => string;
    }[] = [
      {
        id: 'zeroToilets', label: 'Zero Toilets', icon: 'fa-solid fa-restroom',
        hint: 'No toilet of any kind reported at the school',
        severity: 'high', rows: submitted,
        test: (s) => avail(s, 'toilets') === 0,
        detail: (s) => `${inr(s.students)} students, no toilet`,
      },
      {
        id: 'zeroWater', label: 'No Drinking Water', icon: 'fa-solid fa-droplet-slash',
        hint: 'No drinking water source of any kind reported',
        severity: 'high', rows: submitted,
        test: (s) => avail(s, 'water') === 0,
        detail: (s) => `${inr(s.students)} students, no water source`,
      },
      {
        id: 'zeroClassrooms', label: 'Zero Classrooms', icon: 'fa-solid fa-door-closed',
        hint: 'No classroom of its own — likely temporary or shared premises',
        severity: 'high', rows: submitted,
        test: (s) => avail(s, 'classrooms') === 0,
        detail: (s) => `${inr(s.students)} students, no classroom`,
      },
      {
        id: 'waterNotWorking', label: 'Water Source Not Functional', icon: 'fa-solid fa-faucet-drip',
        hint: 'A source exists but none of it is working',
        severity: 'high', rows: submitted,
        test: (s) => avail(s, 'water') > 0 && good(s, 'water') === 0,
        detail: (s) => `${inr(avail(s, 'water'))} units, none functional`,
      },
      {
        id: 'zeroUrinals', label: 'Zero Urinals', icon: 'fa-solid fa-toilet',
        hint: 'No urinal reported at the school',
        severity: 'medium', rows: submitted,
        test: (s) => avail(s, 'urinals') === 0,
        detail: (s) => `${inr(s.students)} students, no urinal`,
      },
      {
        id: 'zeroFurniture', label: 'Zero Furniture', icon: 'fa-solid fa-chair',
        hint: 'No benches or desks reported',
        severity: 'medium', rows: submitted,
        test: (s) => avail(s, 'furniture') === 0,
        detail: (s) => `${inr(s.students)} students, no furniture`,
      },
      {
        id: 'notEntered', label: 'Data Not Submitted', icon: 'fa-solid fa-file-circle-xmark',
        hint: `No infrastructure return filed for ${this.activePeriod()} — figures above exclude these schools`,
        severity: 'medium', rows: all,
        test: (s) => s.entered !== 1,
        detail: (s) => `submitted ${s.periodsEntered ?? 0} of ${this.periods().length} periods`,
      },
    ];

    return defs.map((d) => {
      const hits = d.rows.filter(d.test);
      return {
        id: d.id, label: d.label, icon: d.icon, hint: d.hint, severity: d.severity,
        count: hits.length,
        schools: hits
          .map((s) => ({
            district: this.ds.titleCase(s.__district),
            block: this.ds.titleCase(s.__block),
            school: s.name, udise: s.udise, mgmt: s.mgmt, stype: s.cat ?? '',
            students: s.students, detail: d.detail(s),
          }))
          .sort((a, b) => b.students - a.students || a.school.localeCompare(b.school)),
      };
    });
  });

  /** Distinct schools flagged by at least one infrastructure caution check. */
  readonly cautionTotal = computed(() => {
    const seen = new Set<string>();
    for (const c of this.cautionChecks()) {
      for (const s of c.schools) seen.add(s.udise || `${s.district}|${s.block}|${s.school}`);
    }
    return seen.size;
  });

  readonly currentSchool = computed<InfraSchool | null>(() => {
    if (this.ds.level() !== 'school') return null;
    return this.schoolsForBlock().find((x) => x.name === this.ds.selectedSchool()) ?? null;
  });
  readonly schoolHasData = computed(() => this.ds.level() !== 'school' || !!this.currentSchool());

  /** All types for the current scope, for the overview table. */
  readonly allTypes = computed(() => {
    const n = this.currentNode();
    if (!n) return [];
    return this.types().map((t) => ({
      id: t.id, label: t.label, icon: t.icon,
      ...(n.types[t.id] ?? {} as InfraType),
    }));
  });

  readonly childLabel = computed(() => {
    switch (this.ds.level()) {
      case 'state': return 'Districts';
      case 'district': return 'Blocks';
      case 'block': return 'Schools';
      default: return 'This School';
    }
  });

  /** Children of the current scope with the selected type's metrics. */
  readonly comparisonRows = computed(() => {
    const md = this.periodData();
    if (!md) return [];
    const tid = this.type();
    const level = this.ds.level();
    const row = (key: string, name: string, node: InfraNode) => ({
      key, name,
      ...(node.types[tid] ?? ({} as InfraType)),
      // data entry compliance travels with every row
      expectedSchools: node.expected,
      enteredSchools: node.entered,
      notEnteredSchools: node.notEntered,
      entryPct: node.entryPct,
    });

    if (level === 'state') {
      return Object.keys(md.districts).map((k) =>
        row(k, this.ds.titleCase(k), md.districts[k]));
    }
    if (level === 'district') {
      const prefix = this.ds.selectedDistrict() + '||';
      return Object.keys(md.blocks)
        .filter((k) => k.startsWith(prefix))
        .map((k) => row(k.slice(prefix.length), this.ds.titleCase(k.slice(prefix.length)), md.blocks[k]));
    }
    if (level === 'block') {
      return this.schoolsForBlock().map((s) => ({
        key: s.name, name: s.name,
        ...(s.types[tid] ?? {} as InfraType),
        expectedSchools: 1,
        enteredSchools: s.entered,
        notEnteredSchools: 1 - s.entered,
        entryPct: s.entryPct,
        periodsEntered: s.periodsEntered,
      }));
    }
    return [];
  });

  readonly metricLabel = computed(() => {
    switch (this.metric()) {
      case 'entryPct': return 'Data Entry Compliance';
      case 'coveragePct': return 'School Coverage';
      case 'goodPct': return 'Good Condition';
      case 'functionalPct': return 'Functional';
      case 'gapPct': return 'Shortfall Gap';
      default: return 'Availability vs Norms';
    }
  });
  readonly metricLowerIsBetter = computed(() => this.metric() === 'gapPct');

  /**
   * Infrastructure alerts with explicit thresholds, evaluated per type:
   *   availability < 85% of norms, good condition < 70%,
   *   school coverage < 75%. Data entry compliance < 70% is flagged once
   *   per district, since it undermines every other figure.
   */
  readonly alerts = computed(() => {
    const md = this.periodData();
    if (!md) return [];
    const out: {
      district: string; kind: string; type: string; severity: 'high' | 'medium';
      detail: string; value: number;
    }[] = [];

    for (const k of Object.keys(md.districts)) {
      const node = md.districts[k];

      // entry compliance first: low submission makes the rest unreliable
      if (node.entryPct < 70) {
        out.push({
          district: k, kind: 'Low Data Entry Compliance', type: 'entry',
          severity: node.entryPct < 55 ? 'high' : 'medium',
          detail: `only ${node.entryPct}% submitted (${node.notEntered.toLocaleString('en-IN')} schools pending)`,
          value: node.entryPct,
        });
      }

      for (const meta of this.types()) {
        const t = node.types[meta.id];
        if (!t) continue;
        if (t.norms > 0 && t.availabilityPct < 85) {
          out.push({
            district: k, kind: `${meta.label}: Below Norms`, type: meta.id,
            severity: t.availabilityPct < 70 ? 'high' : 'medium',
            detail: `${t.availabilityPct}% of norms; shortfall ${t.required.toLocaleString('en-IN')}`,
            value: t.availabilityPct,
          });
        }
        if (t.good + t.needRepair + t.demolish > 0 && t.goodPct < 70) {
          out.push({
            district: k, kind: `${meta.label}: Poor Condition`, type: meta.id,
            severity: t.goodPct < 55 ? 'high' : 'medium',
            detail: `${t.goodPct}% good; ${t.needRepair.toLocaleString('en-IN')} need repair`,
            value: t.goodPct,
          });
        }
        if (t.coveragePct < 75) {
          out.push({
            district: k, kind: `${meta.label}: Low Coverage`, type: meta.id,
            severity: t.coveragePct < 60 ? 'high' : 'medium',
            detail: `only ${t.coveragePct}% of schools have this`,
            value: t.coveragePct,
          });
        }
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

  /** Ranked gap list for the alarming view. */
  readonly gapRanking = computed(() => {
    const md = this.periodData();
    if (!md) return [];
    const tid = this.type();
    return Object.keys(md.districts)
      .map((k) => {
        const t = md.districts[k].types[tid];
        return {
          key: k, name: this.ds.titleCase(k),
          required: t?.required ?? 0,
          available: t?.available ?? 0,
          norms: t?.norms ?? 0,
          gapPct: t?.gapPct ?? 0,
        };
      })
      .sort((a, b) => b.gapPct - a.gapPct);
  });

  /** Districts ranked by data entry compliance (worst first). */
  readonly entryRanking = computed(() => {
    const md = this.periodData();
    if (!md) return [];
    return Object.keys(md.districts)
      .map((k) => {
        const n = md.districts[k];
        return {
          key: k, name: this.ds.titleCase(k),
          expected: n.expected, entered: n.entered,
          notEntered: n.notEntered, entryPct: n.entryPct,
        };
      })
      .sort((a, b) => a.entryPct - b.entryPct);
  });
}
