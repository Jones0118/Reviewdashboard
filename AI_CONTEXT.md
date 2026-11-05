# AI_CONTEXT.md — Review Dashboard (EMIS State Monitoring & Review)

> Purpose: a self-contained, AI-readable knowledge base so a new session can
> continue work on this project **without prior chat history**. It documents the
> architecture, data model, conventions, every feature built in the Review
> Dashboard, and the exact code locations/patterns to extend them.
>
> Golden rules when working here:
> 1. **Only modify the Review Dashboard** (the `isReview()` tab / `activeSub()==='cards'`
>    view, `ReviewService`, `kpi-catalog.model.ts`, and the Review sections of
>    `app.html`/`app.scss`). Do **not** change the other dashboards (School,
>    Attendance, Infrastructure, Academic Scores, Class 1 Monitor) or their
>    services except read-only accessors.
> 2. **Never fabricate silently.** When real per-school data is missing, synthesize
>    deterministically (hash of UDISE) and show an **"Assumed data"** badge.
> 3. After every change: `get_diagnostics` on edited files, then run the build
>    (see Build & Verify). Keep the original "Cards" style as default.

---

## 1. Tech stack & how to build

- **Angular 21** (standalone components, signals, new control flow `@if/@for/@switch`).
- **PrimeNG 21** (p-table, p-select, p-multiSelect, p-tag, p-accordion, p-button).
- **ngx-echarts / ECharts** for charts.
- Node/Angular CLI. `git` is **not on PATH**; it's bundled with GitHub Desktop at
  `C:\Users\Emis\AppData\Local\GitHubDesktop\app-<ver>\resources\app\git\cmd\git.exe`.
- Shell is **Windows PowerShell** — `&&` is NOT a valid separator; run commands
  individually. Use dedicated file tools, not `cat`/`sed`/`echo`.

**Build / verify (always do this after edits):**
```
node node_modules/@angular/cli/bin/ng.js build
```
(`npx`/`ng` may be blocked by PowerShell execution policy; call the CLI JS directly.)
Dev server: `node node_modules/@angular/cli/bin/ng.js serve`. Browser needs a hard
refresh (Ctrl+F5) to drop the cached bundle after a rebuild.

**Git remote:** `origin` → `https://github.com/Jones0118/Reviewdashboard.git` (branch `main`).

---

## 2. Project layout (key files)

```
src/app/
  app.ts                      # Root standalone component. Tabs, sub-menus, KPI tile
                              # grid (kpiTiles), scopeValues(), drill open/close
                              # handlers (openModule/openKpi/onTopicTab/closeDomain),
                              # ddVal/ddNum/ddHasData cell formatters, review styles.
  app.html                    # ALL UI. Review Dashboard lives under
                              # @if (isReview()) ... @if (activeSub()==='cards').
  app.scss                    # All styles (kpi-tile, rv-topics, kpi-period, kan-*,
                              # hm-*, palli-*, rv-total, kpi-presabs, etc.)
  models/
    kpi-catalog.model.ts      # KPI_MODULES: the 12-module tile catalog. EDIT HERE
                              # to add/rename/disable module KPIs. Helpers P/N/F.
    enrollment.model.ts       # SchoolRow, AggregateNode, DrillLevel, etc.
    academic.model.ts         # AcademicSchool (has examClass[].subjects[]), etc.
    infra.model.ts, attendance.model.ts, schemes.model.ts, kpi-modules.model.ts,
    real-data.model.ts        # Real EMIS assets (academic/thiran/palli/digital/infra/smc)
  services/
    review.service.ts         # THE review-dashboard brain. Drill rows, columns,
                              # per-KPI predicates, Palli & Academic drills, totals.
    data.service.ts           # Enrollment roll + drill state (district/block/school).
    attendance.service.ts     # scopeSchools(), per-school attendance (by udise).
    academic.service.ts       # scopeSchools(): AcademicSchool[] w/ examClass+subjects.
    infra.service.ts          # scopeSchools(), cautionChecks(), per-school types.
src/assets/                   # Data (mostly gzipped .json.gz). schools.json(.gz),
                              # academic-schools.json.gz, digital-infra-real.json,
                              # infra-schools.json(.gz), schemes.json, kpi-modules.json
```

To inspect gzipped assets in Node:
```
node -e "const z=require('zlib'),fs=require('fs');const d=JSON.parse(z.gunzipSync(fs.readFileSync('./src/assets/academic-schools.json.gz')).toString());console.log(Object.keys(d).slice(0,3));"
```

---

## 3. App shell: tabs & sub-menus (app.ts)

- `tabs`: top menu. In-app tabs: Review Dashboard, School Dashboard, Infrastructure,
  Academic Scores, Attendance, Class 1 Enrolment Monitor. (SLAS/SMC are external URLs.)
- `activeTab` signal; `isReview()`, `isSchoolTab()`, etc. computed guards.
- `ALL_SUB_MENUS`: cards (**District Review**), numbers, trend, comparison, alarming, caution.
- `subMenus` computed:
  - Review Dashboard → only `cards`.
  - All other tabs → everything **except `cards`** (District Review is Review-only),
    and Infrastructure additionally drops `trend`.
- `setTab(t)`: switching to Review sets `activeSub='cards'`; switching away from
  Review while on `cards` falls back to `numbers`.

---

## 4. KPI catalog (models/kpi-catalog.model.ts) — the module tiles

`KPI_MODULES: KpiModule[]`. Each module = `{ title, color, kpis: KpiDef[] }`.
`KpiDef = { id, label, fmt, dir, lo?, hi?, field, topic }`.
- Builders: `P(id,label,dir,lo,hi,field,topic)` = percentage; `N(...)` = number;
  `F(...)` = flag/count. `fmt ∈ 'pct'|'num'|'flag'|'text'`. `dir`: 1 higher-better,
  -1 lower-better, 0 neutral (drives RAG dot).
- **`hide(def)`** sets `tile: false` — the KPI keeps a tile OFF the main
  component-KPI page but stays fully available in "View details": drill columns
  (`moduleKpis()`/`moduleColumns()` do not filter on it), drill KPI tabs, and the
  drill column filter. `kpiTiles()` and `kpiFilterOptions()` are the only two
  places that honour the flag, so every alternate review style (compact/grid/
  table/accordion/kanban/heatmap) follows automatically via `kpiFlatRows()`.
  Currently used by SMC: only the six metric-sheet headlines are tiled
  (m_mh, m_mn, m_ma, m_ek, m_ok, m_gp); the other 11 are `hide()`-wrapped.
- `field` is the `DrillRow` key the KPI reads from (or `null`/`'DERIVED'` → shows "–").
- `topic` activates the drill lens (DrillTopic).

**Current module set & notable state:**
- State Summary, **Enrollment**, **Attendance**, **Infrastructure**,
  **Academic Performance**, THIRAN, Scholarship, **Digital Infrastructure (Middle/High/Hr.Sec)**,
  SMC, **Palli Paarvai**, **Recognition Order - DPS**, **All Children in School**.
- **Schemes Coverage** and **Grievance & Support** are **commented out** (temporarily
  disabled) in this file — wrapped in `/* ===== TEMPORARILY DISABLED ... ===== */`.
  Re-enable by removing the comment wrapper.
- Full metric definitions (formula, unit, direction, RAG band, real/assumed source,
  drill) for every KPI: `D:\general\Dashboard\Review Dashboard – KPI Metrics.md`.

### Enrollment KPIs (flag → per-school list)
zenr Zero enrolment, ztea Zero teacher, stea Single teacher, u10 Under 10,
ptr60 PTR over 60, einc Enrollment increase, edec Declined enrollment,
trn Transition pending %.

### Attendance KPIs
a_s Student attendance %, a_t Teacher attendance %, a_nm Schools not marked %,
a_s60 Schools below 60% student attendance, a_t60 Schools below 60% teacher attendance,
d15 Potential dropout, tl30 Teacher long absent 30+ (assumed ~2%).
- a_s/a_t/a_nm are **percentage KPIs that drill to a filtered school list**:
  a_s → schools with student attendance <75%, a_t → teacher <75%, a_nm → compliance <25%.
- a_s60/a_t60 are REAL (in `REAL_SOURCE_KPIS`): `isBelow60()` is the single rule used by
  the predicate, the per-school 0/1 flag (`schoolKpiValues`) and the district/block
  roll-up (`attBelow60Counts`, reads `AttendanceService.schoolsByBlock` — a read-only
  accessor added for this). **Unmarked schools (compliance 0) are excluded** — they report
  0% for both and are already KPI a_nm. With the current roll both tiles are 0.
- Removed 08-Oct-2026: a_os / a_ot "marked only student/teacher" (were assumed).

### Infrastructure KPIs (per Infra spec md)
gap School with critical gap, i_cl Zero classroom, i_t Zero toilet, i_w No drinking water,
i_e No EB connection (assumed), i_d Building to be demolished, i_cw No compound wall (assumed),
i_need Needs any infra facility, i_k No kitchen shed (assumed).

### Academic Performance KPIs (per "Academic Performance KPI – Final.md")
a_pass Pass %, a_avg Average Mark, a_yoy Year-on-Year Improvement %,
a_e2e Exam-to-Exam Improvement (PP), a_cov Assessment Coverage %, a_cmp Mark Entry Completion %.
- Backed by `academicKpiFields()` from per-period exam stats {avg, pass, compliance}.
- Has an **Assessment toggle (All / Q / H / A)** rendered below the tile; it sets the
  shared `examPeriod` signal which recomputes all academic KPIs + drill.

### Digital Infrastructure KPIs (topic `inf`, ICT lens)
g_i ICT facilities, g_y ICT with internet, g_n ICT without internet,
g_fp ICT functional %, g_ip ICT internet %, g_nf ICT not functional.
- These share catalog topic `inf` but drill under the separate **`dinf`** lens.
- Predicates use **real digital data only** (no assume) so counts match published
  figures. REAL_SOURCE_KPIS includes them.

### Palli Paarvai KPIs (per "Palli Parvai – KPI & Drill-Down Structure.md")
p_co % Class Observation, p_sno % Schools Not Observed (term),
p_ono % Officials Not Observed (month), p_s3 % Schools Observed 3+ Times,
p_low Low performers (<75%), p_top Top performers (≥75%).
- p_s3 rule (clarified 05-Oct-2026): a school qualifies when **any single designation**
  visited it ≥3 times in the month (per-designation threshold, not the sum). The grid has
  a "Visited 3+ by" column; cells ≥3 are red. Clicking a count opens the officials popup:
  S.No · EMIS ID · Staff Name · Office · Target · Observed.

### SMC KPIs (REAL — assets/smc-real.json + smc-detail.json)
**Tiled on the main page (the metric-sheet headlines only):** m_mh Schools where meetings
were held, m_mn Schools where meetings NOT held, m_ma Meeting attendance %, m_ek Emergency
resolutions completion %, m_ok Other resolutions completion %, m_gp Grant utilisation %.
**`hide()`-wrapped — view-details only** (drill columns / tabs / column filter, no tile):
m_mt meetings held, m_r raised, m_c closed, m_p pending, m_k closure rate %, m_e emergency
not closed, m_er emergency resolved, m_or other resolved, m_ou other unresolved,
m_ga allocated (₹ lakh), m_gu utilised (₹ lakh). Grant **utilisation is ASSUMED**, see below.
- Sources: `Resources\SMC\SMC Attendance Abstract ReportReport.csv` (one row per MEETING:
  school, date, present/absent/vacant) + `SMC - All Resolutions ReportReport.csv` (one row
  per resolution: is_emergency, Final status, mapped_department_name) → `ingestSmc()`
  (`node scripts/ingest-real.mjs smc`). The `SMC Planning Report` CSV is a column-subset of
  All Resolutions and is **not** used.
- State figures (full export, 2025-07-24 → 2026-10-01): raised 1,44,715 (resolved 55,239 /
  unresolved 88,165 / withdrawn 1,247 / WIP 64) · emergency 26,803 (7,050 resolved, 19,375
  not — 26.7% completion) · other 1,17,912 (48,189 resolved — 41.2%) · meetings 1,16,027 ·
  attendance 78.4% · 17,499 schools held a meeting of 37,615 eligible (46.5%).
- **Rolling windows.** `SmcPeriodKey = all | p12 | p9 | p6 | p3` (metric sheet: last 1 year /
  9 / 6 / 3 months). Counters are pre-bucketed per window per scope in the ingest and stored
  as **positional arrays** (`SMC_PERIOD_COLS` ↔ `SmcPeriodCol` — keep in sync). Windows are
  anchored to the LATEST date in the export (`anchorDate`), not the clock. `all` is the
  default so the pre-existing tiles are unchanged. The export spans ~14.5 months, so "last 1
  year" legitimately drops ~half the resolutions (72,519 vs 1,44,715).
  `realFields()` reads `smc.p[smcPeriod()]`, so **every SMC tile, drill column and grid is
  window-aware**; changing the period recomputes `drillRows()`.
- **"Meetings NOT held" denominator** = schools in the enrolment roll whose management is in
  `SmcRealAsset.managements` (the 10 government / local-body / welfare managements the SMC
  programme covers — 37,615 schools). Using the full 59,312-school roll would count private
  schools that never had an SMC. Computed client-side in `smcSchoolFields()` from
  `ds.schoolRowsFor()`, since `realFields()` has no access to the roll.
- **Meeting attendance % = present / (present + absent)** — `vacant` SMC seats are not
  absences and stay out of the denominator. `member_count` is unreliable (97,380 of 116,028
  rows have present+absent+vacant > member_count) and is carried for reference only.
- **Grant (metric 4) has NO source** anywhere in `Resources`. Allocation is the published
  composite-grant enrolment slab rule (`compositeGrant()`: ≤30 → ₹10k, ≤100 → ₹25k,
  ≤250 → ₹50k, ≤1000 → ₹75k, else ₹1L) applied to the REAL roll — ₹106.4 cr over 37,615
  schools. **The utilised share is synthesized** (deterministic 55–95% per UDISE via
  `hash01(udise,'smc-grant')` → ₹79.8 cr / 75.0% statewide) and the grant view carries an
  "Assumed utilisation" badge.
- **Dedicated drill** (`selectedDomain()==='smc'`). `smcView()` picks the table:
  `meetings` unit summary (eligible / held / not held / coverage % / attendance) → per-school
  list (auto-filtered to never-met schools when m_mn is active, with last-meeting date) ·
  `all` / `emergency` / `other` resolution completion per unit **plus the department-wise
  abstract** the metric sheet asks for · `grant` allocated vs utilised vs balance.
  `smcActiveTab()` maps any of the 17 SMC KPIs onto the 7 drill tabs.
- `smc-detail.json(.gz)` (9.2 MB / 1.5 MB gz) holds 1,16,027 meetings + 1,44,715 resolutions
  as positional rows with dates as **day offsets from `baseDate`**; loaded lazily by
  `rv.loadSmcDetail()`. It backs the school lists and department abstracts (which need
  per-row granularity at any scope); the unit summaries come off `drillRows()` instead.
- DrillRow fields: smcRaised/Closed/Pending/ClosureRate, smcEmergency(+Open/Raised/Resolved/
  ClosureRate), smcOtherRaised/Resolved/Open/ClosureRate, smcMeetings, smcSchoolsHeld,
  smcSchoolsNotHeld, smcEligibleSchools, smcPresent/Absent/Vacant, smcMeetAttendPct,
  smcGrantAllocated/Utilised/UtilPct.
- **SMC drill changes (05-Nov-2026):** govt-only already via `managements`. Removed the
  "Meetings not held" and "Meeting attendance" KPI tabs (`smcKpiTabs` now m_mh, m_r, m_e,
  m_or, m_ga) and dropped m_mn/m_ma from `SMC_KPI_VIEW` (their tiles still open → fall back
  to m_mh). **Attendance % = present / (present + absent + vacant)** — vacant seats are part
  of the reconstituted member strength, so they now count in the denominator (steering formula
  2). Changed in `realFields` smcMeetAttendPct, `smcMeetingRows/Totals`, `smcSchoolRows/Totals`.
  Meetings-held unit grid: columns Total Schools, Meeting Held, Meeting Not Held, % Schools
  Meeting Conducted (= held schools / total schools), Total Meetings, Members Present/Absent,
  Avg Attendance %; the "Avg per School" column was removed. School drill grid: UDISE, School
  Name, Category, No. of Meetings Held, Avg Attendance %, Present, Absent, Last Meeting
  Conducted Date (Management / Students / Meeting-Held Yes-No / Vacant columns removed; vacant
  still computed for the attendance denominator). "Last 12 months" = the existing `p12` period.
- **SMC month filter (05-Nov-2026):** replaced the rolling-window dropdown with From/To month
  selects. `smcMonthFrom/To` ('YYYY-MM', '' = data ends), `smcActiveFrom/To`, `smcMonthOptions`,
  `smcMonthList`, `smcDayWindow` (floor+ceil day offsets), `setSmcMonthFrom/To`, `smcClearMonths`,
  `smcMonthLabel`. Default From = **June of the latest data year** (2026-06), To = latest month
  (2026-10). Meetings unit grid (`smcMeetingRows`) and resolution unit grid (`smcResolutionRows`)
  are now rebuilt FROM THE DETAIL ASSET grouped by child unit (district at state, block in a
  district) so any month range works — they no longer read the pre-bucketed `drillRows()`.
  `smcScopeMeetings/Resolutions` now filter by `[floor, ceil]`. The grant view still uses the
  full allocation (time-independent). The pre-bucketed `smcPeriod` is retained but unused in UI.
- **SMC resolution school drill + detail (05-Nov-2026):** in the resolution views (all/
  emergency/other), clicking a block (or `smcSelectUnit`) shows `smcResolutionSchoolRows` —
  per govt-school raised/resolved/unresolved/withdrawn/completion%/last-raised, gated by
  `smcResShowSchools` (unit selected or block scope). Each row has a View button →
  `smcOpenResolutionDetail(udise, school)` sets `smcResolutionPick` → `smcResolutionDetailRows`
  lists that school's individual resolutions (Raised On, Department, Level, Emergency, Status)
  for the active view + month range; "Back to schools" via `smcCloseResolutionDetail`. The
  department-wise abstract still renders under the unit/school table but is hidden while a
  single school's resolution detail is open. `smcResolutionPick` is cleared by setSmcKpi /
  smcDrillRow / smcSelectUnit / closeSmcDrill.
- **SMC resolution detail columns + ingest (05-Nov-2026):** the per-school resolution detail
  now shows Raised On, Resolution Category, Sub-category, Department, Level, Status (Emergency
  column removed). Added `cat`/`subcat` to the ingest resolution rows (`category name` /
  `subcategory name` CSV columns), `resolutionFields` now 8 cols, `SmcDetailAsset.cats/subcats`,
  `SmcResolutionCol.cat=6/subcat=7`; re-ran `ingest-real.mjs smc` (values are in Tamil, as in
  source). Removed the "Of which Emergency" column from the department-wise abstract. Renamed
  KPI `m_e` label "Emergency resolutions not closed" → "Emergency resolutions".

### Palli Parvai — user-wise drill + duration KPI (REAL — assets/palli-obs.json, User Stories 4–8)
Source: `Resources\Palli Parvai\PP_Oct_2026_Start and End 20261103.xlsx` → `ingestPalliObs()`
(`node scripts/ingest-real.mjs palli-obs`). October 2026, 1,05,127 observations, 7,948 users,
with observer id + name and start/end time. 5.6 MB / 1.6 MB gz, loaded lazily (`loadPalliObs()`).
Spec: `Resources\Untitled document (1).md` — only User Stories 4–8 were implemented (per user).
- **Where:** inside "% of Class Observation" (no separate tab). Matrix (still ASSUMED, untouched) →
  click a designation → districts (now REAL) → users (US 4) → user's school observations (US 5) →
  View Report (US 6). Plus tab **Observation duration** (`p_dur`, US 7). Breadcrumb `palliCrumbs`
  / `palliGoCrumb` (US 8); date range + search + duration filters are kept across levels.
- **Counting rules (same at every level, all verified to reconcile):** Visited = observation rows
  in the date range. Duration = end − start, valid when 0 < d ≤ `maxValidMinutes` (480 = 8 h —
  sessions left open run to days; 6,363 rows excluded, shown as "Invalid duration"). Target =
  per-officer monthly target from the target sheet (classes/month ÷ sanctioned posts: BRTE 24,
  BEO/DEO/DIET Principal 20, DC/APO 10, CEO 8) × officers × (days in range ÷ 31). Officers =
  distinct users with ≥ 1 observation (zero-observation officers aren't in the export).
  District = roll by UDISE (export text as fallback). Visit % RAG ≥ 90 / 75–90 / < 75; short-
  duration RAG on Under-15 %: < 20 / 20–30 / > 30. Target 0 → Visit % "N/A".
- **Designations:** only the 8 drill designations (`PALLI_DESIG_EXPORT` maps them to raw
  `stackholders`: DEO (Elementary) = "DEO – Primary", DC - 1…8 = DC, APO Secondary/Elementary =
  APO). Head teachers, DI, AEO, DIET lecturers etc. (53,276 of 1,05,127 rows) are outside the 8
  and never appear.
- **Not in the export → SAMPLE values (user asked "with the data do it sample"):** Section (A–D,
  `palliSampleSection`) and the View Report findings (`palliSampleReport`: 8 observation areas
  rated 1–4, score, students present, strength / improvement / follow-up) are generated
  deterministically per observation from `palliObsKey` (day|school|class|user|start) via
  `hash01` — same observation → same sample. Short (< 15 min) observations skew lower (avg score
  49% vs 71.5% for ≥ 30 min). Always badged "Sample" (`*` on Section, amber dashed report box).
  Observer, school, date, class, time and duration remain real. Replace with real data when an
  export with section + report content is available.
- Exports: `exportPalli(view, format)` in app.ts → ExportService (Excel/CSV/PDF, all rows,
  breadcrumb + date range in the subtitle).
- **Low / Top performers (p_low / p_top) are COMMENTED OUT** (on request) in the catalog, the
  Palli tabs, `palliDrillKpis`, the drill columns, `KPI_SCHOOL_PREDICATES` and the @default
  table in app.html. Their computeds remain.

### Recognition Order – DPS KPIs (REAL — assets/dps-real.json)
dp_tot Total pending applications, dp_dist District pending, dp_state State pending,
dp_l15 Pending <15 days, dp_l30 Pending 15–30 days, dp_g30 Pending >30 days.
- Source: `Resources\DPS\RC Pending ApplicationsReport.csv` → `ingestDps()` in
  `scripts/ingest-real.mjs` (`node scripts/ingest-real.mjs dps`). Unit = APPLICATION.
- District vs State from `Pending_with`: district = Pending_in_App_by_deo / Pending_by_deo /
  doc_verifi_pending; state = State_Section_office / State_Superintendent / Pending_by_JD_* /
  Pending_by_director. Buckets are mutually exclusive (sum to total). State totals:
  745 / 453 / 292 / 725 / 9 / 11.
- Dedicated drill (topic `dps`, `selectedDomain()==='dps'` block in app.html): KPI tab bar →
  summary grid by district (or block inside a district) → application list. Service members:
  `dpsKpiTabs`, `dpsKpiId`, `dpsUnit`, `openDpsDrill/closeDpsDrill/setDpsKpi/dpsSelectUnit`,
  `dpsSummaryRows/Totals`, `dpsApplicationRows/Totals`, `hasDpsDrill(id)`.
- DrillRow fields: dpsTotal, dpsDistrictPending, dpsStatePending, dpsLt15, dpsD15to30,
  dpsGt30, dpsAvgDays, dpsMaxDays (populated in `realFields()`; summed in scopeValues).

### All Children in School (ACiS) KPIs (REAL — acis-real.json + acis-students.json + acis-pd.json)
ac_pool Students in Common Pool, ac_surv Surveyed, ac_pend Pending to be surveyed,
ac_sp Survey completion %, ac_adm Admitted to schools, ac_tba To be admitted,
ac_rsn Dropouts with reason recorded, ac_dact Dept. action taken, ac_dpnd Dept. action to be
taken, ac_pd Potential dropouts (15+ days absent), ac_pdp Potential dropout %, ac_pdr PD
repeaters, hide(ac_pdrs) PD reasons, hide(ac_pdg) PD grade-wise. **Nothing is assumed.**
- **Removed on request (do not re-add):** ac_tc TC dropouts, ac_brg bridged & admitted,
  ac_bdur bridging duration, ac_smc to be validated by SMC — from catalog, drill tabs, the
  summary grid (Bridged / SMC Validation / Bridging Days columns) and the child list (Stage /
  Days in Pool columns). The class×gender and month-trend views were removed with them.
- **Not built — no source data (user chose "no fabrication"):** Regularised, PD duration
  buckets, monthly PD trend, cross-year dropout rate. The PD export is a single report window.
- **Standalone "All Children in School" top tab** (`isAcisTab()`, no sub-menu) renders the SAME
  drill as the Review component: the drill markup lives once in `<ng-template #acisDrill
  let-standalone>` at the end of app.html, used via `*ngTemplateOutlet` with `$implicit:false`
  (Review — shows the component topic bar + "Back to all KPIs") or `true` (tab — hides them,
  adds a clickable headline strip `acisTabKpis()` and a District→Block→School back-bar).
  **Edit the ACiS drill only in that template** — both dashboards follow.
- **ACiS tab infographics** (tab only, above the grid): PD and Dropout (common pool), each
  management-wise and grade-wise (`acisPdByManagement/ByGrade`, `acisDropByManagement/ByGrade`
  → `acisMgmtChart()` / `acisGradeChart()` in app.ts). Management = 4 fixed groups from
  `school_type` (`mgmtGroup()`): Government (+Central Govt), Fully Aided, Partially Aided,
  Private (Un-aided); zero groups are kept. PD is 100% Government (the PD report only covers
  govt schools); Dropouts: Govt 41.2% / Fully Aided 10.7% / Partially Aided 5.1% / Private 43.0%.
  Charts read the scoped + filtered rows, so they follow scope and filters.
- **School-category infographic** (ACiS tab, top): `rv.acisByCategory()` → `acisCategoryOpt`.
  Primary / Middle / High / Hr. Secondary (+ "Others" only if non-zero) from School_Category /
  Category. Two side-by-side panels — common pool | potential dropouts — each on ITS OWN scale
  (the pool is ~10× larger; a shared axis flattens PD). State: Hr. Sec 64.3% of the pool / 55.5%
  of PD; Middle is over-represented in PD (12.6% vs 7.7%).
- **ACiS grid style** — every table in the shared drill has `styleClass="p-datatable-sm acis-grid"`
  (styled via `:host ::ng-deep .acis-grid`): zebra rows, wrapped headers, counts in plain dark
  text, colour ONLY on Survey % and PD % as soft pills (`.acis-pill .p-bad/.p-warn/.p-good`),
  `.acis-sep` divider between the dropout and PD column groups; the group-band header row is
  non-sticky so it doesn't overlap the sticky column headers.
- **Dropout rate (REAL, built 30-Oct-2026)** — tab "Dropout rate" (`ac_dr` / `ac_drc`, view
  `droprate`) + two ACiS-tab charts (`acisDropRateOpt`, `acisDropReasonOpt`). N = common-pool
  children NOT re-enrolled (Admit_status ≠ Admitted); D = 2026-27 grade-wise enrolment from the
  roll (`gb/gg[c+2]`, classes I–XII) in the same scope (`scopeRoll()` / `enrolByGrade()`).
  Level-wise (Primary I–V / Upper Primary VI–VIII / Secondary IX–X / Hr. Sec XI–XII), school
  type-wise (4 groups) and grade-wise with reasons (`ACIS_DROP_REASONS`: Migration / CWSN /
  Illness / Child marriage [sub-reason] / Other / Not recorded). School type · gender · class
  filters narrow N and D; CWSN / UMIS hidden there (`acisHideCwsnUmis`) — the roll has neither.
  Tile: `acisDropOut` (pool − admitted) ÷ `acisEnrolI12`. State 2,46,152 ÷ 1,11,06,881 = 2.22%;
  Secondary 5.65% (class 10 = 9.48%). D is the current-year roll, not the previous year's —
  grade-wise enrolment by year (`enrollment.gradeYear`) exists at STATE level only.
- **Still not built (no source):** PD duration buckets, monthly PD trend, Regularised — need
  several dated PD reports; only one window (Sep 1 → Oct 1) and 4 days of attendance exist.
- **Under 15 min % and Invalid duration columns REMOVED** (on request, 04-Nov-2026) from the
  Observation duration table, its totals, the Excel/CSV/PDF exports and the duration filter.
  Invalid (> 8 h / bad timestamp) sessions are still EXCLUDED from the three duration bands —
  they are just no longer displayed. `lt15Pct` / `invalid` are still computed in the service.
- **Duration columns REMOVED from the % Class Observation drill** (on request, 04-Nov-2026):
  district-under-designation table, US 4 user table (Under 15 / 15–30 / ≥30 / Average Duration
  + their totals), US 5 observation list (Duration (min) column + duration filter select) and
  the matching `exportPalli` district / users / userObs columns. Target, Visited, Visit %, RAG,
  drill, search/date filters and the report (which still shows its Duration card) are unchanged.
  Duration lives only in the Observation duration tab (p_dur), which is untouched.
- **RAG Status column REMOVED** (on request, 04-Nov-2026) from the same drill's district and
  US 4 user tables and from their exports. `rag` is still computed per row in the service.
- **Observation duration tab now opens on a designation abstract** (04-Nov-2026):
  `palliDurAbstract` / `palliDurAbstractTotals` — one row per designation (Districts, Total,
  Under 15 / 15–30 / ≥30, Average Duration) across all districts in scope or the district
  filter, plus date range. Clicking a row → `palliDurOpenDesig(g)` sets `palliDurDesig`, which
  shows the existing district × designation table (with an "All designations" back button);
  the count cells there still open the observation list → report. `palliDurDesig === ''` ⇒
  abstract level; reset to '' whenever the p_dur tab is opened. Export view `durAbstract`.
- **User-wise level in the duration drill** (04-Nov-2026): designation abstract → district rows →
  click a district row → `palliDurOpenUsers(d, g)` sets `palliDurUserPick` → `palliDurUserRows` /
  `palliDurUserTotals` (per user: Total, 3 bands, Avg; most under-15 first; search by name/ID).
  User row / "View Observations" → `palliOpenDurList(d, g, 'all', user)`; a band cell →
  that band for that user. `palliDurPick` now has optional `user` and cat `'all'` (= all valid).
  `palliCloseDurList(all = true)`; the list's back button passes `false` to return to the users.
  District-row count cells still open the district-level list directly. Export view `durUsers`.
- **Month filter replaces the date range** (04-Nov-2026): `palliMonth` ('YYYY-MM', '' = latest),
  `palliMonthOptions` (months present in palli-obs, newest first — today only 2026-10),
  `palliActiveMonth(Label)`, `setPalliMonth`. `palliDayRange` = 1st → last day of the month;
  `palliPeriodFactor` is now always 1 (full monthly target). `palliDateFrom/To` are GONE.
  Month select shown on the p_co matrix + p_ono matrix (bar above the @switch), in the p_co drill
  filter bar and in p_dur. One month shared by all tabs. ASSUMED views (p_co matrix
  `palliObsPct`, p_ono `palliOnoCount` / officials) add `palliMonthSeed()` to their hash — ''
  for the latest month so the existing values are unchanged. `openPalliDrill` / `setPalliKpi`
  now always call `loadPalliObs()` (needed for the month list). Exports' subtitle = month label.
  The ingest still reads ONE export file → more months need a merge step in `ingestPalliObs`.
- Requirement doc: `Palli-Parvai-Enhancement-Requirements.md` + `.docx` (v1.1) in the repo root.
- **Asset cache gotcha (fixed 04-Nov-2026):** `loadAsset()` used `cache: 'force-cache'`, so a
  browser kept the FIRST copy of every asset forever — even after a hard refresh — and a
  regenerated `palli-obs.json` (with users / durations) never arrived: the user-wise views showed
  no data. It now uses `cache: 'no-cache'` (revalidate → cheap 304 when unchanged). `loadPalliObs()`
  also rejects an old-format file (no `users[]` / `user` / `durSec`) and shows `palliObsError`
  instead of an empty table. If you change an asset's SHAPE, add the same kind of check.
- **Chart height gotcha:** `.chart` sets width only. Every `echarts` div needs a height class
  (`tall-chart`, `wide-chart`, …) or it renders at 0px.
- **Every ACiS chart carries the app's standard toolbox** via `cs.standardToolbox(id, title, magic)`
  (public wrapper over ChartService's private `toolbox()`): Refresh · Table View · Bar⇄Line
  (grade charts also Stack) · Download → PDF/PNG/JPG chooser. The toolbox `id` MUST equal the
  chart's `registerChart()` id — the download dialog does `charts.get(id)`. Titles carry the
  scope (`acisTitle()`), so files are named e.g. "… — Tiruppur". All ACiS charts are VERTICAL
  columns (categories on x) so Table View lists categories and the Line switch is meaningful;
  `tableHtml()` also falls back to `yAxis[0].data` for any horizontal chart.
- **ONE summary grid, no per-column tabs (user decision 30-Oct-2026).** Columns: Common pool ·
  Surveyed · Pending survey · Survey % · Admitted · To be admitted · Dept. action pending ·
  Potential dropouts · PD % · PD repeaters (CWSN dropped), under grouped headers "Dropouts
  (common pool)" / "Potential dropouts". Tabs are only: District summary (`ac_pool`), Dropout
  reasons (`ac_rsn`), Department action (`ac_dact`), PD reasons (`ac_pdrs`), PD grade-wise
  (`ac_pdg`). Any other ACiS KPI id (incl. headline-tile clicks) opens the summary grid SORTED by
  its column (`acisSortKey`, header highlighted via `acisSortColumn`); `acisActiveTab()` lights
  "District summary" for those. `acisSummaryRows` merges both populations keyed by UPPERCASE
  district/block name or UDISE at school level (union — PD-only schools are kept).
- **CWSN / UMIS filters apply to dropout columns only** (PD report has no such fields); school
  type / gender / class apply to both. Stated in the grid note.
- **School level = two SEPARATE lists with a switch** (`acisSchoolList` 'drop' | 'pd'): common-pool
  children (survey/admit status, reason, sub-reason, department) and potential dropouts
  (reason category, reason, days absent, repeater). Opened together by `acisDrillSummaryRow()`.
- **Line-ending gotcha:** review.service.ts / app.html are CRLF. Any scripted splice must match
  markers with `\r?\n` and must throw when an `indexOf` returns −1 — an unchecked −1 once
  duplicated the whole service file (`slice(0, c) + slice(-1 + len)`).
- **Drill path (both populations): District → Block → School → students with reason.**
  Common pool: `acisDrillSummaryRow()` moves `ds` scope at state/district (names resolved to
  the roll's casing via `canonicalDistrict/Block`), and at block level opens the school's
  children (`acisShowChildren()`). PD: `acisPdDrillRow()` → at block level sets `acisPdSchool`
  (UDISE) → `acisPdStudentRows()` (EMIS, name, class, section, gender, reason category,
  reason, days absent, repeater status).
- Source: `Resources\ACiS\Common Pool - To be Surveyed 2026-27 ReportReport.csv` (the full
  roster: transfer_date = TC date, Survey_Status, Admit_status) + `Common Pool - Surveyed
  students report for 2026-27Report.csv` (reason tree, dropout_bucket, observe_date,
  umis_status) → `ingestAcis()` (`node scripts/ingest-real.mjs acis`).
- **Roster = UNION on EMIS_ID** of both files (7,621 children appear only in the surveyed
  export). State figures: pool 2,91,194 | surveyed 2,68,267 | pending survey 22,927 |
  admitted 45,042 | bridged 43,789 | to-be-admitted 61,333 | to-be-validated (SMC) 2,06,927 |
  CWSN 9,755 | UMIS joined 7,630 | dept action taken/pending 52,345 / 2,15,922.
  38 districts, 415 blocks, 31,777 schools — all join the enrolment roll (415/415 blocks,
  31,775/31,777 UDISEs = 100.0% of the pool).
- **Two assets.** `acis-real.json` (small, eager) holds the 3-scope aggregates for the tiles
  plus state breakdowns `classWise` / `reasonWise` / `deptWise` / `monthWise`.
  `acis-students.json(.gz)` (30 MB / 6.3 MB gz) holds the 2.91 lakh children as **positional
  arrays** with interned `schools`/`reasons`/`subReasons`/`depts` tables; column order is
  `AcisStudentCol` in real-data.model.ts and `fields[]` in the asset — **keep them in sync**.
  Loaded lazily by `rv.loadAcisStudents()` when the drill opens (`acisStudentsLoading()`).
- **Approximations to know:** "bridging duration" = `observe_date − common_pool_date` (there
  is no admission-date column), so it is really "days from entering the pool to being
  reached". "Bridged and admitted" = admitted children with a measurable such gap.
  Department ownership (metric 9) is a **derived mapping** `ACIS_REASON_DEPT` +
  `ACIS_SUBREASON_DEPT` in the ingest (ITI/Polytechnic/nursing → Higher & Technical
  Education, Madrassa → Minorities Welfare, etc.); "action taken" = admitted OR UMIS-joined
  OR deceased.
- **Dedicated drill** (topic `acis`, `selectedDomain()==='acis'` in app.html). `acisView()`
  picks the table from the active KPI:
  `summary` District→Block→School counts → child list · `class` class × gender matrix
  (metric 1 + 5.c) · `reason` reason → sub-reason (metric 8) · `dept` department action
  (metric 9) · `pd` potential dropout + repeaters (metrics 10–11, ASSUMED badge) ·
  `trend` month-wise pool entries from the start of the AY (metric 12).
- **Five metric-sheet filters** (`acisFSchoolType/FGender/FClass/FCwsn/FUmis`, `acisFiltered()`,
  `acisResetFilters()`) narrow every view except `pd`. They are applied once in
  `acisScopeStudents()` (a memoised computed over the 2.91 lakh rows); every other ACiS
  computed reads from it.
- **Potential dropouts are REAL** — `Resources\Enrollment\Potential Dropout StudentsReport.csv`
  → `ingestPd()` → `acis-pd.json(.gz)` (`node scripts/ingest-real.mjs pd`). 29,075 students absent
  15+ of the last 30 days (window 2026-09-01→2026-10-01); repeaters 7,809 from EMIS's own
  `Red_Flag_Status`; 14,107 have no reason recorded ("0" → "Not updated"). The lookup array is
  `schoolRefs` (NOT `schools`, which is the RealAsset per-UDISE map). Positional rows ↔ `AcisPdCol`.
- **PD % denominator = enrolment in the school types the PD report covers** (Government only —
  40,36,861 students) via `pdEnrolled()` / `pdBaseFields()` → `acisPdBase`; state PD % 0.72%.
  The whole roll would dilute it with private schools the report never covers. School type /
  gender / class filters narrow both sides (class uses `gb/gg[cls+2]`, GRADE_ORDER). PD views
  hide the CWSN / UMIS filters (no such fields in the PD report). `kpiFormat` shows sub-1% rates
  with 2 decimals and no "+" for ac_pdp.
- **Encoding gotcha:** never round-trip these files through PowerShell `Get-Content -Raw` +
  `WriteAllText` — PS 5 reads UTF-8 as ANSI and mangles every non-ASCII char (→ ₹ – ×). Use the
  edit tools, or `[IO.File]::ReadAllText(path, UTF8Encoding($false))`.
- DrillRow fields: acisPool, acisSurveyed, acisPendingSurvey, acisSurveyPct, acisAdmitted,
  acisBridged, acisBridgeDays, acisToBeAdmitted, acisToBeValidated, acisWithReason,
  acisDeptTaken, acisDeptPending, acisCwsn, acisUmis, acisPdRepeat.
- **`acisBridgeDays` is an average, not a count** — it is excluded from the summed `keys` in
  `scopeValues()` and handled by the new `WAVG` pass (weighted by `acisBridged`). Any future
  average KPI must go there too, not into `keys`/`PCT`.

---

## 5. ReviewService (services/review.service.ts) — the core

### Drill scope & rows
- Scope comes from `DataService` drill state: state → district → block → school.
- `drillRows()` returns `DrillRow[]` for the current scope's children:
  state→`districtRows()`, district→`blockRows()`, block→`schoolRows()`.
- Each row builder joins Enrollment + Attendance + Academic + Infra + modules by key/UDISE
  and spreads field groups: `moduleFields`, `sampleFields`, `realFields`,
  `enrollmentFields`/`enrollmentFieldsSchool`, `attendanceFields`, `academicKpiFields`,
  `schoolKpiValues` (per-KPI list rows only).
- `DrillRow` is a wide interface (one optional field per KPI). Add a new KPI field here.

### scopeValues() (in app.ts) — tile values
- Aggregates `drillRows()` into a `{field: value}` map for the tile grid.
- Two lists: a `PCT` set (student-weighted average by `n`) and a `keys` array (summed).
- **GOTCHA:** a new percentage KPI must be added to **both** the `PCT` set AND the
  `keys` array, or the tile shows "–" (blank). (This exact bug hit `thiranSharePct`.)
- A third case exists for **averages whose weight is not enrolment** (e.g. average bridging
  days, weighted by the number of bridged children): put those in the `WAVG` map, and keep
  them OUT of `keys`/`PCT` — summing per-district means or weighting them by school roll
  would both be wrong.
- **Prefer the `RATIO` map for percentages.** It recomputes a percentage from its own summed
  numerator and denominator (e.g. meeting attendance % = Σpresent / Σ(present+absent)), which
  is exact, instead of student-weighting per-unit percentages. `RATIO` runs last and
  overwrites whatever `PCT` produced. Currently: smcClosureRate, smcMeetAttendPct,
  smcEmergencyClosureRate, smcOtherClosureRate, smcGrantUtilPct, acisSurveyPct.

### Drill columns
- `defaultTopicColumns()` — per-topic column set (switch on `activeTopic()`), incl.
  a `dinf` case (ICT) distinct from `inf` (physical facilities).
- `moduleColumns()` — columns derived from the **selected module's** KPIs (so the drill
  table matches the clicked module tile). Only applies while the module's topic is active.
- `allTopicColumns()` = moduleColumns if present else defaultTopicColumns.
- `topicColumns()` = allTopicColumns narrowed by the KPI column filter (`colFilter`).
- `kpiListColumns()` / `kpiListBaseColumns()` — columns for the **per-KPI school list**:
  `enr`→enrollmentListColumns, `att`→attendanceListColumns, `inf`→ICT or infra facility
  columns (by `ICT_KPIS.has(kpiListId())`), `dinf`→ictFacilityColumns, else module KPIs.
- Column `fmt`: 'num'|'num1'|'pct'|'pctSigned'|'ptSigned'|'text'|'yesno'|'presAbs'.
  Rendered by `ddVal()` in app.ts. 'yesno' → Yes/No, 'presAbs' → "present/absent".

### Per-KPI school list (flag drill)
- `KPI_SCHOOL_PREDICATES: Record<kpiId, (ctx: KpiSchoolCtx) => boolean>`.
  ctx = `{ row: SchoolRow, infS?, dig?, atS? }` (infra/digital/attendance by UDISE).
- `hasKpiSchoolList(id)` true if a predicate exists → `openKpi` opens the list.
- `kpiDrillRows()` = school-level DrillRows for schools matching the open KPI, scoped,
  each carrying identity (district/block/ctype) + per-school values + facility fields.
- `kpiListId` signal = open KPI; `kpiListAssumed()` true unless id ∈ `REAL_SOURCE_KPIS`
  → shows "Assumed data" badge.
- Row click → `openSchoolFromKpiList(row)` → opens the **read-only school profile
  drawer** (no further drill-down).

### Assumed-data engine
- `hash01(udise, salt)` → deterministic 0..1 (FNV-ish). Stable across renders.
- `assume(udise, kpiId)` → flagged if `hash01 < ASSUMED_RATE[kpiId]`.
- `ASSUMED_RATE` map holds per-KPI shares for KPIs with no real per-school source.
- `REAL_SOURCE_KPIS` set lists KPIs backed by real data (no "Assumed data" badge).

### Grand totals & page size
- `aggregateColumn(rows, col)` → footer total: counts summed; pct/pctSigned/ptSigned/ptr
  **student-weighted averaged** by `n`; text/yesno/presAbs → ''.
- `totalN()` / `kpiListTotalN()` sum students for the footer label.
- Palli footer totals: `palliMatrixTotals`, `palliOnoMatrixTotals`, `palliOnoTotals`, `palliS3Totals`.
- Grids use `[rows]="10" [rowsPerPageOptions]="[10,20,50]" [paginator]="length>0"` and a
  `<ng-template pTemplate="footer">` row styled `.rv-total`.

### Palli Parvai dedicated drill (designation = stakeholder columns)
- `PALLI_DESIGNATIONS` = CEO, DEO – Secondary, DEO – Primary, APO, DC, BEO, BRTE, DIET Principal.
- State: `palliKpiId`, `palliDesignation`, plus KPI-2 drill (`palliSnoDistrict/Block`) and
  KPI-3 drill (`palliOnoDistrict/Designation`). `hasPalliDrill(id)`, `openPalliDrill`,
  `setPalliKpi`, `palliKpiTabs` (switch KPI within the drill).
- Tables (all assumed, deterministic):
  - p_co: district × designation % matrix (+ Overall column + State Average footer).
    Click a designation → designation drill (officials/target/observed/%).
  - p_sno: District → Block → School drill (not-observed counts then school list).
  - p_ono: District × designation count matrix → officials list (user/target/observed=0).
  - p_s3: schools observed 3+ times, per-designation observation counts; a count cell
    opens the **observation detail popup** (`palliObsPopup`: user, date, class).
  - p_low/p_top: district+designation rows below/at-or-above 75%.
- `app.ts openModule('palli')` lands on `p_co`; `openKpi` routes palli KPIs to the drill.

### Academic School → Class → Subject drill
- Opened from a **school row click under the Academic topic** (`drillRow`: if
  `row.level==='school'` && `activeTopic()==='aca'` → `openAcademicDrill(udise, name)`).
- `acaClassRows()` (class-wise Pass%/Avg/Improvement), click a class →
  `acaSubjectRows()` (subject-wise). Respects the Q/H/A `examPeriod`.
- Per-school academic data (`academic-schools.json.gz` → `AcademicSchool.examClass[].subjects`)
  covers only a SUBSET of enrolment schools. **Fallback:** when a school has no record,
  `assumedClassRows`/`assumedSubjectRows` generate deterministic figures and
  `acaDrillAssumed()` shows the "Assumed data" badge. (This was the fix for "not opening"
  — most clicked schools had no academic record so tables were empty.)

---

## 6. app.ts review wiring (key members)

- `kpiTiles()` — the module tile grid at current scope. Each KPI: `{id,label,topic,field,
  value,band,hasData, showPresAbs?,present?,absent?}`. `showPresAbs` on a_s/a_t (present
  green / absent red) and a_nm (marked green / not-marked red).
- `scopeValues()` — see §5 gotcha.
- Review presentation **styles** (dropdown top-right of the Review header):
  `ReviewStyle = 'cards'|'compact'|'grid'|'table'|'accordion'|'kanban'|'heatmap'`.
  Persisted to `localStorage['reviewStyle']`. Default `cards`. `kpiKanban()` groups KPIs
  by RAG band; `moduleBandCount()` for accordion header pills; `kpiFlatRows()` for table.
- Drill open/close:
  - `openModule(topic, moduleTitle)` — "View details". Routes Digital Infra → `dinf`,
    Palli → `openPalliDrill('p_co')`.
  - `openKpi(kpiId, topic, moduleTitle)` — KPI row click. Routes to palli drill /
    per-KPI school list / sort the drill table. Digital Infra → `dinf`.
  - `onTopicTab(topic)` — the drill topic switcher tabs. **Clears selectedKpi, kpiList,
    palli, academic drills** so header+columns+rows follow the new topic (this fixed the
    "header not changing on tab switch" bug).
  - `closeDomain()` — exits the whole drill, resets everything.
- Cell formatters: `ddVal(row,col)` (string), `ddNum`, `ddHasData`, `ddBarPct`.

### Drill topic tabs (`rv.topics`)
enr Enrollment, att Attendance, inf Infrastructure, **dinf Digital Infra**, aca Academic,
thiran THIRAN, scholarship Scholarship, smc SMC, palli Palli Parvai, dps Recognition Order,
**acis All Children in School**.
(Schemes & Grievances `sch` tab is **removed** while those modules are disabled.)
The tab bar is rendered on the generic drill, the per-KPI school list, and the Palli drill
so you can switch components from any view-details page.

### Scholarship scheme-wise counts + block/school drill (04-Nov-2026)
Shown on the **Scholarship "View details" drill** (`selectedDomain() === 'scholarship'`,
the generic district-grid drill in app.html, just AFTER the district/block/school grid table —
NOT in the `activeSub()==='numbers'` overview, which the Review Dashboard never renders).
The 6 schemes come from `kpi-modules.json` (regenerated: Post-Matric SC/SC(A)/ST, NMMS,
Pre-Matric SC/SC(A)/ST, Pre-Matric BC/MBC/DNC, Girl Child Incentive, Special Cash Incentive).
Card title "Scheme-wise counts". Columns: Scheme/Block/School · Amount/Student · Eligible · Payment
Success/Failed/Pending · Success Rate · NPCI Active/Inactive · Aadhaar Not Updated · Amount Paid,
with a Total row and Excel/CSV/PDF (`exportScholar` in app.ts).
- **Level 1 (REAL):** `scholarSchemeRows` — one row per scheme from `kpi-modules.json`
  (`moduleNode().scholarship.schemes`, scope-aware + `scale()`). Amount/Student is a fixed
  SAMPLE constant per scheme (`SCHOLAR_AMOUNT`); Amount Paid = paySuccess × amount.
- **Level 2 (SAMPLE):** click a scheme → `scholarBlockRows` — the scheme's scope figures split
  across the scope's blocks by enrolment weight (× a per-block hash), via `scholarSplit` (last
  unit absorbs the rounding remainder so parts === scope total). Badged "Sample split".
- **Level 3 (SAMPLE):** click a block → `scholarSchoolRows` — the block row split across that
  block's schools the same way. Reconciles to the block row.
- **Level 4 (SAMPLE):** click a school → `scholarSchoolDetail` / `scholarSchoolDetailTotals` —
  that school's per-scheme breakdown (its enrolment share of each scheme × per-UDISE hash),
  `scholarSchool` signal, `scholarOpen/CloseSchool`; "Back to schools" button.
- **Gender filter** (All / Boys / Girls): `scholarGender` + `scholarGenderOptions`,
  `setScholarGender`; `scholarGenderFactor` = scope boys/girls enrolment share, applied via
  `gScale()` to every scheme/block/school/detail count. In the card title.
- State: `scholarDrillScheme` / `scholarDrillBlock` signals; `scholarOpen/CloseScheme`,
  `scholarOpen/CloseBlock`. Totals: `scholarSchemeTotals` / `scholarBlockTotals` /
  `scholarSchoolTotals` (`scholarTotalsOf`). No real block/school scholarship data exists; when
  a UDISE-level export arrives, replace levels 2–3 with real figures.


---

## 7. Drill-down UX contract (what the user expects)

- Click a **flag KPI** → school list showing ONLY matching schools, module/topic columns,
  S.No/District/Block/UDISE/School Name/School Category/Total Students + KPI columns,
  sortable headers, page-size 10/20/50, grand-total footer, row click = read-only
  school profile (no further drill).
- Click **View details** → the module's drill (District→Block→School) with the module's
  KPIs as columns and a matching KPI filter.
- **Component tab in the drill grid** → same thing: `onTopicTab()` resolves the module via
  `moduleTitleForTopic()` (module whose KPIs all share the topic; Digital Infra → `dinf`)
  so the grid shows the module's KPIs, NOT the legacy per-topic prototype columns.
  (Fixed 08-Oct-2026 — previously Infrastructure tab showed Schools with gaps/Main gap/Students.)
- At **school level**, the main drill table shows the same rich layout as the KPI list.
- Switching the topic tab updates header + columns + rows together.
- **Grid conventions (every review grid):** S. No is always the first column; strings are
  left-aligned, numbers/decimals centred. Implemented via `.dr-wrap .num, .rv-modal .num
  { text-align:center }` + `td/th:not(.num) { text-align:left }` scoped to review containers
  (global `.num` stays right-aligned for other dashboards). Data-driven headers must use
  `[class.num]="c.fmt !== 'text'"` (never a hard-coded `class="num"`) so text columns stay left.
- Heatmap style: bordered grid (outer border, row dividers, tinted cell borders), full-opacity
  labels, 150px min cell width.
- Infrastructure drill columns (facility layout): Classroom Available, Boys/Girls Toilet,
  CWSN Toilet, Lab, Drinking Water, Compound Wall, Building to be Demolished, Kitchen Shed.
- Attendance drill columns: Student present %, Boys/Girls absent, Total absent, Teachers,
  Teacher present/absent, Marked status, Potential dropout, Teacher 30+.
- Enrollment drill columns: Boys, Girls, Teachers, Not moved to next class, Enrollment
  change, PTR, Dropout rate, Dropout students.

---

## 8. Known data limitations (do not "fix" by inventing real data)

- Enrolment roll (schools.json) ≫ academic/infra/digital rolls; UDISEs only partially
  overlap. Per-school academic covers a subset → academic drill assumes for the rest.
- Palli Parvai has no per-designation/official source → entire Palli drill is assumed
  (deterministic), badged "Assumed data".
- Grievance/Schemes per-block/school figures don't exist → those modules are disabled.
- Toilets aren't sex-split in the source → Boys/Girls toilet are apportioned.

---

## 9. How to add a new KPI (checklist)

1. Add the `KpiDef` to the right module in `kpi-catalog.model.ts` with a `field` + `topic`.
2. Populate that `field` on `DrillRow` in `review.service.ts` (district/block/school row
   builders, or a `*Fields` helper). Add the field to the `DrillRow` interface.
3. Add the field to **`scopeValues()`** in app.ts — to the `keys` array (always) and the
   `PCT` set (if it's a percentage).
4. If it's a flag that should drill to a school list, add a `KPI_SCHOOL_PREDICATES[id]`
   and (real-data) add id to `REAL_SOURCE_KPIS`, or (assumed) add to `ASSUMED_RATE`.
5. Add a drill column in `defaultTopicColumns()` or the relevant list-columns if needed.
6. `get_diagnostics` on edited files, then build. Hard-refresh the browser.

---

## 10. Feature changelog (what was built, newest first)

- **SMC expanded** to the full metric sheet: meetings-held abstract (held / not held /
  attendance, with the eligible-management denominator), emergency and other resolution
  completion status with department-wise abstracts, composite-grant utilisation, and the
  last 1y / 9m / 6m / 3m rolling-window filter applied to every SMC figure. 12 new KPIs and
  a dedicated drill. Grant utilisation is assumed (no ledger in the export).
- **All Children in School (ACiS)**: 15 KPIs for the 12-metric sheet, real common-pool
  ingest (2.91 lakh children, two CSVs unioned on EMIS_ID), lazy 6 MB student asset, and a
  dedicated drill with five views (summary / class / reason / dept / PD / trend) and the five
  metric-sheet filters. Metrics 10–12 (potential dropout) have no source in the export and
  are badged "Assumed data".
- Recognition Order (DPS) module with real RC-pending data and application-level drill.
- Academic School→Class→Subject drill with assumed fallback + "Assumed data" badge.
- Academic Performance KPIs replaced per spec; Assessment toggle **All/Q/H/A** below tile.
- Rows-per-page selector (10/20/50) + grand-total footer rows across all drill grids.
- Component topic switcher added above Palli KPI tabs and on the per-KPI school list.
- Fixed stale header when switching topic tabs (`onTopicTab` clears per-KPI context).
- Digital Infrastructure: title "(Middle/High/Hr.Sec)", dedicated `dinf` lens + ICT
  columns (Functional Status, ICT facilities, Internet Status, Lab Count); ICT KPIs
  drill to their real matching counts.
- Palli Parvai: full designation-column drill per spec (6 KPIs, District→Block→School and
  District→Designation→Officials, 3+ observation popup).
- "Assumed data" synthesis engine (hash01/assume/ASSUMED_RATE/REAL_SOURCE_KPIS).
- Per-KPI school list for Enrollment + Infrastructure + Digital Infra + Attendance %.
- Review presentation styles switcher (cards/compact/grid/table/accordion/kanban/heatmap),
  persisted to localStorage, default cards.
- District Review restricted to the Review Dashboard tab only.
- Present/absent green-red rendering on attendance % tiles.
- Removed Schemes Coverage & Grievance & Support (commented out, re-enable later).

---

## 11. Quick commands

```
# build
node node_modules/@angular/cli/bin/ng.js build
# serve
node node_modules/@angular/cli/bin/ng.js serve
# git (via GitHub Desktop's bundled git; path has the app version in it)
& "C:\Users\Emis\AppData\Local\GitHubDesktop\app-3.6.6\resources\app\git\cmd\git.exe" status
& "...\git.exe" add <files>
& "...\git.exe" commit -m "msg"
& "...\git.exe" push origin main
```
