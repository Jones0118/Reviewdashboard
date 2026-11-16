# SMC & Scholarship — Requirement Document

| Item | Detail |
| ----- | ----- |
| Module | Review Dashboard → SMC (School Management Committee) and Scholarship |
| Document type | Requirement specification (objective, user stories, acceptance criteria, functional & non-functional requirements, screens, metric-wise calculation logic) |
| Data sources | SMC: `SMC Attendance Abstract ReportReport.csv` + `SMC - All Resolutions ReportReport.csv`. Scholarship: `kpi-modules.json` (demo figures derived from district enrolment) |
| Version / date | 1.0 — 05-Nov-2026 |
| Status | Implemented in the Review Dashboard |

---

# Part A — SMC (School Management Committee)

## A1. Objective

Give State and District monitoring officers a single drill to monitor, for government / local-body / welfare-managed schools only:

1. Whether SMC meetings are being held, and member attendance in those meetings.
2. The SMC resolutions raised, their completion status, and the departments responsible.
3. A month-wise view, down to the individual school and the individual resolution.

## A2. Scope

### In scope
- Meetings-held abstract (district / block / school) with attendance.
- Resolution completion (All / Emergency / Other) at unit, school and resolution level.
- Department-wise abstract.
- Composite grant utilisation (allocation real, utilisation assumed).
- Month-range filter.

### Out of scope
- Non-government managements (private / unaided schools never had an SMC).
- A "scheduled vs held" meeting ratio (the source has no scheduled-meeting count).
- Free-text resolution descriptions (not exported).

## A3. Users

| Role | Usage |
| ----- | ----- |
| State monitoring officer | All districts |
| District monitoring officer (CEO / DEO) | Own district → blocks → schools |

## A4. Government-only rule

The whole SMC component is restricted to the 10 SMC-covered managements: School Education Department, Adi-Dravida Welfare, Municipal, Corporation, Kallar BC/MBC, Tribal Welfare, Differently-Abled Welfare, Forest Department, KGBV and ARS (Netaji Subhash Chandra Bose Awasiya Vidyalaya). Every count, denominator and school list excludes other managements.

## A5. User stories & acceptance criteria

### US-A1 — Meetings-held abstract
As a monitoring officer, I want meeting coverage and attendance per district / block, so I can see where SMCs are inactive.

Acceptance criteria
1. One row per child unit (district at state level, block within a district).
2. Columns: Total Schools, Meeting Held, Meeting Not Held, % Schools Meeting Conducted, Total Meetings, Members Present, Members Absent, Avg Attendance %.
3. Clicking a row drills to the next level; at block level it shows schools.
4. A Grand Total row reconciles with the sum of the rows.
5. All figures obey the selected month range.

### US-A2 — School-wise meeting detail
As a monitoring officer, I want each school's meeting record, so I can follow up with specific schools.

Acceptance criteria
1. Columns: UDISE Code, School Name, Category, No. of Meetings Held, Avg Attendance %, Present, Absent, Last Meeting Conducted Date.
2. Only government schools appear.
3. Sortable and paginated; a Grand Total row is shown.

### US-A3 — Resolution completion (unit → school → resolution)
As a monitoring officer, I want resolution completion by unit, then by school, then each resolution, so I can trace unresolved items.

Acceptance criteria
1. Unit grid columns: Raised, Resolved, Unresolved, Withdrawn, Completion %.
2. Clicking a block shows a school-wise resolution table: UDISE Code, School Name, Category, Raised, Resolved, Unresolved, Withdrawn, Completion %, Last Raised, and a **View** action.
3. The View button opens that school's individual resolutions: Raised On, Resolution Category, Sub-category, Department, Level, Status.
4. The view (All / Emergency / Other) and the month range apply at every level.
5. A "Back to schools" button returns from the detail.

### US-A4 — Department-wise abstract
As a monitoring officer, I want resolutions grouped by responsible department, so I can escalate to the right department.

Acceptance criteria
1. Columns: Department, Raised, Resolved, Unresolved, Withdrawn, Completion %.
2. It follows the active view and month range.
3. It is hidden while a single school's resolution detail is open.

### US-A5 — Month filter
As a monitoring officer, I want to choose the months, defaulting from June to the current month.

Acceptance criteria
1. Two dropdowns, From and To, listing the months present in the data.
2. Default: From = June of the latest data year, To = the latest month.
3. A Reset returns to the default.
4. The filter drives meetings, the school list, resolutions and the department abstract.

## A6. Tabs

The SMC drill has these tabs: **Meetings held, All resolutions, Emergency, Other resolutions, Grant utilisation.** (The earlier "Meetings not held" and "Meeting attendance" tabs were removed; "not held" and attendance are now columns inside Meetings held.)

## A7. Screens

| Screen | Content |
| ----- | ----- |
| S-A1 Meetings-held abstract | Unit grid (US-A1) + month filter + tab bar |
| S-A2 School meeting detail | Per-school meeting table (US-A2) |
| S-A3 Resolution unit grid | Per-unit completion (US-A3.1) + department abstract |
| S-A4 Resolution school grid | Per-school completion with View button (US-A3.2) + department abstract |
| S-A5 Resolution detail | One school's resolutions (US-A3.3) |
| S-A6 Grant utilisation | Allocation vs utilisation per unit |

Navigation: `[Month] Tab → Unit grid → (click block) → School grid → (View) → Resolution detail`.

## A8. Metric-wise calculation logic

| Metric | Formula / rule |
| ----- | ----- |
| Total Schools (eligible) | Count of government-managed schools in the unit, from the enrolment roll. |
| Meeting Held (schools) | Distinct schools that held ≥ 1 meeting in the month range. |
| Meeting Not Held | Total Schools − Meeting Held. |
| % Schools Meeting Conducted | Meeting Held ÷ Total Schools × 100. (Formula 1: attendance-marked schools ÷ total reconstituted schools.) |
| Total Meetings | Count of meeting records in the month range. |
| Members Present / Absent | Sum of present / absent members across those meetings. |
| Vacant seats | Sum of vacant SMC seats (used only in the attendance denominator; no longer shown as a column). |
| Avg Attendance % | Present ÷ (Present + Absent + Vacant) × 100. (Formula 2: members attended ÷ total reconstituted members — vacant seats are part of the sanctioned strength.) |
| Last Meeting Conducted Date | Latest meeting date for the school in the range. |
| Resolutions Raised | Count of resolutions in scope + range + view (All / Emergency flag yes / Emergency flag no). |
| Resolved / Unresolved / Withdrawn | By Final status: Resolved = 1; Withdrawn = 2; Unresolved = 0 or Work-in-progress. |
| Completion % | Resolved ÷ (Resolved + Unresolved) × 100 — withdrawn excluded from the base. |
| Department abstract | Same counts grouped by `mapped_department_name`. |
| Resolution detail fields | Raised On (date), Resolution Category (`category name`), Sub-category (`subcategory name`), Department (`mapped_department_name`), Level, Status (`Final status`). |
| Grant Allocated (₹ lakh) | Published composite-grant enrolment slab per school (≤30 → ₹10k, ≤100 → ₹25k, ≤250 → ₹50k, ≤1000 → ₹75k, else ₹1L) applied to the real roll. |
| Grant Utilised (₹ lakh) | **Assumed** — deterministic 55–95% of allocation per school. |
| Grant Utilisation % | Utilised ÷ Allocated × 100. |
| SMC Meetings Held % (last 12 months) | **Not built** — needs a "scheduled / total meetings" denominator the source does not carry. The 12-month window is available via the month filter. |

## A9. Data honesty (SMC)

| Field | Status |
| ----- | ----- |
| Meetings, present / absent / vacant, meeting dates | Real (attendance abstract) |
| Resolutions, status, department, category, sub-category, level, date | Real (all-resolutions export) |
| Government-school universe | Real (roll + managements) |
| Grant allocation | Real rule on real enrolment |
| Grant utilisation | Assumed, badged "Assumed utilisation" |

---

# Part B — Scholarship

## B1. Objective

Give monitoring officers a scheme-wise view of scholarship eligibility and payment, drillable from the current scope down to the block, the school and a single school's scheme-by-scheme detail, with a gender filter.

## B2. Scope

### In scope
- Scheme-wise counts for the 6 schemes, with amount paid.
- Block → school → school-detail drill.
- Gender filter (All / Boys / Girls).
- Excel / CSV / PDF export at every level.

### Out of scope
- Real block / school scholarship figures (no such source) — these levels are a sample split.
- Real per-scheme gender counts — gender is applied as an enrolment-share factor.

## B3. Users

Same as SMC — State officer (all districts) and District officer (own scope).

## B4. Schemes

Six schemes with a fixed per-student amount (sample reference values):

| Scheme | Amount / student |
| ----- | ----- |
| Post-Matric (SC/SC(A)/ST) | ₹8,000 |
| NMMS (Merit-cum-Means) | ₹12,000 |
| Pre-Matric (SC/SC(A)/ST) | ₹3,500 |
| Pre-Matric (BC/MBC/DNC) | ₹2,000 |
| Girl Child Incentive | ₹1,500 |
| Special Cash Incentive | ₹5,000 |

## B5. User stories & acceptance criteria

### US-B1 — Scheme-wise counts
As a monitoring officer, I want each scheme's eligibility and payment figures for my scope.

Acceptance criteria
1. One row per scheme with columns: Amount / Student, Eligible, Payment Success, Payment Failed, Payment Pending, Success Rate, NPCI Active, NPCI Inactive, Aadhaar Not Updated, Amount Paid.
2. A Total row.
3. Excel / CSV / PDF export of all rows.
4. The table follows the current district / block scope.

### US-B2 — Block & school drill
As a monitoring officer, I want to see a scheme broken down by block and then by school.

Acceptance criteria
1. Clicking a scheme shows a block-wise split; clicking a block shows a school-wise split.
2. Each level has the same columns and a Total row that reconciles to the level above.
3. The block and school levels are clearly badged "Sample split".
4. Back buttons return to the previous level.

### US-B3 — School scholarship detail
As a monitoring officer, I want one school's scholarship figures scheme by scheme.

Acceptance criteria
1. Clicking a school opens a scheme-by-scheme table for that school, with a Total row.
2. A "Back to schools" button returns to the list.
3. The values are badged as sample.

### US-B4 — Gender filter
As a monitoring officer, I want to view figures for Boys or Girls only.

Acceptance criteria
1. A Gender dropdown (All / Boys / Girls) in the card title.
2. Selecting a gender scales every count at every level by that gender's enrolment share.
3. The selection carries into the school detail and the exports.

## B6. Screens

| Screen | Content |
| ----- | ----- |
| S-B1 Scheme-wise counts | Scheme table (US-B1) + gender filter + export |
| S-B2 Block split | Block-wise table for a scheme |
| S-B3 School split | School-wise table for a block |
| S-B4 School detail | Scheme-by-scheme table for one school |

Reached from: Review Dashboard → Scholarship card → **View details** → the grid, then the Scheme-wise counts table below it. Navigation: `Scheme → Block → School → School detail`.

## B7. Metric-wise calculation logic

| Metric | Formula / rule |
| ----- | ----- |
| Eligible, Payment Success / Failed / Pending, NPCI Active / Inactive, Aadhaar Not Updated | Real scope figures from `kpi-modules.json`, summed to the scheme row. |
| Success Rate | Payment Success ÷ Eligible × 100. |
| Amount / Student | Fixed sample constant per scheme (table B4). |
| Amount Paid | Payment Success × Amount / Student. |
| Block split | Scope figure distributed across blocks by enrolment weight × a per-block hash; the last block absorbs rounding so the parts sum to the scope. **Sample.** |
| School split | The block row distributed across its schools the same way. **Sample.** |
| School detail | The school's enrolment share of each scheme × a per-UDISE hash; payment counts clamped so Success + Failed ≤ Eligible. **Sample.** |
| Gender factor | Boys ÷ (Boys + Girls) or Girls ÷ (Boys + Girls) from the scope's enrolment; multiplied into every count. |

## B8. Data honesty (Scholarship)

| Field | Status |
| ----- | ----- |
| Scheme-level eligibility / payment figures | Demo figures derived from district enrolment (not an official MIS export). |
| Amount / Student, Amount Paid | Sample per-student amounts × real success count. |
| Block / school / school-detail splits | Sample, badged "Sample split". |
| Gender split | Proportional estimate from enrolment, not real per-scheme gender data. |

---

# Part C — Non-functional requirements (both components)

| Area | Requirement |
| ----- | ----- |
| Performance | The SMC detail asset (per-meeting / per-resolution, ~2.6 lakh rows, ~1.5 MB gz) loads lazily when the SMC drill opens. Tables paginate. Scholarship uses the already-loaded modules asset. For production, move aggregation to server-side APIs with indexed filters (by scope, month, scheme). |
| Accuracy / reconciliation | Child totals always reconcile to the parent (unit = sum of schools; scheme = sum of blocks). |
| Freshness | Assets are fetched with `no-cache` so a re-ingest is picked up without a cache clear. |
| Accessibility | Sortable headers, keyboard-operable buttons and View/Back actions, ARIA labels on filters. |
| Data honesty | Any non-source value is labelled "Assumed" or "Sample"; real vs derived is never blurred. |
| Security | Both components carry real officer / school identifiers; the hosting/repository must be private, or the data served from an authenticated, scope-restricted API. Role-based scope (state / district) and audit logging of detail views are pending the EMIS login integration. |
| Localisation | Resolution category / sub-category render in the source language (Tamil), as stored in the export. |

# Part D — Open items

| # | Item | Current state |
| ----- | ----- | ----- |
| D1 | Real block / school scholarship data | Sample split until a UDISE-level export is provided. |
| D2 | Real per-scheme gender data | Proportional estimate. |
| D3 | SMC grant utilisation ledger | Assumed 55–95%. |
| D4 | SMC Meetings-Held % (held ÷ scheduled) | Not built — needs a scheduled-meetings denominator. |
| D5 | Months beyond the current export | Re-run `ingest-real.mjs smc`; extend to merge multiple monthly exports. |
| D6 | Role-based scope & audit logging | Pending EMIS login integration. |

# Part E — Change history

| Date | Change |
| ----- | ----- |
| 05-Nov-2026 | SMC: govt-only confirmed; removed Meetings-not-held and Meeting-attendance tabs; meetings grid columns reworked; attendance % = present / (present + absent + vacant). |
| 05-Nov-2026 | SMC: month filter (June → current) across meetings, resolutions and detail. |
| 05-Nov-2026 | SMC: school-wise resolution drill + per-school resolution detail with View button; added category / sub-category from the CSV; removed "Of which Emergency" column and the "not closed" wording. |
| 05-Nov-2026 | Scholarship: scheme-wise counts table under the grid; block → school → school-detail sample drill; gender filter; 6 schemes with per-student amounts. |
