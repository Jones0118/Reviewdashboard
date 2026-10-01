import { Injectable, computed, inject, signal } from '@angular/core';
import { loadAsset } from '../utils/asset-loader';
import {
  Class1MonitorData,
  Class1MonitorKpis,
  Class1MonitorRow,
} from '../models/class1-monitor.model';
import { DataService } from './data.service';

/**
 * Loads the "Births to School: Class 1 Entry Monitor" dataset and resolves it
 * to the current drill scope (State → District → Block → School), reusing the
 * shared drill selections on DataService.
 *
 * Only the state series ships as full rows; every sub-scope is reconstructed
 * from the state series scaled by that scope's share of current Class 1, with
 * the current year overridden by the scope's real Class 1 count.
 */
@Injectable({ providedIn: 'root' })
export class Class1MonitorService {
  private readonly ds = inject(DataService);

  private readonly _data = signal<Class1MonitorData | null>(null);
  private readonly _loaded = signal(false);
  readonly data = this._data.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  async load(): Promise<void> {
    if (this._loaded()) return;
    try {
      const d = await loadAsset<Class1MonitorData>('assets/class1-monitor.json');
      this._data.set(d);
    } catch {
      /* monitor asset unavailable */
    }
    this._loaded.set(true);
  }

  readonly note = computed(() => this._data()?.note ?? '');
  readonly title = computed(() => this._data()?.title ?? 'Class 1 Enrolment Monitor');
  readonly currentYear = computed(() => this._data()?.currentYear ?? '');
  readonly projectionYear = computed(() => this._data()?.projectionYear ?? '');
  readonly baseYear = computed(() => this._data()?.baseYear ?? '');

  /** Human label for the scope currently in view. */
  readonly scopeLabel = computed(() => {
    const level = this.ds.level();
    if (level === 'school') return this.ds.selectedSchool() ?? 'School';
    if (level === 'block') return this.ds.titleCase(this.ds.selectedBlock() ?? '');
    if (level === 'district') return this.ds.titleCase(this.ds.selectedDistrict() ?? '');
    return 'Tamil Nadu';
  });

  /**
   * Rebuild a sub-scope's 15-year rows from the state series, a share and the
   * scope's real current Class 1 count.
   */
  private scopeRows(share: number, currentClass1: number): Class1MonitorRow[] {
    const d = this._data();
    if (!d) return [];
    const cur = d.currentYear;
    return d.rows.map((r) => {
      const expected = Math.round((d.stateExpected[r.year] ?? r.expected) * share);
      const births = Math.round(expected * d.entryFactorInv);
      let actual: number | null = null;
      if (r.year === cur) {
        actual = currentClass1;
      } else if (d.stateActual[r.year] != null) {
        actual = Math.round(d.stateActual[r.year] * share);
      }
      return {
        year: r.year, birthYear: r.birthYear,
        births, expected, actual, projected: r.projected,
      };
    });
  }

  /** Rows for the scope currently in view. */
  readonly rows = computed<Class1MonitorRow[]>(() => {
    const d = this._data();
    if (!d) return [];
    const level = this.ds.level();
    if (level === 'state') return d.rows;

    const dist = this.ds.selectedDistrict();
    const blk = this.ds.selectedBlock();

    if (level === 'district' && dist) {
      const s = d.byScope.districts[dist];
      return s ? this.scopeRows(s.share, s.currentClass1) : [];
    }
    if (level === 'block' && dist && blk) {
      const s = d.byScope.blocks[`${dist}||${blk}`];
      return s ? this.scopeRows(s.share, s.currentClass1) : [];
    }
    if (level === 'school' && dist && blk) {
      const list = d.byScope.schools[`${dist}||${blk}`] ?? [];
      const sc = list.find((x) => x.name === this.ds.selectedSchool());
      return sc ? this.scopeRows(sc.share, sc.currentClass1) : [];
    }
    return d.rows;
  });

  /** KPIs for the scope currently in view. */
  readonly kpis = computed<Class1MonitorKpis | null>(() => {
    const d = this._data();
    if (!d) return null;
    if (this.ds.level() === 'state') return d.kpis;

    const rows = this.rows();
    if (!rows.length) return null;
    const byStart = new Map(rows.map((r) => [Number(r.year.slice(0, 4)), r.expected]));
    const curStart = Number(d.currentYear.slice(0, 4));
    const projStart = Number(d.projectionYear.slice(0, 4));
    const baseStart = Number(d.baseYear.slice(0, 4));
    const cur = byStart.get(curStart) ?? 0;
    const proj = byStart.get(projStart) ?? 0;
    const base = byStart.get(baseStart) ?? 0;
    return {
      currentExpected: cur,
      projectionExpected: proj,
      baseExpected: base,
      pctChange: base ? Math.round(((proj - base) / base) * 1000) / 10 : 0,
    };
  });
}
