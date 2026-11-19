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

- **At a glance: "Key insights by pillar" replaces the old Key insights grid (19-Nov-2026).**
  Request: "replace with this — make this setup in overview page key insights", with reference
  screenshots of a 5-card pillar grid (Access and Equity / Safe and Secure Schools / Learning
  Outcomes First / Social and Emotional Wellbeing / Alumni and Community Mentorship), each card
  showing an icon, a status badge, two metric blocks (headline number + two-segment bar + legend),
  and an "Open pillar" button. Replaced the old single-metric `glanceInsights` grid entirely with
  a new `glancePillarInsights` computed (`glance.ts`) and a `.gl-pgrid`/`.gl-pc` card template
  (`glance.html`/`glance.scss`), one card per `GLANCE_GROUPS` pillar:
  - **Access and Equity**: Average attendance (Present/Absent, `Attendance`/`a_s`) and Children
    out of school — Common Pool (`All Children in School`: `ac_pool` headline, `ac_adm`/`ac_tba`
    split into Admitted/To be admitted).
  - **Safe and Secure Schools**: Schools with no critical infra gap (`Infrastructure`/`gap` vs
    total schools — NOT `i_need`, which renders "–" / is not aggregated at scope level, confirmed
    by reading the Infrastructure module's own tile grid) and Buildings needing attention
    (`Infrastructure`/`i_d` "to be demolished" + the non-tile real field `infRepair` "needs
    repair", read directly off `kv.scopeValues()` since it has no catalog `KpiDef`).
  - **Learning Outcomes First**: Exam pass percentage (`Academic Performance`/`a_pass`,
    Passed/Not passed) and THIRAN students (`THIRAN`/`t_s` headline, `t_bl` BLO attainment %
    split into Caught up/Still below level — the same real id `glanceCompletion` already uses).
  - **Social and Emotional Wellbeing**: codebase-wide search (models, services, kpi catalog,
    assets) found zero fields for sports period, counselling, SEL, or wellbeing anywhere — this
    card has no metrics and shows "No KPI data source exists yet for this pillar in the
    dashboard" with a grey "Not built" badge, instead of the reference's fabricated "68% daily
    sports period" / "62,400 referred for counselling" numbers.
  - **Alumni and Community Mentorship**: Vizhuthugal (Alumni) and NSNOP have no backing data
    either; SMC is the one real module under this pillar, so its two headline metrics stand in —
    Schools holding SMC meetings (`smcSchoolsHeld`/`smcSchoolsNotHeld`, direct fields) and SMC
    resolutions (`smcRaised`/`smcClosed`/`smcPending`, same real figures the old Key insights SMC
    card already used).
  - "Open pillar" reuses the existing in-page `setGlanceView(id)` sidebar navigation (jumps to the
    pillar's first built submenu item, or its first item's "not built yet" stub when nothing in
    the pillar has data — verified both paths live: Wellbeing → Co-curricular/not-built stub,
    Safe and Secure Schools → Physical Infra module page).
  - Removed now-fully-dead code with the old grid: `glanceInsights`, `palliTargetPct` (its only
    caller), `attWindow`/`glanceDays` (fed only the old attendance card's sparkline, no template
    control existed for `attWindow`), and the `glanceSpark` sparkline-geometry helper. Kept
    `glanceColor` (still used by `glanceCompletion`) and `palliByDesig`/`PALLI_DESIGS`/
    `palliMonth`/`palliMonths` (still used by the Palli Paarvai module page's designation chart).
  - Build-clean (`ng build` exit 0) and verified live via headless Chrome: all 5 cards render
    with real figures (e.g. attendance 89.0%, THIRAN 7.44L identified · caught up 94%, SMC
    resolutions 1,44,715 raised), status badges computed from real catalog bands (Watch/Off
    track/On track), and the Wellbeing card's honest no-data state.

- **At a glance: Attendance page cleanup — KPI tiles, readout, team table, pluralization
  (19-Nov-2026).**
  - **Removed the shared `.gl-kgrid` KPI tile grid** for the Attendance module page only
    (`@if (gm.module !== 'Attendance') { ... }` wraps it in `glance.html`). Every other module
    page (Palli Paarvai, Academic Performance, etc.) still shows its tile grid — only Attendance's
    7 flat tiles were called out as redundant with the richer "Where am I?" cards below them.
  - **Removed the "Where am I?" narrative readout note box** (the bullet-point sentence summary,
    e.g. "Student marking compliance for Tamil Nadu is 82.5%…"). Deleted both the template usage
    and the now-unused `attPageReadout` computed from `glance.ts` entirely (not just hidden).
  - **"How is my team doing?" table rewritten to the exact reference layout**: 5 columns —
    District/Block/School (dynamic) / Total Schools / Total Working Schools / Marked by Schools /
    Marked %. Added a `markedPct` field to `attPageUnitRows` (`working && markedToday != null ?
    round(markedToday/working*1000)/10 : null`) to back the new last column.
  - **Fixed a double-plural / plural-where-singular-expected bug** found while verifying the
    table rewrite: `attPageUnitLabel` previously returned `at.childLabel()` directly, which is
    already plural ('Districts'/'Blocks'/'Schools'). Several template spots append their own 's'
    (e.g. `{{ attPageUnitLabel() | lowercase }}s` → "districtss"), and others expected a singular
    noun ("Find a {{ attPageUnitLabel() | lowercase }} by name" → "Find a districts by name", the
    table's first column header showing "Districts" instead of "District"). Changed the computed
    to strip a trailing 's' (except the 'This School' school-scope label, which has none to strip)
    so it returns the singular form, matching the convention `palliUnitLabel` already used on the
    Palli Paarvai page. Verified post-fix via headless Chrome text extraction: count line reads
    "38 of 38 districts", search placeholder "Find a district by name", table header "District",
    peer-chart labels "District average (mean of 38)" / "Best district (Tirupathur)".
  - All three changes build-clean (`ng build` exit 0) and confirmed live via headless-Chrome
    screenshot: KPI grid gone, readout gone, 5-column table rendering real numbers (e.g. Tiruvallur
    2,057 schools / 535 working / 389 marked / 72.7%), gender/category/peer charts and the 14-day
    trend chart all still rendering correctly.

- **At a glance: sidebar/content cleanup (19-Nov-2026).**
  - **"Key trends" section removed** from the Overview page (the 5-chart card: Attendance,
    Enrolment, Palli Paarvai observations, Exam progression, All Children in School). Removed
    the chart-only TS members with it (`ATT_WINDOWS`/`setAttWindow`/`glanceAttPoints`/
    `glanceAttDays`/`glanceAttOpt`, the whole `ENROL_MGMT`/enrolment-trend group, `glancePalliOpt`
    + `setPalliMonth`, the whole `EXAM_TYPES`/exam-progression group, the whole `ACIS_MGMT`/ACiS
    chart group incl. `rv.loadAcisStudents()` in `ngOnInit`), the shared `ANIM`/`V3_AXIS` chart
    style objects, and the now-unused `NgxEchartsDirective` import — the Overview page has no
    ECharts instances left (headline panel and insight-card sparklines are hand-rolled SVG).
    Kept everything the **Key insights** cards still depend on: `attWindow`/`glanceDays` (feeds
    the Student attendance sparkline), and `palliMonth`/`palliMonths`/`palliObsInScope`/
    `palliByDesig`/`palliTotal`/`palliLoading`/`PALLI_DESIGS`/`palliTargetPct` (feeds the Palli
    Paarvai observation % card). Verified with a template + cross-reference grep before deleting
    each symbol.
  - **Sidebar: "3. Learning Outcomes First" gained an "Attendance" item** (`id: 'attendance'`,
    `module: 'Attendance'`, same KPI-catalog module the Key insights "Student attendance" card
    and the completion/attention lists already read — no new data path).
  - **"School Governance"** (`id: 'governance'`) now has `module: 'Palli Paarvai'` (was `null` /
    "not built yet"), so its submenu page lists the real Palli Paarvai tiled KPIs with a "View
    details" link into the Review Dashboard drill, the same pattern "Classroom Teaching &
    Engagement" and "District Governance" already use for the same module (one module backing
    several sidebar items is an established pattern here, not new). Requested with a reference
    file `D:\general\Dashboard\Resources\School-Education-Dashboard-with-Palli-Paarvai.html`; that
    file's school list and observation counts are fabricated demo rows (`D.S` array, names like
    "PUPS Ariyalur 1-01"), not a real export, so its data was **not** copied in — only the idea
    (surface Palli Paarvai under this item) was kept, wired to the app's real observation data per
    the no-fabrication rule elsewhere in this doc.

- **At a glance: Palli Paarvai analytics page (19-Nov-2026).** "Build the entire dashboard from
  the template" — the reference file `School-Education-Dashboard-with-Palli-Paarvai.html` turned
  out to be an earlier **Download HTML** snapshot of this very app (same six domain groups, same
  breadcrumb style — confirmed by opening it headless and diffing its nav text against
  `GLANCE_GROUPS`), with one richer "Palli Paarvai" page hand-bolted onto group 3 using fabricated
  demo data (its own UI said so: *"Sample dataset… does not reconcile to the Overview card"*).
  So "the entire dashboard" already matched; the one real gap was that richer page. Built it for
  real, reusing the exact plumbing the main Review Dashboard's Palli drill already uses — no new
  data path, no fabrication:
  - `rv.drillRows()` (the same computed the District Review grid reads) gives one row per child
    unit of the current scope — districts at state, blocks at district, schools at block — each
    carrying real `palliClassObsPct` / `palliSchoolsNotObsPct` / `palliOfficialsNotObsPct` /
    `palliSchools3PlusPct` (`realFields()` in review.service.ts). `palliUnitRows` in glance.ts
    wraps this with a real school count (`unitSchoolCount()`, read from `ds.districts()` /
    `blocksForDistrict()`, not the row's own possibly-scaled count) and a catalog band.
  - **"Where am I?"**: the 4 existing KPI tiles, a `palliReadout()` narrative (best/lowest child
    unit, how many are below the scope figure, schools-not-observed / officials-behind), an
    "Observations by designation" bar chart (`glancePalliDesigOpt`, resurrected from the
    `palliByDesig` computed that survived the Key-trends removal) and a "Comparison with peers"
    bar chart (`glancePalliPeerOpt`: this scope vs the best and worst child unit on % of Class
    Observation).
  - **"Weekly observation activity"**: real weekly observation counts from the last 8 weeks
    present in `palli-obs.json`, scoped to the selected district/block (`palliWeekly`, built the
    same way `palliObsInScope` already filters). A weekly target line is overlaid **only at state
    scope** (`palliWeeklyTarget`: the real monthly target model ÷ ~4.33) — there's no real
    target subset below state level, so the line is left off rather than invented, same rule
    `palliTargetPct` already follows.
  - **"How is my team doing?"**: a searchable, clickable unit table (`palliUnitRows`, filtered by
    `palliUnitSearch`) with a "Copy table as CSV" button (`copyPalliCsv()`, clipboard). Clicking a
    row drills (`drillPalliUnit()` → `ds.drillToDistrict`/`drillToBlock`), consistent with the
    rest of the glance page being scope-driven from the header dropdowns.
  - Deliberately **not** ported from the template: the A–E five-band colour grading (this page
    reuses the existing 3-band good/watch/off-track pills everywhere else on /glance instead of
    adding a one-off scale) and the "Learning outcomes by subject" breakdown (Palli Paarvai is a
    school-visit-observation programme with no subject-wise learning-outcome measure of its own —
    that figure belongs to Academic Performance / Board Exam, and porting it here would have meant
    fabricating a metric that doesn't exist for this programme).
  - Brought `NgxEchartsDirective` back into the page's imports (removed in the Key-trends cleanup
    above, now genuinely needed again for the two new charts).
  - **SHOW: Performance / Compliance toggle (19-Nov-2026, on request)** — the one piece of the
    template initially left out without being flagged as a fabrication issue (unlike the A-E
    grading and the subject breakdown, this one maps straight onto real data). `palliShow` signal
    ('performance' | 'compliance') drives `palliShowId`/`palliShowField`/`palliShowLabel`:
    Performance = `p_co` (% of Class Observation), Compliance = `p_s3` (% of Schools Observed 3+
    Times) — both already-real KPIs. Switching it re-points `palliUnitRows`' band, `palliReadout`
    and `glancePalliPeerOpt` at the selected measure, and highlights the matching column (with its
    band pill) in the unit table instead of always showing it on % Class Observation.

- **At a glance: Attendance analytics page (19-Nov-2026)** — same treatment as Palli Paarvai,
  for the reference design `D:\general\Dashboard\Resources\TN Attendance Dashboard.html`
  ("Attendance Dashboard": SHOW Students/Teachers × METRIC Marking status/Attendance %, Where
  am I? / Comparison with peers / How much have I improved? / How is my team doing? / Standard
  reports). Checked first what's real in `AttendanceService`/`attendance.model.ts` (via
  context-gatherer): no gender or school-category field exists anywhere in `AttendanceNode`/
  `AttendanceSchool`, so the reference design's gender+category breakdown chart could not be
  built with real data. Everything else maps onto real fields:
  - `attPageShow` ('students'|'teachers') × `attPageMetric` ('marking'|'attendance') drive
    `attPageField()` → `compliance` (marking, not split by student/teacher — a single school-day
    marking event covers both) or `attendance`/`teacherAttendance`.
  - **"Where am I?"** 3 KPI cards are a genuine **single-day snapshot** (`attPageToday()` = the
    last entry of the current scope's own `AttendanceNode.daily[]`, never the shared
    `AttendanceService.day`/`.window` signals, so this page never perturbs the main Attendance
    tab): present/expected (or tPresent/tExpected) %, marked/schools %, and the real `unmarked`
    count — these reconcile exactly (`marked + unmarked = schools` from the same day record).
  - **Breakdown chart**: by **management** (`at.byManagement()` — Government / Partly Aided /
    Fully Aided), the real axis this data has, substituted for the reference design's gender ×
    school-category chart with a dashed state-average line.
  - **Peer comparison**: reuses `at.children()` (already scope-reactive — districts at state,
    blocks at district, schools at block); distinguishes "my position" (the scope's own pooled
    figure) from "{unit} average" (the plain mean of the children, matching the reference
    design's distinct "state average: mean of 38 districts" bar) from the best child.
  - **Trend** ("How much have I improved?"): 14 days / weeks / months built ad hoc from the
    real `daily[]` (already working-days-only); weekly/monthly are a plain average of the daily
    %, labelled as such.
  - **Unit table**: `at.children()` again, with each child's own latest-day marked/pending count
    and the real school count (`unitSchoolCount()`, shared with the Palli page). Search, CSV
    (`copyAttPageCsv`), click-to-drill (`drillUnit` — renamed from `drillPalliUnit` since both
    pages now share it).
  - **"Standard reports"**: four links straight into the real catalog KPIs (`a_s60`, `a_t60`,
    `d15`, `tl30`) via the existing `openGlanceKpi()` — no new navigation. `tl30` is flagged
    "estimated" in this list, since it's the one assumed field here (`estimateLong30()`: a flat
    2% of teaching staff, no real per-teacher leave-duration source — confirmed via the same
    context-gatherer pass).
  - **19-Nov-2026, on request: split into two real graphs.** Re-checked `AttendanceSchool` and
    found `ctype` real and populated with exactly the reference design's four categories
    (`Primary School` / `Middle School` / `High School` / `Higher Secondary School`, confirmed
    straight from `attendance-schools.json`) — the earlier research had missed this field, so
    "by school category" is now its own **real** chart (`attPageCategoryRows`/
    `glanceAttPageCategoryOpt`, grouped from `at.scopeSchools()` by `ctype`, weighted by
    `enrolled`, with the state-average dashed line), replacing the "by management" substitute.
    Gender remains genuinely unavailable as a rate (confirmed again: no boys/girls field
    anywhere in `AttendanceNode`/`AttendanceSchool`) — rather than apportion a fabricated
    differential, `attPageGenderRows`/`glanceAttPageGenderOpt` plots the real scope-wide figure
    on both bars with the real enrolment counts (`ds.current().boys`/`.girls`) in the label, and
    the chart's own subtitle says plainly that the rate is the same because no split exists.

- **At a glance → standalone HTML (18-Nov-2026).** Two pieces, no second copy of the KPI logic:
  - **"Download HTML" button** in the glance header (`GlancePage.exportHtml()`, `exporting` signal).
    Clones the component host as rendered — current scope, filters, chart windows, open submenu
    item — and writes ONE self-contained file: every `<style>` Angular / PrimeNG injected plus
    the linked sheets (global, Font Awesome, primeicons, Google Inter / Noto Tamil) inlined, with
    `url(...)` font and icon files embedded as data URIs (`inlineCssAssets`, 2 MB cap per asset);
    each ECharts canvas becomes a PNG via `echarts.getInstanceByDom(el).getDataURL()`; dropdowns
    become the filter-summary text, buttons are disabled, non-active chart chips removed, entrance
    animations switched off, sticky bars made static. Footer line records scope · filter · time.
    File name `At-a-Glance-<Scope>-<yyyy-mm-dd>.html`, ~3.7 MB (fonts dominate).
  - **`scripts/snapshot-glance.mjs`** (`npm run snapshot:glance [baseUrl] [outDir]`): drives
    headless Chrome / Edge over the DevTools protocol (Node 22+ global WebSocket, no puppeteer),
    opens `/glance` on the running dev server, signs in with `DASHBOARD_USER` /
    `DASHBOARD_PASSWORD` (gen-auth defaults), waits for the lazy assets and ≥ 4 chart canvases,
    presses the page's own Download HTML button and waits for `Browser.downloadProgress`. First
    output: `At-a-Glance-Tamil-Nadu-2026-11-18.html` at the repo root (state scope, all schools).
  - Observed in that snapshot (live-page behaviour, not an export bug): the Needs-attention list
    shows Teacher attendance % and Student attendance % twice, because the same KPI is tiled in
    both State Summary and Attendance. Worth de-duplicating in `glanceAttention` by KPI id.

- **Board Exam tab (17-Nov-2026):** top-menu tab after "Academic Scores X & XII". Source:
  `D:\general\Dashboard\Resources\Board Exam` (six PDFs: 10th/12th STATE_REPORT_GOVT, and
  ARIYALUR 10th/12th DISTRICT_REPORT GOVT/AIDED). Ingest `scripts/ingest-board.py` (Python +
  PyMuPDF; `python scripts/ingest-board.py`) → `src/assets/board-exam.json` (~200 KB).
  - **State reports are image-only PDFs** (no text layer). The 38-district tables for both
    classes were transcribed by hand into `STATE_ROWS` in the script and **verified**: the
    district "appeared" figures sum exactly to the printed state totals (4,07,044 / 3,50,353).
    Govt schools only. Section B trend lines (2022-26, district / state / best) are also
    transcribed (`TREND`).
  - **District reports** are parsed from text: section A (by management: schools, appeared,
    pass/avg with YoY delta, state pass/avg, supplementary), section D (subject pass % and
    average marks by management; a management row whose PDF cells are blank cannot be mapped
    positionally and is marked `reliable:false` and omitted — 12th Other Govt Depts / Private),
    and the school annexure via `page.find_tables()` (10th: 27 cols over 2 pages; 12th: 24-col
    identity table + subject continuation table keyed by school name). Section C counts
    (subject × category, school × category, this year and last) are **recomputed from the
    annexure rows** and match the printed stacked bars exactly (e.g. 10th school cats
    10/51/26/32; Maths 10/24/43/42). Category bands: avg >70 Good, >60 Satisfactory, >50 Needs
    Improvement, ≤50 Poor. The ↑/↓ glyphs are U+2B06/U+2B07, minus is U+2212.
  - **School reports** (`<UDISE>*.xlsx`, one per school, two years side by side, school vs
    district vs state, ranks, rating) are parsed by `parse_school_report` into
    `classes[cls].schoolReports[udise]`. Today: 33320100206 (10th), 33320101202 (12th). Their
    STATE rows are the only state-level per-subject source and feed the state-scope subject chart.
  - Code: `models/board-exam.model.ts`, `services/board-exam.service.ts` (`BoardExamService`,
    `be` in App), `app.html` `@if (isBoardExam())` block, `app.scss` `.be-*`. Layout follows the
    other dashboards: shared sub-menu **Numbers / Trend / Comparison** (no Alarming / Caution),
    Class X / XII toggle in the control bar, scope = shared breadcrumb State -> District -> Block ->
    School (`units()` = the children of the scope: districts / blocks / annexure schools; block
    names and annexure UDISEs match the roll exactly, so `ds.drillTo*` is used throughout).
    Numbers: 3 KPI cards (pass %, average mark, appeared) + category pill, pass-% and average-mark
    bar charts by unit (colour = category band, dashed reference line), subject-wise chart,
    performance-category chart (this year vs last), subject x category stacked bars (district /
    block), results-by-management table (district), drill table with export (`beUnits`). School
    scope shows the school report (or the annexure row). Trend: 5-year lines (state / district /
    best), subject two-year bars, YoY change by unit. Comparison: top/bottom N by metric,
    management vs state (district). Only ARIYALUR has district / block / school detail; other
    districts show their state-report row and a notice.
  - To add more districts: drop their `<DISTRICT>_{10th,12th}_DISTRICT_REPORT_{GOVT,AIDED}.pdf`
    in the Resources folder, extend the `for mg in …` loop to iterate districts, rerun the ingest.

- **Board Exam: requirement build-out (17-Nov-2026).** Implements the gaps between the tab as
  first built and `C:\Users\Emis\Downloads\Board Examination Dashboard — Requirements and AI
  Prompts.md` (12 modules). Everything lives in `BoardExamService` + the `@if (isBoardExam())`
  block; no other dashboard was touched.
  - **Module 1 — global filters.** `fMgmt` / `fCtype` / `fYear` signals next to `cls`, with
    `resetFilters()`, `filterChips()` (shown as `.be-chip` pills with the geographic level) and
    `filterScopeNote()` (says so when a filter cannot reach the figures on screen). They apply
    immediately (the other dashboards behave that way) — there is no separate "Apply" button.
    Management maps through `mgmtGroup()`, which folds both the printed annexure values and the
    roll's long management names onto the report's four groups; **"UNAIDED" contains "AIDED", so
    private is tested first** and `School Education Department School` is matched before the
    generic `DEPARTMENT` rule. Category Type is **not in the board reports** — it comes from the
    enrolment roll's `ctype` by UDISE (`ctypeByUdise`), so it only narrows annexure-backed views.
    Academic Year offers the two years the reports carry; the previous year is derived as
    `value − change` by `py()`, and `pd()` returns null for it, so every change column reads N/A.
    `scopeSchools()` is now the **filtered** annexure list, `annexureSchools()` the raw one.
  - **Assumed district detail (`assumedDistrict`).** The 37 districts without a printed report
    are no longer dead ends. Real anchors: the district's state-report row (schools, appeared,
    pass, avg and both changes), the enrolment roll (name, UDISE, block, management, category,
    real class X / XII enrolment → `appeared`; schools with no class X / XII roll are dropped)
    and the reference report's real subject shape (`subjectShape()`, section D Govt SED offsets
    from All Subjects), per-management state figures and state / best-district trend series.
    Only the per-school spread is synthesized, deterministically from the UDISE (`hash01`), so a
    school's figures never change between visits. Verified: the assumed Govt SED weighted pass
    and average land within ~1 point of the district's printed row, and the assumed government
    school counts total 6,370 (printed 6,269) for class X and 3,261 (3,178) for class XII.
    `assumed()` drives an **"Assumed data" badge** on every card, table and export subtitle.
    `norm()` now carries a `DISTRICT_ALIAS` table (TRICHY→TIRUCHIRAPPALLI, OOTY→THE NILGIRIS,
    PUDUKOTTAI→PUDUKKOTTAI, TUTICORIN→THOOTHUKKUDI, KANYAKUMARI→KANNIYAKUMARI, VIRUDHU NAGAR,
    TIRUPPATHUR (V)→TIRUPATHUR, KALLACURICHY, TIRUVALLORE→TIRUVALLUR, RANIPETTAI→RANIPET), so
    **all 38 report rows now match the roll** (10 did not before).
  - **Modules 3 & 4 — the pass-% and average-mark trends are both on screen** in the Trend view
    (`passTrendOpt` / `avgTrendOpt` from one `trendChart(metric)`); the metric toggle now only
    drives the by-unit change chart. Clicking a point calls `pickTrendYear()`: the x axis is the
    exam year (2026 = AY 2025-26), so 2026 / 2025 switch the dashboard year and older points
    return a note instead of pretending there is detail behind them.
  - **Modules 5 & 6 — the category charts are clickable.** `openCat(cat, subject?)` sets
    `catPick`; `catUnits()` lists the schools (or districts at state scope) behind the bar, with
    drill-through and export (`beCatUnits`). The subject chart defaults to **100% stacked**
    (`stack100`, with a "% share / Counts" toggle) and its tooltip carries both the count and
    the share. When a filter is active the denominators are recomputed from the filtered
    annexure population rather than the printed report totals, and the card says so.
  - **Module 7 — Needs Your Attention.** `alerts()` → Critical / Watch cards (`.be-alert*`),
    each with the issue, scope, subject, affected schools, current / previous / change, a
    recommended action and an Open button (`openAlert`). Rules: pass-% fall, average-mark fall,
    pass % below a floor, share of schools rated Poor, and subjects sitting in a weak band.
    Thresholds live in `BOARD_THRESHOLDS` / the `thresholds` signal and are editable in the UI
    (`beThreshOpen`, `beThresholdFields`, `setThreshold`, `resetThresholds`). Items are
    de-duplicated by id and sorted by severity then magnitude; decline rules are **suppressed on
    the previous-year view**, which has no comparison year in the reports. Export: `beAlerts`.
  - **Module 8 — Grid 1.** `subjectMgmtGrid()` transposes section D into management rows ×
    subject columns (plus All Subjects), each cell showing the figure and its change, with a
    Pass % / Average mark toggle (`gridMetric`), category shading on the average-mark view and
    conditional up/down colouring. Section D has no "All Managements" column, so the Management
    filter **highlights** its row (`.be-me`) instead of reducing the table. Export
    (`beSubjectGrid`) is long format — one row per management and subject — so the columns stay
    fixed across classes.
  - **Module 9 — Grid 2** is the existing drill table at state scope, retitled "District
    Performance Ranking", with the improvement columns labelled `2024-25 → 2025-26`, a search
    box, `N/A` instead of blanks, and a footnote on how pass % and rank are derived.
  - **Module 12 is not built**: the dashboard reads a static asset, so server-side aggregation,
    role-based access and audit are out of reach here. The honest notes in the UI say which
    figures are printed, derived or assumed.

- **Board Exam: layout and consolidation follow-ups (17-Nov-2026).**
  - **Unit charts show a slice, not all 38 districts.** `unitRank` (Top / Bottom) + `unitCount`
    (5 / 10 / 20 / All, `unitCountValue` for the `<select>`) drive both the pass-% and
    average-mark charts through `unitSlice(metric)` → `passChartRows` / `avgChartRows`.
    **Default: top 5.** Each card has a "View all N" link (`viewAllUnits()`, highest to lowest)
    and a "Top 5 only" link back; `unitSliceLabel()` says what is on screen and
    `unitChartHeight()` follows the number of bars drawn. The two charts rank independently, so
    their order can differ — the hints say so.
  - **Numbers layout order is now the requirement document's**: KPI cards → charts (pass %,
    average mark, rating, subject-wise) → list panel → **Needs Your Attention** → Results by
    management → Grid 1 → Grid 2. The school-scope branch closes after the charts, so the
    alerts and Grid 1 render at every scope while Results by management and the ranking grid
    stay behind `@if (be.level() !== 'school')`.
  - **Needs Your Attention is consolidated.** A rule that fires for many units produces ONE
    card ("Pass % fell by 5 pp or more — 6 districts") carrying the affected unit count, the
    total schools behind them, the **worst** unit's figures (tagged "worst unit") and a
    `detail` line naming the worst three and "and N more". Open lists those units in the shared
    panel. Critical / Watch are separate cards per rule, so the counts stay meaningful.
  - **One list panel for everything** (`pick`, `pickUnits`, `pickExportRows`, `closePick`),
    opened by a category click, a subject segment or an alert. `catPick` / `catUnits` are gone.
    `openBeAlert()` in App scrolls `#be-pick` into view, since the panel sits above the alerts.
  - **The subject-wise category chart and Grid 1 now render at every scope.**
    - State scope `subjectCats` counts **districts** per band, placing each district at the
      state subject average shifted by its own distance from the state average (both inputs
      real, the shift derived — `derivedSubjects: true`, a "Derived" tag and
      `subjectCatNote()`). Clicking a segment lists those districts.
    - `subjectMgmtGrid` gained three more scopes: **block** (rebuilt from that block's annexure
      rows by management group, via `gridCell()`), **school** (one row, its own management) and
      **state** (the state subject figure shifted by each management group's distance from the
      state figure). Average marks are printed; **subject pass % at block / school scope is
      derived from the subject average**, and the grid's `source` line says which it is.
  - **Needs Your Attention metrics (17-Nov-2026, on request):** the five earlier rules were
    replaced by three — (1) **Year-on-year improvement**: units whose pass % FELL
    (`yoyDropCritical` 5 pp / `yoyDropWatch` 2 pp); (2) **Average mark**: units in the Poor
    (`avgMarkCritical` ≤ 50) or Needs Improvement (`avgMarkWatch` ≤ 60) band; (3) **Subjects
    with a low pass % and / or a low average mark** (`subjectPassCritical` 80 / `subjectPassWatch`
    90, `subjectAvgCritical` 50 / `subjectAvgWatch` 60). The subject card leads with the average
    mark and carries the pass % in its detail line; below district scope the reports print no
    subject pass %, so it says so. The "share rated Poor" and "pass % floor" rules are gone.
    `BoardThresholds` keys changed accordingly (`beThresholdFields` in App matches).
  - **Chart shapes (17-Nov-2026, on request):** the pass-% and average-mark unit charts are now
    **vertical** bars (category x axis, labels rotate above 6 / 12 bars, reference line on the y
    axis; `unitChartHeight` is 340 / 420 px). "Schools by performance rating" is a **pie**
    (outer ring = selected year, labels with count and share). The previous-year inner ring was
    added and then **removed on request** the same day; `perfCounts().prev` is still computed
    and used by the alerts. Slice clicks still reach `onBePerfClick` via `e.name`.
  - **17-Nov-2026, on request:** the long "Source: …" note in the Board Exam control bar was
    removed (the scope chips, the assumed-data notice and each card's own footnote still carry
    the provenance). "View all N" now stacks the pass-% and average-mark cards **full-width, one
    below the other** (`[class.row-two]="!be.unitShowAll()"` on the grid row; `.grid-row` alone
    is a single-column grid) and raises the chart height to 460 px, so the expanded chart pushes
    the next one down instead of squeezing 38 bars into half a row.
  - **17-Nov-2026 (later), on request:**
    - **KPI card "Year-on-year improvement"** added as the third card: pass-% change in pp with
      an up/down tone (`tone` on the KPI row → `.be-kpi-up/.be-kpi-down`), the average-mark change
      in its sub-line, N/A on the previous-year view.
    - **Trend From / To year window.** `trendFrom` / `trendTo` (null = full range),
      `trendFromYear/ToYear`, `trendFromOptions/ToOptions` (each bounded by the other),
      `setTrendFrom/To` (pull the other end along), `resetTrendYears`, `trendIdx`,
      `trendWindowLabel`. Both trend lines slice to the window via `trendChart()`.
    - **Change-by-unit chart = top 5 and bottom 5 only** (`trendEnds`, `trendUnitsAll` → `trendUnits`
      with a `null` gap row rendered as "…" and a shaded `markArea`; `trendUnitsTruncated`). Now a
      vertical bar chart with a zero line; all units are drawn when there are ≤ 10.
    - **Comparison restructured like Academic Scores:** `compareMode` 'districts' | 'exams' with the
      same `.cmp-tabs`. *Between units*: a **Subject vs Unit heatmap** (`compareHeat` →
      `beHeatOpt` via the shared `cs.subjectHeatmap`; at state scope it is the derived
      state-subject-shifted-by-district figure and is tagged "Derived") above the existing ranked
      bars (now clickable → `onBeCompareClick` drills) and the management-vs-state chart.
      *Between exams*: a head-to-head picker (class × academic year per side, optional subject
      focus) → `h2hA` / `h2hB` / `h2hSubject`, `setH2h`, `h2hSide(cls, year)` (per-scope figures
      for ANY class, which is why the district detail was refactored), `examHeadToHead`,
      `h2hChartRows` → `beH2hOpt` via the shared `cs.examHeadToHead`, subject table, export `beH2h`.
      Default: Class X AY 2024-25 vs Class X AY 2025-26. Warns when both sides are the same sitting
      or when classes differ (only shared subjects are compared).
    - **Refactor for the above:** the class-bound computeds are now wrappers over per-class
      helpers — `blockFor`, `subjectsFor`, `stateTotalFor`, `stateRowsFor`, `scopeStateRowFor`,
      `stateSubjectsFor`, `refDistrictFor`, `realDistrictFor`, `districtFor(cls)`; the assumed
      district is built by `buildAssumed(cls)` into `assumedDistrict10` / `assumedDistrict12`
      (`hash01` / `spread` take a `cls`, `subjectShapeFor(cls)`, `rollEligible(district, cls)`).
      Figures for the current class are unchanged.
    - **Trend grid (17-Nov-2026, on request).** Below the trend charts, a `{Unit}-wise, {From} vs
      {To}` table: Schools · Pass % in the From year, the To year and the change (pp) · Average
      mark in the From year, the To year and the change · Category. Rows follow the trend window
      and drill District → Block → School on click (`drillTrendRow` → `drill`). Built from
      `unitYears()` (per-unit current = printed, previous = value − change, independent of the
      Academic Year filter) mapped through `yearSlot()` (2026 → cur, 2025 → prev). Per-unit
      figures exist for those two years only, so a window year outside them shows N/A and
      `trendGridNote()` says so; From = To shows no change. Export `beTrendGrid`.
    - **Grid restyle (17-Nov-2026, on request).** One modern look for every Board Exam table:
      `:host ::ng-deep .be-table` (all eight PrimeNG grids) and the matching `.be-grid` rules
      (the hand-built school-report and subject × management tables, now all wrapped in
      `.be-scroll`, which carries the rounded 1 px frame). Soft grey header band with wrapped
      labels and a lighter second header row, zebra rows, 13 px body text, tabular numbers, blue
      hover on drillable rows, a rounded frame, transparent caption / paginator, centred `.be-grp`
      group headers. `.be-delta` is now a tinted pill that draws its own ▲ / ▼ (the hand-typed
      arrows and brackets around deltas were removed), `.be-pill` is a tinted outline pill with a
      colour dot instead of a solid block, `.be-cell` is a 3 px category stripe.
    - **Encoding incident (17-Nov-2026, fixed).** A `Get-Content | Set-Content` pass on
      `app.html` decoded UTF-8 as Windows-1252 and re-saved, turning every non-ASCII character
      into mojibake (`—` → `â€”`, 280 sequences). Repaired in place by re-encoding only valid
      multibyte sequences (`%TEMP%\fix-mojibake.ps1`); HEAD was never affected. **Rule for this
      repo:** edit files with the editor tools or `[System.IO.File]::ReadAllText` /
      `WriteAllText` with `UTF8Encoding($false)`; never `Get-Content`/`Set-Content` or `>` on
      source files. Also note `cls` is a PowerShell alias for Clear-Host — don't name a
      function that.

- **Academic Scores X & XII tab (17-Nov-2026):** `AcademicService.boardMode` projects every
  node to the board classes via `examClass` sittings (`boardRows`/`projectNode`); filters
  `boardExams` (multi-select) and `boardClass` (0/10/12); Quarterly / Half Yearly sittings for
  classes 10/12 are **assumed** (stepped from Annual by the scope's own exam gap, deterministic
  jitter, `assumed:true`, "Assumed data" badge) because the export has Annual only.

- **"At a glance" executive page (13-Nov-2026, moved to its own route 16-Nov-2026):** a
  standalone page at **`/glance`** that ports the layout of
  `D:\general\Dashboard\review\SED-Review-Dashboard.html` into the Angular app. It is reached
  from the top menu entry **"At a glance"** (right after Review Dashboard), which opens it in a
  new browser tab exactly like the SMC / SLAS entries (`tabs[].url = 'glance'`).
  - **Routing (new):** `main.ts` now bootstraps `root.ts` (`Root`, selector `app-root`, just a
    `<router-outlet>`); `app.routes.ts` maps `''` → `App` (selector renamed to `app-dashboard`)
    and `glance` → lazily loaded `glance/glance.ts` (`GlancePage`); `app.config.ts` adds
    `provideRouter(routes)`. Vercel's SPA rewrite already serves `/glance` from `index.html`.
  - **Shared values (new):** `services/kpi-values.service.ts` (`KpiValuesService`) now owns
    `scopeValues` (the student-weighted / summed / ratio aggregation of `rv.drillRows()`),
    `band(def, v)` and `format(def, v)`. `App` keeps its old private names as one-line
    delegates (`scopeValues`, `kpiBand`, `kpiFormat`) so nothing else in app.ts changed.
  - **Page:** `glance/glance.html|scss|ts`. Top bar (brand, year, "Review Dashboard" link,
    Download PDF = `window.print()`), a scope bar (Tamil Nadu › district › block breadcrumb +
    the same `p-select`s as the dashboard, bound to the shared `DataService` signals), then the
    template layout: left panel (`.gl-side`) = Overview + every `KPI_MODULES` component except
    State Summary, badge = number of that module's KPIs in the `bad` band, each opening the
    component's own page (its tiled KPIs as cards + "View details"); Overview = headline panel
    (schools with a three-segment Govt / Aided / Private bar from `ds.rawSchoolRows()` type
    counts; students with a Boys / Girls bar; teachers with Teaching / Non-teaching and PTR),
    six insight cards (attendance with real 30-day sparkline, enrolment with real year-wise
    sparkline, potential dropout, pass %, critical infra gap, SMC emergency completion), two
    ECharts trends (daily student bars + teacher line vs the 90% mark; year-wise boys/girls
    stacked enrolment), "Needs your attention" (KPIs in `bad` / `warn` bands, owner =
    component) and a "Programme completion" strip (ACiS survey, THIRAN BLO/baseline, ICT
    functional, SMC meeting attendance, assessment coverage).
  - **Deep link back into the drill:** every card calls `openGlanceKpi` / `openGlanceModule`,
    which `router.navigate(['/'], { queryParams: { topic, kpi?, module? } })`. `App.ngOnInit`
    reads `ActivatedRoute.snapshot.queryParamMap`; if `topic` is present it awaits `rv.load()`,
    switches to Review Dashboard, calls `openKpi` / `openModule`, then clears the params.
  - **Auth:** the page uses the same `AuthService` (sessionStorage; browsers copy it into a tab
    opened via `target=_blank`). Not signed in → a "Sign in required" card linking to `/`.
  - Template blocks with no source here were replaced, not faked: urban/rural → Govt/Aided/
    Private; monthly this-year/last-year attendance → the real 30-day daily series; Hi-Tech lab
    utilisation → SMC emergency completion; entitlements → programme completion %. The
    template's demo "Viewing as" switcher became the real scope bar. The greeting h1 was
    removed on request. The earlier in-app `activeSub === 'glance'` sub-view no longer exists.

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

---

## 12. Academic — exam type + class-wise views, Class X & XII only (11-Nov-2026)

Two cards were added to the Academic component's "View details", inside the
shared-drill `} @else {` branch and gated `@if (rv.activeTopic() === 'aca')`.
**Order on the page (as requested): exam-type grid → district-wise table →
class-wise matrix.** The exam-type card is inserted BEFORE the shared drill
table; the class-wise card sits after it. The shared drill table itself, the
Assessment toggle under the tile and the per-school class→subject modal are
untouched.

**Both cards are restricted to the board classes (X and XII)**, read from
`AcademicData.boardClasses` via `acaBoardClasses`. `acaClassLabel(cls)` maps
10 → "X", 12 → "XII" (ROMAN map) so the headings read as the review sheet names
them. `acaBoardSittings` is the single filter both cards go through.

- **Exam type** (`acaExamRows` / `acaExamTotals`) — one row per Quarterly /
  Half Yearly / Annual. Columns: a two-level header with a per-class band —
  Class X (Average Mark, Pass %) · Class XII (Average Mark, Pass %) ·
  Class X & XII together (Average Mark, Pass %) · Mark Entry % · Students
  Assessed · Avg Change · Pass % Change. `acaBoardCell(perClass, cls, key)`
  reads a per-class cell. **Clicking a row calls `setExamPeriod(row.exam)`** —
  the same switch as the Assessment toggle, so the drill table, the tiles and
  these cards all follow it; the active row carries a tick and `.aca-on`.
  `hasData` is false for an exam with no board sitting: the row dims
  (`.aca-empty`), shows a "no board sitting" chip and renders dashes, never 0.
  The change columns compare against the previous exam that actually HAS board
  data, so a gap in the middle does not produce a bogus delta.
- **Class-wise × exam type** (`acaClassMatrix` / `acaClassMatrixTotals`) — rows
  are Class X and Class XII, columns the exam types, plus "All Exams".
  `acaMatrixMetric` ('avg' | 'pass' | 'entry') picks what the cells show;
  `acaCell(cells, exam)` reads a cell, `acaTone(v)` bands it per metric.
  Clicking a class opens `acaScopeSubjectRows` — subject × exam for that class
  at the same scope, worst subject first.

Source: `AcademicNode.examClass` (exam × class), real at state, district, block
and school. Row and column totals are **weighted by students assessed**, never a
mean of means. When a scope has no exam × class detail the matrix falls back to
`byClass` filtered to the board classes (`blended: true`, no exam split).

**IMPORTANT data limitation — verified, not assumed:** in the current export,
classes 10 and 12 carry an **Annual sitting only**. Checked exhaustively: state,
all 38 districts, every block and all **12,208 schools** yield exactly
`["10/Annual", "12/Annual"]`. So the Quarterly and Half Yearly rows of the
exam-type grid, and those two columns of the class matrix, are **legitimately
empty** today. They are kept in place so the grid fills in once board
quarterly / half-yearly marks are exported. Do not "fix" this by synthesizing.

State figures (2026-27, Annual): Class X avg 70.1 / pass 88.3%, Class XII avg
71.0 / pass 89.0%, both together 70.5 / 88.6%, mark entry 86.3%, 4,64,753
students assessed. Class X has 5 subjects, Class XII has 15.

**Known quirk:** catalog KPI `a_avg` ("Average Mark") is `fmt: 'pct'`, so the
district-wise drill table prints a mark with a `%` sign, and that table still
blends ALL classes (6–12) rather than board-only. These two cards do neither —
they are board-only and render Average Mark without a suffix
(`acaMetricSuffix`). Making the drill table and the tiles board-only as well
means rerouting `examStat()` through `acaBoardSittings`, which would zero the
whole Academic component whenever Quarterly or Half Yearly is the active period
(no board data exists for those), so it was deliberately NOT done.

## 13. Potential Dropout split out of All Children in School (11-Nov-2026)

The five PD KPIs left the `All Children in School` module and became their own
component. Rationale: a different population (children **still enrolled** but
absent 15+ of the last 30 days) from a different source (`acis-pd.json`, the
EMIS Potential Dropout report), and a different intervention from the common
pool (children who have already left).

**Catalog** (`kpi-catalog.model.ts`): new module `Potential Dropout`, colour
`#c2410c`, topic **`pd`** — `ac_pd`, `ac_pdp`, `ac_pdr`, `hide(ac_pdrs)`,
`hide(ac_pdg)`. They are gone from `All Children in School`, which keeps the
common pool (`ac_pool` … `ac_drc`).

**ReviewService**: `DrillTopic` gained `'pd'`; `topics` gained
`{ id:'pd', label:'Potential Dropout', icon:'fa-solid fa-user-clock' }`;
`setTopic` resets `pdUnit`; `defaultTopicColumns` has a `case 'pd'`.
New members: `pdKpiTabs` (District summary / PD reasons / PD grade-wise),
`PD_KPI_VIEW`, `pdKpiId`, `pdUnit`, `pdSchool`, `hasPdDrill`, `openPdDrill`,
`closePdDrill`, `setPdKpi`, `pdView`, `pdActiveTab`, `pdKpiLabel`,
`pdUnitLabel`, `pdShowStudents`, `pdSchoolName`, `pdStudentRows`, `pdSortKey`,
**`pdSummaryRows` / `pdSummaryTotals`**, `pdDrillRow`, `pdCloseStudents`.
`acisPdStudentRows` and `pdStudentRows` now both call the shared private
`pdStudentsFor(udise)` so the two lists can never drift.
Reused as-is: `pdScopeStudents`, `acisPdReasonRows/Totals`, `acisPdCategories`,
`acisPdGradeRows/Totals`, `acisPdClassOptions`, `acisPdSchoolTypeOptions`,
`pdEnrolled`, `acisPdWindow`, and the three shared filters
(`acisFSchoolType` / `acisFGender` / `acisFClass`).

**Given up by ACiS**: `acisKpiTabs` lost the PD reasons / PD grade-wise tabs;
`ACIS_KPI_IDS` lost the five ids; `acisView` lost `'pdreason'` / `'pdgrade'`;
`acisIsPdView` is now `computed(() => false)` (kept because the summary grid
still carries PD columns from a source with no CWSN / UMIS fields).

**app.ts**: `openModule`, `onTopicTab` and `closeDomain` each handle `pd`.
`openKpi` was refactored — it now **closes every dedicated drill up front** and
then opens the one the KPI belongs to, instead of each branch listing the
others; behaviour is identical and adding the next component is a one-line change.

**app.html**: new `@else if (selectedDomain() === 'pd')` branch in the drill
chain (between `acis` and `smc`) with the topic bar, the KPI tabs, the three
filters and `@switch (rv.pdView())`:
`reason` (category × reason) · `grade` (class × reason category) ·
`default` summary grid — one row per district / block / school with Schools
Affected, PD, PD %, Repeaters, Boys, Girls, Avg and Max Days Absent, drilling
district → block → school → that school's student list (EMIS ID, name, class,
section, gender, reason category, reason, days absent, repeater). The two PD
`@case` blocks were **removed** from the shared `#acisDrill` template. The
drill-bar title gained a `rv.pdKpiId()` branch.

**Verified against `acis-pd.json`** (window 2026-09-01 → 2026-10-01): 29,075
potential dropouts across 8,290 government schools in 38 districts = 0.72% of
40,36,861 government enrolment. Worst districts Tiruppur 1,998 (1.21%) and
Krishnagiri 1,992 (1.14%). Class 9 is the peak (6,656), then class 10 (4,305).
Reasons: "Not updated" 48.5%, illness 27.6%, migration 6.2%. The report covers
**Government schools only**, so PD % is always measured against the government roll.

**Left alone on purpose** (say the word to change): the ACiS summary grid keeps
its three PD columns and the ACiS standalone tab keeps its PD charts
(`acisPdMgmtOpt`, `acisPdGradeOpt`) and the pool-vs-PD category panel — they are
a deliberate side-by-side comparison of the two populations. The ACiS tab's
headline strip now has 11 tiles instead of 14, since it reads the ACiS module.

### Overview HTML (12-Nov-2026)
`Review-Dashboard-Overview.html` (repo root) is a standalone overview page styled from
`Downloads\School Education Dashboard.html` (same layout/CSS): 6 headline KPIs, 5 charts and
73 metrics across 12 review modules. Regenerate with
`node --max-old-space-size=4096 scripts/gen-overview-html.mjs` (reads `src/assets/*`; HTML shell
is `scripts/overview-template.html`). Values use the dashboard's own definitions (e.g. zero-teacher
= students>0 && teaching==0; colour bands = catalog lo/hi/dir) and were cross-checked against the
live landing page. Row tags: `demo` (scholarship), `assumed` (SMC grant utilisation, Palli % Class
Observation), `landing` (academic exam KPIs and "schools not marked attendance %", copied from the
landing page because they depend on the selected exam period / attendance window).
- **Collector: Yes filter (12-Nov-2026):** the Overview shows only genuinely collected metrics —
  rows tagged `demo` or `assumed` are dropped in the generator (`modules[].rows.filter(r => r.t
  !== 'demo' && r.t !== 'assumed')`), and any module left with zero rows is dropped entirely
  (`Scholarship` — every one of its figures was `demo`). `landing`-tagged rows stay (real figures,
  just sourced from the live landing page). The "Scholarship payment success" chart was removed
  for the same reason; `SMC` lost its `Grant utilisation %` row (now 8 of 9); `Palli Paarvai` lost
  `% of Class Observation` (now 5 of 6, all plain counts — its sidebar badge is "counts" not "OK").
  81→73 metrics, 13→12 modules. The banner badge and the "Metrics by module" subtitle were updated
  to say "Collector: Yes only"; `DATA.meta.notes` explains the exclusion.
- **State Summary removed + per-module charts (12-Nov-2026):** dropped the `State Summary` module
  entirely (redundant with the top KPI strip, which already is the state overview) — sidebar nav
  and grid card both gone, 73→66 metrics, 12→11 modules. Every remaining module now carries a
  `chart: [...]` array rendered as a `.vzrow` above its metric rows, using 5 new reusable SVG/CSS
  components in the template: `ring()`/`ringRow()` (percentage rings — Attendance, THIRAN, Digital
  Infra, Academic Performance coverage/completion), `donut2()` (two-segment donut + count legend —
  Digital Infra functional split, SMC meetings held/not-held, DPS district/state, Potential Dropout
  repeaters), `funnel()` (stepped bars — Palli Paarvai officials→schools→observations, ACiS
  pool→surveyed→admitted→dept-action), and `bars`/`bars mode:'count'` (reuses `hb()`/new `hbN()` —
  Enrollment and Infrastructure flag-school %, DPS/Potential-Dropout sub-bars). The generic
  dispatcher is `vizBlock(block)`; `cards()` calls `m.chart.map(vizBlock)` when not searching.
  All chart figures are real splits/ratios of each module's own numbers — ONE exception: Academic
  Performance's "5-year Pass % trend" sparkline is explicitly illustrative (only the last point,
  86.7%, is real; the earlier 4 are stepped back by the real YoY figure to show a plausible shape),
  labelled on-page with an italic note and in `DATA.meta.notes`.

- **Page simplified (12-Nov-2026):** on request, removed the `Enrollment`, `Infrastructure` and
  `Digital Infrastructure` modules, then removed the entire "Metrics by module" grid section
  (search box + all remaining module cards and their per-module charts — Attendance, Academic
  Performance, THIRAN, SMC, Palli Paarvai, DPS, ACiS, Potential Dropout all lost their card/chart
  along with it). The sidebar's "Modules" list and the `cards()`/`nav()` module logic, `av`,
  `ring`, `ringRow`, `donut2`, `funnel`, `spark`, `hbN`, `vizBlock`, `off`, `BC` and the matching
  CSS (`.mg/.mc/.mh/.ch/.rw/.rl/.rv/.dt/.tg/.lgd/.em/.vzrow/.vz*/.ringrow/.d2*/.funnel/.fstep/
  .fbar/.sw` + search `input` styles) were deleted from `overview-template.html` as dead code.
  The page is now just: brand + "Overview" nav item (`nav()` simplified, no module list) → KPI
  strip → the 5 original headline charts (Attendance daily, Enrolment by management,
  Infrastructure gaps, ACiS pipeline, SMC resolution completion) → Notes & definitions. The
  generator keeps computing a `modules` array (Academic Performance, THIRAN, Scholarship, SMC,
  Palli Paarvai, DPS, ACiS, Potential Dropout) purely for its own console sanity-check log line;
  it is NOT included in the `DATA` object shipped to the HTML. `DATA.meta.notes` was trimmed to
  only the definitions that still apply to what's on screen (dropped the "Collector: Yes"/band/
  landing-tag/illustrative-trend bullets, since no tagged rows or bands render anywhere now).
  34.1 KB → 15.2 KB.

- **Reverted (12-Nov-2026):** the "page simplified" change above (State-Summary-only sidebar,
  Enrollment/Infrastructure/Digital-Infra removed, whole module grid removed) was undone on
  request — restored `overview-template.html` and `gen-overview-html.mjs` to the prior state:
  all 11 modules with their per-module charts, the full "Metrics by module" grid with search,
  and the sidebar module list. 34.1 KB / 66 metrics / 11 modules, matching byte-for-byte what was
  generated just before the removal. The note above (bulleted "Page simplified") describes a
  change that is no longer in effect; kept for history, not current.

- **Raw metric rows removed from module cards (12-Nov-2026):** on request, each module card in
  the "Metrics by module" grid (now titled "Component charts") no longer lists its individual
  metrics as plain text rows (e.g. "Zero enrolment schools 1,509") — it shows only the header
  (avatar + title + critical/OK/counts badge), the source line, and the module's `chart` block
  (rings/donuts/funnels/bars). `cards()` in `overview-template.html` dropped the `rs.map(...)`
  row rendering; the empty-state now reads "No chart for this component." (none hit this — every
  remaining module has a chart). Search now filters by module TITLE only (row labels are no
  longer shown, so searching by a removed metric name wouldn't make sense). `DATA.modules[].rows`
  is still generated and shipped (used only to compute each card's critical-count badge via
  `off()`); it is simply not rendered as text anymore. Removed now-dead CSS/JS: `BC` map,
  `.rw/.rl/.rv/.tg`; `.dt` kept (still used by the Good/Watch/Critical legend). Added
  `.vzrow-last` so the chart block (now the card's last element) has no trailing border.
  34.1 KB → 33.3 KB (DATA still carries the row numbers for badges, so the drop is modest).

- **Restructured into per-component pages with a vertical menu (12-Nov-2026):** on feedback that
  the single-page layout was "messy, too much in one view," the page is now multi-view: Overview
  is JUST the 6 KPI cards + a one-line hint + Notes (no charts, no module list rendered inline).
  Each of the 11 sidebar "Components" items opens its OWN dedicated page (header with avatar +
  title + critical/OK/counts badge + source line + a "← Overview" back button + Export brief),
  showing only that component's chart(s), each in its own full-size `.c` card in a `.g3` grid
  (side by side when a component has 2 chart blocks). Implemented via `let view` + `go(v)` +
  `render()` (dispatches to `overviewPage()` or `modulePage(i)`) in `overview-template.html`,
  replacing the old `cards()`/single-page grid. The 5 former standalone top-level charts were
  NOT deleted — they were folded into the matching component's page as a 2nd chart block, each
  with its own label, so no data was lost in the simplification: Attendance gained the 30-day
  `linechart` (student+teacher trend, moved from the old top chart); Enrollment gained a 2nd
  `bars` block for "Enrolment share by management"; Infrastructure's bars were swapped for the
  richer 6-category version (No ramp/playground/classroom repair/fire safety/drinking water/
  toilet) that used to be the standalone "Infrastructure gaps" chart; SMC gained a `bargroup`
  block (full-export vs last-12-months resolution completion, reusing `gb()`); All Children in
  School's %-based rows chart was dropped in favour of keeping just its funnel (redundant
  otherwise). Two new chart kinds added to `vizBlock()`: `linechart` (multi-series `lc()` + a
  `.lg` legend) and `bargroup` (`gb()` + legend). Chart sizes were enlarged (ring 112px, donut2
  136px, funnel bar 30px, spark 320×120) since each now gets a full card instead of a compact
  grid tile. `DATA.charts` was removed entirely (folded into `modules[].chart`); `DATA` is now
  just `{kpis, modules, meta}`. 34.1 KB → 30.5 KB.

- **Themed with "Seline Analytics" design system (12-Nov-2026):** applied the style reference
  from `Downloads\DESIGN.md` (warm-stone canvas, single cyan accent, hairline borders instead of
  shadows, pill buttons/badges, flat cards, Inter typography with negative tracking on headings)
  to `overview-template.html`. Tokens: `--bg:#fafaf9` (stone canvas), `--card:#fff`,
  `--tx:#0c0a09` (ink), `--mu:#78716c` (warm gray), `--mu2:#a8a29e` (ash), `--bd:#e8e6e5` (stone
  border), `--accent:#3ba6f1` / `--accent-edge:#3398e1` (cyan), `--sky-wash:#c1e1f7`,
  `--soot:#1c1917` (the one dark/"inverted" surface — used for the sidebar, flat, no gradient).
  Buttons are now pill-shaped (`--r-pill:9999px`); cards are 10px radius with only a 1px border +
  a near-invisible resting shadow, a slightly bigger shadow on hover; avatars are circular and
  colour-neutral (`rgba(120,113,108,.18)` bg, `color:inherit` so they read correctly on both the
  dark sidebar and light card headers without a second CSS variant). Sidebar active state = sky-
  wash background + cyan left accent bar, replacing the old plain white/shadow treatment. Dark-
  mode CSS was removed (the source theme is explicitly light-only).
  **Deliberate exception — status colours kept:** the spec's "one accent only, no new chromatic
  colours" rule is for a marketing page; this dashboard's whole job is flagging real problems, so
  removing red/amber/green for critical/watch/good would be a correctness regression, not a
  style win. Kept all three, retoned to warm/muted values consistent with the stone palette
  (`--cr:#b1453c` on `#f7e8e5`, `--wa:#a66a1e` on `#f7ecd9`, `--ok:#3f7a5c` on `#eaf3ee`) rather
  than the previous vivid red/amber/green.
  **Decorative colour fully collapsed to the single accent:** module avatars no longer use each
  component's brand hex (now neutral grey, differentiated by initial letter only); every chart's
  colour is now forced in `vizBlock()` regardless of what hex the generator passes — the first/
  "primary" series or segment is always `var(--accent)` (cyan), any second series/segment is
  `var(--mu2)` (ash). This changes `rings`/`donut2`/`funnel`/`trend`/`bars`/`linechart`/
  `bargroup` uniformly; `gen-overview-html.mjs`'s per-module hex values are now unused for
  colour (harmless — kept only because removing them would be a larger, riskier diff for no
  visual gain, since the template ignores them).
