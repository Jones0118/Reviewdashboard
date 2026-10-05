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
- `field` is the `DrillRow` key the KPI reads from (or `null`/`'DERIVED'` → shows "–").
- `topic` activates the drill lens (DrillTopic).

**Current module set & notable state:**
- State Summary, **Enrollment**, **Attendance**, **Infrastructure**,
  **Academic Performance**, THIRAN+, Scholarship, **Digital Infrastructure (Middle/High/Hr.Sec)**,
  SMC, **Palli Paarvai**.
- **Schemes Coverage** and **Grievance & Support** are **commented out** (temporarily
  disabled) in this file — wrapped in `/* ===== TEMPORARILY DISABLED ... ===== */`.
  Re-enable by removing the comment wrapper.

### Enrollment KPIs (flag → per-school list)
zenr Zero enrolment, ztea Zero teacher, stea Single teacher, u10 Under 10,
ptr60 PTR over 60, einc Enrollment increase, edec Declined enrollment,
trn Transition pending %.

### Attendance KPIs
a_s Student attendance %, a_t Teacher attendance %, a_nm Schools not marked %,
a_os Schools marked only student (assumed), a_ot Schools marked only teacher (assumed),
d15 Potential dropout, tl30 Teacher long absent 30+.
- a_s/a_t/a_nm are **percentage KPIs that drill to a filtered school list**:
  a_s → schools with student attendance <75%, a_t → teacher <75%, a_nm → compliance <25%.

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
thiran THIRAN+, scholarship Scholarship, smc SMC, palli Palli Parvai.
(Schemes & Grievances `sch` tab is **removed** while those modules are disabled.)
The tab bar is rendered on the generic drill, the per-KPI school list, and the Palli drill
so you can switch components from any view-details page.

---

## 7. Drill-down UX contract (what the user expects)

- Click a **flag KPI** → school list showing ONLY matching schools, module/topic columns,
  S.No/District/Block/UDISE/School Name/School Category/Total Students + KPI columns,
  sortable headers, page-size 10/20/50, grand-total footer, row click = read-only
  school profile (no further drill).
- Click **View details** → the module's drill (District→Block→School) with the module's
  KPIs as columns and a matching KPI filter.
- At **school level**, the main drill table shows the same rich layout as the KPI list.
- Switching the topic tab updates header + columns + rows together.
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
