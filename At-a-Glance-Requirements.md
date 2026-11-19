# At a Glance — Product Requirements Document

| Item | Detail |
| ----- | ----- |
| Product | School Education Dashboard — "At a Glance" executive page |
| Route | `/glance` (standalone page, shares data services with the main Review Dashboard at `/`) |
| Owner | School Education Department, Government of Tamil Nadu |
| Author | Product Management (reverse-documented from the shipped implementation) |
| Version / date | 1.0 – 19-Nov-2026 |
| Status | Implemented and live; this document formalises the requirements the shipped page already satisfies, as a baseline for sign-off, QA and future enhancement |

---

## 1. Purpose

Department leadership (Secretary, Commissioner, Directorate heads, senior officials visiting a district) need a single screen that answers, in under thirty seconds: *how are schools in this state/district/block doing right now, across every programme area the Department runs — and where should I look next?*

The main Review Dashboard is a drill-down tool: it is correct and detailed, but it has no single "front page" — a user has to already know which of twelve-plus components to open. **At a Glance** is that front page. It is a read-only executive summary, opened in its own browser tab, that:

1. Shows headline enrolment numbers (schools / students / teachers) at the current scope.
2. Groups every tracked programme under five policy pillars and shows up to five real metrics per pillar without the user drilling anywhere.
3. Surfaces the KPIs that are currently off track or borderline, ranked, with the component responsible for each.
4. Shows programme-completion percentages for the metrics the Department tracks as "done/not done."
5. Lets a user go from any number on this page straight into the matching drill in the main dashboard, in one click.

**Guiding principle (non-negotiable):** *no figure on this page is invented.* Where a pillar or metric has no real data source anywhere in the Department's exports, the page says so explicitly instead of filling the space with a plausible-looking number. This rule is treated as a product requirement, not an implementation detail — see §8.

## 2. Goals and success criteria

| Goal | How it's measured on this page today |
| ----- | ----- |
| Reduce time-to-insight for a senior reviewer | One screen, no drill required, covers 5 pillars + top-5 critical/watch issues |
| Make every number traceable | Every figure deep-links to the Review Dashboard's per-KPI drill; a footer names every data source |
| Be honest about data gaps | Pillars/metrics with no real backing data show an explicit "no data source" state, never a placeholder number |
| Work for the whole state-to-block hierarchy | Scope selector (state → district → block) re-renders every section live |
| Be usable without training | Plain-language section headers, RAG colour + text label on every bar, deep links instead of a separate manual |

## 3. Users and personas

| Persona | Need from this page |
| ----- | ----- |
| **Secretary / Commissioner (state level)** | Whole-state posture across all five pillars in one glance; which KPIs are critical right now |
| **District / Regional officer** | Same page, scoped to their district or block via the Viewing selector |
| **Programme owner** (e.g. Palli Paarvai, SMC, THIRAN lead) | Confirms their programme's numbers are visible and accurate under the right pillar, and that drilling in lands on their component |
| **Field visitor (ad hoc)** | Opens the link, signs in once, reads the page on a laptop/tablet — no setup, no filters required by default |

All personas share one login; there is no role-based data restriction today (see §9.3).

## 4. Scope

### 4.1 In scope (this document / current build)

- Sign-in gate (shared with the main dashboard).
- Sticky header: brand, year, signed-in user.
- Scope and filter bar: District / Block drill-down, Management multi-select, School-category multi-select, live "Showing…" summary with Reset.
- Collapsible sidebar: Overview link + five pillar groups, each expandable to its real submenu items; each item shows whether it has real data.
- Headline panel: schools / students / teachers, each with a management or gender/role split bar.
- "Key insights by pillar": one card per pillar, each with up to two metrics visible by default, a "Show more/fewer metrics" expander for pillars with more, and an "Open pillar" action in the header that deep-links to that pillar's data.
- "Needs your attention": top-5 critical (off-track) and top-5 watch (borderline) KPIs across the whole catalog, each naming its owning component, each a deep link.
- "Programme completion" strip: a fixed set of six completion-style KPIs shown as percentage bars.
- Submenu item pages: for a built item, its component's tiled KPIs plus a "View details" deep link; for an unbuilt item, an explicit "not built yet" message.
- Deep-linking back into the main Review Dashboard's per-KPI / per-module drill.

### 4.2 Out of scope (explicitly not built, and not silently faked)

- Any metric for the **Social and Emotional Wellbeing** pillar (sports periods, counselling referrals, SEL, co-curricular, libraries, health, career guidance, value education) — no such data exists anywhere in the Department's current exports.
- **Vizhuthugal (Alumni)** and **Namma School Namma Ooru Palli (NSNOP)** under Alumni and Community Mentorship — no data source.
- **Support to CWSN**, **Scheme & Service Delivery** under Access and Equity — no data source.
- **Grievance Redressal & Public Interface** under Safe and Secure Schools — no data source.
- **Grade-level Proficiency (Primary/Middle)**, **Learning Monitoring & Support**, **Teacher Capacity & Development**, **Vetri Palligal** under Learning Outcomes First — no data source.
- Role-based access control / per-district login restriction.
- CSV / Excel / PDF export of this page (the main dashboard's tables have this; this page does not).
- Historical trend charts on this page (trend views exist only inside the main dashboard's per-component drill).
- A School-level scope (this page stops at Block; School-level detail is reached only after a deep link into the main dashboard).
- An explicit Year selector (the year is shown, fixed to the current review year; changing year happens in the main dashboard).

## 5. Information architecture

```
/glance
├── Sign-in (shared session with "/")
└── Overview (default view)
│   ├── Headline panel (schools / students / teachers)
│   ├── Key insights by pillar (5 cards)
│   ├── Needs your attention (Critical / Watch, top 5 each)
│   ├── Programme completion (6-metric strip)
│   └── Footer (data-source note, RAG legend note)
└── Submenu item page (one per sidebar item with a `module`)
    ├── Built item  → tiled KPIs for that component + "View details" deep link
    └── Unbuilt item → "<label> is not built yet" message
```

Deep links from anywhere on this page open `/` (the main Review Dashboard) with the matching topic/KPI/module pre-selected, landing the user on the same District Review drill the in-app tiles use.

## 6. Functional requirements

### 6.1 Sign-in
- **FR-1.1** The page must be gated behind the same sign-in used by the main dashboard, sharing one session (`sessionStorage`) so a user signed in on one page is signed in on the other.
- **FR-1.2** The login form must show a password-visibility toggle and a link back to the full dashboard's own login.
- **FR-1.3** Failed sign-in must show a plain-language error, not a stack trace or generic failure.

### 6.2 Header and filter bar
- **FR-2.1** The header must always show: Department brand (Tamil + English), the active review year, and the signed-in username.
- **FR-2.2** A breadcrumb (Tamil Nadu › District › Block) must reflect the current scope and be independently clickable at each level to jump back up.
- **FR-2.3** A District selector and, once a district is chosen, a Block selector must be available, both searchable.
- **FR-2.4** Management (Govt / Aided / Private / Central) and School category (Primary/Middle/High/Higher Secondary) must be independent multi-select filters, OR-ed within each filter and AND-ed between them.
- **FR-2.5** A live "Showing: …" summary must reflect the active filter combination, with a one-click Reset when any filter is active.
- **FR-2.6** Every section on the Overview and every submenu page must re-render against the current scope and filters without a page reload.

### 6.3 Sidebar navigation
- **FR-3.1** The sidebar must list an "Overview" entry and exactly five pillar groups, each expandable to show its member items.
- **FR-3.2** A pillar group must stay expanded whenever the active page is one of its own items.
- **FR-3.3** Each sidebar item must visually distinguish "has real data" from "not built yet" (dimmed / explicit sub-label) before the user clicks it.
- **FR-3.4** Each pillar group must show a count badge of how many of its KPIs are currently in the "off track" (critical) band.
- **FR-3.5** The sidebar must be collapsible to an icon-only rail and must re-expand automatically when a user opens a group from the collapsed state.

### 6.4 Headline panel
- **FR-4.1** Three cards — Schools, Students, Teachers — each showing: a plain-language label, a large headline count, one line of context, and a two-or-three-segment split bar with its own legend (counts + percentages).
- **FR-4.2** Schools must split by management (Govt / Aided / Private); Students by gender; Teachers by role (Teaching / Non-teaching) with the pupil-teacher ratio shown in the context line.
- **FR-4.3** The split bar for every card must sit at the same vertical position across all three cards regardless of how many legend lines a given card needs (i.e. the three bars must visually align on one horizontal line).

### 6.5 Key insights by pillar
- **FR-5.1** Exactly five cards must render, one per pillar, in a fixed order: Access and Equity, Safe and Secure Schools, Learning Outcomes First, Social and Emotional Wellbeing, Alumni and Community Mentorship — regardless of how many (if any) real metrics a pillar has.
- **FR-5.2** Each card's header must be a single, full-row click target: title on the left, an "Open pillar" action with an arrow icon on the right, that navigates into the pillar's own data (its first component with real data, or — if none exists — the first item's "not built yet" page).
- **FR-5.3** Each card must show its first two real metrics by default. A metric block = a plain-language label, a large headline value, a two-segment progress bar, and a text legend for each segment (value + percentage).
- **FR-5.4** Progress-bar segments must use only the catalog's three status colours (good / watch / bad), never an unrelated decorative colour, and every segment's meaning must also be stated in text (not colour alone).
- **FR-5.5** If a pillar has more than two real metrics, a "Show more metrics" / "Show fewer metrics" control must appear at the bottom of the card; expanding it must insert the remaining metrics above the control (the control itself always stays the last element in the card) and must only increase the card's height, never its width, so neighbouring cards in the same row are undisturbed.
- **FR-5.6** If a pillar has zero real metrics (no data source exists anywhere for it), the card must show an explicit plain-language message instead of any number, chart, or placeholder value.
- **FR-5.7** Current pillar-to-metric mapping (must stay accurate as the catalog evolves):

  | Pillar | Metrics shown | Real data source |
  | ----- | ----- | ----- |
  | Access and Equity | Potential dropouts % (students absent 15+ of last 30 days ÷ enrolment); Dropout rate % (common-pool children not re-admitted ÷ enrolment classes I–XII) | EMIS Potential Dropout report; ACiS common-pool export |
  | Safe and Secure Schools | Schools with no critical infra gap %; Buildings needing attention (to be demolished / needs repair) | EMIS infrastructure export |
  | Learning Outcomes First | Student attendance %; Inspection targets achieved via Palli Paarvai (state scope only); Class X Board Exam average mark; Class XII Board Exam average mark; THIRAN BLO attainment % | TNSED attendance app; Palli Paarvai export + target model; Board Exam reports; THIRAN endline export |
  | Social and Emotional Wellbeing | *(none — see §4.2)* | — |
  | Alumni and Community Mentorship | Schools holding SMC meetings %; SMC resolutions (closed vs open) | SMC export |

### 6.6 Needs your attention
- **FR-6.1** Two ranked lists — "Critical attention" (off track / below catalog range) and "Watch" (inside range but not yet on track) — each showing up to five KPIs, numbered, each naming the owning component.
- **FR-6.2** Each row must be a deep link into that KPI's drill in the main dashboard.
- **FR-6.3** An empty list must show a plain "nothing off track / nothing on watch at this scope" message, not a blank space.
- **FR-6.4 (open defect, see §10):** The same underlying KPI must not appear twice in the same list under two different component names (currently possible when a KPI is catalogued under more than one module, e.g. Attendance appearing under both "State Summary" and "Attendance").

### 6.7 Programme completion
- **FR-7.1** A fixed set of completion-style KPIs (currently: ACiS survey completion, THIRAN BLO attainment, THIRAN baseline update, ICT labs functional, SMC meeting attendance, Assessment coverage) must render as labelled percentage bars, coloured by each KPI's own catalog band.
- **FR-7.2** Each bar must be a deep link into that KPI's drill.
- **FR-7.3** A KPI with no data at the current scope must be omitted from the strip, not shown as 0%.

### 6.8 Submenu item pages
- **FR-8.1** Opening a sidebar item with real data must show that component's tiled KPIs (value, status band, one-line description) and a "View details" action that deep-links into the full drill.
- **FR-8.2** Opening a sidebar item with no real data must show a plain "<item> is not built yet — no data source for this item exists in the dashboard" message, never a fabricated figure.
- **FR-8.3** Components with their own view-mode toggles (e.g. Palli Paarvai's Performance/Compliance, Attendance's Students/Teachers × Marking/Attendance %) must expose those toggles on this page and apply them consistently to every chart/number on that submenu page.

### 6.9 Deep-linking
- **FR-9.1** Every clickable figure on this page must open `/` (the main Review Dashboard) with the matching topic, KPI id and module pre-selected via query parameters, landing the user on the same drill the in-app tiles use — never a dead end.

## 7. Non-functional requirements

| Area | Requirement |
| ----- | ----- |
| Performance | Loading this page must not block on, or duplicate, data already loaded by the main dashboard (idempotent service loads); landing here first or after the main dashboard costs the same. |
| Accessibility | Every interactive control must be a real `<button>`/`<a>`/form element (not a styled `<div>`); expandable regions must expose `aria-expanded`/`aria-controls`; toggle groups must expose `aria-pressed`; live filter summaries must use `aria-live`; every status colour must be backed by a text label, not colour alone, for colour-blind users. |
| Honesty | No number, chart, or bar may be shown for a metric that has no real backing data (see §8); the alternative is an explicit message, every time, with no exceptions. |
| Device support | Hover-only affordances (e.g. a label that appears on hover) must still be fully visible by default on touch devices that cannot hover. |
| Security | Session is browser-side only; this is explicitly a "front door," not an authentication system, and must not be represented to users or stakeholders as access control. Treat any requirement implying real authorization (per-district restriction, auditability) as **not yet satisfied** (§9.3). |
| Browser | Requires a secure context (HTTPS or localhost) for sign-in, since the credential check uses `SubtleCrypto`. |

## 8. Data requirements and the no-fabrication rule

Every figure on this page must originate from one of the Department's real exports:

- EMIS enrolment roll (current review year)
- TNSED attendance app (daily student/teacher attendance and marking compliance)
- EMIS infrastructure export (facilities, buildings)
- THIRAN (foundational literacy/numeracy identification and endline test)
- SMC (School Management Committee meetings, resolutions, grants)
- Palli Paarvai (school-visit observation line list + designation-wise target model)
- Recognition Order / DPS (pending recognition-certificate applications)
- ACiS / Potential Dropout (common-pool and 15-day-absence reports)
- Board Exam reports (Class X / XII results)

**Rule:** if a pillar, metric, or KPI has no matching field in one of the above, the product requirement is to say so in plain language (a "not built yet" page, an empty-state card message, or simply omitting that one metric) — not to approximate, assume, or carry over a number from an unrelated population. Where a deterministic estimate is unavoidable elsewhere in the dashboard (outside this page), it must be visibly labelled "Assumed" or "Estimated"; this page currently contains no such estimated figures — everything shown is either real or absent.

## 9. Known gaps and risks

### 9.1 Needs your attention — duplicate entries (defect, not a requirement gap)
Two of the five "Critical attention" slots and two of the five "Watch" slots can be consumed by the same real-world KPI counted under two catalog modules (e.g. "Teacher attendance %" under both State Summary and Attendance). This halves the effective signal of a top-5 list and should be deduplicated — tracked as a fix, not a scope change.

### 9.2 Social and Emotional Wellbeing pillar has zero data
This is working as designed (§8), but as a product matter it means one of five pillars on the page is permanently empty until the Department begins collecting sports/counselling/SEL data through an export this dashboard can ingest. Stakeholders should not expect a number here without a new data source being commissioned first.

### 9.3 No role-based access control
Every signed-in user sees every district/block's data; there is no concept of "this official only sees their own district." If the Department needs that control, it is a new requirement, not a configuration change to the existing login.

### 9.4 No export from this page
A user who wants to share this page's figures must use the browser's native print, or take a screenshot; there is no built-in "save as PDF/Excel" from `/glance` itself (unlike the main dashboard's per-table export). If departmental reporting requires a shareable snapshot from this specific page, that is a new requirement to scope and build.

## 10. Glossary

| Term | Meaning on this page |
| ----- | ----- |
| Pillar | One of the five policy groupings used to organise every tracked programme: Access and Equity, Safe and Secure Schools, Learning Outcomes First, Social and Emotional Wellbeing, Alumni and Community Mentorship. |
| Built / not built | "Built" = a sidebar item has a real `KPI_MODULES` component behind it with actual data; "not built" = no data source exists in this dashboard for that item. |
| Critical / Watch / On track | The three status bands every percentage KPI is scored against its catalog's expected range: below range (critical/off track), inside but not yet meeting the better end (watch), at or past the better end (on track). |
| Scope | The state → district → block level the page is currently showing; set via the Viewing breadcrumb/selectors. |
| Deep link | A click-through from a number on this page into the exact matching drill-down view in the main Review Dashboard. |

---

*This document describes the page as implemented. Any future change to a pillar's metrics, the sidebar structure, or the no-fabrication rule should update this file in the same change, so it stays the source of truth for what "At a Glance" is supposed to do.*
