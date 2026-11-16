import { ChangeDetectionStrategy, Component, ElementRef, OnInit, afterNextRender, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { CountUpDirective } from './count-up.directive';

import { AuthService } from '../services/auth.service';
import { DataService } from '../services/data.service';
import { AttendanceService } from '../services/attendance.service';
import { AcademicService } from '../services/academic.service';
import { InfraService } from '../services/infra.service';
import { ReviewService } from '../services/review.service';
import { KpiValuesService } from '../services/kpi-values.service';
import { KPI_MODULES } from '../models/kpi-catalog.model';
import { AcisStudentCol, PalliObsCol } from '../models/real-data.model';
import { inr, inrAxis, inrShort } from '../utils/format';

/**
 * "At a glance" — standalone executive page at /glance, modelled on
 * review/SED-Review-Dashboard.html (side panel + headline panel + insight cards
 * + trends + attention + completion). Opened from the top menu in a new browser
 * tab, like SMC. Same data as the Review Dashboard tiles (KpiValuesService +
 * KPI catalog); the side panel lists the Review components, each opening its
 * own page, and every figure deep-links back into the District Review drill.
 * No figure here is invented: where the template had a metric with no source
 * in this app (urban/rural, monthly history, entitlements) the block is
 * replaced by a real one.
 */
@Component({
  selector: 'app-glance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, NgxEchartsDirective, SelectModule, MultiSelectModule, CountUpDirective],
  templateUrl: './glance.html',
  styleUrl: './glance.scss',
})
export class GlancePage implements OnInit {
  readonly ds = inject(DataService);
  readonly at = inject(AttendanceService);
  readonly rv = inject(ReviewService);
  readonly auth = inject(AuthService);
  private readonly ac = inject(AcademicService);
  private readonly inf = inject(InfraService);
  private readonly kv = inject(KpiValuesService);
  private readonly router = inject(Router);

  // ---- sign in (same AuthService / session as the dashboard) ----
  loginUser = signal('');
  loginPass = signal('');
  showPass = signal(false);
  async submitLogin(): Promise<void> {
    if (await this.auth.signIn(this.loginUser(), this.loginPass())) this.loginPass.set('');
  }

  async ngOnInit(): Promise<void> {
    // Same datasets the dashboard loads; every load() is idempotent, so landing
    // here directly or after the main page costs nothing extra.
    await this.ds.load();
    this.at.load().catch(() => { /* optional dataset */ });
    this.ac.load().catch(() => { /* optional dataset */ });
    this.inf.load().catch(() => { /* optional dataset */ });
    this.rv.load().catch(() => { /* optional dataset */ });
    // observation line list for the Palli Paarvai trend chart (lazy asset)
    this.rv.loadPalliObs();
    // common-pool student list for the ACiS school-category chart (lazy asset)
    this.rv.loadAcisStudents();
  }

  readonly ready = computed(() => this.ds.loaded() && this.rv.loaded());

  // ---- sticky top (header + viewing/filter bar): expose its height so the
  // side nav can stick just below it whatever the bar wraps to ----
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  constructor() {
    afterRenderEffect(() => {
      // re-measure after any render that can change the bar's height
      this.auth.isAuthenticated(); this.ready(); this.ds.level(); this.filterActive();
      this.measureTop();
    });
    afterNextRender(() => {
      new ResizeObserver(() => this.measureTop()).observe(this.el.nativeElement);
    });
  }
  private measureTop(): void {
    const top = this.el.nativeElement.querySelector<HTMLElement>('.gl-top');
    this.el.nativeElement.style.setProperty('--gl-top-h', `${top?.offsetHeight ?? 0}px`);
  }

  // ---- filters (V3 chip filters), applied through the shared DataService ----
  /** Management chips → school-type filter values on the roll. */
  readonly MGMT_CHIPS: { label: string; stype: string[] }[] = [
    { label: 'All', stype: [] },
    { label: 'Govt', stype: ['Government'] },
    { label: 'Aided', stype: ['Fully Aided', 'Partially Aided'] },
    { label: 'Private', stype: ['Un-aided'] },
    { label: 'Central', stype: ['Central Govt'] },
  ];
  /** School-type chips → the roll's category names matching each stage. */
  readonly TYPE_CHIPS: { label: string; re: RegExp | null }[] = [
    { label: 'All', re: null },
    { label: 'Primary', re: /primary|nursery|play/i },
    { label: 'Middle', re: /middle/i },
    { label: 'High', re: /^high/i },
    { label: 'Hr Sec', re: /hr\.?\s?sec/i },
  ];
  /** Selected Management / Category labels (empty = all). Multi-select; selections are OR-ed. */
  readonly mgmtSel = signal<string[]>([]);
  readonly typeSel = signal<string[]>([]);
  /** Multi-select options for the Management and Category filters ("All" = nothing selected). */
  readonly mgmtOptions = this.MGMT_CHIPS.filter((c) => c.label !== 'All').map((c) => ({ label: c.label, value: c.label }));
  readonly typeOptions = this.TYPE_CHIPS.filter((c) => c.label !== 'All').map((c) => ({ label: c.label, value: c.label }));
  setMgmt(labels: string[] | null): void {
    const sel = labels ?? [];
    this.mgmtSel.set(sel);
    const stype = this.MGMT_CHIPS.filter((c) => sel.includes(c.label)).flatMap((c) => c.stype);
    this.ds.filters.update((f) => ({ ...f, stype }));
  }
  setType(labels: string[] | null): void {
    const sel = labels ?? [];
    this.typeSel.set(sel);
    const res = this.TYPE_CHIPS.filter((c) => sel.includes(c.label) && c.re).map((c) => c.re!);
    const cat = res.length ? this.ds.catOptions().map((o) => o.value).filter((v) => res.some((re) => re.test(v))) : [];
    this.ds.filters.update((f) => ({ ...f, cat }));
  }
  resetChips(): void {
    this.mgmtSel.set([]); this.typeSel.set([]);
    this.ds.filters.update((f) => ({ ...f, stype: [], cat: [] }));
  }
  readonly filterActive = computed(() => this.mgmtSel().length > 0 || this.typeSel().length > 0);
  readonly filterSummary = computed(() => {
    const m = this.mgmtSel(), c = this.typeSel();
    if (!m.length && !c.length) return 'All schools';
    const parts = [m.length ? m.join(' / ') : null, c.length ? c.join(' / ') : null].filter(Boolean);
    return parts.join(' \u00B7 ') + ' schools';
  });

  // ---- scope (State -> District -> Block), shared DataService state ----
  readonly districtOptions = computed(() =>
    this.ds.districts().map((d) => ({ label: this.ds.titleCase(d.name), value: d.name })),
  );
  readonly blockOptions = computed(() =>
    this.ds.blocksForDistrict().map((b) => ({ label: this.ds.titleCase(b.block), value: b.block })),
  );
  onDistrictChange(name: string | null): void { if (name) this.ds.drillToDistrict(name); else this.ds.goToState(); }
  onBlockChange(block: string | null): void { if (block) this.ds.drillToBlock(block); else this.ds.goToDistrict(); }
  print(): void { window.print(); }

  /** Which page the glance view shows: 'overview' or a component title. */
  glanceView = signal<string>('overview');
  setGlanceView(v: string): void {
    this.glanceView.set(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Sidebar icon + one-line description per Review component. */
  private readonly GLANCE_META: Record<string, { icon: string; sub: string; short?: string }> = {
    'Enrollment': { icon: 'fa-solid fa-user-graduate', sub: 'Zero/single teacher, PTR, declines' },
    'Attendance': { icon: 'fa-solid fa-clipboard-check', sub: 'Students, teachers, marking' },
    'Infrastructure': { icon: 'fa-solid fa-building-columns', sub: 'Toilets, water, buildings' },
    'Academic Performance': { icon: 'fa-solid fa-graduation-cap', sub: 'Pass %, marks, coverage' },
    'THIRAN': { icon: 'fa-solid fa-book-open-reader', sub: 'Identification, BLO attainment' },
    'Scholarship': { icon: 'fa-solid fa-award', sub: 'Eligibility, payments (demo)' },
    'Digital Infrastructure (Middle/High/Hr.Sec)': { icon: 'fa-solid fa-desktop', sub: 'ICT labs, internet', short: 'Digital Infrastructure' },
    'SMC': { icon: 'fa-solid fa-people-group', sub: 'Meetings, resolutions, grants' },
    'Palli Paarvai': { icon: 'fa-solid fa-eye', sub: 'School visit observations' },
    'Recognition Order - DPS': { icon: 'fa-solid fa-file-circle-check', sub: 'Pending RC applications', short: 'Recognition Order' },
    'All Children in School': { icon: 'fa-solid fa-children', sub: 'Common pool, survey, admission' },
    'Potential Dropout': { icon: 'fa-solid fa-user-clock', sub: '15+ days absent' },
  };

  /**
   * Every tiled KPI at the current scope, unfiltered (the glance view ignores
   * the district-page KPI multi-select so its headline cards never go missing).
   */
  private readonly glanceKpiRows = computed(() => {
    const vals = this.kv.scopeValues();
    return KPI_MODULES.flatMap((mod) =>
      mod.kpis
        .filter((def) => def.tile !== false)
        .map((def) => {
          const raw = def.field && def.field !== 'DERIVED' ? (vals[def.field] ?? null) : null;
          return {
            id: def.id, label: def.label, topic: def.topic, module: mod.title, color: mod.color,
            fmt: def.fmt, dir: def.dir, raw,
            value: this.kv.format(def, raw), band: this.kv.band(def, raw), hasData: raw != null,
          };
        }),
    );
  });
  private glanceKpi(module: string, id: string) {
    return this.glanceKpiRows().find((r) => r.module === module && r.id === id) ?? null;
  }
  private glancePill(band: string): { cls: string; text: string } | null {
    return band === 'good' ? { cls: 'ok', text: 'On track' }
      : band === 'warn' ? { cls: 'wa', text: 'Watch' }
      : band === 'bad' ? { cls: 'cr', text: 'Off track' }
      : null;
  }
  private glanceColor(band: string): string {
    // V3 status colours (ST.c): on track / watch / off track; neutral = primary blue
    return band === 'good' ? '#10B981' : band === 'warn' ? '#F59E0B' : band === 'bad' ? '#E11D48' : '#2F62C4';
  }
  /** Inline-SVG sparkline geometry (120x40 viewBox, as in the V3 reference), null when too short. */
  private glanceSpark(series: number[], color: string) {
    const s = series.filter((v) => v != null && isFinite(v));
    if (s.length < 2) return null;
    const w = 120, h = 40;
    const mn = Math.min(...s), mx = Math.max(...s);
    const pad = (mx - mn) * 0.35 || Math.abs(mx * 0.05) || 1;
    const lo = mn - pad, hi = mx + pad;
    const x = (i: number) => 4 + i * ((w - 8) / (s.length - 1));
    const y = (v: number) => h - 5 - ((v - lo) / (hi - lo)) * (h - 10);
    return {
      points: s.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      cx: x(s.length - 1).toFixed(1), cy: y(s[s.length - 1]).toFixed(1), color,
    };
  }

  /**
   * Vertical menu → submenu, from review/"Vertical Menu - Sheet1.csv". Each
   * submenu item points at the Review component (KPI module title) that holds
   * its data; `module: null` items have no source in this dashboard yet and
   * open a "not built" page. One module may back several items (Academic
   * Performance backs both exam items, Palli Paarvai backs both observation
   * items). Group 4 has no heading in the sheet — named here, flagged as such.
   */
  private readonly GLANCE_GROUPS: { id: string; group: string; icon: string; items: { id: string; label: string; module: string | null; icon: string }[] }[] = [
    { id: 'g1', group: '1. Access and Equity', icon: 'fa-solid fa-scale-balanced', items: [
      { id: 'scholar', label: 'Scholarships and Entitlements', module: 'Scholarship', icon: 'fa-solid fa-award' },
      { id: 'cwsn', label: 'Support to CWSN', module: null, icon: 'fa-solid fa-wheelchair' },
      { id: 'acis', label: 'All Children in Schools (ACiS)', module: 'All Children in School', icon: 'fa-solid fa-children' },
      { id: 'scheme', label: 'Scheme & Service Delivery', module: null, icon: 'fa-solid fa-gift' },
    ] },
    { id: 'g2', group: '2. Safe and Secure Schools', icon: 'fa-solid fa-shield-halved', items: [
      { id: 'infra', label: 'Physical Infra', module: 'Infrastructure', icon: 'fa-solid fa-building-columns' },
      { id: 'grievance', label: 'Grievance Redressal & Public Interface', module: null, icon: 'fa-solid fa-headset' },
    ] },
    { id: 'g3', group: '3. Learning Outcomes First', icon: 'fa-solid fa-book-open', items: [
      { id: 'glp-primary', label: 'Grade-level Proficiency for Primary Grades', module: null, icon: 'fa-solid fa-child-reaching' },
      { id: 'glp-middle', label: 'Grade-level Proficiency for Middle Grades', module: null, icon: 'fa-solid fa-person-chalkboard' },
      { id: 'board', label: '10th & 12th Board Exam Performance', module: 'Academic Performance', icon: 'fa-solid fa-graduation-cap' },
      { id: 'blp-middle', label: 'Basic-level Proficiency in Middle Grades', module: 'THIRAN', icon: 'fa-solid fa-book-open-reader' },
      { id: 'qh-exam', label: '10th & 12th Quarterly / Half-yearly Exam Performance', module: 'Academic Performance', icon: 'fa-solid fa-pen-ruler' },
    ] },
    { id: 'g4', group: '4. Teaching, Governance & Monitoring', icon: 'fa-solid fa-chalkboard-user', items: [
      { id: 'classroom', label: 'Classroom Teaching & Engagement', module: 'Palli Paarvai', icon: 'fa-solid fa-eye' },
      { id: 'learn-monitor', label: 'Learning Monitoring & Support', module: null, icon: 'fa-solid fa-magnifying-glass-chart' },
      { id: 'teacher-cap', label: 'Teacher Capacity & Development', module: null, icon: 'fa-solid fa-user-tie' },
      { id: 'digital', label: 'Labs & Digital Infra', module: 'Digital Infrastructure (Middle/High/Hr.Sec)', icon: 'fa-solid fa-desktop' },
      { id: 'governance', label: 'School Governance', module: null, icon: 'fa-solid fa-landmark' },
      { id: 'vetri', label: 'Vetri Palligal', module: null, icon: 'fa-solid fa-trophy' },
      { id: 'field', label: 'District Governance - Field Inspections & Monitoring', module: 'Palli Paarvai', icon: 'fa-solid fa-clipboard-check' },
    ] },
    { id: 'g5', group: '5. Social and Emotional Wellbeing', icon: 'fa-solid fa-heart', items: [
      { id: 'cocurricular', label: 'Co-curricular', module: null, icon: 'fa-solid fa-palette' },
      { id: 'libraries', label: 'Public Libraries', module: null, icon: 'fa-solid fa-book' },
      { id: 'health', label: 'Student Health & Wellbeing', module: null, icon: 'fa-solid fa-heart-pulse' },
      { id: 'career', label: 'Career Guidance', module: null, icon: 'fa-solid fa-compass' },
      { id: 'thunai', label: 'Thunai', module: null, icon: 'fa-solid fa-hands-holding-child' },
      { id: 'values', label: 'Value Education', module: null, icon: 'fa-solid fa-seedling' },
    ] },
    { id: 'g6', group: '6. Alumni and Community Mentorship', icon: 'fa-solid fa-people-arrows', items: [
      { id: 'smc', label: 'School Management Committee (SMC)', module: 'SMC', icon: 'fa-solid fa-people-group' },
      { id: 'alumni', label: 'Vizhuthugal (Alumni)', module: null, icon: 'fa-solid fa-user-graduate' },
      { id: 'nsnop', label: 'Namma School Namma Ooru Palli (NSNOP)', module: null, icon: 'fa-solid fa-house-flag' },
    ] },
  ];

  /** Expanded menu groups (submenus). The group holding the open item is kept open. */
  readonly openGroups = signal<Set<string>>(new Set());
  toggleGroup(id: string): void {
    // in the icon rail a group has no visible submenu, so opening one expands the nav
    if (this.navCollapsed()) { this.navCollapsed.set(false); this.openGroups.update((s) => new Set([...s, id])); return; }
    this.openGroups.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  isGroupOpen(id: string): boolean {
    return this.openGroups().has(id) || this.GLANCE_GROUPS.some((g) => g.id === id && g.items.some((i) => i.id === this.glanceView()));
  }

  /** Sidebar: menu groups → submenu items, each with its component's off-track count. */
  readonly glanceMenu = computed(() => {
    const rows = this.glanceKpiRows();
    return this.GLANCE_GROUPS.map((g) => {
      const items = g.items.map((it) => {
        const mod = it.module ? KPI_MODULES.find((m) => m.title === it.module) ?? null : null;
        const meta = it.module ? this.GLANCE_META[it.module] : undefined;
        return {
          id: it.id, label: it.label, icon: it.icon,
          module: it.module, short: meta?.short ?? it.module ?? '',
          sub: mod ? `${meta?.short ?? it.module} component` : 'Not built yet',
          built: !!mod,
          color: mod?.color ?? '#8a96ae',
          topic: mod?.kpis[0]?.topic ?? '',
          bad: mod ? rows.filter((r) => r.module === mod.title && r.band === 'bad').length : 0,
        };
      });
      return { id: g.id, group: g.group, icon: g.icon, items, bad: items.reduce((s, i) => s + i.bad, 0) };
    });
  });
  private readonly glanceItems = computed(() => this.glanceMenu().flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))));

  readonly glanceCrumb = computed(() => {
    const parts = ['Tamil Nadu'];
    if (this.ds.selectedDistrict()) parts.push(this.ds.titleCase(this.ds.selectedDistrict()!));
    if (this.ds.selectedBlock()) parts.push(this.ds.titleCase(this.ds.selectedBlock()!));
    if (this.ds.selectedSchool()) parts.push(this.ds.selectedSchool()!);
    return parts.join(' › ') + ' › ' + this.rv.currentYear();
  });
  readonly glanceAsOf = computed(() => `Attendance to ${this.at.asOf() || '—'} · enrolment roll ${this.rv.currentYear()}`);

  /** School counts by broad type for the current scope (roll is students-only in the node). */
  private readonly glanceSchoolTypeCounts = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.ds.rawSchoolRows()) m.set(r.stype, (m.get(r.stype) ?? 0) + 1);
    return m;
  });

  /** The three headline cards: schools, students, teachers, each with a split bar. */
  readonly glanceStats = computed(() => {
    const n = this.ds.current();
    if (!n) return [];
    const typeN = this.glanceSchoolTypeCounts();
    const cnt = (...names: string[]) => names.reduce((s, k) => s + (typeN.get(k) ?? 0), 0);
    const govtSch = cnt('Government'), aidedSch = cnt('Fully Aided', 'Partially Aided'), privSch = cnt('Un-aided');
    const ptr = n.teaching ? Math.round((n.students / n.teaching) * 10) / 10 : 0;
    // white tints read as one scale on the blue panel and stay legible (reviewer: old greens/ambers were ~2.6:1)
    const COLORS = ['#FFFFFF', 'rgba(255,255,255,.62)', 'rgba(255,255,255,.34)'];
    const split = (...parts: [string, number][]) => {
      const tot = parts.reduce((s, [, v]) => s + v, 0) || 1;
      return {
        segs: parts.map(([k, v], i) => ({
          k, n: v, v: inrShort(v), color: COLORS[i % COLORS.length],
          pct: Math.round((v / tot) * 1000) / 10,
        })),
      };
    };
    const hasTypes = typeN.size > 0;
    return [
      {
        label: 'No. of schools', icon: 'fa-solid fa-school', big: inr(n.schools),
        sub: 'All managements',
        splits: hasTypes ? [split(['Govt', govtSch], ['Aided', aidedSch], ['Private', privSch])] : [],
      },
      {
        label: 'No. of students', icon: 'fa-solid fa-user-graduate', big: inrShort(n.students),
        sub: `${inr(n.students)} · Pre-KG to XII · all managements`,
        splits: [split(['Boys', n.boys], ['Girls', n.girls])],
      },
      {
        label: 'No. of teachers', icon: 'fa-solid fa-chalkboard-user', big: inrShort(n.teaching),
        sub: `${inr(n.teaching)} teaching · PTR ${ptr} : 1`,
        splits: [split(['Teaching', n.teaching], ['Non-teaching', n.nonTeaching])],
      },
    ];
  });

  /** Six headline insight cards, one per key component, each linking to its drill. */
  readonly glanceInsights = computed(() => {
    const out: {
      icon: string; title: string; module: string; id: string; topic: string; value: string;
      pill: { cls: string; text: string } | null; delta: { dir: 'up' | 'down'; text: string } | null;
      spark: { points: string; cx: string; cy: string; color: string } | null; note: string;
    }[] = [];
    const r1 = (v: number) => Math.round(v * 10) / 10;

    // Attendance — real 30-day daily series behind the sparkline
    const aS = this.glanceKpi('Attendance', 'a_s');
    if (aS) {
      const days = this.glanceDays();
      const first = days[0]?.attendance, last = days[days.length - 1]?.attendance;
      const diff = days.length > 1 ? r1(last - first) : null;
      const aT = this.glanceKpi('Attendance', 'a_t'), aNm = this.glanceKpi('Attendance', 'a_nm');
      out.push({
        icon: 'fa-solid fa-clipboard-check', title: 'Student attendance', module: aS.module, id: aS.id, topic: aS.topic,
        value: aS.value, pill: this.glancePill(aS.band),
        delta: diff == null ? null : { dir: diff >= 0 ? 'up' : 'down', text: `${Math.abs(diff)} pts over ${days.length} school days` },
        spark: this.glanceSpark(days.map((d) => d.attendance), this.glanceColor(aS.band)),
        note: `Teacher attendance ${aT?.value ?? '–'} · ${aNm?.raw != null ? r1(aNm.raw) + '%' : '–'} of schools not marking attendance.`,
      });
    }

    // Enrolment — real year-wise roll
    const t = this.ds.scopeTrend();
    const n = this.ds.current();
    if (n && t.students.length) {
      const s = t.students, last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null;
      const pct = prev ? r1(((last - prev) / prev) * 100) : null;
      const diff = prev != null ? last - prev : 0;
      out.push({
        icon: 'fa-solid fa-school', title: 'Enrolment', module: 'State Summary', id: 'stu', topic: 'enr',
        value: inrShort(n.students), pill: null,
        delta: pct == null ? null : { dir: pct >= 0 ? 'up' : 'down', text: `${Math.abs(pct)}% vs ${t.years[t.years.length - 2]}` },
        spark: this.glanceSpark(s.slice(-6), '#2F62C4'),
        note: prev != null
          ? `${inrShort(Math.abs(diff))} ${diff >= 0 ? 'more' : 'fewer'} children than last year · Boys ${inrShort(n.boys)} · Girls ${inrShort(n.girls)}.`
          : `Boys ${inrShort(n.boys)} · Girls ${inrShort(n.girls)}.`,
      });
    }

    // Potential dropout — EMIS PD report
    const pd = this.glanceKpi('Potential Dropout', 'ac_pd');
    if (pd) {
      const pdp = this.glanceKpi('Potential Dropout', 'ac_pdp'), rep = this.glanceKpi('Potential Dropout', 'ac_pdr');
      out.push({
        icon: 'fa-solid fa-user-clock', title: 'Potential dropouts', module: pd.module, id: pd.id, topic: pd.topic,
        value: pd.value, pill: this.glancePill(pdp?.band ?? 'none'), delta: null, spark: null,
        note: `Absent 15+ of the last 30 days · ${pdp?.raw != null ? pdp.raw.toFixed(2) + '%' : '–'} of enrolment · ${rep?.value ?? '–'} repeaters.`,
      });
    }

    // Academic — exam pass %, with the YoY improvement as the delta
    const pass = this.glanceKpi('Academic Performance', 'a_pass');
    if (pass) {
      const yoy = this.glanceKpi('Academic Performance', 'a_yoy');
      const avg = this.glanceKpi('Academic Performance', 'a_avg'), cov = this.glanceKpi('Academic Performance', 'a_cov');
      const y = yoy?.raw;
      out.push({
        icon: 'fa-solid fa-graduation-cap', title: 'Pass percentage', module: pass.module, id: pass.id, topic: pass.topic,
        value: pass.value, pill: this.glancePill(pass.band),
        delta: y == null ? null : { dir: y >= 0 ? 'up' : 'down', text: `${Math.abs(r1(y))} pts year-on-year` },
        spark: null,
        note: `Average mark ${avg?.value ?? '–'} · assessment coverage ${cov?.value ?? '–'} · ${this.rv.examPeriod()} assessment.`,
      });
    }

    // SMC – resolutions closed (closure rate = closed / raised; the catalog's m_k, a view-details KPI)
    const vals = this.kv.scopeValues();
    const mk = KPI_MODULES.find((m) => m.title === 'SMC')?.kpis.find((k) => k.id === 'm_k');
    const closure = vals['smcClosureRate'] ?? null;
    if (mk && closure != null) {
      const emg = this.glanceKpi('SMC', 'm_ek'), oth = this.glanceKpi('SMC', 'm_ok');
      out.push({
        icon: 'fa-solid fa-people-group', title: 'SMC resolutions closed', module: 'SMC', id: 'm_k', topic: 'smc',
        value: this.kv.format(mk, closure), pill: this.glancePill(this.kv.band(mk, closure)), delta: null, spark: null,
        note: `${inr(vals['smcPending'] ?? 0)} resolutions still open of ${inr(vals['smcRaised'] ?? 0)} raised · emergency ${emg?.value ?? '–'} · other ${oth?.value ?? '–'} completed.`,
      });
    }

    // All Children in School – common pool students
    const pool = this.glanceKpi('All Children in School', 'ac_pool');
    if (pool) {
      const sp = this.glanceKpi('All Children in School', 'ac_sp'), adm = this.glanceKpi('All Children in School', 'ac_adm'), tba = this.glanceKpi('All Children in School', 'ac_tba');
      out.push({
        icon: 'fa-solid fa-map', title: 'Common pool students', module: pool.module, id: pool.id, topic: pool.topic,
        value: pool.value, pill: this.glancePill(sp?.band ?? 'none'), delta: null, spark: null,
        note: `Left one school, not yet admitted to another · ${sp?.value ?? '–'} surveyed · ${adm?.value ?? '–'} admitted · ${tba?.value ?? '–'} to be admitted.`,
      });
    }

    // Palli Paarvai – observations against the monthly class-observation target
    const pal = this.palliTargetPct();
    if (pal) {
      out.push({
        icon: 'fa-solid fa-eye', title: 'Palli Paarvai observation %', module: 'Palli Paarvai', id: 'p_co', topic: 'palli',
        value: pal.value, pill: pal.pill, delta: null, spark: null, note: pal.note,
      });
    }
    // V3 icon-tile tones, cycled per card: [tile bg, icon fg]
    const TONES: [string, string][] = [['#EAF0FB', '#2F62C4'], ['#E6F5EF', '#2F8A66'], ['#FDF0E6', '#B85A22'], ['#F2EAFC', '#7B3AC6']];
    return out.map((k, i) => ({ ...k, tileBg: TONES[i % 4][0], tileFg: TONES[i % 4][1] }));
  });

  /**
   * Shared ECharts axis/grid styling, matching the V3 reference charts:
   * 11px #64748B labels, #CBD5E1 baseline, #EEF2F8 gridlines, no ticks,
   * legend drawn in the card header (HTML) rather than by ECharts.
   */
  /** Shared ECharts animation: ease in on first paint, tween on every data change. */
  private readonly ANIM = { animation: true, animationDuration: 500, animationEasing: 'cubicOut', animationDurationUpdate: 450, animationEasingUpdate: 'cubicInOut' } as const;
  private readonly V3_AXIS = {
    axisTick: { show: false },
    axisLabel: { fontSize: 11, color: '#64748B' },
    axisLine: { lineStyle: { color: '#CBD5E1' } },
    splitLine: { lineStyle: { color: '#EEF2F8' } },
  };

  /**
   * Attendance view for the chart and the attendance insight card (local to
   * this page): last 7 / 15 school days, or a monthly trend built by summing
   * the daily present / expected counts per calendar month.
   */
  readonly ATT_WINDOWS: { label: string; key: 'w7' | 'w15' | 'month' }[] = [
    { label: 'Week', key: 'w7' }, { label: '15 days', key: 'w15' }, { label: 'Monthly', key: 'month' },
  ];
  readonly attWindow = signal<'w7' | 'w15' | 'month'>('w15');
  setAttWindow(key: 'w7' | 'w15' | 'month'): void { this.attWindow.set(key); }
  /** Daily records behind the current view (all 30 days when Monthly). */
  readonly glanceDays = computed(() => {
    const n = this.at.current();
    if (!n) return [];
    const w = this.attWindow();
    const keep = w === 'w7' ? 7 : w === 'w15' ? 15 : n.daily.length;
    return n.daily.slice(Math.max(0, n.daily.length - keep));
  });
  /** Chart points: one per day, or one per month (present ÷ expected), with the absent share. */
  readonly glanceAttPoints = computed(() => {
    const days = this.glanceDays();
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const dayLabel = (iso: string) =>
      new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    if (this.attWindow() !== 'month') {
      return days.map((d) => ({ label: dayLabel(d.date), present: d.attendance, absent: r1(100 - d.attendance), days: 1 }));
    }
    const months = new Map<string, { present: number; expected: number; days: number }>();
    for (const d of days) {
      const k = d.date.slice(0, 7);
      const m = months.get(k) ?? { present: 0, expected: 0, days: 0 };
      m.present += d.present; m.expected += d.expected; m.days += 1;
      months.set(k, m);
    }
    return [...months.entries()].map(([k, m]) => {
      const present = m.expected ? r1((m.present / m.expected) * 100) : 0;
      const label = new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      return { label, present, absent: r1(100 - present), days: m.days };
    });
  });
  readonly glanceAttDays = computed(() => this.glanceDays().length);

  /** Key trend 1: student attendance, stacked present / absent to 100%, against the 90% target — V3 bar style. */
  readonly glanceAttOpt = computed(() => {
    const pts = this.glanceAttPoints();
    const monthly = this.attWindow() === 'month';
    return {
      ...this.ANIM,
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: {
        trigger: 'axis', valueFormatter: (v: number) => `${v}%`,
        formatter: (ps: any[]) => {
          const i = ps[0]?.dataIndex ?? 0, p = pts[i];
          const span = monthly ? ` · ${p.days} school days` : '';
          return `<b>${p.label}</b>${span}<br/>Present <b>${p.present}%</b><br/>Absent <b>${p.absent}%</b>`;
        },
      },
      grid: { left: 40, right: 12, top: 22, bottom: pts.length > 8 ? 40 : 28 },
      xAxis: {
        type: 'category', data: pts.map((p) => p.label), ...this.V3_AXIS, splitLine: { show: false },
        // every label stays; dense views rotate instead of dropping alternate dates
        axisLabel: { ...this.V3_AXIS.axisLabel, interval: 0, rotate: pts.length > 8 ? 35 : 0 },
      },
      yAxis: {
        // daily views start at 60 so a 3-point move is visible; monthly keeps the full scale
        type: 'value', min: monthly ? 0 : 60, max: 100, interval: monthly ? 25 : 10, ...this.V3_AXIS, axisLine: { show: false },
        axisLabel: { ...this.V3_AXIS.axisLabel, formatter: '{value}%' },
      },
      series: [
        {
          name: 'Present', type: 'bar', stack: 'att', data: pts.map((p) => p.present),
          barCategoryGap: '36%', barMaxWidth: monthly ? 96 : 56,
          itemStyle: { color: '#2F62C4' },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { color: '#D97706', type: 'dashed', width: 2 },
            label: { show: true, position: 'insideEndTop', formatter: 'Target 90%', fontSize: 11, fontWeight: 600, color: '#B45309' },
            data: [{ yAxis: 90 }],
          },
        },
        {
          name: 'Absent', type: 'bar', stack: 'att', data: pts.map((p) => p.absent),
          barMaxWidth: monthly ? 96 : 56,
          itemStyle: { color: '#C9D8F2', borderRadius: [4, 4, 0, 0] },
          // the present % sits above the full bar, as V3 labels its bars
          label: {
            show: pts.length <= 16, position: 'top', fontSize: 11, fontWeight: 600, color: '#24498F',
            formatter: (p: any) => `${pts[p.dataIndex].present}%`,
          },
        },
      ],
    };
  });
  /**
   * Enrolment chart management filter (chart-local). "All" uses the
   * pre-aggregated trend; a management picks the schools of that type in the
   * current scope and sums their per-year `series` (boys/girls likewise).
   */
  readonly ENROL_MGMT: { label: string; stype: string[] | null }[] = [
    { label: 'All', stype: null },
    { label: 'Govt', stype: ['Government'] },
    { label: 'Aided', stype: ['Fully Aided', 'Partially Aided'] },
    { label: 'Private', stype: ['Un-aided'] },
  ];
  readonly enrolMgmt = signal('All');
  setEnrolMgmt(label: string): void { this.enrolMgmt.set(label); }
  readonly glanceEnrolTrend = computed(() => {
    const pick = this.ENROL_MGMT.find((m) => m.label === this.enrolMgmt()) ?? this.ENROL_MGMT[0];
    if (!pick.stype) return this.ds.scopeTrend();
    const years = this.ds.years();
    const n = years.length;
    const students = new Array<number>(n).fill(0), boys = new Array<number>(n).fill(0), girls = new Array<number>(n).fill(0);
    const want = new Set(pick.stype);
    for (const r of this.ds.schoolRowsInScope()) {
      if (!want.has(r.stype)) continue;
      for (let i = 0; i < n; i++) {
        students[i] += r.series?.[i] ?? 0; boys[i] += r.bseries?.[i] ?? 0; girls[i] += r.gseries?.[i] ?? 0;
      }
    }
    return { years, students, boys, girls };
  });

  /** Key trend 2: year-wise enrolment stacked boys / girls, total labelled — V3 stacked-bar style. */
  readonly glanceEnrolOpt = computed(() => {
    const t = this.glanceEnrolTrend();
    const from = Math.max(0, t.years.length - 6);
    const years = t.years.slice(from), boys = t.boys.slice(from), girls = t.girls.slice(from);
    const totals = t.students.slice(from);
    return {
      color: ['#2F62C4', '#3A9A7A'],
      ...this.ANIM,
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => inr(v) },
      grid: { left: 56, right: 12, top: 26, bottom: 28 },
      xAxis: { type: 'category', data: years, ...this.V3_AXIS, splitLine: { show: false } },
      yAxis: {
        type: 'value', ...this.V3_AXIS, axisLine: { show: false },
        axisLabel: { ...this.V3_AXIS.axisLabel, formatter: (v: number) => inrAxis(v) },
      },
      series: [
        { name: 'Boys', type: 'bar', stack: 'roll', data: boys, barMaxWidth: 56, itemStyle: { borderColor: '#fff', borderWidth: 1 } },
        {
          name: 'Girls', type: 'bar', stack: 'roll', data: girls, barMaxWidth: 56,
          itemStyle: { borderRadius: [4, 4, 0, 0], borderColor: '#fff', borderWidth: 1 },
          label: {
            show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A',
            formatter: (p: any) => inrAxis(totals[p.dataIndex]),
          },
        },
      ],
    };
  });
  readonly enrolHasData = computed(() => this.glanceEnrolTrend().students.some((v) => v > 0));
  readonly glanceEnrolTag = computed(() => {
    const s = this.glanceEnrolTrend().students;
    if (s.length < 2) return '';
    const d = s[s.length - 1] - s[s.length - 2];
    return `${d >= 0 ? '+' : '−'}${inrShort(Math.abs(d))} vs last year`;
  });
  // ---- side nav collapse (icon rail) ----
  readonly navCollapsed = signal(false);
  toggleNav(): void { this.navCollapsed.update((v) => !v); }
  fmtN(v: number): string { return inr(v); }

  /**
   * Key trend 3: Palli Paarvai observations by observing designation, from the
   * observation line list (palli-obs.json), scoped to the selected district /
   * block, with a month filter built from the months present in the data.
   */
  /**
   * Palli Paarvai observation %: observations by the five tracked designations
   * in the selected month(s) against their monthly class-observation target
   * (Designation_wise_Target_Calculation sheet, state-wide sanctioned posts).
   * The target model exists only state-wide, so the % is computed at state
   * scope; district / block scopes report the observation count instead.
   */
  readonly palliTargetPct = computed(() => {
    if (this.palliLoading() || this.rv.palliObsError()) return null;
    const rows = this.palliByDesig();
    const obs = rows.reduce((s, r) => s + r.n, 0);
    const monthsInScope = this.palliMonths().length - 1;           // minus "All months"
    const months = this.palliMonth() === 'all' ? Math.max(1, monthsInScope) : 1;
    const monthLabel = this.palliMonths().find((m) => m.key === this.palliMonth())?.label ?? 'all months';
    if (this.ds.level() !== 'state') {
      return { value: inr(obs), pill: null, note: `Observations by CEO, DEO, BEO and BRTE in ${this.ds.scopeLabel()} · ${monthLabel} · target model is state-wide, so no % at this scope.` };
    }
    const model = this.rv.palliTargetModel();
    const target = this.PALLI_DESIGS.reduce((s, d) => s + (model.find((m) => m.official === d)?.classesPerMonth ?? 0), 0) * months;
    if (!target) return null;
    const pct = Math.round((obs / target) * 1000) / 10;
    const def = KPI_MODULES.find((m) => m.title === 'Palli Paarvai')?.kpis.find((k) => k.id === 'p_co');
    return {
      value: `${pct}%`,
      pill: def ? this.glancePill(this.kv.band(def, pct)) : null,
      note: `${inr(obs)} observations against a target of ${inr(target)} · ${monthLabel} · CEO, DEO (Sec / Ele), BEO and BRTE.`,
    };
  });
  readonly PALLI_DESIGS = ['CEO', 'DEO (Secondary)', 'DEO (Elementary)', 'BEO', 'BRTE'];
  readonly palliMonth = signal<string>('all');
  setPalliMonth(m: string): void { this.palliMonth.set(m); }
  /** Observations in scope, each as { month: 'YYYY-MM', desig }. */
  private readonly palliObsInScope = computed(() => {
    const a = this.rv.palliObs();
    if (!a) return [];
    const base = new Date(a.baseDate + 'T00:00:00Z').getTime();
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    const out: { month: string; desig: string }[] = [];
    for (const o of a.observations) {
      const sch = a.schools[o[PalliObsCol.school]];
      if (dist && (sch?.d ?? '').toUpperCase() !== dist) continue;
      if (blk && (sch?.b ?? '').toUpperCase() !== blk) continue;
      const d = new Date(base + o[PalliObsCol.day] * 86400000);
      out.push({ month: d.toISOString().slice(0, 7), desig: a.desigs[o[PalliObsCol.desig]] ?? '' });
    }
    return out;
  });
  readonly palliMonths = computed(() => {
    const set = new Set(this.palliObsInScope().map((o) => o.month));
    const label = (k: string) => new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return [{ key: 'all', label: 'All months' }, ...[...set].sort().map((k) => ({ key: k, label: label(k) }))];
  });
  readonly palliByDesig = computed(() => {
    const m = this.palliMonth();
    const counts = new Map(this.PALLI_DESIGS.map((d) => [d, 0]));
    for (const o of this.palliObsInScope()) {
      if (m !== 'all' && o.month !== m) continue;
      if (counts.has(o.desig)) counts.set(o.desig, counts.get(o.desig)! + 1);
    }
    const total = [...counts.values()].reduce((s, v) => s + v, 0) || 1;
    return this.PALLI_DESIGS.map((d) => {
      const n = counts.get(d) ?? 0;
      return { desig: d, n, pct: Math.round((n / total) * 1000) / 10 };
    });
  });
  readonly palliTotal = computed(() => this.palliByDesig().reduce((s, r) => s + r.n, 0));
  readonly palliLoading = computed(() => !this.rv.palliObs() && !this.rv.palliObsError());
  readonly glancePalliOpt = computed(() => {
    const rows = this.palliByDesig();
    return {
      ...this.ANIM,
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any[]) => {
          const r = rows[ps[0]?.dataIndex ?? 0];
          return `<b>${r.desig}</b><br/>Share of observations <b>${r.pct}%</b><br/>${inr(r.n)} observations`;
        },
      },
      grid: { left: 40, right: 12, top: 26, bottom: 40 },
      xAxis: {
        type: 'category', data: rows.map((r) => r.desig.replace(' (', '\n(')), ...this.V3_AXIS, splitLine: { show: false },
        axisLabel: { ...this.V3_AXIS.axisLabel, interval: 0, lineHeight: 14 },
      },
      yAxis: {
        type: 'value', min: 0, max: 100, interval: 25, ...this.V3_AXIS, axisLine: { show: false },
        axisLabel: { ...this.V3_AXIS.axisLabel, formatter: '{value}%' },
      },
      series: [{
        name: 'Share of observations', type: 'bar', data: rows.map((r) => r.pct),
        barCategoryGap: '36%', barMaxWidth: 56,
        itemStyle: { color: '#2F62C4', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#24498F', formatter: (p: any) => `${p.value}%` },
      }],
    };
  });

  /**
   * Key trend 4: class-wise performance (Classes 6–12) — Average Mark bars with
   * the board classes (X, XII) in maroon and Pass % as a line, as on the
   * Academic Scores dashboard. Source: AcademicNode.byClass at the current scope.
   */
  readonly EXAM_TYPES = ['All', 'Quarterly', 'Half Yearly', 'Annual'];
  readonly examType = signal('All');
  setExamType(e: string): void { this.examType.set(e); }
  readonly examByClass = computed(() => {
    const n = this.ac.current();
    const board = new Set(this.ac.data()?.boardClasses ?? [10, 12]);
    const exam = this.examType();
    const rows = exam === 'All'
      ? (n?.byClass ?? []).map((c) => ({ cls: String(c.name), avg: c.avg as number | null, pass: c.pass as number | null }))
      : (n?.examClass ?? []).filter((r) => r.exam === exam).map((r) => ({ cls: String(r.cls), avg: r.avg as number | null, pass: r.pass as number | null }));
    // board classes only (X and XII); a sitting a class does not have (e.g. no
    // Quarterly for Class X) shows as a gap, never as 0
    const all = [...board].map(String).sort((a, b) => +a - +b);
    return all.map((cls) => {
      const r = rows.find((x) => x.cls === cls);
      return { cls, avg: r?.avg ?? null, pass: r?.pass ?? null, board: board.has(+cls) };
    });
  });
  /** Classes with no sitting for the selected exam (named in the caption). */
  readonly examMissing = computed(() => this.examByClass().filter((r) => r.avg == null && r.pass == null).map((r) => r.cls));
  readonly examHasData = computed(() => this.examByClass().some((r) => r.avg != null || r.pass != null));
  readonly glanceExamOpt = computed(() => {
    const rows = this.examByClass();
    return {
      ...this.ANIM,
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = rows[ps[0].dataIndex];
          let out = `<b>Class ${r.cls}</b>${r.board ? ' <i>(Board exam)</i>' : ''}`;
          if (r.avg == null && r.pass == null) return out + '<br/>No sitting for this exam';
          for (const p of ps) out += `<br/>${p.marker} ${p.seriesName}: <b>${p.value ?? '–'}</b>`;
          return out;
        },
      },
      grid: { left: 40, right: 12, top: 26, bottom: 28 },
      xAxis: { type: 'category', data: rows.map((r) => `Class ${r.cls}`), ...this.V3_AXIS, splitLine: { show: false }, axisLabel: { ...this.V3_AXIS.axisLabel, interval: 0 } },
      yAxis: { type: 'value', min: 0, max: 100, interval: 20, ...this.V3_AXIS, axisLine: { show: false } },
      series: [
        {
          name: 'Average Mark', type: 'bar', barMaxWidth: 64, barCategoryGap: '45%',
          data: rows.map((r) => ({ value: r.avg, itemStyle: { color: r.board ? '#8E1B3F' : '#2F62C4', borderRadius: [4, 4, 0, 0] } })),
        },
        {
          name: 'Pass %', type: 'line', data: rows.map((r) => r.pass),
          smooth: true, symbol: 'circle', symbolSize: 7, connectNulls: false,
          itemStyle: { color: '#2F8A66' }, lineStyle: { width: 2.5, color: '#2F8A66' },
        },
      ],
    };
  });

  /**
   * Key trend 5: All Children in School — common-pool students by the category
   * of the school they left, with a management filter. Source: the per-student
   * list (acis-students.json → school refs carry type `t` and category `c`),
   * scoped to the selected district / block.
   */
  readonly ACIS_MGMT: { label: string; types: string[] | null }[] = [
    { label: 'All', types: null },
    { label: 'Govt', types: ['Government'] },
    { label: 'Aided', types: ['Fully Aided', 'Partially Aided'] },
    { label: 'Private', types: ['Un-aided'] },
  ];
  readonly acisMgmt = signal('All');
  setAcisMgmt(label: string): void { this.acisMgmt.set(label); }
  private readonly ACIS_CATS = ['Primary School', 'Middle School', 'High School', 'Higher Secondary School'];
  readonly acisLoading = computed(() => !this.rv.acisStudents());
  readonly acisByCategory = computed(() => {
    const a = this.rv.acisStudents();
    if (!a) return [];
    const pick = this.ACIS_MGMT.find((m) => m.label === this.acisMgmt()) ?? this.ACIS_MGMT[0];
    const want = pick.types ? new Set(pick.types) : null;
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    // one pass over the school refs decides inclusion; students then just count
    const schoolOk = a.schools.map((s) =>
      (!dist || (s.d ?? '').toUpperCase() === dist) && (!blk || (s.b ?? '').toUpperCase() === blk) && (!want || want.has(s.t)));
    const counts = new Map<string, number>(this.ACIS_CATS.map((c) => [c, 0]));
    let other = 0;
    for (const r of a.students) {
      const si = r[AcisStudentCol.school] as number;
      if (!schoolOk[si]) continue;
      const c = a.schools[si]?.c ?? '';
      if (counts.has(c)) counts.set(c, counts.get(c)! + 1); else other++;
    }
    const out = this.ACIS_CATS.map((c) => ({ cat: c.replace(' School', ''), n: counts.get(c) ?? 0 }));
    if (other) out.push({ cat: 'Others', n: other });
    return out;
  });
  readonly acisTotal = computed(() => this.acisByCategory().reduce((s, r) => s + r.n, 0));
  readonly glanceAcisOpt = computed(() => {
    const rows = this.acisByCategory();
    return {
      ...this.ANIM,
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => inr(v) },
      grid: { left: 56, right: 12, top: 26, bottom: 40 },
      xAxis: { type: 'category', data: rows.map((r) => r.cat.replace('Higher Secondary', 'Higher\nSecondary')), ...this.V3_AXIS, splitLine: { show: false }, axisLabel: { ...this.V3_AXIS.axisLabel, interval: 0, lineHeight: 14 } },
      yAxis: {
        type: 'value', ...this.V3_AXIS, axisLine: { show: false },
        axisLabel: { ...this.V3_AXIS.axisLabel, formatter: (v: number) => inrAxis(v) },
      },
      series: [{
        name: 'Students in common pool', type: 'bar', data: rows.map((r) => r.n),
        barCategoryGap: '36%', barMaxWidth: 56,
        itemStyle: { color: '#2F62C4', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#24498F', formatter: (p: any) => inr(p.value) },
      }],
    };
  });
  /** Needs your attention: KPIs off track (critical) and on watch, each with its component as owner. */
  readonly attentionCounts = computed(() => {
    const rows = this.glanceKpiRows().filter((r) => r.hasData);
    return { bad: rows.filter((r) => r.band === 'bad').length, warn: rows.filter((r) => r.band === 'warn').length };
  });
  readonly glanceAttention = computed(() => {
    const rows = this.glanceKpiRows().filter((r) => r.hasData);
    const item = (r: (typeof rows)[number]) => ({
      id: r.id, topic: r.topic, module: r.module,
      title: `${r.label}: ${r.value}`,
      sub: r.fmt === 'pct' ? `Outside the expected range for ${r.module}` : `${r.module} count at this scope`,
      owner: this.GLANCE_META[r.module]?.short ?? r.module,
    });
    return {
      critical: rows.filter((r) => r.band === 'bad').slice(0, 5).map(item),
      watch: rows.filter((r) => r.band === 'warn').slice(0, 5).map(item),
    };
  });

  /** Completion strip: real programme completion percentages at this scope. */
  readonly glanceCompletion = computed(() => {
    const picks: [string, string, string][] = [
      ['All Children in School', 'ac_sp', 'ACiS survey completion'],
      ['THIRAN', 't_bl', 'THIRAN BLO attainment'],
      ['THIRAN', 't_bu', 'THIRAN baseline update'],
      ['Digital Infrastructure (Middle/High/Hr.Sec)', 'g_fp', 'ICT labs functional'],
      ['SMC', 'm_ma', 'SMC meeting attendance'],
      ['Academic Performance', 'a_cov', 'Assessment coverage'],
    ];
    return picks
      .map(([m, id, label]) => ({ k: this.glanceKpi(m, id), label }))
      .filter((x) => x.k && x.k.raw != null)
      .map((x) => ({
        id: x.k!.id, topic: x.k!.topic, module: x.k!.module, label: x.label,
        pct: Math.max(0, Math.min(100, Math.round((x.k!.raw as number) * 10) / 10)),
        color: this.glanceColor(x.k!.band),
      }));
  });

  /** The open submenu item's page: its component's tiled KPIs as cards, or a "not built" stub. */
  readonly glanceModule = computed(() => {
    const id = this.glanceView();
    if (id === 'overview') return null;
    const it = this.glanceItems().find((x) => x.id === id);
    if (!it) return null;
    return {
      ...it,
      title: it.module ?? it.label,
      kpis: it.module
        ? this.glanceKpiRows().filter((r) => r.module === it.module).map((r) => ({ ...r, pill: this.glancePill(r.band) }))
        : [],
    };
  });

  /**
   * Jump from a glance card into the Review Dashboard's per-KPI drill. The
   * dashboard (route '') reads these query params in ngOnInit and opens the
   * same District Review drill the in-app tiles do.
   */
  openGlanceKpi(k: { id: string; topic: string; module: string }): void {
    this.router.navigate(['/'], { queryParams: { topic: k.topic, kpi: k.id, module: k.module } });
  }
  openGlanceModule(m: { topic: string; title: string }): void {
    this.router.navigate(['/'], { queryParams: { topic: m.topic, module: m.title } });
  }
}
