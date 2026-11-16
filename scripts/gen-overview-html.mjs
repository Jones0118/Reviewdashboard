import fs from 'node:fs';
const A = 'src/assets/';
const j = (f) => JSON.parse(fs.readFileSync(A + f, 'utf8'));
const n = (x) => Math.round(x).toLocaleString('en-IN');
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? r1((a / b) * 100) : 0);

// ---- the dashboard's own colour band for a % KPI (app.ts kpiBand) ----
const band = (v, lo, hi, dir) => {
  let s = (v - lo) / (hi - lo || 1);
  if (dir < 0) s = 1 - s;
  s = Math.max(0, Math.min(1, s));
  return s > 0.66 ? 'good' : s > 0.33 ? 'warn' : 'bad';
};
const P = (l, v, lo, hi, dir, t) => ({ l, v: `${v}%`, b: band(v, lo, hi, dir), ...(t ? { t } : {}) });
const N = (l, v, t) => ({ l, v: n(v), b: 'none', ...(t ? { t } : {}) });

// ---- helpers over district nodes ----
const sumD = (districts) => {
  const out = {};
  const add = (o, pre) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number') out[pre + k] = (out[pre + k] ?? 0) + v;
      else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) v.forEach((x, i) => { out[`${pre}${k}[${i}]`] = (out[`${pre}${k}[${i}]`] ?? 0) + x; });
      else if (v && typeof v === 'object' && !Array.isArray(v)) add(v, pre + k + '.');
    }
  };
  for (const d of Object.values(districts)) add(d, '');
  return out;
};

// ---- load ----
const enr = j('enrollment.json'), att = j('attendance.json'), infra = sumD(j('infra-real.json').districts);
const thr = sumD(j('thiran-real.json').districts), dig = sumD(j('digital-infra-real.json').districts);
const dps = sumD(j('dps-real.json').districts), acis = sumD(j('acis-real.json').districts), pd = sumD(j('acis-pd.json').districts);
const pal = sumD(j('palli-real.json').districts), kmod = j('kpi-modules.json');
const smcA = j('smc-real.json'), smcS = sumD(smcA.districts);
const obs = j('palli-obs.json');

// ---- school roll: counts the landing page derives from it ----
const roll = j('schools.json');
const smcMg = new Set(smcA.managements);
let schools = 0, zeroEnrol = 0, zeroTeacher = 0, single = 0, under10 = 0, ptr60 = 0, smcEligible = 0, alloc = 0, used = 0, incr = 0, decl = 0;
const hash01 = (u, salt) => { let h = 2166136261; const s = `${u}|${salt}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };
const slab = (s) => (s <= 0 ? 0 : s <= 30 ? 10000 : s <= 100 ? 25000 : s <= 250 ? 50000 : s <= 1000 ? 75000 : 100000);
for (const arr of Object.values(roll)) for (const s of arr) {
  schools++;
  const st = s.students ?? 0, tc = s.teaching ?? 0;
  if (st === 0) zeroEnrol++;
  if (tc === 0 && st > 0) zeroTeacher++;            // dashboard: students on roll but no teacher
  if (tc === 1) single++;
  if (st > 0 && st < 10) under10++;
  if (tc > 0 && st / tc > 60) ptr60++;
  const ser = s.series ?? [];
  if (ser.length >= 2) { const l = ser[ser.length - 1], p = ser[ser.length - 2]; if (l > p) incr++; else if (l < p) decl++; }
  if (smcMg.has(s.mgmt ?? '')) { smcEligible++; const a = slab(st); alloc += a; used += a * (0.55 + hash01(s.udise, 'smc-grant') * 0.4); }
}
console.log('roll check:', { schools, zeroEnrol, zeroTeacher, single, under10, ptr60, incr, decl, smcEligible });

// ---- state figures ----
const E = enr.state, T = att.state;
const gapSchools = infra.schoolsWithGap, infraN = infra.schools;
const sSch = kmod.state.scholarship.schemes;
const sum = (k) => sSch.reduce((t, x) => t + x[k], 0);

// SMC (full export + last 12 months), per the app: closed = resolved + withdrawn; completion excludes withdrawn
const pc = (w) => (i) => smcS[`p.${w}[${i}]`];
const idx = Object.fromEntries(smcA.periodCols.map((c, i) => [c, i]));
const SM = (w) => { const g = (c) => smcS[`p.${w}[${idx[c]}]`]; return {
  raised: g('raised'), resolved: g('resolved'), withdrawn: g('withdrawn'), unresolved: g('unresolved') + g('wip'),
  emgC: pct(g('emgResolved'), g('emgResolved') + g('emgUnresolved')),
  othC: pct(g('othResolved'), g('othResolved') + g('othUnresolved')),
  allC: pct(g('resolved'), g('resolved') + g('unresolved') + g('wip')),
  meetings: g('meetings'), held: g('schoolsHeld'), present: g('present'), absent: g('absent'), vacant: g('vacant'),
}; };
const sA = SM('all'), s12 = SM('p12');
const closed = sA.resolved + sA.withdrawn;

// ---- series/rows that used to be standalone top-level charts, now folded
// into the matching component's own page (no clutter on Overview). ----
const daily = T.daily;
const fmtD = (iso) => new Date(iso + 'T00:00:00Z').toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const attLabels = daily.map((d, i) => (i % 6 === 0 || i === daily.length - 1 ? fmtD(d.date) : ''));
const short = (s) => s.replace(' School', '').replace('Department', 'Dept.').trim();
const mgRows = [...E.byManagement].sort((a, b) => b.students - a.students).slice(0, 6).map((m) => [short(m.name), pct(m.students, E.students)]);
const infraRows6 = [['No ramp', infra.noRamp], ['No playground', infra.noPlayground], ['Classroom repair needed', infra.classRepair],
  ['No fire safety', infra.noFire], ['No drinking water', infra.noWater], ['No toilet', infra.noToilet]]
  .map(([l, v]) => [l, pct(v, infraN)]).sort((a, b) => b[1] - a[1]);

const modules = [
  { title: 'Enrollment', color: '#0f766e', src: 'Enrolment roll, 2026-27 (UDISE)', rows: [
    N('Zero enrolment schools', zeroEnrol), N('Zero teacher schools', zeroTeacher), N('Single teacher schools', single),
    N('Under 10 students schools', under10), N('PTR over 60 schools', ptr60),
    N('Enrollment increase schools', incr), N('Schools with declined enrollment', decl),
    P('Transition rate — % schools not meeting 100%', pct(decl, schools), 0, 30, -1) ],
    chart: [
      { kind: 'bars', label: 'Flagged schools, % of total', mode: 'pct', rows: [
        ['Zero enrolment', pct(zeroEnrol, schools)], ['Zero teacher', pct(zeroTeacher, schools)],
        ['Single teacher', pct(single, schools)], ['Under 10 students', pct(under10, schools)],
        ['PTR over 60', pct(ptr60, schools)] ], color: '#0f766e' },
      { kind: 'bars', label: `Enrolment share by management, % of ${(E.students / 1e7).toFixed(2)} Cr students`, mode: 'pct', rows: mgRows, color: 'var(--accent)' },
    ] },
  { title: 'Attendance', color: '#b45309', src: `TNSED attendance app · 30 days to ${att.asOf}`, rows: [
    P('Student attendance %', T.attendance, 82, 97, 1), P('Teacher attendance %', T.teacherAttendance, 91, 99, 1),
    P('Schools not marked attendance %', 17.1, 0, 25, -1, 'landing'),
    N('Potential dropout (15 days absent)', T.dropoutRisk) ],
    chart: [
      { kind: 'rings', label: 'Attendance, last 30 days', items: [
        { label: 'Student attendance', value: T.attendance, color: '#b45309' },
        { label: 'Teacher attendance', value: T.teacherAttendance, color: '#0891b2' } ] },
      { kind: 'linechart', label: `Daily attendance trend, last ${daily.length} school days`, mn: 84, mx: 96, labels: attLabels,
        series: [{ label: 'Student', color: '#b45309', data: daily.map((d) => d.attendance) }, { label: 'Teacher', color: '#0891b2', data: daily.map((d) => d.teacher) }] },
    ] },
  { title: 'Infrastructure', color: '#7c3aed', src: `Infrastructure return · ${n(infraN)} schools reporting`, rows: [
    N('School with critical gap', gapSchools), N('Zero toilet school', infra.noToilet), N('No drinking water school', infra.noWater),
    N('Building to be demolished', infra.classDemolish), N('No kitchen shed', infra.noKitchen) ],
    chart: [{ kind: 'bars', label: 'Gap categories, % of reporting schools (lower is better)', mode: 'pct', rows: infraRows6, color: '#7c3aed' }] },
  { title: 'Academic Performance', color: '#be123c', src: 'Exam marks · values as shown on the Review Dashboard landing page', rows: [
    P('Pass Percentage %', 86.7, 40, 95, 1, 'landing'), P('Average Mark', 32.0, 35, 80, 1, 'landing'),
    P('Year-on-Year Improvement %', 3.8, -5, 10, 1, 'landing'), P('Exam-to-Exam Improvement (PP)', 3.8, -5, 10, 1, 'landing'),
    P('Assessment Coverage %', 86.5, 60, 100, 1, 'landing'), P('Mark Entry Completion %', 2.4, 0, 100, 1, 'landing') ],
    // Only one time point is available from the landing page; the 4 earlier
    // points are illustrative, stepped back by the real Year-on-Year figure
    // (3.8 pts/yr) so the trend ends on the real 86.7% value. Clearly labelled
    // in the UI as illustrative — "assume the data" per request.
    chart: [
      { kind: 'trend', label: 'Pass % trend, last 5 years', series: [4, 3, 2, 1, 0].map((k) => r1(86.7 - k * 3.8)), color: '#be123c',
        note: 'Illustrative — only the latest value (86.7%) is from the dashboard' },
      { kind: 'rings', label: 'Assessment & mark entry', items: [
        { label: 'Assessment coverage', value: 86.5, color: '#9f1239' },
        { label: 'Mark entry completion', value: 2.4, color: '#be123c' } ] },
    ] },
  { title: 'THIRAN', color: '#4d7c0f', src: 'THIRAN compliance + endline export', rows: [
    N('THIRAN students identified', thr.students), N('Schools covered', thr.schools),
    P('% of enrolment', pct(thr.students, thr.totalStudents), 20, 60, 1),
    P('BLO attainment %', pct(thr.attainBLO, thr.endlineThiran), 50, 100, 1),
    P('Baseline update %', pct(thr.baselineUpdated, thr.totalStudents), 30, 100, 1),
    N('Students not tagged', thr.notTagged) ],
    chart: [{ kind: 'rings', label: 'Coverage & compliance', items: [
      { label: '% of enrolment', value: pct(thr.students, thr.totalStudents), color: '#4d7c0f' },
      { label: 'BLO attainment', value: pct(thr.attainBLO, thr.endlineThiran), color: '#65a30d' },
      { label: 'Baseline update', value: pct(thr.baselineUpdated, thr.totalStudents), color: '#3f6212' } ] }] },
  { title: 'Scholarship', color: '#a21caf', src: 'Demo figures derived from district enrolment — not an official MIS export', rows: [
    P('Scholarship eligibility %', pct(sum('eligible'), sum('total')), 70, 98, 1, 'demo'),
    P('Payment success %', pct(sum('paySuccess'), sum('eligible')), 75, 99, 1, 'demo'),
    N('Payment failed', sum('payFailed'), 'demo'), N('Payment pending', sum('payPending'), 'demo'),
    N('NPCI inactive', sum('npciInactive'), 'demo'), N('Aadhaar not updated', sum('aadhaarNotUpdated'), 'demo') ] },
  { title: 'Digital Infrastructure (Middle/High/Hr.Sec)', color: '#0e7490', src: 'Digital infrastructure return', rows: [
    N('Schools with ICT facilities', dig.ictSchools), N('ICT schools with internet', dig.internet), N('ICT schools without internet', dig.noInternet),
    P('ICT functional %', pct(dig.functional, dig.ictSchools), 50, 100, 1), P('ICT internet %', pct(dig.internet, dig.ictSchools), 50, 100, 1),
    N('ICT not functional', dig.notFunctional) ],
    chart: [
      { kind: 'rings', label: 'ICT coverage', items: [
        { label: 'ICT functional', value: pct(dig.functional, dig.ictSchools), color: '#0e7490' },
        { label: 'ICT with internet', value: pct(dig.internet, dig.ictSchools), color: '#0891b2' } ] },
      { kind: 'donut2', label: 'ICT functional split', a: { label: 'Functional', value: dig.functional, color: '#0e7490' }, b: { label: 'Not functional', value: dig.notFunctional, color: '#bae6fd' } },
    ] },
  { title: 'SMC', color: '#9a3412', src: `Government schools only · full export, Jul 2025 – ${smcA.anchorDate.slice(0, 7)}`, rows: [
    N('Schools where meetings were held', sA.held), N('Schools where meetings NOT held', Math.max(0, smcEligible - sA.held)),
    P('Meeting attendance %', pct(sA.present, sA.present + sA.absent + sA.vacant), 50, 100, 1),
    N('SMC resolutions raised', sA.raised), N('Pending resolutions', sA.raised - closed),
    P('Closure rate %', pct(closed, sA.raised), 0, 100, 1),
    P('Emergency resolutions completion %', sA.emgC, 0, 100, 1), P('Other resolutions completion %', sA.othC, 0, 100, 1),
    P('Grant utilisation %', pct(used, alloc), 0, 100, 1, 'assumed') ],
    chart: [
      { kind: 'donut2', label: 'Meetings held vs not held', a: { label: 'Meetings held', value: sA.held, color: '#9a3412' }, b: { label: 'Not held', value: Math.max(0, smcEligible - sA.held), color: '#fed7aa' } },
      { kind: 'bargroup', label: 'Resolution completion %, full export vs last 12 months', lb: ['Emergency', 'Other', 'All'], a: [sA.emgC, sA.othC, sA.allC], b: [s12.emgC, s12.othC, s12.allC], labelA: 'Full export', labelB: 'Last 12 months', max: 60 },
    ] },
  { title: 'Palli Paarvai', color: '#1d4ed8', src: 'Palli Paarvai observation exports', rows: [
    P('% of Class Observation', kmod.state.palliParvai.completionPct, 50, 100, 1, 'assumed'),
    N('Observations, Oct 2026', obs.observations.length), N('Observers, Oct 2026', obs.users.length),
    N('Observations, term to date', pal.observations), N('Schools visited, term to date', pal.visitedSchools),
    N('Officials who observed, term to date', pal.officials) ],
    chart: [{ kind: 'funnel', label: 'Observation activity, term to date', steps: [
      ['Officials who observed', pal.officials], ['Schools visited', pal.visitedSchools], ['Observations, term to date', pal.observations] ], color: '#1d4ed8' }] },
  { title: 'Recognition Order - DPS', color: '#7e22ce', src: 'Pending Recognition Certificate applications', rows: [
    N('Total pending applications', dps.total), N('District pending', dps.districtPending), N('State pending', dps.statePending),
    N('Pending < 15 days', dps.lt15), N('Pending 15–30 days', dps.d15to30), N('Pending > 30 days', dps.gt30) ],
    chart: [
      { kind: 'donut2', label: 'District vs state pending', a: { label: 'District', value: dps.districtPending, color: '#7e22ce' }, b: { label: 'State', value: dps.statePending, color: '#e9d5ff' } },
      { kind: 'bars', label: 'Ageing, % of total pending', mode: 'pct', rows: [
        ['< 15 days', pct(dps.lt15, dps.total)], ['15–30 days', pct(dps.d15to30, dps.total)], ['> 30 days', pct(dps.gt30, dps.total)] ], color: '#7e22ce' },
    ] },
  { title: 'All Children in School', color: '#047857', src: 'ACiS common pool · survey and admission', rows: [
    N('Students in Common Pool', acis.pool), N('Students surveyed', acis.surveyed), N('Pending to be surveyed', acis.pendingSurvey),
    P('Survey completion %', pct(acis.surveyed, acis.pool), 50, 100, 1),
    N('Students admitted to schools', acis.admitted), N('Students to be admitted', acis.toBeAdmitted),
    N('Dropouts with reason recorded', acis.withReason), N('Dept. action taken', acis.deptTaken), N('Dept. action to be taken', acis.deptPending) ],
    chart: [{ kind: 'funnel', label: 'Out-of-school pipeline', steps: [
      ['Common Pool', acis.pool], ['Surveyed', acis.surveyed], ['Admitted to schools', acis.admitted], ['Dept. action taken', acis.deptTaken] ], color: '#047857' }] },
  { title: 'Potential Dropout', color: '#c2410c', src: 'EMIS Potential Dropout report · absent 15+ of last 30 days', rows: [
    N('Potential dropouts (15+ days absent)', pd.pd), N('Potential dropout repeaters', pd.repeaters), N('Reason recorded', pd.withReason) ],
    chart: [
      { kind: 'donut2', label: 'Repeaters vs not', a: { label: 'Repeaters', value: pd.repeaters, color: '#c2410c' }, b: { label: 'Not repeaters', value: Math.max(0, pd.pd - pd.repeaters), color: '#fed7aa' } },
      { kind: 'bars', label: 'Reason recorded, % of potential dropouts', mode: 'pct', rows: [['Reason recorded', pct(pd.withReason, pd.pd)]], color: '#c2410c' },
    ] },
];

// ---- "Collector: Yes" filter — the Overview shows only genuinely collected
// metrics. "demo" (synthetic, not an official export) and "assumed" (no source
// ledger) rows are dropped; "landing" rows stay (real figures, just read from
// the dashboard's own landing page). A module left with zero rows is dropped.
for (const m of modules) m.rows = m.rows.filter((r) => r.t !== 'demo' && r.t !== 'assumed');
const modulesYes = modules.filter((m) => m.rows.length > 0);
const droppedModules = modules.filter((m) => m.rows.length === 0).map((m) => m.title);
if (droppedModules.length) console.log('[overview] dropped modules (no collector:Yes metrics left):', droppedModules.join(', '));

// ---- KPI strip ----
const cr = E.students / 1e7;
const kpis = [
  { l: 'Students enrolled', v: `${cr.toFixed(2)} Cr`, d: '', c: '', n: 'all managements' },
  { l: 'Schools', v: n(E.schools), d: '', c: '', n: `${n(smcEligible)} government (SMC-covered)` },
  { l: 'Student attendance', v: `${T.attendance}%`, d: 'watch', c: 'a', n: `30 days to ${att.asOf}` },
  { l: 'Teacher attendance', v: `${T.teacherAttendance}%`, d: 'critical', c: 'r', n: 'below 91–99% band' },
  { l: 'Potential dropouts', v: n(T.dropoutRisk), d: '15+ days absent', c: 'a', n: 'attendance app' },
  { l: 'Critical infra gap', v: n(gapSchools), d: `${pct(gapSchools, infraN)}% of reporting`, c: 'r', n: 'schools' },
];

const DATA = {
  meta: {
    line: `Attendance to ${att.asOf} · SMC to ${smcA.anchorDate} · Palli Paarvai Oct 2026 · generated 12 Nov 2026 from the Review Dashboard assets`,
    notes: [
      'Percentage KPIs are banded (good / watch / critical) with the same ranges the Review Dashboard catalog uses; plain counts carry no band.',
      'This dashboard shows "Collector: Yes" components only — genuinely collected figures with a real data source. Synthetic ("demo") and source-less ("assumed") figures are excluded entirely, which is why Scholarship does not appear here (every scholarship figure is demo).',
      '"landing" tag = real figures read from the Review Dashboard\'s own landing page (academic exam results, schools-not-marked-attendance %), because they depend on a selected exam period or attendance window rather than a single fixed export.',
      'SMC covers government-managed schools only. Member attendance = present ÷ (present + absent + vacant). Resolution completion = resolved ÷ (resolved + unresolved), withdrawn excluded.',
      'Attendance figures are a 30-day window; the dashboard also offers 3, 5, 7 and 15-day windows.',
      'Each component\'s chart uses its own figures. One exception: the Academic Performance 5-year trend is illustrative — only its last point (86.7%) is a real dashboard value, the 4 earlier points are stepped back by the real Year-on-Year figure to show a plausible trend shape.',
    ],
  },
  kpis, modules: modulesYes,
};

const tpl = fs.readFileSync('scripts/overview-template.html', 'utf8');
if (!tpl.includes('/*__DATA__*/null')) throw new Error('placeholder missing');
const html = tpl.replace('/*__DATA__*/null', () => JSON.stringify(DATA).replace(/</g, '\\u003c'));
const out = 'Review-Dashboard-Overview.html';
fs.writeFileSync(out, html, 'utf8');
console.log('wrote', out, (html.length / 1024).toFixed(1) + ' KB;', modulesYes.length, 'component pages, reached from the vertical menu');
console.log(JSON.stringify(kpis.map((k) => `${k.l}: ${k.v}`)));
console.log('SMC', JSON.stringify({ eligible: smcEligible, held: sA.held, att: pct(sA.present, sA.present + sA.absent + sA.vacant), grantPct: pct(used, alloc), allocCr: r1(alloc / 1e7), emg: sA.emgC, oth: sA.othC, p12: [s12.emgC, s12.othC, s12.allC] }));
