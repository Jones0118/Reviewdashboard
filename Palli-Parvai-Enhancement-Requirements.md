# Palli Paarvai – New Enhancement: Requirement Document

| Item | Detail |
| ----- | ----- |
| Module | Review Dashboard → Palli Paarvai |
| Enhancement | User-wise observation drill-down, school observation details, observation report, Observation Duration KPI, and month filter |
| Scope | User Stories 4–8 of the epic "Palli Paarvai – Observation Dashboard, User-wise Reports and Observation Duration KPI", plus the month filter |
| Data source | `PP_Oct_2026_Start and End 20261103.xlsx` (Palli Paarvai export, October 2026) |
| Version / date | 1.1 – 04-Nov-2026 |
| Status | Implemented in the Review Dashboard; pending department sign-off on open items (Section 10) |

---

## 1. Purpose

The existing Palli Paarvai section shows observation coverage at state, designation and district level only. Monitoring officers cannot see which individual officer made which observation, how long each observation lasted, or what was recorded.

This enhancement lets State and District monitoring officers:

1. Drill from the % Class Observation KPI down to districts, individual officers and the schools each officer observed.
2. Open the report of a single observation.
3. Analyse observation duration by designation, district and officer, to identify short or unreliable observations.
4. Review any month through a single month filter.
5. Move between all levels with breadcrumbs, without losing filters, and export every level.

## 2. Scope

### 2.1 In scope

| # | Requirement | User story |
| ----- | ----- | ----- |
| R1 | User-wise observation performance for a selected designation and district | US 4 |
| R2 | School-wise observation list for a selected user | US 5 |
| R3 | Detailed observation report for a selected observation | US 6 |
| R4 | Observation Duration KPI: designation abstract → district → user → observations | US 7 |
| R5 | Breadcrumb navigation, preserved filters, clear filters | US 8 |
| R6 | Excel, CSV and PDF export at every level | US 4–7 |
| R7 | Month filter on % Class Observation, % Officials Not Observed and Observation Duration | New |

### 2.2 Out of scope

- User Stories 1–3: the designation-wise matrix of % Class Observation and its RAG thresholds. The existing matrix is unchanged apart from the month filter.
- Low performers / Top performers tabs (temporarily disabled).
- Role-based data restriction and audit logging (see Section 9 — depends on the EMIS login integration).

## 3. Users

| Role | Usage |
| ----- | ----- |
| State monitoring officer | All districts, all designations |
| District monitoring officer (CEO / DEO) | Own district (once role-scoping is integrated) |

## 4. Navigation flow

There are two entry points. Both end at the same observation list and report. The selected month applies to every level.

```
A. % of Class Observation tab (coverage / target achievement)
   [Month] Designation matrix → click designation → District-wise → click district
   → User-wise (US 4) → click user → School observations (US 5) → View Report (US 6)

B. Observation duration tab (time spent per observation)
   [Month] Designation abstract → click designation → District-wise duration
   → click district → User-wise duration → click user / count
   → Observation list → View Report

C. % of Officials Not Observed tab
   [Month] District × designation counts → click a count → Officials list
```

## 5. Business rules and definitions

| # | Rule | Definition |
| ----- | ----- | ----- |
| BR1 | Visited | Number of observation records in the selected month. Each row in the export counts as one observation. Multiple observations of the same school stay separate records. |
| BR2 | Duration | End time − start time, in minutes. |
| BR3 | Valid duration | Duration greater than 0 and up to 480 minutes (8 hours). Sessions above 8 hours were left open in the app and are treated as invalid timestamps. |
| BR4 | Invalid duration | Missing, zero, negative or over-8-hour duration. Excluded from every duration category and from the average. These are not shown as a column (removed on request), but are still counted as excluded. October 2026: 6,363 records. |
| BR5 | Duration categories | Under 15 min: < 15. 15 to under 30 min: ≥ 15 and < 30. 30 min or more: ≥ 30. Only valid durations are counted. |
| BR6 | Total Observations (duration KPI) | Under 15 + 15 to under 30 + 30 or more, i.e. valid-duration observations only. |
| BR7 | Average Duration | Sum of valid durations ÷ number of valid-duration observations, 1 decimal. |
| BR8 | Officer target | Monthly classes to be observed per officer, from the department target sheet: BRTE 24; BEO, DEO and DIET Principal 20; DC and APO 10; CEO 8. Because the filter is a whole month, the full monthly target applies (no proration). |
| BR9 | Target (district / designation) | Per-officer target × number of officers. |
| BR10 | Officers | Distinct users of that designation with at least one observation in the selected month. |
| BR11 | Visit % | Visited ÷ Target × 100, 1 decimal. Shows "N/A" when Target is 0. |
| BR12 | District | Taken from the school's UDISE code in the EMIS school roll. The district text in the export is the fallback. |
| BR13 | Designations | CEO, DEO – Secondary, DEO – Primary (Elementary), APO, DC, BEO, BRTE, DIET Principal. Other observer roles in the export (head teachers, DI, AEO, DIET lecturers, etc.) are not shown. |
| BR14 | Reconciliation | User totals = district row; district totals = designation row. The same month and counting rules apply at every level. |
| BR15 | Month | A calendar month, from the 1st to the last day. The month list is built from the observation dates present in the data, newest first. The default is the latest month. |

## 6. Functional requirements

### R1 – User-wise observation performance (US 4)

Trigger: % of Class Observation → designation → click a district.

| Column | Rule |
| ----- | ----- |
| Sl. No. | Sequential |
| User Name | Officer name, with user ID |
| Designation | Selected designation |
| Target | BR8 |
| Visited | BR1 |
| Visit % | BR11 |
| Action | View Observations |

Acceptance criteria

1. The list is filtered to the selected district, designation and month.
2. Default sort is lowest Visit % first. All columns are sortable.
3. Users can be searched by name or user ID.
4. Clicking the row, the user name or View Observations opens R2 for that user.
5. A Grand Total row shows users, Target, Visited and Visit %.
6. Excel, CSV and PDF exports contain all rows (not just the visible page), with the breadcrumb and month in the title.
7. When there are no users, the message is "No <designation> observations in this district for the selected filters".

> Change log: the duration columns (Under 15 / 15–30 / ≥ 30 / Average Duration) and the RAG Status column were removed from this table and from the district table above it, on request. Duration analysis is available only in the Observation duration tab (R4).

### R2 – User-wise school observation details (US 5)

| Column | Rule |
| ----- | ----- |
| Sl. No. | Sequential |
| Observation Date | Actual date of the observation |
| UDISE Code / School Name | From the same school record |
| Class | Observed class from the export |
| Section | Not in the export – sample value, marked `*` |
| Time | Start – end |
| Action | View Report |

Acceptance criteria

1. Only the selected user's observations in the selected month are shown.
2. Every observation is a separate row, newest first.
3. Search by school name or UDISE; month filter; pagination of 10/20/50/100 rows.
4. Excel, CSV and PDF export.
5. When there are no observations, the message is "This user has no observations for the selected filters".
6. Going back returns to R1 with the designation, district and month kept.

### R3 – Observation report (US 6)

1. View Report opens the report for that exact observation, identified by observer + school + date + class + start time. It is not identified by school alone.
2. Header (real data): observer, ID, designation, school, UDISE, district, date, start–end time, class, duration and duration category.
3. Body: observation areas with ratings (1–4), score, students present, strength, area for improvement and follow-up.
4. Back returns to the observation list with filters kept.

> Data gap: the export has no report content and no section. Until a report API/export is available, the body and Section are shown as SAMPLE values. These are generated deterministically per observation, so the same observation always shows the same values. They are clearly badged "Sample".

### R4 – Observation Duration KPI (US 7)

#### Level 1 – Designation abstract (default view)

| Column | Rule |
| ----- | ----- |
| S. No | Sequential |
| Designation | Clickable |
| Districts | Districts with at least one observation |
| Total Observations | BR6 |
| Under 15 min / 15 to under 30 min / 30 min or more | BR5 |
| Average Duration (min) | BR7 |

Includes a Grand Total row. Clicking a designation opens Level 2.

#### Level 2 – District-wise duration (selected designation)

District, Designation, Total Observations, the three duration categories and Average Duration, with a Grand Total row.

- Clicking a district row opens Level 3.
- Clicking a duration count opens the observation list for that district, designation and category.
- The "All designations" button returns to Level 1.

#### Level 3 – User-wise duration (selected district + designation)

Sl. No., User Name (with ID), Designation, Total Observations, the three duration categories, Average Duration and View Observations, with a Grand Total row.

- Default sort is most "Under 15 min" observations first. Users can be searched by name or ID.
- Clicking the row or View Observations opens all of that user's valid observations.
- Clicking a duration count opens that user's observations in that category.

#### Level 4 – Observation list

Observer Name, School Name, UDISE Code, Observation Date, Time, Duration (min) and View Report. Searchable by observer, school or UDISE. Back returns to the previous level (user-wise or district-wise).

#### Filters

District, designation and month. The month filter replaces the earlier From/To date filter.

#### Acceptance criteria

1. Category definitions (BR3–BR5) are identical at every level.
2. Invalid durations are never included in any category, total or average.
3. Totals reconcile across levels (BR14).
4. Every level can be exported to Excel, CSV and PDF.
5. Opening the tab always starts at Level 1.

> Change log: the "Under 15 min %" and "Invalid duration" columns were removed from this view on request. Invalid records are still excluded.

### R5 – Navigation and filters (US 8)

1. In the % Class Observation drill, the breadcrumb follows the pattern All Designations → Designation → District → User → School Observations → View Report, and each crumb returns to that level. In the Observation duration tab, each level has a Back button to the level above.
2. Designation, district, user, month and search filters are preserved when navigating back.
3. "Clear filters" resets the month to the latest month, and clears search, district and designation.

### R6 – Export

1. Excel, CSV and PDF are available on every table level.
2. Exports include all filtered rows, not just the visible page.
3. The title includes the scope; the subtitle includes the breadcrumb path and month (e.g. "October 2026").
4. Sample fields (Section) are not exported as real data.

### R7 – Month filter (new)

| Tab | Where the filter appears | What it filters |
| ----- | ----- | ----- |
| % of Class Observation | Above the district × designation matrix, and in the filter bar at every drill level | Matrix, district-wise, user-wise, school observations and report |
| % of Officials Not Observed | Above the district × designation matrix; the selected month is shown in the officials-list header | Matrix and officials list |
| Observation duration | Filter bar (replaces From/To dates) | All four levels |

Acceptance criteria

1. The filter is a single "Month" dropdown, labelled as month + year (e.g. "October 2026").
2. Options are the months present in the observation data, newest first. The default is the latest month (BR15).
3. One selected month is shared across the three tabs, so switching tabs keeps the month.
4. Changing the month recalculates every count, target, percentage and total on the current level, and keeps the user on the same level.
5. Targets use the full monthly target (BR8).
6. Until the observation data has loaded, the dropdown shows "Loading months…".

> Data note: the current export covers October 2026 only (1,05,127 records), so October 2026 is the only option today. % Class Observation (matrix level) and % Officials Not Observed still use assumed values until a source with officer master and monthly targets is provided. Their values change per month, but they are not real figures.

## 7. Data requirements

| Field | Source column / derivation | Available |
| ----- | ----- | ----- |
| Observer ID, name | Export | Yes |
| Designation | Export `stackholders`, mapped per BR13 | Yes |
| School UDISE, name | Export, plus EMIS school roll | Yes |
| District | EMIS roll via UDISE (BR12) | Yes |
| Observation date (→ month) | Export | Yes |
| Class | Export | Yes |
| Start time, end time | Export | Yes (6,363 invalid) |
| Section | – | No – sample |
| Report content / observation ID | – | No – sample |
| Sanctioned posts / officer master | Target sheet | Partial – officers with 0 observations are not in the export |
| Monthly exports for other months | – | No – only October 2026 has been provided |

October 2026 volume: 1,05,127 observation records and 7,948 users. 53,276 records belong to roles outside the 8 designations.

## 8. Non-functional requirements

| Area | Requirement |
| ----- | ----- |
| Performance | Observation data (5.6 MB, 1.6 MB compressed) loads when the Palli Paarvai view opens (it is needed for the month list), not with the dashboard home page. Pagination applies to all lists. For production, move aggregation to server-side APIs (designation/district/user, by month) with indexed filters, and fetch reports on demand. |
| Freshness | Assets are fetched with `no-cache` so a new export is picked up without clearing the browser cache. |
| Accessibility | Sortable headers, keyboard-operable buttons, ARIA labels on the search and month fields, and role="alert"/"status" on error and sample notices. |
| Data honesty | Any non-source value (Section, report body, assumed matrices) is labelled "Sample" or "Assumed data". |

## 9. Security

1. Users must see only data within their authorised administrative scope (state / district / block).
2. Report access must be restricted by role, and sensitive report views should be audit-logged.
3. Exports must respect the same scope.
4. Officer names and IDs are personal data. The repository/hosting must be private, or the data must be served from an authenticated API rather than static files.

> Current status: items 1–3 depend on the EMIS login/role integration and are not yet enforced in the dashboard. Item 4 is open – `palli-obs.json` is currently a static asset in the repository.

## 10. Open items for department decision

| # | Item | Current assumption |
| ----- | ----- | ----- |
| O1 | Visited definition: unique schools vs observation records | Observation records |
| O2 | Valid duration upper limit | 8 hours |
| O3 | Officer target basis and source of sanctioned posts | Target sheet ÷ sanctioned posts, full month |
| O4 | Officers with zero observations (not in the export) | Not shown – an officer master is needed |
| O5 | Section and report content | Sample until a report API/export is provided |
| O6 | RAG thresholds (Visit % and short duration) | RAG removed from the drill on request; re-add if approved |
| O7 | Role-based scoping and audit logging | Pending EMIS integration |
| O8 | Months beyond October 2026 | Each new monthly export must be provided. The ingest currently reads one export file, so it must be extended to merge several months into the same data file before more months appear in the filter. |
| O9 | Real data for the % Class Observation matrix and % Officials Not Observed | Assumed until an officer master and monthly targets are available |

## 11. Change history

| Date | Change |
| ----- | ----- |
| 04-Nov-2026 | US 4–8 implemented on the October 2026 export; drill placed under % Class Observation (standalone line-list tab removed) |
| 04-Nov-2026 | Sample Section and sample report added |
| 04-Nov-2026 | Under 15 min % and Invalid duration columns removed from the duration KPI |
| 04-Nov-2026 | Duration columns and RAG Status removed from the % Class Observation drill |
| 04-Nov-2026 | Duration KPI: designation abstract added as Level 1; user-wise level added below district |
| 04-Nov-2026 | Month filter replaces the From/To date filter in Observation duration and the % Class Observation drill; month filter added to the % Class Observation matrix and % Officials Not Observed (v1.1) |
