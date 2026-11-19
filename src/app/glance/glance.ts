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
import { PalliObsCol } from '../models/real-data.model';
import { inr, inrShort } from '../utils/format';

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
    // this page reads all-class academic figures; the Class X & XII tab may have left board mode on
    this.ac.boardMode.set(false);
    this.at.load().catch(() => { /* optional dataset */ });
    this.ac.load().catch(() => { /* optional dataset */ });
    this.inf.load().catch(() => { /* optional dataset */ });
    this.rv.load().catch(() => { /* optional dataset */ });
    // observation line list for the Palli Paarvai trend chart (lazy asset)
    this.rv.loadPalliObs();
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

  // ---- "Download HTML": a self-contained snapshot of the page as rendered ----
  readonly exporting = signal(false);
  /**
   * Serialises the page as it stands (scope, filters, chart windows, open
   * submenu item) into one standalone .html: the component's own compiled
   * styles plus the global sheets are inlined, every ECharts canvas becomes a
   * PNG, fonts and icon files are embedded as data URIs so the file reads the
   * same offline. Interactive controls (dropdowns, buttons) are rendered as
   * static text — the file is a report, not a copy of the app.
   */
  async exportHtml(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const host = this.el.nativeElement;
      const clone = host.cloneNode(true) as HTMLElement;

      // charts: canvas → image, read from the live instances by position
      const live = Array.from(host.querySelectorAll<HTMLElement>('[echarts]'));
      const copies = Array.from(clone.querySelectorAll<HTMLElement>('[echarts]'));
      const echarts = await import('echarts');
      live.forEach((el, i) => {
        const inst = echarts.getInstanceByDom(el);
        const target = copies[i];
        if (!inst || !target) return;
        const img = document.createElement('img');
        img.src = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
        img.alt = 'chart';
        img.style.cssText = `display:block;width:100%;height:${el.offsetHeight}px;object-fit:contain;`;
        target.replaceWith(img);
      });

      // controls → static text
      clone.querySelectorAll('.b1r .gl-btn, .gl-collapse, .freset').forEach((n) => n.remove());
      const sel = clone.querySelector<HTMLElement>('.gl-bar2 .sel');
      if (sel) { sel.textContent = ''; const s = document.createElement('span'); s.className = 'fl'; s.textContent = this.filterSummary(); sel.appendChild(s); }
      clone.querySelectorAll('button').forEach((b) => { b.setAttribute('disabled', ''); b.style.cursor = 'default'; });
      clone.querySelectorAll('.gl-win').forEach((w) => { w.querySelectorAll('.chip:not(.on)').forEach((c) => c.remove()); });

      // styles: every <style> Angular / PrimeNG injected, plus the linked sheets (fonts, icons, global)
      const inlineCss: string[] = [];
      for (const st of Array.from(document.querySelectorAll('style'))) inlineCss.push(st.textContent ?? '');
      for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
        try { inlineCss.push(await this.inlineCssAssets(await (await fetch(link.href)).text(), link.href)); } catch { /* skip an unreachable sheet */ }
      }
      // the page animates in; a saved file should open settled
      inlineCss.push('.gl-anim,.gl-bp .sbar i,.gl-ent .bar i,.gl-spark .sl{animation:none!important}.gl-spark .sl{stroke-dashoffset:0!important}.gl-top{position:static!important}.gl-side{position:static!important;max-height:none!important}');

      const scope = this.ds.titleCase(this.ds.scopeLabel());
      const when = new Date();
      const stamp = when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      const title = `At a glance — ${scope} — ${this.rv.currentYear()}`;
      const note = `<div style="font:12px Inter,system-ui,sans-serif;color:#64748B;text-align:center;padding:10px 16px;background:#F4F6FA;border-top:1px solid #E6ECF5">`
        + `Snapshot of the School Education Dashboard "At a glance" page · ${this.escape(scope)} · ${this.escape(this.filterSummary())} · saved ${this.escape(stamp)}. `
        + `Figures are as shown on the live page at that moment; controls are static in this file.</div>`;
      const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
        + `<title>${this.escape(title)}</title><style>${inlineCss.join('\n')}</style></head>`
        + `<body style="margin:0;background:#F4F6FA">${clone.outerHTML}${note}</body></html>`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `At-a-Glance-${scope.replace(/[^\w]+/g, '-')}-${when.toISOString().slice(0, 10)}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally {
      this.exporting.set(false);
    }
  }
  /** Replace url(...) references in a stylesheet with data URIs so fonts and icons travel with the file. */
  private async inlineCssAssets(css: string, baseHref: string): Promise<string> {
    const refs = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]))]
      .filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
    const out = new Map<string, string>();
    await Promise.all(refs.map(async (u) => {
      try {
        const abs = new URL(u, baseHref).href;
        const res = await fetch(abs);
        if (!res.ok) return;
        const blob = await res.blob();
        if (blob.size > 2_000_000) return; // leave very large assets as links
        out.set(u, await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); }));
      } catch { /* leave the original reference */ }
    }));
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, u) => (out.has(u) ? `url("${out.get(u)}")` : m));
  }
  private escape(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }

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
      { id: 'attendance', label: 'Attendance', module: 'Attendance', icon: 'fa-solid fa-calendar-check' },
      { id: 'classroom', label: 'Classroom Teaching & Engagement', module: 'Palli Paarvai', icon: 'fa-solid fa-eye' },
      { id: 'learn-monitor', label: 'Learning Monitoring & Support', module: null, icon: 'fa-solid fa-magnifying-glass-chart' },
      { id: 'teacher-cap', label: 'Teacher Capacity & Development', module: null, icon: 'fa-solid fa-user-tie' },
      { id: 'digital', label: 'Labs & Digital Infra', module: 'Digital Infrastructure (Middle/High/Hr.Sec)', icon: 'fa-solid fa-desktop' },
      { id: 'governance', label: 'School Governance', module: 'Palli Paarvai', icon: 'fa-solid fa-landmark' },
      { id: 'vetri', label: 'Vetri Palligal', module: null, icon: 'fa-solid fa-trophy' },
      { id: 'field', label: 'District Governance - Field Inspections & Monitoring', module: 'Palli Paarvai', icon: 'fa-solid fa-clipboard-check' },
    ] },
    { id: 'g5', group: '4. Social and Emotional Wellbeing', icon: 'fa-solid fa-heart', items: [
      { id: 'cocurricular', label: 'Co-curricular', module: null, icon: 'fa-solid fa-palette' },
      { id: 'libraries', label: 'Public Libraries', module: null, icon: 'fa-solid fa-book' },
      { id: 'health', label: 'Student Health & Wellbeing', module: null, icon: 'fa-solid fa-heart-pulse' },
      { id: 'career', label: 'Career Guidance', module: null, icon: 'fa-solid fa-compass' },
      { id: 'thunai', label: 'Thunai', module: null, icon: 'fa-solid fa-hands-holding-child' },
      { id: 'values', label: 'Value Education', module: null, icon: 'fa-solid fa-seedling' },
    ] },
    { id: 'g6', group: '5. Alumni and Community Mentorship', icon: 'fa-solid fa-people-arrows', items: [
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
    // V3 headline-bar palette (mint / amber) plus a light sky for the third segment; all legible on the blue panel
    const COLORS = ['#6EE7B7', '#FDE68A', '#BAE6FD'];
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

  /**
   * Inspection targets achieved: Palli Paarvai observations by CEO, DEO
   * (Secondary/Elementary), BEO and BRTE against their monthly
   * class-observation target model (Designation_wise_Target_Calculation
   * sheet). The target model exists only state-wide, so this is real only at
   * state scope; returns null everywhere else rather than fabricating a
   * district/block %. Feeds the Learning Outcomes First pillar card.
   */
  private readonly inspectionTargetPct = computed(() => {
    if (this.palliLoading() || this.rv.palliObsError() || this.ds.level() !== 'state') return null;
    const rows = this.palliByDesig();
    const obs = rows.reduce((s, r) => s + r.n, 0);
    const monthsInScope = this.palliMonths().length - 1;           // minus "All months"
    const months = this.palliMonth() === 'all' ? Math.max(1, monthsInScope) : 1;
    const model = this.rv.palliTargetModel();
    const target = this.PALLI_DESIGS.reduce((s, d) => s + (model.find((m) => m.official === d)?.classesPerMonth ?? 0), 0) * months;
    if (!target) return null;
    return { obs, target, pct: Math.round((obs / target) * 1000) / 10 };
  });

  /**
   * Key insights by pillar — one card per GLANCE_GROUPS pillar (Access and
   * Equity / Safe and Secure Schools / Learning Outcomes First / Social and
   * Emotional Wellbeing / Alumni and Community Mentorship), each with up to
   * two real metrics (a headline number + a two-segment breakdown bar) and a
   * status badge. Replaces the old single-metric insight-card grid.
   *
   * No figure here is invented: every segment is a real catalog KPI or a
   * direct real field, divided only against another real figure from the
   * same source. Where a pillar has no backing data at all (Social and
   * Emotional Wellbeing — no sports/counselling/SEL field exists anywhere in
   * this dataset), the card says so instead of showing numbers.
   */
  readonly glancePillarInsights = computed(() => {
    type Seg = { label: string; value: string; pct: number; color: string };
    type Metric = { label: string; big: string; suffix: string; segs: [Seg, Seg] };
    type Card = {
      id: string; icon: string; title: string; tileBg: string; tileFg: string;
      pill: { cls: string; text: string } | null; metrics: Metric[]; openId: string | null;
    };
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const vals = this.kv.scopeValues();
    const menu = this.glanceMenu();
    // Progress bars use only the app's three RAG colours — no blue/teal/pink.
    const GREEN = '#10B981', AMBER = '#F59E0B', RED = '#E11D48';
    const openIdFor = (gid: string) => {
      const g = menu.find((x) => x.id === gid);
      return g ? (g.items.find((i) => i.built)?.id ?? g.items[0]?.id ?? null) : null;
    };
    const out: Card[] = [];

    // ---- 1. Access and Equity — potential dropouts %, dropout rate % ----
    {
      const metrics: Metric[] = [];
      // Potential dropouts %: N = students absent 15+ of the last 30 days
      // (acisPd, EMIS Potential Dropout report), D = enrolment in PD-covered
      // school types (acisPdBase). Both real; ratio computed once in
      // KpiValuesService.scopeValues(), not re-derived here.
      const pdp = this.glanceKpi('Potential Dropout', 'ac_pdp');
      const pdN = vals['acisPd'] ?? null, pdD = vals['acisPdBase'] ?? null;
      if (pdp?.raw != null && pdN != null && pdD != null && pdD > 0) {
        const flagPct = r1(pdp.raw as number), okPct = r1(100 - flagPct);
        metrics.push({
          label: 'Potential dropouts', big: pdp.value, suffix: '',
          segs: [
            { label: 'Absent 15+ days (flagged)', value: `${inr(pdN)} · ${flagPct}%`, pct: flagPct, color: RED },
            { label: 'Not flagged', value: `${inr(pdD - pdN)} · ${okPct}%`, pct: okPct, color: GREEN },
          ],
        });
      }
      // Dropout rate %: N = common-pool children not re-admitted to any school
      // (acisDropOut), D = enrolment in classes I–XII (acisEnrolI12) — the real
      // equivalent of "dropped out and not re-enrolled ÷ enrolment at the
      // start of the year"; both real, from the ACiS common-pool export.
      const dr = this.glanceKpi('All Children in School', 'ac_dr');
      const drN = vals['acisDropOut'] ?? null, drD = vals['acisEnrolI12'] ?? null;
      if (dr?.raw != null && drN != null && drD != null && drD > 0) {
        const outPct = r1(dr.raw as number), inPct = r1(100 - outPct);
        metrics.push({
          label: 'Dropout rate', big: dr.value, suffix: '',
          segs: [
            { label: 'Dropped out, not re-enrolled', value: `${inr(drN)} · ${outPct}%`, pct: outPct, color: RED },
            { label: 'Re-enrolled / continuing', value: `${inr(drD - drN)} · ${inPct}%`, pct: inPct, color: GREEN },
          ],
        });
      }
      out.push({
        id: 'g1', icon: 'fa-solid fa-scale-balanced', title: 'Access and Equity',
        tileBg: '#EAF0FB', tileFg: '#2F62C4', pill: this.glancePill(pdp?.band ?? dr?.band ?? 'none'),
        metrics, openId: openIdFor('g1'),
      });
    }

    // ---- 2. Safe and Secure Schools — facility coverage, buildings needing attention ----
    {
      const metrics: Metric[] = [];
      // 'i_need' (infNeedsAny) is not aggregated at scope level (renders "–" on
      // the Infrastructure tile grid itself); 'gap' (Schools with critical infra
      // gap) is the real, scope-aggregated composite flag, so it is used here.
      const gap = this.glanceKpi('Infrastructure', 'gap');
      const schoolsTotal = this.ds.current()?.schools ?? 0;
      if (gap?.raw != null && schoolsTotal > 0) {
        const gapPct = r1(Math.min(100, ((gap.raw as number) / schoolsTotal) * 100));
        const okPct = r1(100 - gapPct);
        const okCount = Math.max(0, schoolsTotal - (gap.raw as number));
        metrics.push({
          label: 'Schools with no critical infra gap', big: `${okPct}%`, suffix: '',
          segs: [
            { label: 'No critical gap', value: `${inr(okCount)} · ${okPct}%`, pct: okPct, color: GREEN },
            { label: 'Has gaps', value: `${inr(gap.raw as number)} · ${gapPct}%`, pct: gapPct, color: AMBER },
          ],
        });
      }
      const demolish = this.glanceKpi('Infrastructure', 'i_d');
      const repair = vals['infRepair'] ?? null;
      if (demolish?.raw != null && repair != null) {
        const total = (demolish.raw as number) + repair || 1;
        const demPct = r1(((demolish.raw as number) / total) * 100), repPct = r1(100 - demPct);
        metrics.push({
          label: 'Buildings needing attention', big: inr(total), suffix: 'identified',
          segs: [
            { label: 'To be demolished', value: `${inr(demolish.raw as number)} · ${demPct}%`, pct: demPct, color: RED },
            { label: 'Needs repair', value: `${inr(repair)} · ${repPct}%`, pct: repPct, color: AMBER },
          ],
        });
      }
      out.push({
        id: 'g2', icon: 'fa-solid fa-shield-halved', title: 'Safe and Secure Schools',
        tileBg: '#FDF0E6', tileFg: '#B85A22', pill: this.glancePill(gap?.band ?? demolish?.band ?? 'none'),
        metrics, openId: openIdFor('g2'),
      });
    }

    // ---- 3. Learning Outcomes First — attendance %, inspection targets, Board exam
    //         avg marks (Class X & XII), THIRAN BLO attainment ----
    {
      const metrics: Metric[] = [];
      // 1. Student attendance % — weighted: total present-days ÷ total school
      // days for all students combined (Attendance/a_s, already computed that way).
      const aS = this.glanceKpi('Attendance', 'a_s');
      if (aS?.raw != null) {
        const present = r1(aS.raw), absent = r1(100 - aS.raw);
        metrics.push({
          label: 'Student attendance %', big: aS.value, suffix: '',
          segs: [
            { label: 'Present', value: `${present}%`, pct: present, color: GREEN },
            { label: 'Absent', value: `${absent}%`, pct: absent, color: RED },
          ],
        });
      }
      // 2. Inspection targets achieved — Palli Paarvai observations by CEO,
      // DEO (Sec/Ele), BEO and BRTE vs their monthly class-observation target
      // model. Real only at state scope (the target model is state-wide);
      // omitted elsewhere rather than showing a fabricated district/block %.
      const insp = this.inspectionTargetPct();
      if (insp) {
        const remPct = r1(Math.max(0, 100 - insp.pct));
        metrics.push({
          label: 'Inspection targets achieved (Palli Paarvai)', big: `${insp.pct}%`, suffix: '',
          segs: [
            { label: 'Completed', value: `${inr(insp.obs)} · ${insp.pct}%`, pct: Math.min(100, insp.pct), color: GREEN },
            { label: 'Target remaining', value: `${inr(Math.max(0, insp.target - insp.obs))} · ${remPct}%`, pct: remPct, color: AMBER },
          ],
        });
      }
      // 3 & 4. Board exam average mark, Class X and Class XII — the real
      // Annual board sitting for each class (AcademicNode.examClass; `avg` is
      // already total marks ÷ students who attended, from the source export).
      const examClass = this.ac.current()?.examClass ?? [];
      const x10 = examClass.find((r) => r.cls === 10 && r.board);
      if (x10?.avg != null) {
        metrics.push({
          label: 'X Board Exam Results Average Mark', big: `${r1(x10.avg)}`, suffix: '/ 100',
          segs: [
            { label: 'Average mark', value: `${r1(x10.avg)}`, pct: Math.min(100, r1(x10.avg)), color: GREEN },
            { label: 'Remaining', value: `${r1(100 - x10.avg)}`, pct: Math.max(0, r1(100 - x10.avg)), color: AMBER },
          ],
        });
      }
      const x12 = examClass.find((r) => r.cls === 12 && r.board);
      if (x12?.avg != null) {
        metrics.push({
          label: 'XII Board Exam Results Average Mark', big: `${r1(x12.avg)}`, suffix: '/ 100',
          segs: [
            { label: 'Average mark', value: `${r1(x12.avg)}`, pct: Math.min(100, r1(x12.avg)), color: GREEN },
            { label: 'Remaining', value: `${r1(100 - x12.avg)}`, pct: Math.max(0, r1(100 - x12.avg)), color: AMBER },
          ],
        });
      }
      // 5. % of students in THIRAN+ — BLO (Basic Level of Objectives) benchmark
      // attainment in the THIRAN endline test (thiranAttainBLO ÷ students
      // endline-tested, back-derived from the same two real figures that
      // produce the catalog's own 'BLO attainment %'; the export has no count
      // of all Grade 2-9 students, only those identified/endline-tested).
      const tBl = this.glanceKpi('THIRAN', 't_bl');
      const attainBlo = vals['thiranAttainBLO'] ?? null;
      if (tBl?.raw != null && attainBlo != null && (tBl.raw as number) > 0) {
        const base = Math.round(attainBlo / ((tBl.raw as number) / 100));
        const notAttain = Math.max(0, base - attainBlo);
        const upPct = r1(tBl.raw as number), belowPct = r1(100 - upPct);
        metrics.push({
          label: 'THIRAN BLO attainment %', big: tBl.value, suffix: '',
          segs: [
            { label: 'Attained BLO benchmark', value: `${inr(attainBlo)} · ${upPct}%`, pct: upPct, color: GREEN },
            { label: 'Not yet attained', value: `${inr(notAttain)} · ${belowPct}%`, pct: belowPct, color: AMBER },
          ],
        });
      }
      out.push({
        id: 'g3', icon: 'fa-solid fa-book-open', title: 'Learning Outcomes First',
        tileBg: '#E6F5EF', tileFg: '#2F8A66', pill: this.glancePill(aS?.band ?? tBl?.band ?? 'none'),
        metrics, openId: openIdFor('g3'),
      });
    }

    // ---- 4. Social and Emotional Wellbeing — no backing data anywhere in this dataset ----
    out.push({
      id: 'g5', icon: 'fa-solid fa-heart', title: 'Social and Emotional Wellbeing',
      tileBg: '#F2EAFC', tileFg: '#7B3AC6', pill: { cls: 'mu', text: 'Not built' },
      metrics: [], openId: openIdFor('g5'),
    });

    // ---- 5. Alumni and Community Mentorship — real SMC meetings + resolutions ----
    // (Alumni/Vizhuthugal and NSNOP have no backing data; SMC is the one real
    // module under this pillar, so its two headline metrics stand in for it.)
    {
      const metrics: Metric[] = [];
      const held = vals['smcSchoolsHeld'] ?? null, notHeld = vals['smcSchoolsNotHeld'] ?? null;
      if (held != null && notHeld != null) {
        const total = held + notHeld || 1;
        const heldPct = r1((held / total) * 100), notHeldPct = r1(100 - heldPct);
        metrics.push({
          label: 'Schools holding SMC meetings', big: `${heldPct}%`, suffix: '',
          segs: [
            { label: 'Held', value: `${inr(held)} · ${heldPct}%`, pct: heldPct, color: GREEN },
            { label: 'Not held', value: `${inr(notHeld)} · ${notHeldPct}%`, pct: notHeldPct, color: AMBER },
          ],
        });
      }
      const raised = vals['smcRaised'] ?? null, closed = vals['smcClosed'] ?? null, pending = vals['smcPending'] ?? null;
      if (raised != null && closed != null && pending != null) {
        const closedPct = r1((closed / (raised || 1)) * 100), pendingPct = r1(100 - closedPct);
        metrics.push({
          label: 'SMC resolutions', big: inr(raised), suffix: 'raised',
          segs: [
            { label: 'Closed', value: `${inr(closed)} · ${closedPct}%`, pct: closedPct, color: GREEN },
            { label: 'Open', value: `${inr(pending)} · ${pendingPct}%`, pct: pendingPct, color: AMBER },
          ],
        });
      }
      const ma = KPI_MODULES.find((m) => m.title === 'SMC')?.kpis.find((k) => k.id === 'm_ma');
      const maRaw = vals['smcMeetAttendPct'] ?? null;
      out.push({
        id: 'g6', icon: 'fa-solid fa-people-arrows', title: 'Alumni and Community Mentorship',
        tileBg: '#E0F2F1', tileFg: '#0f766e',
        pill: ma && maRaw != null ? this.glancePill(this.kv.band(ma, maRaw)) : null,
        metrics, openId: openIdFor('g6'),
      });
    }

    return out;
  });

  // ---- side nav collapse (icon rail) ----
  readonly navCollapsed = signal(false);
  toggleNav(): void { this.navCollapsed.update((v) => !v); }
  fmtN(v: number): string { return inr(v); }

  /** Pillar cards expanded past their first two metrics (Key insights by pillar). */
  readonly pillarExpanded = signal<Set<string>>(new Set());
  togglePillar(id: string): void {
    this.pillarExpanded.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  readonly PALLI_DESIGS = ['CEO', 'DEO (Secondary)', 'DEO (Elementary)', 'BEO', 'BRTE'];
  readonly palliMonth = signal<string>('all');
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

  /**
   * Palli Paarvai module page (glanceModule() when gm.module === 'Palli Paarvai'):
   * a richer analytics layer above the four KPI tiles — a state read-out, two
   * comparison charts, a weekly activity trend and a searchable unit table —
   * all built from the same real sources the main Review Dashboard's Palli
   * Paarvai drill uses (`rv.drillRows()` for per-unit %, `rv.palliObs()` for
   * the observation line list). No figure here is invented.
   */
  private readonly PALLI_DEF = (id: string) => KPI_MODULES.find((m) => m.title === 'Palli Paarvai')?.kpis.find((k) => k.id === id);
  private palliBand(id: string, v: number | null): string {
    const def = this.PALLI_DEF(id);
    return def && v != null ? this.kv.band(def, v) : 'none';
  }
  /** Real school count for a drillRows() unit key, from the enrolment roll (not the KPI row's scaled count). */
  private unitSchoolCount(key: string): number {
    const lvl = this.ds.level();
    if (lvl === 'state') return this.ds.districts().find((d) => d.name === key)?.schools ?? 0;
    if (lvl === 'district') return this.ds.blocksForDistrict().find((b) => b.block === key)?.schools ?? 0;
    return 1;
  }
  /** SHOW: Performance (% of Class Observation) vs Compliance (% Schools Observed 3+ Times) — both real KPIs. */
  readonly palliShow = signal<'performance' | 'compliance'>('performance');
  readonly palliShowId = computed(() => (this.palliShow() === 'performance' ? 'p_co' : 'p_s3'));
  readonly palliShowField = computed<'co' | 's3'>(() => (this.palliShow() === 'performance' ? 'co' : 's3'));
  readonly palliShowLabel = computed(() => (this.palliShow() === 'performance' ? '% of Class Observation' : '% of Schools Observed 3+ Times'));
  /** The children of the current scope (districts / blocks / schools) with their real Palli Paarvai %s. */
  readonly palliUnitRows = computed(() => {
    const lvl = this.ds.level();
    if (lvl === 'school') return [];
    const field = this.palliShowField() === 'co' ? 'palliClassObsPct' : 'palliSchools3PlusPct';
    const id = this.palliShowId();
    return (this.rv.drillRows() as any[]).map((r) => ({
      key: r.key as string, name: r.name as string, schools: this.unitSchoolCount(r.key),
      co: r.palliClassObsPct ?? null, sno: r.palliSchoolsNotObsPct ?? null,
      ono: r.palliOfficialsNotObsPct ?? null, s3: r.palliSchools3PlusPct ?? null,
      band: this.palliBand(id, r[field] ?? null),
    }));
  });
  readonly palliUnitLabel = computed(() => ({ state: 'District', district: 'Block', block: 'School' } as Record<string, string>)[this.ds.level()] ?? 'Unit');
  readonly palliUnitSearch = signal('');
  readonly palliUnitRowsFiltered = computed(() => {
    const q = this.palliUnitSearch().trim().toLowerCase();
    const rows = this.palliUnitRows();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  });
  /** Drill from a unit table row (district → block), shared by every rich module page. */
  drillUnit(key: string): void {
    if (this.ds.level() === 'state') this.ds.drillToDistrict(key);
    else if (this.ds.level() === 'district') this.ds.drillToBlock(key);
  }
  /** Copy the unit table as CSV (clipboard), same figures as shown on screen. */
  async copyPalliCsv(): Promise<void> {
    const rows = this.palliUnitRowsFiltered();
    const head = [this.palliUnitLabel(), 'Schools', '% Class Observation', '% Schools Not Observed', '% Officials Not Observed', '% Schools Observed 3+ Times'];
    const lines = [head.join(','), ...rows.map((r) => [r.name, r.schools, r.co ?? '', r.sno ?? '', r.ono ?? '', r.s3 ?? ''].join(','))];
    try { await navigator.clipboard.writeText(lines.join('\n')); } catch { /* clipboard unavailable (insecure context, etc.) */ }
  }
  /** State's read-out: a short real narrative above the charts, like the Review Dashboard's own KPI summaries. */
  readonly palliReadout = computed(() => {
    const field = this.palliShowField();
    const units = this.palliUnitRows().filter((r) => r[field] != null);
    const show = this.glanceKpi('Palli Paarvai', this.palliShowId());
    const sno = this.glanceKpi('Palli Paarvai', 'p_sno');
    const ono = this.glanceKpi('Palli Paarvai', 'p_ono');
    if (!show || !units.length) return [];
    const sorted = [...units].sort((a, b) => (b[field] as number) - (a[field] as number));
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const below = units.filter((u) => (u[field] as number) < (show.raw as number)).length;
    const unit = this.palliUnitLabel().toLowerCase();
    return [
      `${this.palliShowLabel()} for ${this.ds.scopeLabel()} is ${show.value}. Best ${unit}: ${best.name} (${best[field]}%); lowest: ${worst.name} (${worst[field]}%).`,
      `${below} of ${units.length} ${unit}s are below the ${this.ds.scopeLabel()} figure.`,
      sno ? `${sno.value} of schools have had no observation this term.` : '',
      ono ? `${ono.value} of officials are behind their month-to-date target.` : '',
    ].filter(Boolean);
  });
  /** Chart: observations by observing designation (real, from the line list). */
  readonly glancePalliDesigOpt = computed(() => {
    const rows = this.palliByDesig();
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.desig}</b><br/>Share of observations <b>${r.pct}%</b><br/>${inr(r.n)} observations`; } },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: rows.map((r) => r.desig.replace(' (', '\n(')), axisLabel: { fontSize: 10, color: '#64748B', interval: 0, lineHeight: 13 }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
      series: [{ name: 'Share of observations', type: 'bar', data: rows.map((r) => r.pct), barCategoryGap: '36%', barMaxWidth: 56,
        itemStyle: { color: '#1d4ed8', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600, color: '#24498F', formatter: (p: any) => `${p.value}%` } }],
    };
  });
  /** Chart: this scope vs the best and lowest child unit, on the selected SHOW measure. */
  readonly glancePalliPeerOpt = computed(() => {
    const field = this.palliShowField();
    const units = this.palliUnitRows().filter((r) => r[field] != null).sort((a, b) => (b[field] as number) - (a[field] as number));
    const show = this.glanceKpi('Palli Paarvai', this.palliShowId());
    if (!units.length || !show) return {};
    const best = units[0], worst = units[units.length - 1];
    const rows = [
      { label: this.ds.titleCase(this.ds.scopeLabel()), v: show.raw as number, color: '#2F62C4' },
      { label: `Best ${this.palliUnitLabel().toLowerCase()}\n(${best.name})`, v: best[field] as number, color: '#D97706' },
      { label: `Lowest ${this.palliUnitLabel().toLowerCase()}\n(${worst.name})`, v: worst[field] as number, color: '#CBD5E1' },
    ];
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { fontSize: 10, color: '#64748B', interval: 0, lineHeight: 13 }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
      series: [{ type: 'bar', data: rows.map((r) => ({ value: r.v, itemStyle: { color: r.color, borderRadius: [4, 4, 0, 0] } })), barCategoryGap: '40%', barMaxWidth: 70,
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` } }],
    };
  });
  /**
   * Weekly observation counts in scope, most recent 8 weeks present in the
   * export. State scope also overlays the real weekly target (the monthly
   * target model ÷ ~4.33); district/block scope has no real target subset
   * to compare against, so the line is left off rather than invented.
   */
  readonly palliWeekly = computed(() => {
    const a = this.rv.palliObs();
    if (!a) return [];
    const base = new Date(a.baseDate + 'T00:00:00Z').getTime();
    const dist = this.ds.selectedDistrict()?.toUpperCase() ?? null;
    const blk = this.ds.selectedBlock()?.toUpperCase() ?? null;
    const weekStart = (dayOffset: number) => {
      const d = new Date(base + dayOffset * 86400000);
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      d.setUTCDate(d.getUTCDate() - dow);
      return d.toISOString().slice(0, 10);
    };
    const counts = new Map<string, number>();
    for (const o of a.observations) {
      const sch = a.schools[o[PalliObsCol.school]];
      if (dist && (sch?.d ?? '').toUpperCase() !== dist) continue;
      if (blk && (sch?.b ?? '').toUpperCase() !== blk) continue;
      const wk = weekStart(o[PalliObsCol.day]);
      counts.set(wk, (counts.get(wk) ?? 0) + 1);
    }
    const weeks = [...counts.keys()].sort().slice(-8);
    const label = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return weeks.map((w) => ({ label: `wk of ${label(w)}`, n: counts.get(w) ?? 0 }));
  });
  readonly palliWeeklyTarget = computed(() => {
    if (this.ds.level() !== 'state') return null;
    const model = this.rv.palliTargetModel();
    const monthly = this.PALLI_DESIGS.reduce((s, d) => s + (model.find((m) => m.official === d)?.classesPerMonth ?? 0), 0);
    return monthly ? Math.round((monthly / 4.33) * 10) / 10 : null;
  });
  readonly glancePalliWeeklyOpt = computed(() => {
    const rows = this.palliWeekly();
    if (!rows.length) return {};
    const target = this.palliWeeklyTarget();
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 48, right: 70, top: 16, bottom: 36 },
      xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { fontSize: 10, color: '#64748B' }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#64748B' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
      series: [{
        name: 'Observations', type: 'bar', data: rows.map((r) => r.n), barMaxWidth: 48,
        itemStyle: { color: '#1d4ed8', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600, color: '#24498F' },
        markLine: target == null ? undefined : { silent: true, symbol: 'none', lineStyle: { color: '#D97706', type: 'dashed' },
          label: { formatter: `~${target}/wk`, fontSize: 10, color: '#B45309', position: 'insideEndTop' }, data: [{ yAxis: target }] },
      }],
    };
  });

  /**
   * Attendance module page (glanceModule() when gm.module === 'Attendance'): the
   * same richer analytics layer as Palli Paarvai's — SHOW (Students/Teachers) ×
   * METRIC (Marking status/Attendance %), a state read-out, two comparison
   * charts, a trend and a searchable unit table — built entirely from
   * `AttendanceService`'s real per-scope and per-child nodes. No figure here
   * is invented. One honest substitution: the reference design breaks the
   * first chart down by gender and school category, but neither breakdown
   * exists in the attendance data (confirmed: no gender field, no category
   * field anywhere in `AttendanceNode`/`AttendanceSchool`) — the real
   * breakdown this data DOES have is by management (`at.byManagement()`),
   * used instead.
   */
  readonly attPageShow = signal<'students' | 'teachers'>('students');
  readonly attPageMetric = signal<'marking' | 'attendance'>('marking');
  readonly attPageShowLabel = computed(() => (this.attPageShow() === 'students' ? 'Student' : 'Teacher'));
  readonly attPageMetricLabel = computed(() => (this.attPageMetric() === 'marking' ? 'Marking status' : 'Attendance %'));
  /** The field on an AttendanceNode (or AttendanceDay) for the active SHOW/METRIC pair. Marking compliance is recorded once per school, not split by student/teacher. */
  private attPageField(): string {
    if (this.attPageMetric() === 'marking') return 'compliance';
    return this.attPageShow() === 'students' ? 'attendance' : 'teacherAttendance';
  }
  /** The latest working day on a node's own daily series (no shared window/day signal touched — local to this page). */
  private latestDay(node: { daily?: any[] } | null | undefined): any {
    return node?.daily?.length ? node.daily[node.daily.length - 1] : null;
  }
  /** Headline % for the current scope, active SHOW/METRIC. */
  readonly attPageHeadline = computed(() => {
    const n = this.at.current() as any;
    return n ? (n[this.attPageField()] as number) : null;
  });
  readonly attPageToday = computed(() => this.latestDay(this.at.current()));
  /** "Where am I?" — three real snapshot cards for the latest working day in scope. */
  readonly attPageCards = computed(() => {
    const day = this.attPageToday();
    if (!day) return null;
    const students = this.attPageShow() === 'students';
    const present = students ? day.present : day.tPresent;
    const expected = students ? day.expected : day.tExpected;
    const presentPct = expected ? Math.round((present / expected) * 1000) / 10 : null;
    const markedPct = day.schools ? Math.round((day.marked / day.schools) * 1000) / 10 : null;
    return {
      date: day.date,
      presentPct, presentLabel: `${inrShort(present)} of ${inrShort(expected)} ${students ? 'enrolled' : 'teaching staff'}`,
      markedPct, markedLabel: `${inr(day.marked)} of ${inr(day.schools)} schools reporting that day`,
      pending: day.unmarked, pendingLabel: `${inr(day.unmarked)} schools had not marked attendance that day`,
    };
  });
  /** By school category (real: AttendanceSchool.ctype = Primary/Middle/High/Higher Secondary School, confirmed real in the asset). */
  readonly attPageCategoryRows = computed(() => {
    const field = this.attPageField();
    const schools = this.at.scopeSchools();
    const order = ['Primary School', 'Middle School', 'High School', 'Higher Secondary School'];
    const groups = new Map<string, any[]>();
    for (const s of schools) {
      const k = (s as any).ctype || 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }
    const wavg = (list: any[]) => {
      const tot = list.reduce((a, s) => a + s.enrolled, 0);
      return tot ? Math.round((list.reduce((a, s) => a + (s[field] as number) * s.enrolled, 0) / tot) * 10) / 10 : null;
    };
    const keys = [...order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !order.includes(k))];
    return keys.map((k) => {
      const list = groups.get(k)!;
      return { name: k.replace(' School', ''), v: wavg(list), enrolled: list.reduce((a, s) => a + s.enrolled, 0), schools: list.length };
    }).filter((r) => r.v != null);
  });
  readonly glanceAttPageCategoryOpt = computed(() => {
    const rows = this.attPageCategoryRows();
    const state = this.attPageHeadline();
    if (!rows.length) return {};
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.name}</b><br/>${ps[0].value}%<br/>${inrShort(r.enrolled)} enrolled · ${inr(r.schools)} schools`; } },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: rows.map((r) => r.name), axisLabel: { fontSize: 10, color: '#64748B', interval: 0, lineHeight: 13 }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
      series: [{
        type: 'bar', data: rows.map((r) => r.v), barCategoryGap: '36%', barMaxWidth: 70,
        itemStyle: { color: '#b45309', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` },
        markLine: state == null ? undefined : { silent: true, symbol: 'none', lineStyle: { color: '#334155', type: 'dashed' },
          label: { formatter: `State avg ${state}%`, fontSize: 10, color: '#334155', position: 'insideEndTop' }, data: [{ yAxis: state }] },
      }],
    };
  });
  /**
   * By gender: NO measured gender-split attendance/marking record exists
   * anywhere in the attendance data (confirmed — no boys/girls field on
   * AttendanceNode or AttendanceSchool). Rather than apportion a fabricated
   * differential, both bars show the real scope-wide figure; only the
   * enrolment counts (from the real enrolment roll) differ by gender. The
   * chart says so plainly.
   */
  readonly attPageGenderRows = computed(() => {
    const n = this.ds.current();
    const state = this.attPageHeadline();
    if (!n || state == null) return [];
    return [
      { name: 'Boys', v: state, enrolled: n.boys },
      { name: 'Girls', v: state, enrolled: n.girls },
    ];
  });
  readonly glanceAttPageGenderOpt = computed(() => {
    const rows = this.attPageGenderRows();
    if (!rows.length) return {};
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.name}</b><br/>${ps[0].value}% (scope-wide figure)<br/>${inrShort(r.enrolled)} enrolled (real)`; } },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: rows.map((r) => `${r.name}\n${inrShort(r.enrolled)}`), axisLabel: { fontSize: 10, color: '#64748B', interval: 0, lineHeight: 13 }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
      series: [{
        type: 'bar', data: rows.map((r) => r.v), barCategoryGap: '45%', barMaxWidth: 70,
        itemStyle: { color: '#0e7490', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` },
      }],
    };
  });
  /** Children of the current scope with the active metric — reused for the peer chart and the unit table. */
  readonly attPageUnitLabel = computed(() => {
    const l = this.at.childLabel();
    return l.endsWith('s') && l !== 'This School' ? l.slice(0, -1) : l;
  });
  readonly attPageUnitRows = computed(() => {
    const field = this.attPageField();
    if (this.ds.level() === 'school') return [];
    return this.at.children().map((c) => {
      const today = this.latestDay(c.node);
      const working = c.node.schools;
      const markedToday = today?.marked ?? null;
      return {
        key: c.key, name: c.name, v: (c.node as any)[field] as number, schools: this.unitSchoolCount(c.key),
        working, markedToday, pendingToday: today?.unmarked ?? null,
        markedPct: working && markedToday != null ? Math.round((markedToday / working) * 1000) / 10 : null,
      };
    });
  });
  /** Chart: my position vs the mean of peers vs the best peer (matches the reference design's distinct "state average" line). */
  readonly glanceAttPagePeerOpt = computed(() => {
    const rows = this.attPageUnitRows().filter((r) => r.v != null);
    const mine = this.attPageHeadline();
    if (!rows.length || mine == null) return {};
    const mean = Math.round((rows.reduce((s, r) => s + (r.v as number), 0) / rows.length) * 10) / 10;
    const best = [...rows].sort((a, b) => (b.v as number) - (a.v as number))[0];
    const bars = [
      { label: `My position\n(${this.ds.titleCase(this.ds.scopeLabel())})`, v: mine, color: '#1e3a5f' },
      { label: `${this.attPageUnitLabel()} average\n(mean of ${rows.length})`, v: mean, color: '#94A3B8' },
      { label: `Best ${this.attPageUnitLabel().toLowerCase().replace(/s$/, '')}\n(${best.name})`, v: best.v as number, color: '#D97706' },
    ];
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: bars.map((b) => b.label), axisLabel: { fontSize: 10, color: '#64748B', interval: 0, lineHeight: 13 }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
      series: [{ type: 'bar', data: bars.map((b) => ({ value: b.v, itemStyle: { color: b.color, borderRadius: [4, 4, 0, 0] } })), barCategoryGap: '40%', barMaxWidth: 70,
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` } }],
    };
  });
  /** "How much have I improved?" — 14 working days / weeks / months, built from the real daily series. */
  readonly attPageWindow = signal<'14d' | '14w' | '14m'>('14d');
  readonly attPageTrend = computed(() => {
    const n = this.at.current() as any;
    if (!n?.daily?.length) return [];
    const field = this.attPageMetric() === 'marking' ? 'compliance' : (this.attPageShow() === 'students' ? 'attendance' : 'teacher');
    const daily: any[] = n.daily;
    const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    if (this.attPageWindow() === '14d') {
      return daily.slice(-14).map((d) => ({ label: dayLabel(d.date), v: d[field] as number }));
    }
    const bucket = this.attPageWindow() === '14w' ? 7 : 30;
    const groups = new Map<string, number[]>();
    for (const d of daily) {
      const t = new Date(d.date + 'T00:00:00Z').getTime();
      const k = String(Math.floor(t / (bucket * 86400000)));
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(d[field] as number);
    }
    const keys = [...groups.keys()].sort((a, b) => +a - +b).slice(-14);
    return keys.map((k, i) => {
      const vs = groups.get(k)!;
      const avg = Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10;
      return { label: this.attPageWindow() === '14w' ? `wk ${i + 1}` : `mo ${i + 1}`, v: avg };
    });
  });
  readonly glanceAttPageTrendOpt = computed(() => {
    const rows = this.attPageTrend();
    if (!rows.length) return {};
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      grid: { left: 44, right: 12, top: 16, bottom: 30 },
      xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { fontSize: 10, color: '#64748B', interval: 0, rotate: rows.length > 10 ? 30 : 0 }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } }, scale: true },
      series: [{ type: 'bar', data: rows.map((r) => r.v), barMaxWidth: 48, itemStyle: { color: '#b45309', borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600, color: '#92400e' } }],
    };
  });
  /** "How is my team doing?" — searchable unit table, same convention as the Palli page. */
  readonly attPageUnitSearch = signal('');
  readonly attPageUnitRowsFiltered = computed(() => {
    const q = this.attPageUnitSearch().trim().toLowerCase();
    const rows = this.attPageUnitRows();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  });
  async copyAttPageCsv(): Promise<void> {
    const rows = this.attPageUnitRowsFiltered();
    const head = [this.attPageUnitLabel(), 'Schools', 'Working schools', `${this.attPageMetricLabel()} %`, 'Marked (latest day)', 'Pending (latest day)'];
    const lines = [head.join(','), ...rows.map((r) => [r.name, r.schools, r.working, r.v ?? '', r.markedToday ?? '', r.pendingToday ?? ''].join(','))];
    try { await navigator.clipboard.writeText(lines.join('\n')); } catch { /* clipboard unavailable */ }
  }
  /** "Standard reports" — quick links straight into the real catalog KPIs (tl30 is the one assumed field; flagged in the template). */
  readonly attPageReports = computed(() => {
    const ids: { id: string; label: string }[] = [
      { id: 'a_s60', label: 'Schools below 60% student attendance' },
      { id: 'a_t60', label: 'Schools below 60% teacher attendance' },
      { id: 'd15', label: 'Potential dropout (15 days absent)' },
      { id: 'tl30', label: 'Teacher long absent (30+ days)' },
    ];
    return ids.map((r) => ({ ...r, k: this.glanceKpi('Attendance', r.id) })).filter((r) => r.k);
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
