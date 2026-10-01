import {
  Component,
  OnInit,
  NgZone,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { ECharts } from 'echarts/core';

import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { CautionCheck } from './models/caution.model';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { ChartService } from './services/chart.service';
import { AcademicService } from './services/academic.service';
import { AttendanceService } from './services/attendance.service';
import { InfraService } from './services/infra.service';
import { Class1MonitorService } from './services/class1-monitor.service';
import { ReviewService, DrillRow } from './services/review.service';
import { KPI_MODULES, KpiDef } from './models/kpi-catalog.model';
import { ExportColumn, ExportService } from './services/export.service';
import { DONUT_DIMENSIONS, DonutDimension, MAP_METRICS, MapMetric } from './models/enrollment.model';
import { ACADEMIC_METRICS, AcademicMetric } from './models/academic.model';
import { ATTENDANCE_METRICS, AttendanceMetric } from './models/attendance.model';
import { INFRA_METRICS, InfraMetric } from './models/infra.model';
import { ReviewProgram } from './models/schemes.model';
import { THEMES, THEME_STORAGE_KEY, Theme } from './models/theme';
import { inr, inrShort } from './utils/format';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    NgxEchartsDirective,
    TableModule,
    SelectModule,
    MultiSelectModule,
    ButtonModule,
    TagModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly ds = inject(DataService);
  readonly ac = inject(AcademicService);
  readonly at = inject(AttendanceService);
  readonly inf = inject(InfraService);
  readonly c1 = inject(Class1MonitorService);
  readonly rv = inject(ReviewService);
  readonly auth = inject(AuthService);
  private readonly ex = inject(ExportService);
  private readonly cs = inject(ChartService);
  private readonly http = inject(HttpClient);

  // ================= SIGN IN =================
  loginUser = signal('');
  loginPass = signal('');
  showPass = signal(false);

  togglePass(): void { this.showPass.update((v) => !v); }

  async submitLogin(): Promise<void> {
    const ok = await this.auth.signIn(this.loginUser(), this.loginPass());
    if (ok) {
      this.loginPass.set('');
      // data loading is kicked off by the services on construction, so there's
      // nothing to trigger here beyond clearing the form
    }
  }

  signOut(): void {
    this.auth.signOut();
    this.loginUser.set('');
    this.loginPass.set('');
  }

  private readonly MAP_NAME = 'tamilnadu';
  mapRegistered = signal(false);
  /** Map panel visibility — collapsible to give charts the full width. */
  /**
   * Map visibility is tracked per page (tab + sub-view) rather than globally,
   * so closing it on one page doesn't close it everywhere. Pages default to
   * open and are only recorded here once the user toggles them.
   */
  private readonly mapState = signal<Record<string, boolean>>({});
  /** Identifies the current page for map state purposes. */
  private readonly mapKey = computed(() => `${this.activeTab()}|${this.activeSub()}`);
  readonly mapOpen = computed(() => this.mapState()[this.mapKey()] ?? true);
  /** Only the School Dashboard Numbers page renders a map. */
  readonly hasMap = computed(() => this.isSchoolTab() && this.activeSub() === 'numbers');
  /** Map zoom level, driven by the +/- / reset controls. */
  mapZoom = signal(1);
  /** Filter panel visibility. */
  filterOpen = signal(false);
  /** Theme settings panel visibility. */
  themeOpen = signal(false);
  readonly themes = THEMES;
  activeTheme = signal<Theme>(THEMES[0]);
  exporting = signal(false);

  readonly metricOptions = MAP_METRICS;
  readonly donutOptions = DONUT_DIMENSIONS;
  /**
   * Top menu. Entries with a `url` are external systems and open in a new tab
   * rather than switching the in-app view.
   */
  readonly tabs: { label: string; url?: string }[] = [
    { label: 'Review Dashboard' },
    { label: 'School Dashboard' },
    { label: 'Infrastructure' },
    { label: 'Academic Scores' },
    { label: 'Attendance' },
    { label: 'Class 1 Enrolment Monitor' },
    {
      label: 'SLAS',
      url: 'https://slas.tnschools.gov.in/#/allcomponent/2U2FsdGVkX1+UNXltyNSvAi4f2M/ksGO1/oIJj5mOdv4=',
    },
    {
      label: 'SMC',
      url: 'https://smc.tnschools.gov.in/#/allcomponent/2U2FsdGVkX1+UNXltyNSvAi4f2M/ksGO1/oIJj5mOdv4=',
    },
  ];
  activeTab = signal('School Dashboard');
  comboMetric = signal<'students' | 'schools'>('students');

  /** Sub-menu shared by the dashboards. */
  private readonly ALL_SUB_MENUS = [
    { id: 'cards', label: 'District Review', icon: 'fa-solid fa-layer-group' },
    { id: 'numbers', label: 'Numbers', icon: 'fa-solid fa-calculator' },
    { id: 'trend', label: 'Trend Analysis', icon: 'fa-solid fa-chart-line' },
    { id: 'comparison', label: 'Comparison', icon: 'fa-solid fa-code-compare' },
    { id: 'alarming', label: 'Alarming', icon: 'fa-solid fa-triangle-exclamation' },
    { id: 'caution', label: 'Caution', icon: 'fa-solid fa-circle-exclamation' },
  ];

  /**
   * Infrastructure is a monthly snapshot rather than a running series, so it
   * has no Trend view — the monthly data-entry compliance chart lives in
   * Numbers instead. Every dashboard has a Caution view.
   *
   * The Review Dashboard is an executive summary, so it keeps only Numbers
   * (the KPI + chart overview) and Caution (the alarming/critical items).
   */
  readonly subMenus = computed(() => {
    if (this.activeTab() === 'Review Dashboard') {
      return this.ALL_SUB_MENUS.filter((s) => s.id === 'cards');
    }
    return this.activeTab() === 'Infrastructure'
      ? this.ALL_SUB_MENUS.filter((s) => s.id !== 'trend')
      : this.ALL_SUB_MENUS;
  });
  activeSub = signal<'cards' | 'numbers' | 'trend' | 'comparison' | 'alarming' | 'caution'>('numbers');

  readonly isAcademic = computed(() => this.activeTab() === 'Academic Scores');
  readonly isAttendance = computed(() => this.activeTab() === 'Attendance');
  readonly isInfra = computed(() => this.activeTab() === 'Infrastructure');
  readonly isSchoolTab = computed(() => this.activeTab() === 'School Dashboard');
  readonly isClass1 = computed(() => this.activeTab() === 'Class 1 Enrolment Monitor');
  readonly isReview = computed(() => this.activeTab() === 'Review Dashboard');
  readonly infraMetrics = INFRA_METRICS;

  /** Alert-category filter, so the Alarming tables can be split into tabs. */
  alertKind = signal<string>('');
  setAlertKind(k: string): void { this.alertKind.set(k); }

  /** Category tabs for whichever Alarming view is active. */
  readonly alertKinds = computed(() => {
    if (this.isAcademic()) return this.ac.alertSummary().byKind;
    if (this.isAttendance()) return this.at.alertSummary().byKind;
    if (this.isInfra()) return this.inf.alertSummary().byKind;
    return this.ds.alertSummary().byKind;
  });

  /** Alerts filtered to the selected category. */
  readonly filteredAlerts = computed(() => {
    const k = this.alertKind();
    const all = this.isAcademic() ? this.ac.alerts()
      : this.isAttendance() ? this.at.alerts()
      : this.isInfra() ? this.inf.alerts()
      : this.ds.alerts();
    return k ? all.filter((a: any) => a.kind === k) : all;
  });

  /** Alert total for whichever dashboard is active, shown beside "Alarming". */
  readonly activeAlertCount = computed(() => {
    if (this.isAcademic()) return this.ac.loaded() ? this.ac.alertSummary().total : 0;
    if (this.isAttendance()) return this.at.loaded() ? this.at.alertSummary().total : 0;
    if (this.isInfra()) return this.inf.loaded() ? this.inf.alertSummary().total : 0;
    return this.ds.loaded() ? this.ds.alertSummary().total : 0;
  });
  readonly academicMetrics = ACADEMIC_METRICS;
  readonly attendanceMetrics = ATTENDANCE_METRICS;

  /** Indicator shown in the Comparison view. */
  readonly compareMetrics = [
    { value: 'students', label: 'Total Students' },
    { value: 'schools', label: 'Total Schools' },
    { value: 'teaching', label: 'Teachers' },
    { value: 'gpi', label: 'Gender Parity Index' },
    { value: 'ptr', label: 'Pupil-Teacher Ratio' },
    { value: 'avgPerSchool', label: 'Avg Students / School' },
    { value: 'girlsPct', label: 'Girls Share %' },
  ];
  compareMetric = signal('students');

  readonly today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  private districtComboNames: string[] = [];

  // ---- chart instance registry (for downloads) ----
  private charts = new Map<string, ECharts>();
  /** Pending download request: which chart and what heading to name the file after. */
  downloadTarget = signal<{ id: string; title: string } | null>(null);
  downloading = signal(false);

  constructor() {
    // Chart toolbox download icons route here.
    this.cs.setDownloadHandler((id, title) => {
      this.zone.run(() => this.downloadTarget.set({ id, title }));
    });

    // The KPI filter is a district-page feature; reset it whenever the user
    // leaves the district level so the state landing always shows all KPIs.
    effect(() => {
      if (this.ds.level() !== 'district' && this.kpiFilter().length) {
        this.kpiFilter.set([]);
      }
    });
  }

  private readonly zone = inject(NgZone);

  registerChart(id: string, ec: ECharts): void {
    this.charts.set(id, ec);
  }

  closeDownload(): void { this.downloadTarget.set(null); }

  /** Turn a chart heading into a safe file name. */
  private slug(title: string): string {
    return (title || 'chart')
      .replace(/[—–]/g, '-')
      .replace(/[^\w\s()-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120);
  }

  /** Export the pending chart as png | jpg | pdf, named after its heading. */
  async download(format: 'png' | 'jpg' | 'pdf'): Promise<void> {
    const target = this.downloadTarget();
    if (!target) return;
    const chart = this.charts.get(target.id);
    if (!chart) { this.closeDownload(); return; }
    this.downloading.set(true);
    try {
      const name = this.slug(target.title);
      const type = format === 'jpg' ? 'jpeg' : 'png';
      const dataUrl = chart.getDataURL({
        type: type as any,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      if (format === 'pdf') {
        const { default: jsPDF } = await import('jspdf');
        // Size the page to the chart so nothing is cropped
        const w = chart.getWidth();
        const h = chart.getHeight();
        const landscape = w >= h;
        const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        pdf.setFontSize(12);
        pdf.setTextColor(27, 58, 122);
        pdf.text(target.title, 10, 12, { maxWidth: pageW - 20 });
        pdf.setFontSize(9);
        pdf.setTextColor(90);
        pdf.text(`Scope: ${this.ds.scopeLabel()}  |  Year: ${this.ds.data()?.currentYear ?? ''}`, 10, 18);
        const maxW = pageW - 20;
        const maxH = pageH - 30;
        let imgW = maxW;
        let imgH = (h / w) * imgW;
        if (imgH > maxH) { imgH = maxH; imgW = (w / h) * imgH; }
        pdf.addImage(dataUrl, 'PNG', (pageW - imgW) / 2, 24, imgW, imgH);
        pdf.save(`${name}.pdf`);
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${name}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      this.downloading.set(false);
      this.closeDownload();
    }
  }

  // ---- KPI stats ----
  readonly stats = computed(() => {
    const n = this.ds.current();
    if (!n) return [];
    return [
      { label: 'Total Schools', value: n.schools, icon: 'fa-solid fa-school' },
      { label: 'Total Students', value: n.students, icon: 'fa-solid fa-user-graduate' },
      { label: 'Boys', value: n.boys, icon: 'fa-solid fa-person' },
      { label: 'Girls', value: n.girls, icon: 'fa-solid fa-person-dress' },
      { label: 'Teachers', value: n.teaching, icon: 'fa-solid fa-chalkboard-user' },
    ];
  });

  readonly ratios = computed(() => {
    const n = this.ds.current();
    if (!n || n.students === 0) return [];
    const gpi = n.boys ? n.girls / n.boys : 0;
    const ptr = n.teaching ? n.students / n.teaching : 0;
    const girlsPct = (n.girls / (n.boys + n.girls)) * 100;
    return [
      { label: 'Gender Parity Index', value: gpi.toFixed(2) },
      { label: 'Pupil-Teacher Ratio', value: ptr.toFixed(1) + ' : 1' },
      { label: 'Girls Share', value: girlsPct.toFixed(1) + '%' },
      { label: 'Avg Students / School', value: n.schools ? inr(Math.round(n.students / n.schools)) : '0' },
    ];
  });

  // ---- chart headings (also used as download file names) ----
  readonly primaryDonutTitle = computed(() => {
    const f = this.donutOptions.find((d) => d.value === this.ds.donutDimension());
    return (f ? f.label : 'Management-Wise') + ' — ' + this.ds.titleCase(this.ds.scopeLabel());
  });
  readonly mapTitle = computed(() => this.ds.metricLabel() + ' by District — Tamil Nadu');
  readonly genderTitle = computed(() => 'Gender Split — ' + this.ds.titleCase(this.ds.scopeLabel()));
  readonly casteTitle = computed(() => 'Social Category — ' + this.ds.titleCase(this.ds.scopeLabel()));
  readonly gradeTitle = computed(() => 'Enrolment by Grade — ' + this.ds.titleCase(this.ds.scopeLabel()));
  readonly comboTitle = computed(() =>
    'District-wise ' + (this.comboMetric() === 'students' ? 'Students' : 'Schools') + ' — Tamil Nadu',
  );
  readonly trendTitle = computed(() => 'Enrolment Trend — ' + this.ds.titleCase(this.ds.scopeLabel()));
  readonly genderTrendTitle = computed(() => 'Boys vs Girls Trend — ' + this.ds.titleCase(this.ds.scopeLabel()));

  // ---- charts ----
  readonly primaryDonutOpt = computed(() => {
    const n = this.ds.current();
    return n ? this.cs.donutByDimension(n, this.ds.donutDimension(), { id: 'primaryDonut', title: this.primaryDonutTitle() }) : {};
  });
  readonly genderOpt = computed(() => {
    const n = this.ds.current();
    return n ? this.cs.genderDonut(n, { id: 'gender', title: this.genderTitle() }) : {};
  });
  readonly casteOpt = computed(() => {
    const n = this.ds.current();
    return n ? this.cs.casteDonut(n, { id: 'caste', title: this.casteTitle() }) : {};
  });
  readonly gradeOpt = computed(() => {
    const n = this.ds.current();
    return n ? this.cs.gradeBar(n, { id: 'grade', title: this.gradeTitle() }) : {};
  });

  readonly comboOpt = computed(() => {
    const opt = this.cs.districtCombo(this.ds.districts(), this.comboMetric(), { id: 'combo', title: this.comboTitle() });
    this.districtComboNames = opt._names ?? [];
    return opt;
  });

  readonly trendOpt = computed(() => {
    const t = this.ds.scopeTrend();
    return this.cs.trendLine(t.years, t.students, 'Students', { id: 'trend', title: this.trendTitle() });
  });
  readonly genderTrendOpt = computed(() => {
    const t = this.ds.scopeTrend();
    return this.cs.genderTrend(t.years, t.boys, t.girls, { id: 'genderTrend', title: this.genderTrendTitle() });
  });

  // ---- transition rate & GER ----
  /** Transition Rate is a state-level cohort measure. */
  readonly showTransition = computed(() => this.isSchoolTab() && this.ds.hasGradeYear());
  readonly transitionTitle = computed(() => `Transition Rate — ${this.ds.source()} (${this.ds.titleCase(this.ds.scopeLabel())})`);
  readonly transitionOpt = computed(() => {
    const t = this.ds.transitionRate();
    return this.cs.transitionTrend(t.years, t.stages, { id: 'transition', title: this.transitionTitle() });
  });

  /** GER shows real values for UDISE+, and a "needs API" badge for EMIS. */
  readonly gerReady = computed(() => this.ds.hasPopulation());
  readonly gerNeedsApi = computed(() => this.ds.gerNeedsApi());
  readonly gerTitle = computed(() => `Gross Enrolment Ratio — ${this.ds.source()}`);
  readonly gerOpt = computed(() => {
    const g = this.ds.gerByLevel();
    return this.cs.gerTrend(g.years, g.series, { id: 'ger', title: this.gerTitle() });
  });

  // ================= REVIEW DASHBOARD =================
  /** Programme filter shared by every review KPI (All / Model / Vetri / SPARKS / PAL). */
  setReviewProgram(p: ReviewProgram): void { this.rv.setProgram(p); }

  // ---- Review KPI tile grid (landing view) ----

  /** KPI multi-select filter: selected "topic:id" keys (empty = show all). */
  kpiFilter = signal<string[]>([]);
  setKpiFilter(ids: string[]): void { this.kpiFilter.set(ids ?? []); }

  /** Options for the KPI multi-select, label = "Module · KPI". */
  readonly kpiFilterOptions = computed(() =>
    KPI_MODULES.flatMap((m) =>
      m.kpis.map((k) => ({ label: `${m.title} · ${k.label}`, value: `${k.topic}:${k.id}` })),
    ),
  );

  /**
   * Aggregate the current drill scope into a single value map by combining the
   * child rows (drillRows). Percentages are student-weighted; counts are summed.
   * This gives a scope-level value for every KPI field at State/District/Block.
   */
  private readonly scopeValues = computed<Record<string, number | null>>(() => {
    const rows = this.rv.drillRows();
    if (!rows.length) return {};
    const totalStudents = rows.reduce((s, r) => s + (r.n || 0), 0) || 1;
    const out: Record<string, number | null> = {};
    // percentage fields are weighted by students; everything else is summed
    const PCT = new Set(['att', 'teacherAtt', 'compliance', 'academicAvg', 'academicChange',
      'sch', 'tnSparkPct', 'breakfastPct', 'h14417ResPct', 'scholarEligibilityPct',
      'smcClosureRate', 'palliCompletionPct', 'chg', 'girlsPct', 'dropRate', 'thiranSharePct',
      // real-data percentages
      'acaLanguageAvg', 'acaEnglishAvg', 'acaMathsAvg', 'acaScienceAvg', 'acaSocialAvg',
      'acaCompletionPct', 'thiranBaselinePct', 'thiranBloPct', 'ictFunctionalPct',
      'ictInternetPct', 'infGapPct', 'scholarPaySuccessPct', 'cwsnPct', 'slasPct']);
    const keys: (keyof DrillRow)[] = ['ns', 'n', 'teaching', 'att', 'teacherAtt', 'compliance',
      'drop', 'tl', 'gaps', 'academicAvg', 'academicChange', 'sch', 'cases', 'tnSparkPct',
      'breakfastPct', 'cmOpen', 'h14417Open', 'h14417Critical', 'h14417ResPct', 'girlsPct',
      'dropRate', 'thiranStudents', 'thiranSchools', 'scholarEligibilityPct', 'scholarAadhaar',
      'scholarPayPending', 'smcRaised', 'smcClosed', 'smcPending', 'smcClosureRate',
      'palliTarget', 'palliVisited', 'palliNotVisited', 'palliCompletionPct',
      // ---- real-data counts ----
      'palliObservations', 'palliOfficials', 'palliBrte', 'palliBeo',
      'thiranAttainBLO', 'thiranNotTagged',
      'ictSchools', 'ictInternet', 'ictNoInternet', 'ictFunctional', 'ictNotFunctional',
      'smcEmergency', 'smcEmergencyOpen',
      'infNoToilet', 'infNoWater', 'infNoCwsnToilet', 'infNoKitchen', 'infDemolish', 'infRepair',
      'infNoPlayground', 'infNoFirstAid', 'infNoFire', 'infNoRamp', 'infClassShortage',
      // ---- percentages (also listed in PCT above) ----
      'acaLanguageAvg', 'acaEnglishAvg', 'acaMathsAvg', 'acaScienceAvg', 'acaSocialAvg',
      'acaCompletionPct', 'thiranBaselinePct', 'thiranBloPct', 'ictFunctionalPct',
      'ictInternetPct', 'infGapPct', 'scholarPaySuccessPct', 'cwsnPct', 'slasPct',
      // ---- synthetic counts still referenced by catalog KPIs ----
      'declSchools', 'attPending', 'breakfastExcept', 'cmCritical',
      'scholarPayFailed', 'scholarNpciInactive', 'acaUp', 'acaDown'];
    for (const k of keys) {
      const kk = k as string;
      if (PCT.has(kk)) {
        out[kk] = Math.round((rows.reduce((s, r) => s + ((r[k] as number) || 0) * (r.n || 0), 0) / totalStudents) * 10) / 10;
      } else {
        out[kk] = rows.reduce((s, r) => s + ((r[k] as number) || 0), 0);
      }
    }
    return out;
  });

  /** RAG band for a KPI at a given value, using its catalog range/direction. */
  private kpiBand(def: KpiDef, v: number | null): 'good' | 'warn' | 'bad' | 'none' {
    if (v == null || def.dir === 0) return 'none';
    if (def.fmt === 'pct' && def.lo != null && def.hi != null) {
      let s = (v - def.lo) / (def.hi - def.lo || 1);
      if (def.dir < 0) s = 1 - s;
      s = Math.max(0, Math.min(1, s));
      return s > 0.66 ? 'good' : s > 0.33 ? 'warn' : 'bad';
    }
    // counts / flags: neutral unless direction known — leave as none (no fabricated cutoff)
    return 'none';
  }

  /** Format a KPI value for display; null -> "–". */
  private kpiFormat(def: KpiDef, v: number | null): string {
    if (v == null || isNaN(v as number)) return '–';
    if (def.fmt === 'pct') return `${def.dir < 0 && v > 0 ? '+' : ''}${(v as number).toFixed(1)}%`;
    return Math.round(v as number).toLocaleString('en-IN');
  }

  /**
   * The 12-module tile grid at the current scope. Every KPI resolves its value
   * from scopeValues via its catalog `field`; unmapped KPIs (field === null)
   * render as "–". Ported from the state_review_dashboard.html artifact.
   */
  readonly kpiTiles = computed(() => {
    const vals = this.scopeValues();
    const filter = this.kpiFilter();
    const active = new Set(filter);
    return KPI_MODULES.map((mod) => ({
      title: mod.title,
      color: mod.color,
      // topic of the module = topic of its first KPI (drives "View details")
      topic: mod.kpis[0]?.topic ?? 'enr',
      kpis: mod.kpis
        .filter((def) => active.size === 0 || active.has(`${def.topic}:${def.id}`))
        .map((def) => {
          const raw = def.field && def.field !== 'DERIVED' ? (vals[def.field] ?? null) : null;
          return {
            id: def.id,
            label: def.label,
            topic: def.topic,
            field: def.field,
            value: this.kpiFormat(def, raw),
            band: this.kpiBand(def, raw),
            hasData: raw != null,
          };
        }),
    })).filter((t) => t.kpis.length > 0);
  });

  /** Open a whole module's drill-down (topic level) via the View details button. */
  openModule(topic: string): void {
    this.selectedKpi.set(null);
    this.selectedDomain.set(topic);
    this.rv.setTopic(topic as any);
    setTimeout(() => {
      document.getElementById('rv-drilldown')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  // ---- per-KPI drill state ----
  /** Currently opened KPI (per-KPI drill); null shows the tile grid. */
  selectedKpi = signal<KpiDef | null>(null);
  selectedDomain = signal<string | null>(null);

  /** Open a KPI's drill-down inline on the same page (per-KPI + per-topic). */
  openKpi(kpiId: string, topic: string): void {
    const def = KPI_MODULES.flatMap((m) => m.kpis).find((k) => k.id === kpiId && k.topic === topic) ?? null;
    this.selectedKpi.set(def);
    this.selectedDomain.set(topic);
    this.rv.setTopic(topic as any);
    // if the KPI maps to a real field, sort the drill table by it
    if (def?.field && def.field !== 'DERIVED') this.rv.setSort(def.field);
    setTimeout(() => {
      document.getElementById('rv-drilldown')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  /** Close the inline drill-down and return to the tile grid. */
  closeDomain(): void {
    this.selectedKpi.set(null);
    this.selectedDomain.set(null);
    this.ds.goToState();
  }

  /** Header label for the open drill (KPI label, else module title). */
  readonly selectedDomainName = computed(() => {
    const kpi = this.selectedKpi();
    if (kpi) return kpi.label;
    const topic = this.selectedDomain();
    return KPI_MODULES.find((m) => m.kpis[0]?.topic === topic)?.title ?? '';
  });

  readonly reviewScope = computed(() => this.ds.titleCase(this.ds.scopeLabel()));

  readonly reviewTrendOpt = computed(() => {
    const t = this.rv.enrolmentTrend5y();
    return this.cs.trendLine(t.years, t.values, 'Students', {
      id: 'reviewTrend', title: `Enrolment Trend (last 5 years) — ${this.reviewScope()}`,
    });
  });
  readonly reviewGenderOpt = computed(() =>
    this.cs.reviewDonut('Gender', this.rv.genderSplit(), {
      id: 'reviewGender', title: `Gender Split — ${this.reviewScope()}`,
    }),
  );
  readonly reviewMgmtOpt = computed(() =>
    this.cs.reviewDonut('Management', this.rv.managementSplit(), {
      id: 'reviewMgmt', title: `Management-Wise Enrolment — ${this.reviewScope()}`,
    }),
  );
  readonly reviewAttUnitOpt = computed(() =>
    this.cs.reviewRankBar(
      this.rv.attendanceByUnit(), 'Attendance',
      { suffix: '%', baseline: this.rv.attendanceScopeAvg(), baselineLabel: 'Average', red: 88, amber: 91 },
      { id: 'reviewAttUnit', title: `Low Performing ${this.rv.drillUnitLabel()}s by Attendance — ${this.reviewScope()}` },
    ),
  );
  readonly reviewAttTypeOpt = computed(() =>
    this.cs.reviewRankBar(
      this.rv.attendanceBySchoolType(), 'Attendance',
      { suffix: '%', red: 88, amber: 91 },
      { id: 'reviewAttType', title: `Attendance by School Type — ${this.reviewScope()}` },
    ),
  );
  readonly reviewInfraOpt = computed(() =>
    this.cs.reviewRankBar(
      this.rv.infraGapRows(), 'Schools',
      {},
      { id: 'reviewInfra', title: `Critical Infrastructure Gaps — ${this.reviewScope()}` },
    ),
  );
  readonly reviewClassOpt = computed(() =>
    this.cs.reviewClassBar(
      this.rv.academicByClass(), this.rv.academicStateAvg(), this.rv.examPeriod(),
      { id: 'reviewClass', title: `Academic Score by Class (${this.rv.examPeriod()}) — ${this.reviewScope()}` },
    ),
  );
  readonly reviewSchemeOpt = computed(() =>
    this.cs.reviewRankBar(
      this.rv.schemeRings().map((s) => ({ name: s.label, value: s.value })), 'Coverage',
      { suffix: '%', red: 80, amber: 90 },
      { id: 'reviewScheme', title: `Scheme Coverage & Resolution — ${this.reviewScope()}` },
    ),
  );
  readonly reviewGrievOpt = computed(() => {
    const g = this.rv.grievanceStack();
    return this.cs.reviewStackBar(
      [
        { name: 'Resolved', value: g.resolved, color: '#3f9a54' },
        { name: 'Open', value: g.open, color: '#f5c243' },
        { name: 'Critical', value: g.critical, color: '#a8332c' },
      ],
      { id: 'reviewGriev', title: `Grievances: CM Cell & 14417 — ${this.reviewScope()}` },
    );
  });
  readonly reviewCautionOpt = computed(() =>
    this.cs.reviewRankBar(
      this.rv.cautionItems().map((c) => ({ name: c.label, value: c.count })), 'Count',
      {},
      { id: 'reviewCaution', title: `Critical / Alarming Indicators — ${this.reviewScope()}` },
    ),
  );

  /** How many classes fall below the State average, for the card caption. */
  classesBelowState(): number {
    return this.rv.academicByClassVsState().filter((r) => r.below).length;
  }
  /** How many of the shown classes are board exams (Annual only). */
  boardClassCount(): number {
    return this.rv.academicByClass().filter((c) => c.board).length;
  }

  // ---- additional KPI module charts (KPI.md) ----
  readonly thiranClassOpt = computed(() =>
    this.cs.reviewColumnBar(this.rv.thiranByClass(), 'Students', {
      id: 'thiranClass', title: `THIRAN+ Students by Class — ${this.reviewScope()}`,
    }),
  );
  readonly thiranCategoryOpt = computed(() =>
    this.cs.reviewDonut('School Category', this.rv.thiranByCategory(), {
      id: 'thiranCategory', title: `THIRAN+ by School Category — ${this.reviewScope()}`,
    }),
  );
  readonly scholarshipCatOpt = computed(() =>
    this.cs.reviewDonut('Social Category', this.rv.scholarshipSocialCategory(), {
      id: 'scholarshipCat',
      title: `Scholarship by Social Category (${this.rv.scholarshipActive()?.name ?? 'All'}) — ${this.reviewScope()}`,
    }),
  );
  readonly digitalOpt = computed(() =>
    this.cs.reviewRankBar(this.rv.digitalBars(), 'Schools', {}, {
      id: 'digital', title: `ICT Coverage — ${this.reviewScope()}`,
    }),
  );
  readonly smcAgeingOpt = computed(() =>
    this.cs.reviewColumnBar(this.rv.smcAgeing(), 'Pending resolutions', {
      id: 'smcAgeing', title: `SMC Resolution Ageing — ${this.reviewScope()}`,
    }),
  );
  readonly smcTypeOpt = computed(() =>
    this.cs.reviewDonut('Resolution Type', this.rv.smcTypeSplit(), {
      id: 'smcType', title: `SMC Emergency vs Non-Emergency — ${this.reviewScope()}`,
    }),
  );
  readonly palliDesignationOpt = computed(() => {
    // exclude the synthetic Total row from the chart
    const rows = this.rv.palliByDesignation().filter((r) => r.name !== 'Total');
    return this.cs.reviewGroupedBar(
      rows.map((r) => r.name),
      [
        { name: 'Target', values: rows.map((r) => r.target) },
        { name: 'Observed', values: rows.map((r) => r.observed) },
      ],
      'Schools',
      { id: 'palliDesignation', title: `Palli Parvai by Designation — ${this.reviewScope()}` },
    );
  });

  // ---- drill-down table cell formatting ----
  ddNum(row: any, col: any): number {
    return Number(row[col.key] ?? 0);
  }
  ddVal(row: any, col: any): string {
    if (row.level === 'school') {
      if (col.key === 'att' && row.hasAtt === false) return '—';
      if ((col.key === 'academicAvg' || col.key === 'academicPrevAvg' || col.key === 'academicChange') && row.hasAca === false) return '—';
    }
    const v = row[col.key];
    switch (col.fmt) {
      case 'num': return inr(Math.round(Number(v) || 0));
      case 'num1': return (Math.round((Number(v) || 0) * 10) / 10).toString();
      case 'pct': return `${(Math.round((Number(v) || 0) * 10) / 10)}%`;
      case 'pctSigned': { const n = Number(v) || 0; return `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10}%`; }
      case 'ptSigned': { const n = Number(v) || 0; return `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10} pt`; }
      default: return String(v ?? '');
    }
  }
  ddBarPct(row: any, col: any): number {
    const v = this.ddNum(row, col);
    const max = col.barMax || 100;
    return Math.max(4, Math.min(100, (v / max) * 100));
  }
  ddHasData(row: any, col: any): boolean {
    if (row.level !== 'school') return true;
    if (col.key === 'att' && row.hasAtt === false) return false;
    if ((col.key === 'academicAvg' || col.key === 'academicPrevAvg' || col.key === 'academicChange') && row.hasAca === false) return false;
    return true;
  }

  /** "Needs API integration" popup for the EMIS GER star badge. */
  gerApiPopupOpen = signal(false);
  openGerApiPopup(): void { this.gerApiPopupOpen.set(true); }
  closeGerApiPopup(): void { this.gerApiPopupOpen.set(false); }

  /** Header logo present; falls back to the dome icon if the image is missing. */
  logoOk = signal(true);

  readonly mapOpt = computed(() => {
    if (!this.mapRegistered()) return {};
    const series = this.ds.mapSeries();
    const max = series.reduce((m, s) => Math.max(m, s.value), 0);
    return this.cs.tnMap(
      this.MAP_NAME, series, max, this.ds.metricLabel(),
      { id: 'map', title: this.mapTitle() }, this.mapZoom(),
    );
  });

  // ---- comparison / alarming ----
  readonly compareMetricLabel = computed(() => {
    const f = this.compareMetrics.find((m) => m.value === this.compareMetric());
    return f ? f.label : 'Total Students';
  });
  readonly compareTitle = computed(() =>
    this.compareMetricLabel() + ' — ' + (this.ds.level() === 'state' ? 'District Comparison' : 'Block Comparison'),
  );
  readonly compareBaseline = computed(() => {
    const m = this.compareMetric();
    const b = this.ds.baseline();
    if (m === 'gpi') return b.gpi;
    if (m === 'ptr') return b.ptr;
    if (m === 'avgPerSchool') return b.avgPerSchool;
    if (m === 'girlsPct') return b.girlsPct;
    // count metrics: use the mean of the rows
    const rows = this.ds.comparisonRows();
    if (!rows.length) return 0;
    const sum = rows.reduce((s, r) => s + ((r as any)[m] ?? 0), 0);
    return Math.round(sum / rows.length);
  });
  private compareNames: string[] = [];
  readonly compareOpt = computed(() => {
    const opt = this.cs.comparisonBar(
      this.ds.comparisonRows(), this.compareMetric(), this.compareMetricLabel(),
      this.compareBaseline(), { id: 'compare', title: this.compareTitle() },
    );
    this.compareNames = opt._names ?? [];
    return opt;
  });
  onCompareClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const name = this.compareNames[e.dataIndex];
      if (!name) return;
      if (this.ds.level() === 'state') this.ds.drillToDistrict(name);
      else this.ds.drillToBlock(name);
    }
  }

  readonly alertTitle = computed(() => 'Alerts by Category — Tamil Nadu');
  readonly alertOpt = computed(() =>
    this.cs.alertBar(this.ds.alertSummary().byKind, { id: 'alerts', title: this.alertTitle() }),
  );

  // ---- drillable child trends (state -> district -> block -> school) ----
  readonly childTrendTitle = computed(() => {
    const c = this.ds.childTrendPlot();
    const rank = this.ds.trendRank() === 'top' ? 'Top' : 'Bottom';
    return `${rank} ${c.shown} ${c.childLabel} Enrolment Trend — ${this.ds.titleCase(this.ds.scopeLabel())}`;
  });
  private childTrendNames: string[] = [];
  readonly childTrendOpt = computed(() => {
    const c = this.ds.childTrendPlot();
    const opt = this.cs.childTrendLines(
      c.years, c.items, c.childLabel,
      { id: 'childTrend', title: this.childTrendTitle() },
    );
    this.childTrendNames = opt._names ?? [];
    return opt;
  });

  /** Count options for the trend chart (capped at 20). */
  readonly trendCountOptions = [5, 10, 12, 15, 20];

  setFromYear(y: string | null): void { this.ds.fromYear.set(y); }
  setTrendRank(r: 'top' | 'bottom'): void { this.ds.trendRank.set(r); }
  setTrendCount(n: number): void { this.ds.trendCount.set(Math.min(20, Math.max(1, +n || 12))); }

  /** Drill one level deeper from a clicked trend line or legend entry. */
  onChildTrendClick(e: any): void {
    let key: string | null = null;
    if (typeof e?.seriesIndex === 'number' && this.childTrendNames[e.seriesIndex] != null) {
      key = this.childTrendNames[e.seriesIndex];
    } else if (e?.seriesName) {
      const items = this.ds.childTrendPlot().items;
      const found = items.find((i) => i.name === e.seriesName);
      if (found) key = found.key;
    }
    if (key) this.drillChild(key);
  }

  /** Drill into a child of the current scope, whatever the level. */
  drillChild(key: string): void {
    switch (this.ds.level()) {
      case 'state': this.ds.drillToDistrict(key); break;
      case 'district': this.ds.drillToBlock(key); break;
      case 'block': this.ds.drillToSchool(key); break;
      default: break;
    }
  }

  setSub(id: string): void { this.activeSub.set(id as any); }
  setCompareMetric(m: string): void { this.compareMetric.set(m); }

  /** Jump to a district from an alert row. */
  openAlert(district: string): void {
    this.ds.drillToDistrict(district);
    this.activeSub.set('numbers');
  }

  // ================= ACADEMIC SCORES =================
  readonly acStats = computed(() => {
    const n = this.ac.current();
    if (!n) return [];
    return [
      { label: 'Average Mark', value: n.avgMark, suffix: '', icon: 'fa-solid fa-pen-ruler' },
      { label: 'Pass Percentage', value: n.passPct, suffix: '%', icon: 'fa-solid fa-circle-check' },
      { label: 'Compliance', value: n.compliance, suffix: '%', icon: 'fa-solid fa-clipboard-check' },
    ];
  });

  readonly acCounts = computed(() => {
    const n = this.ac.current();
    if (!n) return [];
    const weakest = [...n.bySubject].sort((a, b) => a.avg - b.avg)[0];
    const strongest = [...n.bySubject].sort((a, b) => b.avg - a.avg)[0];
    const below = n.bySubject.reduce((s, x) => s + x.below35, 0);
    const appeared = n.bySubject.reduce((s, x) => s + x.below35 + x.b35_60 + x.b61_80 + x.above80, 0);
    return [
      { label: 'Students Expected', value: inr(n.total) },
      { label: 'Marks Entered', value: inr(n.updated) },
      { label: 'Strongest Subject', value: strongest ? `${strongest.name} (${strongest.avg})` : '-' },
      { label: 'Weakest Subject', value: weakest ? `${weakest.name} (${weakest.avg})` : '-' },
      { label: 'Below 35 Marks', value: appeared ? `${((below / appeared) * 100).toFixed(1)}%` : '-' },
    ];
  });

  readonly acScopeLabel = computed(() => this.ds.titleCase(this.ds.scopeLabel()));
  readonly acRadarTitle = computed(() => `Subject Profile vs State — ${this.acScopeLabel()}`);
  readonly acBandTitle = computed(() => `Mark Band Distribution — ${this.acScopeLabel()}`);
  readonly acExamTitle = computed(() => `Exam Progression — ${this.acScopeLabel()}`);
  readonly acClassTitle = computed(() => `Class-wise Performance — ${this.acScopeLabel()}`);
  readonly acHeatTitle = computed(() => `Subject vs District Heatmap — ${this.ac.activeYear()}`);
  readonly acRiskTitle = computed(() => `Compliance vs Pass Risk Quadrant — ${this.ac.activeYear()}`);
  readonly acTrendTitle = computed(() => `Academic Trend — ${this.acScopeLabel()}`);
  readonly acCompareTitle = computed(() => `${this.ac.metricLabel()} — ${this.ac.childLabel()} Comparison`);
  readonly acAlertTitle = computed(() => `Academic Alerts by Category — ${this.ac.activeYear()}`);
  readonly acChildTrendTitle = computed(
    () => `${this.ac.rank() === 'top' ? 'Most Improved' : 'Steepest Decline'} ${this.ac.childLabel()} — ${this.ac.metricLabel()}`,
  );

  readonly acRadarOpt = computed(() => {
    const n = this.ac.current(); const s = this.ac.stateNode();
    if (!n || !s) return {};
    const mine = this.ac.subjectSet() === 'hs' ? n.byHsSubject : n.bySubject;
    const theirs = this.ac.subjectSet() === 'hs' ? s.byHsSubject : s.bySubject;
    // align state values to my subject order
    const aligned = mine.map((m) => theirs.find((t) => t.name === m.name) ?? { name: m.name, avg: 0 });
    return this.cs.subjectRadar(mine, aligned as any, this.acScopeLabel(), { id: 'acRadar', title: this.acRadarTitle() });
  });
  readonly acBandOpt = computed(() => {
    const subs = this.ac.activeSubjects();
    return subs.length ? this.cs.gradeBandStack(subs, { id: 'acBand', title: this.acBandTitle() }) : {};
  });

  // ---- exam comparison ----
  readonly acExamSubjTitle = computed(() => `Exam vs Subject — ${this.acScopeLabel()}`);
  readonly acExamGainTitle = computed(() => `Exam Improvement by District — ${this.ac.activeYear()}`);
  readonly acStreamTitle = computed(() => `Higher Secondary Stream Comparison — ${this.acScopeLabel()}`);

  readonly acExamSubjOpt = computed(() => {
    const m = this.ac.examSubjectMatrix();
    return m.rows.length
      ? this.cs.examSubjectCompare(m.subjects, m.rows, { id: 'acExamSubj', title: this.acExamSubjTitle() })
      : {};
  });
  private acGainNames: string[] = [];
  readonly acExamGainOpt = computed(() => {
    const rows = this.ac.examSpreadByDistrict();
    const ex = this.ac.examTypes();
    if (!rows.length || ex.length < 2) return {};
    const opt = this.cs.examGainCompare(rows, ex[0], ex[ex.length - 1], { id: 'acExamGain', title: this.acExamGainTitle() });
    this.acGainNames = opt._names ?? [];
    return opt;
  });
  onAcGainClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const k = this.acGainNames[e.dataIndex];
      if (k) { this.ds.drillToDistrict(k); this.activeSub.set('numbers'); }
    }
  }
  readonly acStreamOpt = computed(() => {
    const n = this.ac.current();
    return n && n.byStream?.length
      ? this.cs.streamCompare(n.byStream, { id: 'acStream', title: this.acStreamTitle() })
      : {};
  });

  readonly acH2hTitle = computed(() => {
    const h = this.ac.examHeadToHead();
    return h ? `${h.a.label} vs ${h.b.label} — ${this.acScopeLabel()}` : 'Exam Comparison';
  });
  readonly acH2hOpt = computed(() => {
    const h = this.ac.examHeadToHead();
    if (!h || !h.subjects.length) return {};
    return this.cs.examHeadToHead(h.subjects, h.a.label, h.b.label, { id: 'acH2h', title: this.acH2hTitle() });
  });
  setAcAClass(c: number): void { this.ac.aClass.set(+c || 0); this.ac.aExam.set(''); }
  setAcAExam(e: string): void { this.ac.aExam.set(e); }
  setAcBClass(c: number): void { this.ac.bClass.set(+c || 0); this.ac.bExam.set(''); }
  setAcBExam(e: string): void { this.ac.bExam.set(e); }
  setAcSubjectFilter(s: string): void { this.ac.subjectFilter.set(s); }

  readonly acSittingTitle = computed(() => `Exam Sittings by Class — ${this.acScopeLabel()}`);
  readonly acSittingOpt = computed(() => {
    const rows = this.ac.examSittings();
    return rows.length
      ? this.cs.examSittingCompare(rows, { id: 'acSitting', title: this.acSittingTitle() })
      : {};
  });
  setAcExamClass(c: number): void { this.ac.examClassFilter.set(+c || 0); }

  setAcCompareMode(m: 'districts' | 'exams'): void { this.ac.compareMode.set(m); }
  setAcSubjectSet(s: 'core' | 'hs'): void { this.ac.subjectSet.set(s); }
  readonly acExamOpt = computed(() => {
    const n = this.ac.current();
    return n ? this.cs.examProgression(n.byExam, this.ac.examTypes(), { id: 'acExam', title: this.acExamTitle() }) : {};
  });
  readonly acClassOpt = computed(() => {
    const n = this.ac.current();
    const b = this.ac.data()?.boardClasses ?? [];
    return n ? this.cs.classPerformance(n.byClass, b, { id: 'acClass', title: this.acClassTitle() }) : {};
  });
  readonly acHeatOpt = computed(() => {
    const h = this.ac.heatmap();
    return h.districts.length ? this.cs.subjectHeatmap(h.districts, h.subjects, h.cells, { id: 'acHeat', title: this.acHeatTitle() }) : {};
  });
  readonly acRiskOpt = computed(() => {
    const pts = this.ac.riskScatter(); const s = this.ac.stateNode();
    if (!pts.length || !s) return {};
    return this.cs.riskQuadrant(
      pts, s.compliance, s.passPct,
      { id: 'acRisk', title: this.acRiskTitle() },
      'Data Compliance %', 'Pass %', 'Students',
    );
  });
  readonly acTrendOpt = computed(() => {
    const t = this.ac.scopeTrend();
    return this.cs.academicTrend(t.years, t.avgMark, t.passPct, t.compliance, { id: 'acTrend', title: this.acTrendTitle() });
  });
  private acCompareNames: string[] = [];
  readonly acCompareOpt = computed(() => {
    const s = this.ac.stateNode();
    const baseline = s ? (s as any)[this.ac.metric()] ?? 0 : 0;
    const opt = this.cs.academicCompare(
      this.ac.comparisonRows(), this.ac.metric(), this.ac.metricLabel(),
      this.ac.metricSuffix(), baseline, { id: 'acCompare', title: this.acCompareTitle() },
    );
    this.acCompareNames = opt._names ?? [];
    return opt;
  });
  readonly acAlertOpt = computed(() =>
    this.cs.alertBar(this.ac.alertSummary().byKind, { id: 'acAlerts', title: this.acAlertTitle() }),
  );
  private acChildNames: string[] = [];
  readonly acChildTrendOpt = computed(() => {
    const c = this.ac.childTrends();
    const opt = this.cs.childTrendLines(c.years, c.items, this.ac.childLabel(), { id: 'acChildTrend', title: this.acChildTrendTitle() });
    this.acChildNames = opt._names ?? [];
    return opt;
  });

  setAcYear(y: string): void { this.ac.year.set(y); }
  setAcFromYear(y: string): void { this.ac.fromYear.set(y); }
  setAcToYear(y: string): void { this.ac.toYear.set(y); }
  setAcMetric(m: string): void { this.ac.metric.set(m as AcademicMetric); }
  setAcRank(r: 'top' | 'bottom'): void { this.ac.rank.set(r); }
  setAcCount(n: number): void { this.ac.count.set(Math.min(20, Math.max(1, +n || 12))); }
  setAcTrendExams(e: string[]): void { this.ac.trendExams.set(e ?? []); }
  setAcTrendClasses(c: number[]): void { this.ac.trendClasses.set((c ?? []).map((x) => +x)); }

  onAcCompareClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const key = this.acCompareNames[e.dataIndex];
      if (key) this.drillChild(key);
    }
  }
  onAcChildTrendClick(e: any): void {
    let key: string | null = null;
    if (typeof e?.seriesIndex === 'number' && this.acChildNames[e.seriesIndex] != null) {
      key = this.acChildNames[e.seriesIndex];
    } else if (e?.seriesName) {
      const found = this.ac.childTrends().items.find((i) => i.name === e.seriesName);
      if (found) key = found.key;
    }
    if (key) this.drillChild(key);
  }
  onAcRiskClick(e: any): void {
    const k = e?.data?.key;
    if (k) { this.ds.drillToDistrict(k); this.activeSub.set('numbers'); }
  }
  openAcAlert(district: string): void {
    this.ds.drillToDistrict(district);
    this.activeSub.set('numbers');
  }

  // ================= ATTENDANCE =================
  readonly atScopeLabel = computed(() => this.ds.titleCase(this.ds.scopeLabel()));
  readonly atWindowLabel = computed(() => this.at.periodLabel());

  readonly atStats = computed(() => {
    const n = this.at.current();
    if (!n) return [];
    const dd = this.at.isDayMode() ? this.at.activeDayRecord() : null;
    const w = this.at.activeWindow();
    return [
      {
        label: 'Marking Compliance',
        value: dd ? dd.compliance : w ? w.compliance : n.compliance,
        suffix: '%', icon: 'fa-solid fa-clipboard-check',
      },
      {
        label: 'Student Attendance',
        value: dd ? dd.attendance : w ? w.attendance : n.attendance,
        suffix: '%', icon: 'fa-solid fa-user-check',
      },
      {
        label: 'Teacher Attendance',
        value: dd ? dd.teacher : n.teacherAttendance,
        suffix: '%', icon: 'fa-solid fa-chalkboard-user',
      },
      {
        label: 'Dropout Risk',
        value: n.dropoutRate,
        suffix: '%', icon: 'fa-solid fa-user-xmark',
      },
    ];
  });

  readonly atCounts = computed(() => {
    const n = this.at.current();
    if (!n) return [];
    const dd = this.at.isDayMode() ? this.at.activeDayRecord() : null;
    const w = this.at.activeWindow();
    const scope = this.at.isDayMode() ? 'on ' + this.at.activeDay() : `last ${this.at.window()}d`;
    if (dd) {
      return [
        { label: 'Schools', value: inr(dd.schools) },
        { label: 'Schools Marked', value: inr(dd.marked) },
        { label: 'Schools Not Marked', value: inr(dd.unmarked) },
        { label: `Students Absent (${scope})`, value: inr(dd.absentees) },
        { label: `Potential dropouts (${this.at.dropoutThreshold()}+ days absent)`, value: inr(n.dropoutRisk) },
      ];
    }
    return [
      { label: 'Schools', value: inr(n.schools) },
      { label: 'Students Enrolled', value: inr(n.enrolled) },
      { label: `Absentee-days (${scope})`, value: inr(w ? w.absentees : n.absentees) },
      { label: `Unmarked school-days (${scope})`, value: inr(w ? w.unmarked : n.unmarkedDays) },
      { label: `Potential dropouts (${this.at.dropoutThreshold()}+ days absent)`, value: inr(n.dropoutRisk) },
    ];
  });

  readonly atDailyTitle = computed(() => `Daily Attendance — ${this.atScopeLabel()} (${this.atWindowLabel()})`);
  readonly atComplianceTitle = computed(() => `Marked vs Unmarked School-Days — ${this.atScopeLabel()}`);
  readonly atPresenceTitle = computed(() => `Student Present vs Absent — ${this.atScopeLabel()}`);
  readonly atWindowTitle = computed(() => `Attendance Across Windows — ${this.atScopeLabel()}`);
  readonly atCompareTitle = computed(() => `${this.at.metricLabel()} — ${this.at.childLabel()} Comparison`);
  readonly atTrendTitle = computed(() => `${this.at.metricLabel()} Trend — ${this.at.childLabel()}`);
  readonly atDropoutTitle = computed(() => `Dropout Risk by District (${this.at.dropoutThreshold()}+ days absent)`);
  readonly atAlertTitle = computed(() => `Attendance Alerts by Category — ${this.atWindowLabel()}`);
  readonly atRiskTitle = computed(() => `Compliance vs Attendance Risk — ${this.atWindowLabel()}`);

  readonly atDailyOpt = computed(() => {
    const days = this.at.dailySeries();
    return days.length ? this.cs.attendanceDaily(days, { id: 'atDaily', title: this.atDailyTitle() }) : {};
  });
  readonly atComplianceOpt = computed(() => {
    const n = this.at.current();
    if (!n) return {};
    const dd = this.at.isDayMode() ? this.at.activeDayRecord() : null;
    if (dd) {
      // exact school counts for the chosen day
      return this.cs.complianceDonut(dd.marked, dd.unmarked, { id: 'atCompliance', title: this.atComplianceTitle() });
    }
    const w = this.at.activeWindow();
    const unmarked = w ? w.unmarked : n.unmarkedDays;
    const totalDays = w ? w.days * n.schools : n.expectedDays;
    const marked = Math.max(0, totalDays - unmarked);
    return this.cs.complianceDonut(marked, unmarked, { id: 'atCompliance', title: this.atComplianceTitle() });
  });
  readonly atPresenceOpt = computed(() => {
    const n = this.at.current();
    if (!n) return {};
    const dd = this.at.isDayMode() ? this.at.activeDayRecord() : null;
    if (dd) {
      return this.cs.presenceDonut(dd.present, dd.absentees, 'Attendance', { id: 'atPresence', title: this.atPresenceTitle() });
    }
    const w = this.at.activeWindow();
    const exp = w ? w.expected : 0;
    const abs = w ? w.absentees : n.absentees;
    return this.cs.presenceDonut(Math.max(0, exp - abs), abs, 'Attendance', { id: 'atPresence', title: this.atPresenceTitle() });
  });
  readonly atWindowOpt = computed(() => {
    const n = this.at.current();
    return n ? this.cs.windowCompare(n.windows, { id: 'atWindow', title: this.atWindowTitle() }) : {};
  });

  readonly atBandTitle = computed(() => `School Attendance Distribution — ${this.atScopeLabel()}`);
  readonly atMgmtTitle = computed(() => `Attendance by School Type — ${this.atScopeLabel()}`);

  readonly atBandOpt = computed(() => {
    const rows = this.at.attendanceBands();
    return rows.some((r) => r.schools > 0)
      ? this.cs.attendanceBands(rows, { id: 'atBand', title: this.atBandTitle() })
      : {};
  });
  readonly atMgmtOpt = computed(() => {
    const rows = this.at.byManagement();
    return rows.length
      ? this.cs.attendanceByMgmt(rows, { id: 'atMgmt', title: this.atMgmtTitle() })
      : {};
  });

  private atCompareNames: string[] = [];
  readonly atCompareOpt = computed(() => {
    const st = this.at.stateNode();
    const m = this.at.metric();
    const baseline = st ? (st as any)[m] ?? 0 : 0;
    // dropout risk is the one metric where a HIGH value is bad
    const lowerIsBetter = m === 'dropoutRate';
    const opt = this.cs.academicCompare(
      this.at.comparisonRows(), m, this.at.metricLabel(), '%', baseline,
      { id: 'atCompare', title: this.atCompareTitle() }, lowerIsBetter,
    );
    this.atCompareNames = opt._names ?? [];
    return opt;
  });
  onAtCompareClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const k = this.atCompareNames[e.dataIndex];
      if (k) this.drillChild(k);
    }
  }

  private atTrendNames: string[] = [];
  readonly atTrendOpt = computed(() => {
    const c = this.at.childTrends();
    if (!c.items.length) return {};
    const opt = this.cs.childTrendLines(
      c.dates.map((d) => d.slice(5)), c.items as any, this.at.childLabel(),
      { id: 'atTrend', title: this.atTrendTitle() },
    );
    this.atTrendNames = opt._names ?? [];
    return opt;
  });
  onAtTrendClick(e: any): void {
    let key: string | null = null;
    if (typeof e?.seriesIndex === 'number' && this.atTrendNames[e.seriesIndex] != null) {
      key = this.atTrendNames[e.seriesIndex];
    } else if (e?.seriesName) {
      const f = this.at.childTrends().items.find((i: any) => i.name === e.seriesName);
      if (f) key = (f as any).key;
    }
    if (key) this.drillChild(key);
  }

  private atDropoutNames: string[] = [];
  readonly atDropoutOpt = computed(() => {
    const rows = this.at.dropoutRanking();
    if (!rows.length) return {};
    const opt = this.cs.dropoutRanking(rows, this.at.dropoutThreshold(), { id: 'atDropout', title: this.atDropoutTitle() });
    this.atDropoutNames = opt._names ?? [];
    return opt;
  });
  onAtDropoutClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const k = this.atDropoutNames[e.dataIndex];
      if (k) { this.ds.drillToDistrict(k); this.activeSub.set('numbers'); }
    }
  }

  readonly atAlertOpt = computed(() =>
    this.cs.alertBar(this.at.alertSummary().byKind, { id: 'atAlerts', title: this.atAlertTitle() }),
  );
  readonly atRiskOpt = computed(() => {
    const pts = this.at.riskScatter();
    const st = this.at.stateNode();
    if (!pts.length || !st) return {};
    const w = st.windows.find((x) => x.days === this.at.window());
    return this.cs.riskQuadrant(
      pts, w ? w.compliance : st.compliance, w ? w.attendance : st.attendance,
      { id: 'atRisk', title: this.atRiskTitle() },
      'Marking Compliance %', 'Student Attendance %', 'Students at dropout risk',
    );
  });
  onAtRiskClick(e: any): void {
    const k = e?.data?.key;
    if (k) { this.ds.drillToDistrict(k); this.activeSub.set('numbers'); }
  }

  // ---- attendance: day vs day ----
  readonly atDayCmpTitle = computed(() => {
    const h = this.at.dayHeadToHead();
    return h ? `${h.aDate} vs ${h.bDate} — ${this.atScopeLabel()}` : 'Day Comparison';
  });
  private atDayCmpNames: string[] = [];
  readonly atDayCmpOpt = computed(() => {
    const h = this.at.dayHeadToHead();
    if (!h || !h.children.length) return {};
    const rows = h.children.map((c) => ({
      name: c.name, aAvg: c.aAtt, bAvg: c.bAtt, avgDiff: c.attDiff,
    }));
    this.atDayCmpNames = h.children.map((c) => c.key);
    return this.cs.examHeadToHead(rows, h.aDate, h.bDate, { id: 'atDayCmp', title: this.atDayCmpTitle() });
  });
  setAtCompareMode(m: 'districts' | 'days'): void { this.at.compareMode.set(m); }
  setAtDayA(d: string): void { this.at.dayA.set(d); }
  setAtDayB(d: string): void { this.at.dayB.set(d); }

  setAtWindow(w: number): void { this.at.window.set(+w || 30); }
  setAtMode(m: 'period' | 'day'): void { this.at.mode.set(m); }
  setAtDay(d: string): void { this.at.day.set(d); this.at.mode.set('day'); }
  setAtMetric(m: string): void { this.at.metric.set(m as AttendanceMetric); }
  setAtRank(r: 'top' | 'bottom'): void { this.at.rank.set(r); }
  setAtCount(n: number): void { this.at.count.set(Math.min(20, Math.max(1, +n || 12))); }
  openAtAlert(d: string): void { this.ds.drillToDistrict(d); this.activeSub.set('numbers'); }

  // ================= TABLE EXPORTS =================
  /** Column sets, defined once per table. */
  private readonly EXPORT_COLS: Record<string, ExportColumn[]> = {
    drill: [
      { header: 'Name', field: 'name' },
      { header: 'Schools', field: 'schools', type: 'number' },
      { header: 'Boys', field: 'boys', type: 'number' },
      { header: 'Girls', field: 'girls', type: 'number' },
      { header: 'Students', field: 'students', type: 'number' },
      { header: 'Teachers', field: 'teaching', type: 'number' },
    ],
    childTrend: [
      { header: 'Name', field: 'name' },
      { header: 'From', field: 'first', type: 'number' },
      { header: 'To', field: 'last', type: 'number' },
      { header: 'Difference', field: 'diff', type: 'number' },
      { header: 'Change %', field: 'change', type: 'percent' },
    ],
    stateTrend: [
      { header: 'Year', field: 'year' },
      { header: 'Schools', field: 'schools', type: 'number' },
      { header: 'Boys', field: 'boys', type: 'number' },
      { header: 'Girls', field: 'girls', type: 'number' },
      { header: 'Students', field: 'students', type: 'number' },
      { header: 'Teachers', field: 'teaching', type: 'number' },
    ],
    comparison: [
      { header: 'Name', field: 'name' },
      { header: 'Schools', field: 'schools', type: 'number' },
      { header: 'Students', field: 'students', type: 'number' },
      { header: 'GPI', field: 'gpi' },
      { header: 'PTR', field: 'ptr' },
      { header: 'Avg per School', field: 'avgPerSchool', type: 'number' },
      { header: 'Girls %', field: 'girlsPct', type: 'percent' },
    ],
    alerts: [
      { header: 'Severity', field: 'severity' },
      { header: 'District', field: 'district' },
      { header: 'Alert', field: 'kind' },
      { header: 'Measured', field: 'detail' },
    ],
    acAlerts: [
      { header: 'Severity', field: 'severity' },
      { header: 'District', field: 'district' },
      { header: 'Alert', field: 'kind' },
      { header: 'Measured', field: 'detail' },
    ],
    atAlerts: [
      { header: 'Severity', field: 'severity' },
      { header: 'District', field: 'district' },
      { header: 'Alert', field: 'kind' },
      { header: 'Measured', field: 'detail' },
    ],
    acSubjects: [
      { header: 'Subject', field: 'name' },
      { header: 'Average Mark', field: 'avg' },
      { header: 'Pass %', field: 'pass', type: 'percent' },
      { header: 'Below 35', field: 'below35', type: 'number' },
      { header: '35-60', field: 'b35_60', type: 'number' },
      { header: '61-80', field: 'b61_80', type: 'number' },
      { header: 'Above 80', field: 'above80', type: 'number' },
      { header: 'Absentees', field: 'absent', type: 'number' },
    ],
    acChildren: [
      { header: 'Name', field: 'name' },
      { header: 'Average Mark', field: 'avgMark' },
      { header: 'Pass %', field: 'passPct', type: 'percent' },
      { header: 'Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Weakest Subject', field: 'weakest' },
      { header: 'Weakest Average', field: 'weakestAvg' },
    ],
    acChildTrend: [
      { header: 'Name', field: 'name' },
      { header: 'From', field: 'first' },
      { header: 'To', field: 'last' },
      { header: 'Change', field: 'diff' },
    ],
    acSittings: [
      { header: 'Exam Name', field: 'exam' },
      { header: 'Class', field: 'cls' },
      { header: 'Board Exam', field: 'board' },
      { header: 'Average Mark', field: 'avg' },
      { header: 'Pass %', field: 'pass', type: 'percent' },
      { header: 'Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Students Entered', field: 'updated', type: 'number' },
    ],
    acExamRows: [
      { header: 'Exam Type', field: 'name' },
      { header: 'Average Mark', field: 'avg' },
      { header: 'vs Baseline', field: 'avgDelta' },
      { header: 'Pass %', field: 'pass', type: 'percent' },
      { header: 'Pass Delta', field: 'passDelta' },
      { header: 'Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Students Entered', field: 'updated', type: 'number' },
    ],
    acH2hSubjects: [
      { header: 'Subject', field: 'name' },
      { header: 'Exam A Average', field: 'aAvg' },
      { header: 'Exam B Average', field: 'bAvg' },
      { header: 'Average Difference', field: 'avgDiff' },
      { header: 'Pass Difference', field: 'passDiff' },
    ],
    acExamGain: [
      { header: 'District', field: 'name' },
      { header: 'First Exam', field: 'quarterly' },
      { header: 'Last Exam', field: 'annual' },
      { header: 'Gain', field: 'gain' },
    ],
    caution: [
      { header: 'District', field: 'district' },
      { header: 'Block', field: 'block' },
      { header: 'School', field: 'school' },
      { header: 'UDISE Code', field: 'udise' },
      { header: 'Management', field: 'mgmt' },
      { header: 'Category', field: 'stype' },
      { header: 'Students', field: 'students', type: 'number' },
      { header: 'Finding', field: 'detail' },
    ],
    cautionSummary: [
      { header: 'Check', field: 'label' },
      { header: 'Severity', field: 'severity' },
      { header: 'Schools Flagged', field: 'count', type: 'number' },
      { header: 'What it means', field: 'hint' },
    ],
    atBands: [
      { header: 'Attendance Band', field: 'label' },
      { header: 'Schools', field: 'schools', type: 'number' },
      { header: 'Share of Schools %', field: 'pct', type: 'percent' },
      { header: 'Students', field: 'students', type: 'number' },
      { header: 'Share of Students %', field: 'studentPct', type: 'percent' },
    ],
    atMgmt: [
      { header: 'School Type', field: 'name' },
      { header: 'Schools', field: 'schools', type: 'number' },
      { header: 'Students Enrolled', field: 'enrolled', type: 'number' },
      { header: 'Student Attendance %', field: 'attendance', type: 'percent' },
      { header: 'Marking Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Teacher Attendance %', field: 'teacherAttendance', type: 'percent' },
      { header: 'Dropout Risk %', field: 'dropoutRate', type: 'percent' },
    ],
    atWindows: [
      { header: 'Period (working days)', field: 'days' },
      { header: 'Attendance %', field: 'attendance', type: 'percent' },
      { header: 'Absentee-days', field: 'absentees', type: 'number' },
      { header: 'Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Unmarked Days', field: 'unmarked', type: 'number' },
    ],
    atDay: [
      { header: 'Date', field: 'date' },
      { header: 'Schools', field: 'schools', type: 'number' },
      { header: 'Marked', field: 'marked', type: 'number' },
      { header: 'Not Marked', field: 'unmarked', type: 'number' },
      { header: 'Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Present', field: 'present', type: 'number' },
      { header: 'Absent', field: 'absentees', type: 'number' },
      { header: 'Attendance %', field: 'attendance', type: 'percent' },
      { header: 'Teacher %', field: 'teacher', type: 'percent' },
    ],
    atChildren: [
      { header: 'Name', field: 'name' },
      { header: 'Enrolled', field: 'enrolled', type: 'number' },
      { header: 'Attendance %', field: 'attendance', type: 'percent' },
      { header: 'Compliance %', field: 'compliance', type: 'percent' },
      { header: 'Unmarked', field: 'unmarked', type: 'number' },
      { header: 'Teacher %', field: 'teacherAttendance', type: 'percent' },
      { header: 'Absentee-days', field: 'absentees', type: 'number' },
      { header: 'Potential Dropout Students', field: 'dropoutRisk', type: 'number' },
      { header: 'Risk Rate %', field: 'dropoutRate', type: 'percent' },
    ],
    atDayCmp: [
      { header: 'Name', field: 'name' },
      { header: 'Attendance A %', field: 'aAtt', type: 'percent' },
      { header: 'Attendance B %', field: 'bAtt', type: 'percent' },
      { header: 'Attendance Change', field: 'attDiff' },
      { header: 'Compliance A %', field: 'aComp', type: 'percent' },
      { header: 'Compliance B %', field: 'bComp', type: 'percent' },
      { header: 'Compliance Change', field: 'compDiff' },
    ],
    atDropout: [
      { header: 'District', field: 'name' },
      { header: 'Students at Risk', field: 'risk', type: 'number' },
      { header: 'Risk Rate %', field: 'rate', type: 'percent' },
      { header: 'Enrolled', field: 'enrolled', type: 'number' },
    ],
    infTypes: [
      { header: 'Type', field: 'label' },
      { header: 'Available', field: 'available', type: 'number' },
      { header: 'Required by Norms', field: 'norms', type: 'number' },
      { header: 'Shortfall', field: 'required', type: 'number' },
      { header: 'Surplus', field: 'surplus', type: 'number' },
      { header: 'Availability %', field: 'availabilityPct', type: 'percent' },
      { header: 'Coverage %', field: 'coveragePct', type: 'percent' },
      { header: 'Good %', field: 'goodPct', type: 'percent' },
      { header: 'Needs Repair', field: 'needRepair', type: 'number' },
    ],
    infChildren: [
      { header: 'Name', field: 'name' },
      { header: 'Schools Expected', field: 'expectedSchools', type: 'number' },
      { header: 'Schools Submitted', field: 'enteredSchools', type: 'number' },
      { header: 'Entry Compliance %', field: 'entryPct', type: 'percent' },
      { header: 'Available', field: 'available', type: 'number' },
      { header: 'Required by Norms', field: 'norms', type: 'number' },
      { header: 'Shortfall', field: 'required', type: 'number' },
      { header: 'Availability %', field: 'availabilityPct', type: 'percent' },
      { header: 'Coverage %', field: 'coveragePct', type: 'percent' },
      { header: 'Good %', field: 'goodPct', type: 'percent' },
      { header: 'Gap %', field: 'gapPct', type: 'percent' },
    ],
    infEntry: [
      { header: 'Period', field: 'period' },
      { header: 'Schools Expected', field: 'expected', type: 'number' },
      { header: 'Schools Submitted', field: 'entered', type: 'number' },
      { header: 'Entry Pending', field: 'notEntered', type: 'number' },
      { header: 'Compliance %', field: 'entryPct', type: 'percent' },
    ],
    infEntryRank: [
      { header: 'District', field: 'name' },
      { header: 'Schools Expected', field: 'expected', type: 'number' },
      { header: 'Schools Submitted', field: 'entered', type: 'number' },
      { header: 'Entry Pending', field: 'notEntered', type: 'number' },
      { header: 'Compliance %', field: 'entryPct', type: 'percent' },
    ],
    infGap: [
      { header: 'District', field: 'name' },
      { header: 'Available', field: 'available', type: 'number' },
      { header: 'Required by Norms', field: 'norms', type: 'number' },
      { header: 'Shortfall', field: 'required', type: 'number' },
      { header: 'Gap %', field: 'gapPct', type: 'percent' },
    ],
    infAlerts: [
      { header: 'Severity', field: 'severity' },
      { header: 'District', field: 'district' },
      { header: 'Alert', field: 'kind' },
      { header: 'Measured', field: 'detail' },
    ],
  };

  /** Row source for each table key. */
  private exportRows(key: string): any[] {
    switch (key) {
      case 'drill': return this.tableRows();
      case 'childTrend': return this.ds.childTrendRows();
      case 'stateTrend': return this.ds.stateTrend();
      case 'comparison': return this.ds.comparisonRows();
      // alert exports follow the selected category tab
      case 'alerts': case 'acAlerts': case 'atAlerts': case 'infAlerts':
        return this.filteredAlerts();
      case 'acSubjects': return this.ac.activeSubjects();
      case 'acChildren': return this.ac.comparisonRows();
      case 'acChildTrend': return this.ac.childTrendRows();
      case 'acSittings': return this.ac.examSittings();
      case 'acExamRows': return this.ac.examRows();
      case 'acH2hSubjects': return this.ac.examHeadToHead()?.subjects ?? [];
      case 'acExamGain': return this.ac.examSpreadByDistrict();
      case 'caution': return this.cautionRows();
      case 'cautionSummary': return this.cautionChecks();
      case 'atBands': return this.at.attendanceBands();
      case 'atMgmt': return this.at.byManagement();
      case 'atWindows': return this.at.current()?.windows ?? [];
      case 'atDay': {
        const d = this.at.activeDayRecord();
        return d ? [d] : [];
      }
      case 'atChildren': return this.at.comparisonRows();
      case 'atDayCmp': return this.at.dayHeadToHead()?.children ?? [];
      case 'atDropout': return this.at.dropoutRanking();
      case 'infTypes': return this.inf.allTypes();
      case 'infChildren': return this.inf.comparisonRows();
      case 'infGap': return this.inf.gapRanking();
      case 'infEntry': return this.inf.entryTrend();
      case 'infEntryRank': return this.inf.entryRanking();
      default: return [];
    }
  }

  /** Human title for each export, including the current scope. */
  private exportTitle(key: string): string {
    const scope = this.ds.titleCase(this.ds.scopeLabel());
    switch (key) {
      case 'drill': return `${this.tableTitle()} - ${scope}`;
      case 'childTrend': return `${this.ds.childTrends().childLabel} Change - ${scope}`;
      case 'stateTrend': return 'Year-wise State Enrolment';
      case 'comparison': return `Indicator Comparison - ${scope}`;
      case 'alerts': return `Alarming Indicators - ${scope}`;
      case 'acSubjects': return `Subject Detail - ${this.ac.subjectSetLabel()} - ${scope}`;
      case 'acChildren': return `${this.ac.childLabel()} Academic Summary - ${scope}`;
      case 'acChildTrend': return `${this.ac.childLabel()} ${this.ac.metricLabel()} Change - ${scope}`;
      case 'acSittings': return `Exam Sittings - ${scope}`;
      case 'acExamRows': return `Exam Comparison - ${scope}`;
      case 'acH2hSubjects': return `Exam Head to Head Subjects - ${scope}`;
      case 'acExamGain': return 'District Exam Improvement';
      case 'acAlerts': return 'Academic Alarming Indicators';
      case 'cautionSummary': return `Caution Check Summary - ${scope}`;
      case 'caution': return `Caution ${this.cautionCheck()?.label ?? ''} - ${scope}`;
      case 'atBands': return `School Attendance Distribution - ${scope}`;
      case 'atMgmt': return `Attendance by School Type - ${scope}`;
      case 'atWindows': return `Attendance Period Breakdown - ${scope}`;
      case 'atDay': return `Attendance Day Detail ${this.at.activeDay()} - ${scope}`;
      case 'atChildren': return `${this.at.childLabel()} Attendance - ${scope}`;
      case 'atDayCmp': return `Attendance Day Comparison - ${scope}`;
      case 'atDropout': return 'Dropout Risk by District';
      case 'atAlerts': return 'Attendance Alarming Indicators';
      case 'infTypes': return `Infrastructure Overview - ${scope}`;
      case 'infChildren': return `${this.inf.typeLabel()} by ${this.inf.childLabel()} - ${scope}`;
      case 'infGap': return `${this.inf.typeLabel()} Shortfall by District`;
      case 'infEntry': return `Data Entry Compliance by ${this.inf.cadence() === 'year' ? 'Year' : 'Month'} - ${scope}`;
      case 'infEntryRank': return `Data Entry Compliance by District - ${this.inf.activePeriod()}`;
      case 'infAlerts': return 'Infrastructure Alarming Indicators';
      default: return 'Export';
    }
  }

  private exportSubtitle(key: string): string {
    const bits: string[] = [];
    if (this.isSchoolTab()) bits.push(`Source: ${this.ds.source()}`, `Year: ${this.ds.data()?.currentYear ?? ''}`);
    if (this.isAcademic()) bits.push(`Academic year: ${this.ac.activeYear()}`, 'Government / Partially Aided / Fully Aided only');
    if (this.isAttendance()) bits.push(this.at.periodLabel(), 'Government / Partially Aided / Fully Aided only');
    if (this.isInfra()) {
      // caution checks span every type, so naming one would be misleading
      const isCaution = key === 'caution' || key === 'cautionSummary';
      bits.push(`Source: ${this.inf.source()}`);
      if (!isCaution) bits.push(`Type: ${this.inf.typeLabel()}`);
      bits.push(`${this.inf.activePeriod()}`,
        `Data entry: ${this.inf.entry().entryPct}% submitted`);
    }
    if (this.alertKind() && key.toLowerCase().includes('alert')) {
      bits.push(`Category: ${this.alertKind()}`);
    }
    if (this.activeFilterCount() > 0) {
      const f = this.ds.filters();
      const p: string[] = [];
      if (f.mgmt.length) p.push('Management: ' + f.mgmt.join('; '));
      if (f.cat.length) p.push('Category: ' + f.cat.join('; '));
      if (f.stype.length) p.push('School Type: ' + f.stype.join('; '));
      bits.push('Filters - ' + p.join(' | '));
    }
    return bits.join('  |  ');
  }

  /**
   * Context columns prepended to every export so a downloaded file is
   * self-describing:
   *   at district level -> District
   *   at block level    -> District, Block
   *   at school level   -> District, Block, School, UDISE Code
   * Row-level tables add the identifying column for whatever the rows are.
   */
  private contextColumns(key: string): ExportColumn[] {
    const cols: ExportColumn[] = [];
    const level = this.ds.level();
    // Caution rows already carry District / Block / School / UDISE per school,
    // so prefixing scope columns would duplicate them.
    if (key === 'caution') return cols;
    const rowsAreSchools =
      (key === 'drill' && level === 'block') ||
      (key === 'atChildren' && level === 'block') ||
      (key === 'infChildren' && level === 'block') ||
      (key === 'acChildren' && level === 'block');

    if (level !== 'state') cols.push({ header: 'District', field: '_district' });
    if (level === 'block' || level === 'school') cols.push({ header: 'Block', field: '_block' });
    if (level === 'school') {
      cols.push({ header: 'School', field: '_school' });
      cols.push({ header: 'UDISE Code', field: '_udise' });
    }
    // when the rows themselves are schools, carry each school's own UDISE code
    if (rowsAreSchools) cols.push({ header: 'UDISE Code', field: '_rowUdise' });
    return cols;
  }

  /** Attach hierarchy context to each exported row. */
  private withContext(key: string, rows: any[]): any[] {
    const level = this.ds.level();
    const district = this.ds.selectedDistrict() ? this.ds.titleCase(this.ds.selectedDistrict()!) : '';
    const block = this.ds.selectedBlock() ? this.ds.titleCase(this.ds.selectedBlock()!) : '';
    const school = this.ds.selectedSchool() ?? '';
    // UDISE code of the drilled school, from whichever dataset is active
    const udise =
      this.ds.schoolsForBlock().find((s) => s.name === school)?.udise
      ?? this.inf.schoolsForBlock().find((s) => s.name === school)?.udise
      ?? this.at.schoolsForBlock().find((s) => s.name === school)?.udise
      ?? '';

    // lookup for per-row school UDISE codes
    const codeByName = new Map<string, string>();
    if (level === 'block') {
      for (const s of this.ds.schoolsForBlock()) codeByName.set(s.name, s.udise);
      for (const s of this.inf.schoolsForBlock()) if (!codeByName.has(s.name)) codeByName.set(s.name, s.udise);
      for (const s of this.at.schoolsForBlock()) if (!codeByName.has(s.name)) codeByName.set(s.name, s.udise);
    }

    return rows.map((r) => ({
      ...r,
      _district: district,
      _block: block,
      _school: school,
      _udise: udise,
      _rowUdise: codeByName.get(r?.name) ?? '',
    }));
  }

  /** Export a table's COMPLETE dataset, with hierarchy context attached. */
  exportTable(key: string, format: 'excel' | 'csv' | 'pdf'): void {
    const baseCols = this.EXPORT_COLS[key] ?? this.EXPORT_COLS['drill'];
    const columns = [...this.contextColumns(key), ...baseCols];
    const rows = this.withContext(key, this.exportRows(key));
    if (!rows.length) return;
    const req = {
      title: this.exportTitle(key),
      subtitle: this.exportSubtitle(key),
      columns,
      rows,
    };
    if (format === 'excel') this.ex.toExcel(req);
    else if (format === 'csv') this.ex.toCsv(req);
    else this.ex.toPdf(req);
  }

  /** Row count for a table, shown on the export toolbar. */
  exportCount(key: string): number { return this.exportRows(key).length; }

  // ================= INFRASTRUCTURE =================
  readonly infScopeLabel = computed(() => this.ds.titleCase(this.ds.scopeLabel()));
  readonly infStats = computed(() => {
    const t = this.inf.current();
    const e = this.inf.entry();
    if (!t) return [];
    // Buildings & amenities have no entitlement norm, so the availability- and
    // shortfall-vs-norms figures do not apply — show condition instead.
    const noNorms = this.inf.type() === 'building';
    const stats = [
      { label: 'Data Entry Compliance', value: e.entryPct, suffix: '%', icon: 'fa-solid fa-clipboard-check' },
    ];
    if (!noNorms) {
      stats.push({ label: 'Availability vs Norms', value: t.availabilityPct, suffix: '%', icon: 'fa-solid fa-scale-balanced' });
    }
    stats.push({ label: 'Good Condition', value: t.goodPct, suffix: '%', icon: 'fa-solid fa-circle-check' });
    if (noNorms) {
      stats.push({ label: 'School Coverage', value: t.coveragePct, suffix: '%', icon: 'fa-solid fa-school' });
    } else {
      stats.push({ label: 'Shortfall Gap', value: t.gapPct, suffix: '%', icon: 'fa-solid fa-triangle-exclamation' });
    }
    return stats;
  });
  readonly infCounts = computed(() => {
    const t = this.inf.current();
    const e = this.inf.entry();
    if (!t) return [];
    const noNorms = this.inf.type() === 'building';
    const counts = [
      { label: 'Schools Expected', value: inr(e.expected) },
      { label: 'Schools Submitted', value: inr(e.entered) },
      { label: 'Entry Pending', value: inr(e.notEntered) },
      { label: 'Available Units', value: inr(t.available) },
    ];
    if (!noNorms) {
      counts.push({ label: 'Required by Norms', value: inr(t.norms) });
      counts.push({ label: 'Shortfall', value: inr(t.required) });
    } else {
      counts.push({ label: 'Schools With', value: inr(t.schoolsWith) });
      counts.push({ label: 'Need Repair', value: inr(t.needRepair) });
    }
    return counts;
  });

  readonly infOverviewTitle = computed(() => `Infrastructure Overview — ${this.infScopeLabel()}`);
  readonly infCondTitle = computed(() => `${this.inf.typeLabel()} Condition — ${this.infScopeLabel()}`);
  readonly infAvailTitle = computed(() => `${this.inf.typeLabel()} vs Norms — ${this.infScopeLabel()}`);
  readonly infCompareTitle = computed(() => `${this.inf.typeLabel()} ${this.inf.metricLabel()} — ${this.inf.childLabel()}`);
  readonly infGapTitle = computed(() => `${this.inf.typeLabel()} Shortfall by District`);
  readonly infAlertTitle = computed(() => 'Infrastructure Alerts by Category');
  readonly infEntryTitle = computed(() => {
    const unit = this.inf.cadence() === 'year' ? 'Year' : 'Month';
    return `Data Entry Compliance by ${unit} — ${this.infScopeLabel()}`;
  });
  readonly infEntryDonutTitle = computed(() => `Data Entry ${this.inf.activePeriod()} — ${this.infScopeLabel()}`);
  readonly infEntryRankTitle = computed(() => `Data Entry Compliance by District — ${this.inf.activePeriod()}`);

  readonly infEntryTrendOpt = computed(() => {
    const pts = this.inf.entryTrend();
    return pts.length
      ? this.cs.infraEntryTrend(pts, this.inf.activePeriod(), { id: 'infEntryTrend', title: this.infEntryTitle() })
      : {};
  });
  readonly infEntryDonutOpt = computed(() => {
    const e = this.inf.entry();
    return e.expected
      ? this.cs.infraEntryDonut(e.entered, e.notEntered, { id: 'infEntryDonut', title: this.infEntryDonutTitle() })
      : {};
  });
  private infEntryNames: string[] = [];
  readonly infEntryRankOpt = computed(() => {
    const rows = this.inf.entryRanking();
    if (!rows.length) return {};
    const opt = this.cs.infraEntryRanking(rows, { id: 'infEntryRank', title: this.infEntryRankTitle() });
    this.infEntryNames = opt._names ?? [];
    return opt;
  });
  onInfEntryClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const k = this.infEntryNames[e.dataIndex];
      if (k) this.drillChild(k);
    }
  }
  setInfPeriod(p: string): void { this.inf.period.set(p); }

  readonly infOverviewOpt = computed(() => {
    const rows = this.inf.allTypes();
    return rows.length ? this.cs.infraTypeOverview(rows, { id: 'infOverview', title: this.infOverviewTitle() }) : {};
  });
  readonly infCondOpt = computed(() => {
    const t = this.inf.current();
    return t ? this.cs.infraCondition(t, this.inf.typeLabel(), { id: 'infCond', title: this.infCondTitle() }) : {};
  });
  readonly infAvailOpt = computed(() => {
    const t = this.inf.current();
    return t ? this.cs.infraAvailability(t, this.inf.typeLabel(), { id: 'infAvail', title: this.infAvailTitle() }) : {};
  });
  private infCompareNames: string[] = [];
  readonly infCompareOpt = computed(() => {
    const st = this.inf.stateType();
    const m = this.inf.metric();
    const baseline = st ? (st as any)[m] ?? 0 : 0;
    const opt = this.cs.academicCompare(
      this.inf.comparisonRows(), m, this.inf.metricLabel(), '%', baseline,
      { id: 'infCompare', title: this.infCompareTitle() }, this.inf.metricLowerIsBetter(),
    );
    this.infCompareNames = opt._names ?? [];
    return opt;
  });
  onInfCompareClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const k = this.infCompareNames[e.dataIndex];
      if (k) this.drillChild(k);
    }
  }
  private infGapNames: string[] = [];
  readonly infGapOpt = computed(() => {
    const rows = this.inf.gapRanking();
    if (!rows.length) return {};
    const opt = this.cs.infraGapRanking(rows, { id: 'infGap', title: this.infGapTitle() });
    this.infGapNames = opt._names ?? [];
    return opt;
  });
  onInfGapClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const k = this.infGapNames[e.dataIndex];
      if (k) { this.ds.drillToDistrict(k); this.activeSub.set('numbers'); }
    }
  }
  readonly infAlertOpt = computed(() =>
    this.cs.alertBar(this.inf.alertSummary().byKind, { id: 'infAlerts', title: this.infAlertTitle() }),
  );

  setInfType(t: string): void { this.inf.type.set(t); this.alertKind.set(''); }
  setInfMetric(m: string): void { this.inf.metric.set(m as InfraMetric); }

  /**
   * How each infrastructure type's norms / entitlement are calculated. Shown
   * in the norms info (i) popup on every type. Buildings & amenities have no
   * entitlement norm, so it is presence/condition only.
   */
  private readonly INFRA_NORMS_INFO: Record<string, { title: string; norm: string; calc: string }> = {
    classrooms: {
      title: 'Classrooms',
      norm: '1 classroom per 35 students.',
      calc: 'Required = ceil(students ÷ 35). Availability vs Norms = available ÷ required × 100.',
    },
    toilets: {
      title: 'Toilets',
      norm: '1 toilet per 40 students (boys and girls counted against their own enrolment).',
      calc: 'Norm = ceil(boys ÷ 40) + ceil(girls ÷ 40). Availability vs Norms = available ÷ norm × 100.',
    },
    urinals: {
      title: 'Urinals',
      norm: '1 urinal per 60 students (boys and girls counted separately).',
      calc: 'Norm = ceil(boys ÷ 60) + ceil(girls ÷ 60). Availability vs Norms = available ÷ norm × 100.',
    },
    water: {
      title: 'Drinking Water',
      norm: '1 drinking-water point per 150 students (minimum 1).',
      calc: 'Norm = max(1, ceil(students ÷ 150)). Availability vs Norms = taps available ÷ norm × 100.',
    },
    labs: {
      title: 'Labs & Smart Boards',
      norm: '1 lab entitlement for schools above 120 students, plus 1 smart-board provision.',
      calc: 'Norm = lab entitlement + 1. Availability vs Norms = (labs + smart boards) ÷ norm × 100.',
    },
    furniture: {
      title: 'Furniture',
      norm: '1 bench/desk seat per 2 students.',
      calc: 'Norm = students ÷ 2. Availability vs Norms = benches available ÷ norm × 100.',
    },
    building: {
      title: 'Building & Amenities',
      norm: 'No entitlement norm — buildings are assessed by presence and condition, not against a per-student ratio.',
      calc: 'No availability-vs-norms figure. Reported as school coverage and good/repair condition only.',
    },
  };

  /** Info popup for the norms (i) icon on infra types. */
  normsInfoOpen = signal(false);
  readonly normsInfo = computed(() => this.INFRA_NORMS_INFO[this.inf.type()] ?? null);
  openNormsInfo(id?: string): void {
    if (id) this.inf.type.set(id);
    this.normsInfoOpen.set(true);
  }
  closeNormsInfo(): void { this.normsInfoOpen.set(false); }


  /**
   * Drill from an infrastructure alert. The alert carries its own type, so
   * switch the sidebar selection to match — otherwise Numbers would open on
   * whatever type happened to be selected before.
   */
  openInfAlert(a: { district: string; type?: string }): void {
    if (a?.type) this.inf.type.set(a.type);
    this.ds.drillToDistrict(a.district);
    this.activeSub.set('numbers');
  }

  // ---- table ----
  readonly tableRows = computed(() => this.ds.tableRows());
  readonly tableTitle = computed(() => {
    switch (this.ds.level()) {
      case 'state': return 'Districts';
      case 'district': return 'Blocks';
      default: return 'Schools';
    }
  });
  readonly canDrillRows = computed(() => this.ds.level() !== 'school');

  readonly districtOptions = computed(() =>
    this.ds.districts().map((d) => ({ label: this.ds.titleCase(d.name), value: d.name })),
  );
  readonly blockOptions = computed(() =>
    this.ds.blocksForDistrict().map((b) => ({ label: this.ds.titleCase(b.block), value: b.block })),
  );
  readonly schoolOptions = computed(() =>
    this.ds.schoolsForBlock().map((s) => ({ label: s.name, value: s.name })),
  );

  readonly activeFilterCount = computed(() => {
    const f = this.ds.filters();
    return f.mgmt.length + f.cat.length + f.stype.length;
  });

  async ngOnInit(): Promise<void> {
    this.restoreTheme();
    await this.ds.load();
    // academic + attendance load in the background; the school view paints first
    this.ac.load().catch(() => { /* optional dataset */ });
    this.at.load().catch(() => { /* optional dataset */ });
    this.inf.load().catch(() => { /* optional dataset */ });
    this.c1.load().catch(() => { /* optional dataset */ });
    this.rv.load().catch(() => { /* optional dataset */ });
  }

  // ---- theming ----
  toggleTheme(): void { this.themeOpen.update((v) => !v); }
  closeTheme(): void { this.themeOpen.set(false); }

  selectTheme(t: Theme): void {
    this.activeTheme.set(t);
    this.applyTheme(t);
    try { localStorage.setItem(THEME_STORAGE_KEY, t.id); } catch { /* storage unavailable */ }
    this.closeTheme();
  }

  private restoreTheme(): void {
    let id: string | null = null;
    try { id = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* ignore */ }
    const t = this.themes.find((x) => x.id === id) ?? this.themes[0];
    this.activeTheme.set(t);
    this.applyTheme(t);
  }

  private applyTheme(t: Theme): void {
    const s = document.documentElement.style;
    s.setProperty('--gov-blue', t.primary);
    s.setProperty('--gov-blue-dark', t.dark);
    s.setProperty('--gov-blue-light', t.light);
    s.setProperty('--gov-accent', t.accent);
    s.setProperty('--kpi-num', t.kpiNum);
    s.setProperty('--scope-from', t.scopeFrom);
    s.setProperty('--scope-to', t.scopeTo);
  }

  async onMapInit(ec: ECharts): Promise<void> {
    if (this.mapRegistered()) return;
    const echarts = await import('echarts/core');
    const geo = await firstValueFrom(this.http.get<any>('assets/tamilnadu.geojson'));
    (echarts as any).registerMap(this.MAP_NAME, geo);
    this.mapRegistered.set(true);
  }

  /** Drill from a clicked district. */
  onMapClick(e: any): void {
    if (e?.name) this.ds.drillToDistrict(e.name);
  }

  zoomIn(): void { this.mapZoom.update((z) => Math.min(6, +(z * 1.3).toFixed(3))); }
  zoomOut(): void { this.mapZoom.update((z) => Math.max(0.6, +(z / 1.3).toFixed(3))); }
  zoomReset(): void { this.mapZoom.set(1); }

  onComboClick(e: any): void {
    if (e?.componentType === 'series' && typeof e.dataIndex === 'number') {
      const name = this.districtComboNames[e.dataIndex];
      if (name) this.ds.drillToDistrict(name);
    }
  }

  onRowClick(row: { key: string }): void {
    const level = this.ds.level();
    if (level === 'state') this.ds.drillToDistrict(row.key);
    else if (level === 'district') this.ds.drillToBlock(row.key);
    else if (level === 'block') this.ds.drillToSchool(row.key);
  }

  setMetric(m: MapMetric): void { this.ds.metric.set(m); }
  setDonutDim(d: DonutDimension): void { this.ds.donutDimension.set(d); }

  // ================= CLASS 1 ENROLMENT MONITOR =================
  readonly c1Kpis = computed(() => {
    const k = this.c1.kpis();
    if (!k) return [];
    return [
      {
        label: `Expected Class 1 entrants, ${this.c1.currentYear()}`,
        value: inr(k.currentExpected),
      },
      {
        label: `Expected Class 1 entrants, ${this.c1.projectionYear()}`,
        value: inr(k.projectionExpected),
      },
      {
        label: `Change, ${this.c1.baseYear()} to ${this.c1.projectionYear()}`,
        value: `${k.pctChange > 0 ? '+' : ''}${k.pctChange}%`,
        down: k.pctChange < 0,
      },
    ];
  });
  readonly c1ChartTitle = computed(() => 'Expected Class 1 entrants by academic year');
  readonly c1MonitorOpt = computed(() => {
    const rows = this.c1.rows();
    if (!rows.length) return {};
    const years = rows.map((r) => r.year);
    const expected = rows.map((r) => r.expected);
    const actual = rows.map((r) => r.actual);
    const firstProjectedIdx = rows.findIndex((r) => r.projected);
    return this.cs.class1Monitor(years, expected, actual, firstProjectedIdx,
      { id: 'class1Monitor', title: this.c1ChartTitle() });
  });


  setTab(t: string): void {
    this.activeTab.set(t);
    this.alertKind.set('');
    this.cautionId.set('');
    // Infrastructure has no Trend view; fall back to Numbers
    if (t === 'Infrastructure' && this.activeSub() === 'trend') this.activeSub.set('numbers');
    // Review Dashboard has only the District Review cards view
    if (t === 'Review Dashboard') {
      this.activeSub.set('cards');
      this.selectedDomain.set(null);
    }
  }

  // ================= CAUTION =================
  /** Selected caution check; empty means the most severe one with hits. */
  readonly cautionId = signal('');

  /** Checks for whichever tab is active. */
  readonly cautionChecks = computed<CautionCheck[]>(() => {
    if (this.isInfra()) return this.inf.cautionChecks();
    if (this.isAcademic()) return this.ac.cautionChecks();
    if (this.isAttendance()) return this.at.cautionChecks();
    return this.ds.cautionChecks();
  });
  readonly cautionTotal = computed(() => {
    if (this.isReview()) return this.rv.cautionTotal();
    if (this.isInfra()) return this.inf.cautionTotal();
    if (this.isAcademic()) return this.ac.cautionTotal();
    if (this.isAttendance()) return this.at.cautionTotal();
    return this.ds.cautionTotal();
  });
  /** Only checks that actually matched, worst first. */
  readonly cautionActive = computed(() => {
    const order = { high: 0, medium: 1 };
    return this.cautionChecks()
      .filter((c) => c.count > 0)
      .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  });
  /** The check being viewed, defaulting to the most severe with hits. */
  readonly cautionCheck = computed<CautionCheck | null>(() => {
    const list = this.cautionActive();
    if (!list.length) return null;
    return list.find((c) => c.id === this.cautionId()) ?? list[0];
  });
  readonly cautionRows = computed(() => this.cautionCheck()?.schools ?? []);
  setCaution(id: string): void { this.cautionId.set(id); }

  readonly cautionTitle = computed(() => {
    const c = this.cautionCheck();
    const scope = this.ds.titleCase(this.ds.scopeLabel());
    return c ? `${c.label} — ${scope}` : `Caution — ${scope}`;
  });
  /** Toggles the map for the current page only. */
  toggleMap(): void {
    const k = this.mapKey();
    const next = !this.mapOpen();
    this.mapState.update((s) => ({ ...s, [k]: next }));
  }
  toggleFilters(): void { this.filterOpen.update((v) => !v); }

  onDistrictChange(name: string | null): void { if (name) this.ds.drillToDistrict(name); else this.ds.goToState(); }
  onBlockChange(block: string | null): void { if (block) this.ds.drillToBlock(block); else this.ds.goToDistrict(); }
  onSchoolChange(name: string | null): void { if (name) this.ds.drillToSchool(name); else this.ds.goToBlock(); }

  // filter setters (keep signal immutable)
  setMgmt(v: string[]): void { this.ds.filters.update((f) => ({ ...f, mgmt: v ?? [] })); }
  setCat(v: string[]): void { this.ds.filters.update((f) => ({ ...f, cat: v ?? [] })); }
  setStype(v: string[]): void { this.ds.filters.update((f) => ({ ...f, stype: v ?? [] })); }
  clearFilters(): void { this.ds.clearFilters(); }

  /** Full Indian-grouped number (1,23,45,678). */
  fmt(v: number | string): string { return typeof v === 'number' ? inr(v) : v; }
  /** Cr / L for large values, full number below a lakh (never K, never millions). */
  short(v: number): string { return inrShort(v); }

  // ---- PDF export ----
  async exportPdf(): Promise<void> {
    this.exporting.set(true);
    try {
      const [{ default: jsPDF }, html2canvasMod, autoTableMod] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
        import('jspdf-autotable'),
      ]);
      const html2canvas = (html2canvasMod as any).default ?? html2canvasMod;
      const autoTable = (autoTableMod as any).default ?? autoTableMod;

      const el = document.getElementById('capture-area');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();

      pdf.setFontSize(14);
      pdf.setTextColor(27, 58, 122);
      pdf.text('EMIS School Dashboard — Tamil Nadu', 10, 12);
      pdf.setFontSize(10);
      pdf.setTextColor(80);
      pdf.text(`Scope: ${this.ds.scopeLabel()}  |  Year: ${this.ds.data()?.currentYear ?? ''}`, 10, 18);
      if (this.activeFilterCount() > 0) {
        const f = this.ds.filters();
        const parts: string[] = [];
        if (f.mgmt.length) parts.push('Management: ' + f.mgmt.join(', '));
        if (f.cat.length) parts.push('Category: ' + f.cat.join(', '));
        if (f.stype.length) parts.push('School Type: ' + f.stype.join(', '));
        pdf.setFontSize(8);
        pdf.text('Filters — ' + parts.join('  |  '), 10, 23, { maxWidth: pageW - 20 });
      }

      if (el) {
        const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#eef2f7' });
        const imgW = pageW - 20;
        const imgH = (canvas.height * imgW) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 27, imgW, imgH);
      }

      pdf.addPage();
      pdf.setFontSize(12);
      pdf.setTextColor(27, 58, 122);
      pdf.text(`${this.tableTitle()} — ${this.ds.scopeLabel()}`, 10, 14);
      autoTable(pdf, {
        startY: 18,
        head: [['Name', 'Schools', 'Boys', 'Girls', 'Students', 'Teachers']],
        body: this.tableRows().map((r: any) => [
          this.ds.level() === 'block' ? r.name : this.ds.titleCase(r.name),
          this.fmt(r.schools), this.fmt(r.boys), this.fmt(r.girls),
          this.fmt(r.students), this.fmt(r.teaching),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [27, 58, 122] },
      });

      pdf.save('emis-tn-' + this.ds.scopeLabel().replace(/[^a-z0-9]/gi, '_') + '.pdf');
    } finally {
      this.exporting.set(false);
    }
  }
}
