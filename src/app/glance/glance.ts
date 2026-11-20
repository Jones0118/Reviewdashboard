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

  // ---- display-only role picker (top bar) ----
  readonly roleOpen = signal(false);
  toggleRole(): void { this.roleOpen.update((v) => !v); }
  selectRole(id: string): void { this.auth.setRole(id); this.roleOpen.set(false); }

  // ---- header brand emblem (real asset; fall back to a generic icon if it fails to load) ----
  readonly logoOk = signal(true);

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
  // side nav can stick just below it whatever the bar wraps to; also tracks
  // the main content's width for the pillar-grid masonry column count ----
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly mainWidth = signal(0);
  constructor() {
    afterRenderEffect(() => {
      // re-measure after any render that can change the header's or the pinned filter's height
      this.auth.isAuthenticated(); this.ready(); this.ds.level(); this.filterActive(); this.anyFilterActive(); this.glanceView();
      this.measureLayout();
    });
    afterNextRender(() => {
      new ResizeObserver(() => this.measureLayout()).observe(this.el.nativeElement);
    });
  }
  private measureLayout(): void {
    const top = this.el.nativeElement.querySelector<HTMLElement>('.gl-top');
    this.el.nativeElement.style.setProperty('--gl-top-h', `${top?.offsetHeight ?? 0}px`);
    const main = this.el.nativeElement.querySelector<HTMLElement>('.gl-main');
    this.mainWidth.set(main?.clientWidth ?? 0);
    // pinned filter card height (its wrapper carries a 22px band below the card)
    const flt = this.el.nativeElement.querySelector<HTMLElement>('.gl-filterwrap.pin');
    this.el.nativeElement.style.setProperty('--gl-filter-h', `${flt ? Math.max(0, flt.offsetHeight - 22) : 0}px`);
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
  /** Reset: every control in the filter bar — Management, Category and the scope back to state. */
  resetFilters(): void {
    this.mgmtSel.set([]); this.typeSel.set([]);
    this.ds.filters.update((f) => ({ ...f, stype: [], cat: [] }));
    this.ds.goToState();
  }
  readonly filterActive = computed(() => this.mgmtSel().length > 0 || this.typeSel().length > 0);
  /** Anything narrowing the page: a scope below state, or a Management / Category selection. */
  readonly anyFilterActive = computed(() => this.ds.level() !== 'state' || this.filterActive());
  readonly filterSummary = computed(() => {
    const m = this.mgmtSel(), c = this.typeSel();
    if (!m.length && !c.length) return 'All schools';
    const parts = [m.length ? m.join(' / ') : null, c.length ? c.join(' / ') : null].filter(Boolean);
    return parts.join(' \u00B7 ') + ' schools';
  });

  // ---- scope (State -> District -> Block -> School), shared DataService state ----
  readonly districtOptions = computed(() =>
    this.ds.districts().map((d) => ({ label: this.ds.titleCase(d.name), value: d.name })),
  );
  readonly blockOptions = computed(() =>
    this.ds.blocksForDistrict().map((b) => ({ label: this.ds.titleCase(b.block), value: b.block })),
  );
  /** Schools in the selected block; honours the Management / Category filters, same as the main dashboard. */
  readonly schoolOptions = computed(() =>
    this.ds.schoolsForBlock().map((s) => ({ label: s.name, value: s.name })),
  );
  onDistrictChange(name: string | null): void { if (name) this.ds.drillToDistrict(name); else this.ds.goToState(); }
  onBlockChange(block: string | null): void { if (block) this.ds.drillToBlock(block); else this.ds.goToDistrict(); }
  onSchoolChange(name: string | null): void { if (name) this.ds.drillToSchool(name); else this.ds.goToBlock(); }
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
      inlineCss.push('.gl-anim,.gl-bp .sbar i,.gl-ent .bar i,.gl-spark .sl{animation:none!important}.gl-spark .sl{stroke-dashoffset:0!important}.gl-top{position:static!important}.gl-nav{position:static!important;height:auto!important}.gl-mainview{position:static!important}.gl-filterwrap{position:static!important}');

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
  private readonly GLANCE_GROUPS: { id: string; group: string; short: string; icon: string; items: { id: string; label: string; module: string | null; icon: string }[] }[] = [
    { id: 'g1', group: '1. Access and Equity', short: 'Access', icon: 'fa-handshake', items: [
      { id: 'scholar', label: 'Scholarships and Entitlements', module: 'Scholarship', icon: 'fa-solid fa-award' },
      { id: 'cwsn', label: 'Support to CWSN', module: null, icon: 'fa-solid fa-wheelchair' },
      { id: 'acis', label: 'All Children in Schools (ACiS)', module: 'All Children in School', icon: 'fa-solid fa-children' },
      { id: 'scheme', label: 'Scheme & Service Delivery', module: null, icon: 'fa-solid fa-gift' },
    ] },
    { id: 'g2', group: '2. Safe and Secure Schools', short: 'Safety', icon: 'fa-building', items: [
      { id: 'infra', label: 'Physical Infra', module: 'Infrastructure', icon: 'fa-solid fa-building-columns' },
      { id: 'grievance', label: 'Grievance Redressal & Public Interface', module: null, icon: 'fa-solid fa-headset' },
    ] },
    { id: 'g3', group: '3. Learning Outcomes First', short: 'Learning', icon: 'fa-lightbulb', items: [
      { id: 'glp-primary', label: 'Grade-level Proficiency for Primary Grades', module: null, icon: 'fa-solid fa-child-reaching' },
      { id: 'glp-middle', label: 'Grade-level Proficiency for Middle Grades', module: null, icon: 'fa-solid fa-person-chalkboard' },
      { id: 'board', label: '10th & 12th Board Exam Performance', module: 'Academic Performance', icon: 'fa-solid fa-graduation-cap' },
      { id: 'blp-middle', label: 'Basic-level Proficiency in Middle Grades', module: 'THIRAN', icon: 'fa-solid fa-book-open-reader' },
      { id: 'qh-exam', label: '10th & 12th Quarterly / Half-yearly Exam Performance', module: 'Academic Performance', icon: 'fa-solid fa-pen-ruler' },
      { id: 'attendance', label: 'School Governance', module: 'Attendance', icon: 'fa-solid fa-landmark' },
      { id: 'classroom', label: 'Classroom Teaching & Engagement', module: 'Palli Paarvai', icon: 'fa-solid fa-eye' },
      { id: 'learn-monitor', label: 'Learning Monitoring & Support', module: null, icon: 'fa-solid fa-magnifying-glass-chart' },
      { id: 'teacher-cap', label: 'Teacher Capacity & Development', module: null, icon: 'fa-solid fa-user-tie' },
      { id: 'digital', label: 'Labs & Digital Infra', module: 'Digital Infrastructure (Middle/High/Hr.Sec)', icon: 'fa-solid fa-desktop' },
      { id: 'vetri', label: 'Vetri Palligal', module: null, icon: 'fa-solid fa-trophy' },
      { id: 'field', label: 'District Governance - Field Inspections & Monitoring', module: 'Palli Paarvai', icon: 'fa-solid fa-clipboard-check' },
    ] },
    { id: 'g5', group: '4. Social and Emotional Wellbeing', short: 'Wellbeing', icon: 'fa-heart', items: [
      { id: 'cocurricular', label: 'Co-curricular', module: null, icon: 'fa-solid fa-palette' },
      { id: 'libraries', label: 'Public Libraries', module: null, icon: 'fa-solid fa-book' },
      { id: 'health', label: 'Student Health & Wellbeing', module: null, icon: 'fa-solid fa-heart-pulse' },
      { id: 'career', label: 'Career Guidance', module: null, icon: 'fa-solid fa-compass' },
      { id: 'thunai', label: 'Thunai', module: null, icon: 'fa-solid fa-hands-holding-child' },
      { id: 'values', label: 'Value Education', module: null, icon: 'fa-solid fa-seedling' },
    ] },
    { id: 'g6', group: '5. Alumni and Community Mentorship', short: 'Community', icon: 'fa-comments', items: [
      { id: 'smc', label: 'School Management Committee (SMC)', module: 'SMC', icon: 'fa-solid fa-people-group' },
      { id: 'alumni', label: 'Vizhuthugal (Alumni)', module: null, icon: 'fa-solid fa-user-graduate' },
      { id: 'nsnop', label: 'Namma School Namma Ooru Palli (NSNOP)', module: null, icon: 'fa-solid fa-house-flag' },
    ] },
  ];

  /**
   * Navigation state. The icon rail is fixed; the arrow at its top shows or
   * hides the second panel (closed by default), which lists the pages of the
   * pillar that owns the open page. Overview has no pages of its own, so no
   * panel is shown there whatever the arrow says.
   * Picking a pillar on the rail opens its first page (the Gmail pattern: the
   * rail switches app, the panel is that app's folder list).
   */
  readonly panelOpen = signal(false);
  togglePanel(): void { this.panelOpen.update((v) => !v); }
  readonly panelGroup = computed(() => {
    const view = this.glanceView();
    return this.glanceMenu().find((g) => g.items.some((i) => i.id === view)) ?? null;
  });
  openGroup(id: string): void {
    const first = this.glanceMenu().find((g) => g.id === id)?.items[0]?.id;
    if (first) this.setGlanceView(first);
  }
  /** Overview has no pages; its panel lists the page's own sections instead. */
  readonly OVERVIEW_ANCHORS: { id: string; label: string; icon: string }[] = [
    { id: 'gl-pillars', label: 'Key Insights', icon: 'fa-solid fa-table-cells-large' },
    { id: 'gl-attention', label: 'Need Your Attention', icon: 'fa-solid fa-triangle-exclamation' },
  ];
  scrollToAnchor(id: string): void {
    // scroll-margin-top on the targets keeps them clear of the pinned header + filter
    this.el.nativeElement.querySelector<HTMLElement>('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  /** Rail highlight: the pillar whose page is open (none while on Overview). */
  railOn(id: string): boolean {
    return this.glanceView() !== 'overview' && this.panelGroup()?.id === id;
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
          built: !!mod,
          color: mod?.color ?? '#8a96ae',
          topic: mod?.kpis[0]?.topic ?? '',
          bad: mod ? rows.filter((r) => r.module === mod.title && r.band === 'bad').length : 0,
        };
      });
      return { id: g.id, group: g.group, short: g.short, icon: g.icon, items, bad: items.reduce((s, i) => s + i.bad, 0) };
    });
  });
  private readonly glanceItems = computed(() => this.glanceMenu().flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))));

  /** School counts by broad type for the current scope (roll is students-only in the node). */
  private readonly glanceSchoolTypeCounts = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.ds.rawSchoolRows()) m.set(r.stype, (m.get(r.stype) ?? 0) + 1);
    return m;
  });


  /**
   * Headline figure on the three cards: same Indian units as `inrShort`, but
   * with the unit spelt out ("1.27 Crore", "5.62 Lakh") because these numbers
   * are read on their own. Thousands stay as a full grouped number.
   */
  private bigUnit(v: number | null | undefined): string {
    const n = Number(v ?? 0);
    const abs = Math.abs(n);
    if (abs >= 1e7) return (n / 1e7).toFixed(2) + ' Crore';
    if (abs >= 1e5) return (n / 1e5).toFixed(2) + ' Lakh';
    return inr(n);
  }

  /** The three headline cards: schools, students, teachers, each with a split bar. */
  readonly glanceStats = computed(() => {    const n = this.ds.current();
    if (!n) return [];
    const typeN = this.glanceSchoolTypeCounts();
    const cnt = (...names: string[]) => names.reduce((s, k) => s + (typeN.get(k) ?? 0), 0);
    const govtSch = cnt('Government'), aidedSch = cnt('Fully Aided', 'Partially Aided'), privSch = cnt('Un-aided');

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
        label: 'No. of Schools', icon: 'fa-solid fa-school', big: inr(n.schools),
        sub: 'All managements',
        splits: hasTypes ? [split(['Govt', govtSch], ['Aided', aidedSch], ['Private', privSch])] : [],
      },
      {
        label: 'No. of Students', icon: 'fa-solid fa-user-graduate', big: this.bigUnit(n.students),
        sub: 'Class 1–12, All managements',
        splits: [split(['Boys', n.boys], ['Girls', n.girls])],
      },
      {
        label: 'No. of Teachers', icon: 'fa-solid fa-chalkboard-user', big: this.bigUnit(n.teaching),
        sub: 'All managements',
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
    /** `tip` is what the bar shows on hover; the legend itself carries labels only. */
    type Metric = { label: string; big: string; suffix: string; segs: [Seg, Seg]; tip?: string };
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
          // red flagged share, green remainder; the hover tip spells out the
          // flagged count against the enrolment the % is computed on
          segs: [
            { label: 'Absent 15+ days', value: inr(pdN), pct: flagPct, color: RED },
            { label: 'Enrolled', value: inr(pdD - pdN), pct: okPct, color: GREEN },
          ],
          tip: `Absent 15+ days ${inr(pdN)} of ${inr(pdD)} students`,
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
            { label: 'Dropped out', value: `${inr(drN)} · ${outPct}%`, pct: outPct, color: RED },
            { label: 'Enrolled', value: `${inr(drD - drN)} · ${inPct}%`, pct: inPct, color: GREEN },
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

    // hover tip for every bar that did not set its own: "label value · label value"
    for (const c of out) for (const m of c.metrics) m.tip ??= m.segs.map((s) => `${s.label} ${s.value}`).join(' \u00B7 ');
    return out;
  });

  /**
   * Masonry columns for the pillar grid: distributes `glancePillarInsights()`
   * round-robin across N columns (N tracks the old CSS Grid's
   * `repeat(auto-fit, minmax(300px,1fr))` breakpoint math against the main
   * content's measured width) so each column packs tightly on its own —
   * expanding one card only grows its own column, never pushes a shorter
   * column's cards down with it.
   */
  readonly pillarCols = computed(() => {
    const w = this.mainWidth();
    const gap = 16, minCol = 300;
    if (!w) return 3;
    return Math.max(1, Math.floor((w + gap) / (minCol + gap)));
  });
  readonly pillarColumns = computed(() => {
    const cards = this.glancePillarInsights();
    const cols = Math.min(this.pillarCols(), cards.length || 1);
    const out: (typeof cards)[] = Array.from({ length: cols }, () => []);
    cards.forEach((c, i) => out[i % cols].push(c));
    return out;
  });

  // ---- side nav collapse (icon rail) ----
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
  /**
   * Schools that did / did not mark attendance on the latest working day, by
   * category. Real: each AttendanceSchool carries dailyAtt[] with -1 on a day
   * it did not mark, so the last entry is that school's status for the day.
   */
  private readonly attPageMarkingByCategory = computed(() => {
    const schools = this.at.scopeSchools();
    if (!schools.length) return [];
    const order = ['Primary School', 'Middle School', 'High School', 'Higher Secondary School'];
    const short: Record<string, string> = { 'Primary School': 'Primary', 'Middle School': 'Middle', 'High School': 'High', 'Higher Secondary School': 'Hr. Sec' };
    const m = new Map<string, { marked: number; unmarked: number }>();
    for (const s of schools) {
      const d = s.dailyAtt;
      const last = d?.length ? d[d.length - 1] : -1;
      const k = s.ctype || 'Other';
      const e = m.get(k) ?? { marked: 0, unmarked: 0 };
      if (last >= 0) e.marked++; else e.unmarked++;
      m.set(k, e);
    }
    const keys = [...order.filter((k) => m.has(k)), ...[...m.keys()].filter((k) => !order.includes(k))];
    return keys.map((k) => ({ name: short[k] ?? k, ...m.get(k)! }));
  });
  /**
   * Students present on the latest working day, by management. The attendance
   * data covers Government and Aided (fully / partially) schools only, and each
   * school's dailyAtt[] holds its own attendance % for the day, so present =
   * enrolled x that day's % summed per management. Schools not marked that day
   * contribute nothing.
   */
  private readonly attPagePresentByMgmt = computed(() => {
    const schools = this.at.scopeSchools();
    const m = new Map<string, number>();
    for (const s of schools) {
      const d = s.dailyAtt;
      const last = d?.length ? d[d.length - 1] : -1;
      if (last < 0) continue;
      const k = s.stype === 'Government' ? 'Govt' : /aided/i.test(s.stype) ? 'Aided' : 'Other';
      m.set(k, (m.get(k) ?? 0) + Math.round((s.enrolled * last) / 100));
    }
    return ['Govt', 'Aided', 'Other'].filter((k) => (m.get(k) ?? 0) > 0).map((k) => [k, m.get(k)!] as [string, number]);
  });
  /**
   * Headline tiles for the latest working day in scope, in the Overview card
   * shape (label, big figure, sub line, split bars). Student attendance splits
   * present students Govt / Aided (the managements the attendance data covers);
   * the two school tiles split by school category.
   */
  readonly attPageCards = computed(() => {
    const day = this.attPageToday();
    if (!day) return null;
    const students = this.attPageShow() === 'students';
    const present = students ? day.present : day.tPresent;
    const expected = students ? day.expected : day.tExpected;
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const presentPct = pct(present, expected);
    const markedPct = pct(day.marked, day.schools);
    const COLORS = ['#6EE7B7', '#FDE68A', '#BAE6FD', '#E9D5FF'];
    const split = (parts: [string, number][], asPct = false) => {
      const tot = parts.reduce((s, [, v]) => s + v, 0) || 1;
      return { segs: parts.map(([k, v], i) => {
        const share = Math.round((v / tot) * 1000) / 10;
        return { k, n: v, v: asPct ? `${share}%` : inr(v), color: COLORS[i % COLORS.length], pct: share };
      }) };
    };
    const mgmt = this.attPagePresentByMgmt();
    const cat = this.attPageMarkingByCategory();
    const byCat = (f: 'marked' | 'unmarked') => cat.filter((c) => c[f] > 0).map((c) => [c.name, c[f]] as [string, number]);
    const who = students ? 'Student' : 'Teacher';
    return {
      date: day.date,
      cards: [
        {
          label: `${who} Attendance`, icon: 'fa-solid fa-user-check',
          big: presentPct != null ? `${presentPct}%` : 'N/A',
          sub: 'Govt / Aided schools',
          splits: students && mgmt.length ? [split(mgmt)] : [],
        },
        {
          label: 'Schools Marked Attendance', icon: 'fa-solid fa-house-circle-check',
          big: markedPct != null ? `${markedPct}%` : 'N/A',
          sub: 'All categories',
          splits: cat.length ? [split(byCat('marked'))] : [],
        },
        {
          label: 'Schools Not Marked Attendance', icon: 'fa-solid fa-triangle-exclamation',
          big: inr(day.unmarked),
          sub: 'All categories',
          splits: cat.length ? [split(byCat('unmarked'))] : [],
        },
      ],
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
  /**
   * Bar colour for an Attendance-page percentage: the catalog band of the KPI
   * the number stands for (student attendance 'a_s', teacher attendance 'a_t',
   * or marking via 'schools not marked' 'a_nm' on the complement), so the
   * charts read in the same three colours as the Overview pillar bars.
   */
  private attPageColor(v: number | null): string {
    if (v == null) return '#CBD5E1';
    const marking = this.attPageMetric() === 'marking';
    const id = marking ? 'a_nm' : this.attPageShow() === 'students' ? 'a_s' : 'a_t';
    const def = KPI_MODULES.find((m) => m.title === 'Attendance')?.kpis.find((k) => k.id === id);
    return def ? this.glanceColor(this.kv.band(def, marking ? 100 - v : v)) : this.glanceColor('none');
  }
  /** Shared axis/grid/typography for the Attendance charts: Inter, muted 11px axes, hairline grid. */
  private attPageAxes(xData: string[], extraX: Record<string, unknown> = {}) {
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
      xAxis: { type: 'category', data: xData, axisLabel: { fontSize: 11, color: '#64748B', interval: 0, lineHeight: 14, ...extraX }, axisLine: { lineStyle: { color: '#CBD5E1' } }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 11, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } } },
    };
  }
  readonly glanceAttPageCategoryOpt = computed(() => {
    const rows = this.attPageCategoryRows();
    const state = this.attPageHeadline();
    if (!rows.length) return {};
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const scope = this.ds.titleCase(this.ds.scopeLabel());
    // the scope-average line is labelled outside the plot, on the right, so it
    // never collides with the value label on the last bar
    const avgLine = state == null ? undefined : {
      silent: true, symbol: 'none', lineStyle: { color: '#334155', type: 'dashed' },
      label: { formatter: `${scope}\n${state}%`, fontSize: 11, lineHeight: 14, color: '#334155', position: 'end', align: 'left', padding: [0, 0, 0, 6] },
      data: [{ yAxis: state }],
    };
    const base = { ...this.attPageAxes(rows.map((r) => r.name)), grid: { left: 40, right: 84, top: 16, bottom: 40 } };
    if (this.attPageMetric() === 'marking') {
      // stacked: schools that marked attendance vs schools that did not, per category
      const GREEN = '#10B981', RED = '#E11D48';
      return {
        ...base,
        legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#334155' } },
        grid: { ...base.grid, bottom: 56 },
        tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.name}</b><br/>${ps.map((p) => `${p.marker} ${p.seriesName} ${p.value}%`).join('<br/>')}<br/>${inr(r.schools)} schools`; } },
        series: [
          { name: 'Marked attendance', type: 'bar', stack: 'm', barCategoryGap: '36%', barMaxWidth: 70,
            data: rows.map((r) => r1(r.v as number)), itemStyle: { color: GREEN },
            label: { show: true, position: 'inside', fontSize: 11, fontWeight: 600, color: '#fff', formatter: (p: any) => `${p.value}%` },
            markLine: avgLine },
          { name: 'Not marked attendance', type: 'bar', stack: 'm', barCategoryGap: '36%', barMaxWidth: 70,
            data: rows.map((r) => r1(100 - (r.v as number))), itemStyle: { color: RED, borderRadius: [4, 4, 0, 0] },
            label: { show: true, position: 'inside', fontSize: 11, fontWeight: 600, color: '#fff', formatter: (p: any) => (p.value >= 6 ? `${p.value}%` : '') } },
        ],
      };
    }
    return {
      ...base,
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.name}</b><br/>${ps[0].value}%<br/>${inrShort(r.enrolled)} enrolled · ${inr(r.schools)} schools`; } },
      series: [{
        type: 'bar', data: rows.map((r) => ({ value: r.v, itemStyle: { color: this.attPageColor(r.v), borderRadius: [4, 4, 0, 0] } })), barCategoryGap: '36%', barMaxWidth: 70,
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` },
        markLine: avgLine,
      }],
    };
  });
  /**
   * Chart 1 under Marking status: schools that marked attendance on the latest
   * working day vs schools that did not (real, from the day record). Replaces
   * the gender split, which has no measured marking data behind it.
   */
  readonly attPageSchoolRows = computed(() => {
    const day = this.attPageToday();
    if (!day?.schools) return [];
    const marked = Math.round((day.marked / day.schools) * 1000) / 10;
    return [
      { name: 'Marked attendance', v: marked, n: day.marked as number },
      { name: 'Not marked attendance', v: Math.round((100 - marked) * 10) / 10, n: day.unmarked as number },
    ];
  });
  readonly glanceAttPageSchoolsOpt = computed(() => {
    const rows = this.attPageSchoolRows();
    if (!rows.length) return {};
    const GREEN = '#10B981', RED = '#E11D48';
    return {
      ...this.attPageAxes(rows.map((r) => `${r.name}\n${inr(r.n)} schools`)),
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.name}</b><br/>${ps[0].value}% · ${inr(r.n)} schools`; } },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      series: [{
        type: 'bar', barCategoryGap: '45%', barMaxWidth: 70,
        data: rows.map((r, i) => ({ value: r.v, itemStyle: { color: i === 0 ? GREEN : RED, borderRadius: [4, 4, 0, 0] } })),
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` },
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
      ...this.attPageAxes(rows.map((r) => `${r.name}\n${inrShort(r.enrolled)}`)),
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${r.name}</b><br/>${ps[0].value}% (scope-wide figure)<br/>${inrShort(r.enrolled)} enrolled (real)`; } },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      series: [{
        type: 'bar', data: rows.map((r) => ({ value: r.v, itemStyle: { color: this.attPageColor(r.v), borderRadius: [4, 4, 0, 0] } })), barCategoryGap: '45%', barMaxWidth: 70,
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
    // every bar carries its own RAG band, so "my position" vs "best" reads as status, not as a palette
    const bars = [
      { label: `My position\n(${this.ds.titleCase(this.ds.scopeLabel())})`, v: mine },
      { label: `${this.attPageUnitLabel()} average\n(mean of ${rows.length})`, v: mean },
      { label: `Best ${this.attPageUnitLabel().toLowerCase().replace(/s$/, '')}\n(${best.name})`, v: best.v as number },
    ];
    return {
      ...this.attPageAxes(bars.map((b) => b.label)),
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      grid: { left: 40, right: 12, top: 16, bottom: 40 },
      series: [{ type: 'bar', data: bars.map((b) => ({ value: b.v, itemStyle: { color: this.attPageColor(b.v), borderRadius: [4, 4, 0, 0] } })), barCategoryGap: '40%', barMaxWidth: 70,
        label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0F172A', formatter: (p: any) => `${p.value}%` } }],
    };
  });
  /** "How much have I improved?" — 14 working days / weeks / months, built from the real daily series. */
  /**
   * Attendance trend range: Days (last 12 working days), Months (last 3 / 6 / 9
   * calendar months as monthly averages of the daily %), Years (one chosen
   * year, Jan-Dec monthly averages). Months with no records in the data are
   * left empty, never filled in, and the caption says what the data covers.
   */
  readonly attPageRange = signal<'days' | 'months' | 'years'>('days');
  readonly attPageMonths = signal<number>(3);
  readonly ATT_MONTH_OPTIONS = [3, 6, 9];
  private readonly attPageYear = signal<number | null>(null);
  setAttPageYear(y: number): void { this.attPageYear.set(y); }
  /** Years that actually have daily records at this scope, latest first. */
  readonly attPageYears = computed(() => {
    const daily: any[] = (this.at.current() as any)?.daily ?? [];
    return [...new Set(daily.map((d) => +d.date.slice(0, 4)))].sort((a, b) => b - a);
  });
  readonly attPageYearSel = computed(() => {
    const ys = this.attPageYears();
    const y = this.attPageYear();
    return y != null && ys.includes(y) ? y : ys[0] ?? null;
  });
  /** First and last recorded working day, for the caption. */
  readonly attPageCoverage = computed(() => {
    const daily: any[] = (this.at.current() as any)?.daily ?? [];
    if (!daily.length) return null;
    const f = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { from: f(daily[0].date), to: f(daily[daily.length - 1].date), days: daily.length };
  });
  readonly attPageTrend = computed(() => {
    const n = this.at.current() as any;
    if (!n?.daily?.length) return [];
    const field = this.attPageMetric() === 'marking' ? 'compliance' : (this.attPageShow() === 'students' ? 'attendance' : 'teacher');
    const daily: any[] = n.daily;
    const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    if (this.attPageRange() === 'days') {
      return daily.slice(-12).map((d) => ({ label: dayLabel(d.date), v: d[field] as number, n: 1 }));
    }
    // monthly averages of the daily %, keyed YYYY-MM
    const byMonth = new Map<string, number[]>();
    for (const d of daily) {
      const k = d.date.slice(0, 7);
      (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(d[field] as number);
    }
    const avg = (vs: number[] | undefined) => (vs?.length ? Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10 : null);
    const label = (ym: string, withYear: boolean) =>
      new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', withYear ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' });
    let keys: string[];
    if (this.attPageRange() === 'months') {
      // the last N calendar months ending at the latest recorded month
      const last = daily[daily.length - 1].date.slice(0, 7);
      const [y, m] = last.split('-').map(Number);
      keys = Array.from({ length: this.attPageMonths() }, (_, i) => {
        const d = new Date(Date.UTC(y, m - 1 - (this.attPageMonths() - 1 - i), 1));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      });
      return keys.map((k) => ({ label: label(k, true), v: avg(byMonth.get(k)), n: byMonth.get(k)?.length ?? 0 }));
    }
    const year = this.attPageYearSel();
    if (year == null) return [];
    keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    return keys.map((k) => ({ label: label(k, false), v: avg(byMonth.get(k)), n: byMonth.get(k)?.length ?? 0 }));
  });
  /** Caption under the trend heading. */
  readonly attPageTrendCaption = computed(() => {
    const who = `${this.attPageShowLabel()} ${this.attPageMetricLabel().toLowerCase()}`;
    const cov = this.attPageCoverage();
    const covTxt = cov ? ` · records cover ${cov.from} – ${cov.to} (${cov.days} working days)` : '';
    switch (this.attPageRange()) {
      case 'days': return `${who} · last 12 working days, daily`;
      case 'months': return `${who} · monthly average of daily %, last ${this.attPageMonths()} months${covTxt}`;
      default: return `${who} · monthly average of daily %, ${this.attPageYearSel() ?? ''}${covTxt}`;
    }
  });
  readonly glanceAttPageTrendOpt = computed(() => {
    const rows = this.attPageTrend();
    if (!rows.length) return {};
    return {
      ...this.attPageAxes(rows.map((r) => r.label), { rotate: rows.length > 10 ? 30 : 0 }),
      // trend keeps a scaled axis so day-to-day movement stays visible
      yAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#64748B', formatter: '{value}%' }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#EEF2F8' } }, scale: true },
      tooltip: { trigger: 'axis', formatter: (ps: any[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return r.v == null ? `<b>${r.label}</b><br/>No records` : `<b>${r.label}</b><br/>${r.v}%${r.n > 1 ? `<br/>average of ${r.n} working days` : ''}`; } },
      grid: { left: 44, right: 12, top: 16, bottom: 30 },
      series: [{ type: 'bar', data: rows.map((r) => ({ value: r.v, itemStyle: { color: this.attPageColor(r.v), borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 48,
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600, color: '#0F172A', formatter: (p: any) => (p.value == null ? '' : `${p.value}%`) } }],
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
    return { critical: rows.filter((r) => r.band === 'bad').slice(0, 5).map(item) };
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
}
