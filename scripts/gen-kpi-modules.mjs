/**
 * Generates src/assets/kpi-modules.json for the Review Dashboard.
 *
 * Covers the five additional KPI modules in KPI.md that have no source dataset
 * in this repo:
 *   THIRAN+, Scholarship, Digital Infrastructure, SMC, Palli Parvai.
 *
 * As with gen-schemes.mjs, every figure is derived deterministically from the
 * real per-district enrolment already shipped in enrollment.json, so the
 * numbers scale sensibly with district size and stay reproducible between
 * builds. These are demo figures for layout review, not an official MIS export.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'src', 'assets');
const enrollment = JSON.parse(readFileSync(join(assets, 'enrollment.json'), 'utf8'));

/** Deterministic, seedable PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const round = (n) => Math.max(0, Math.round(n));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// ---- reference lists from KPI.md ----
const SCHOLARSHIP_SCHEMES = [
  'ADW GIS (3-5)',
  'ADW GIS (6-8)',
  'ADW GOI PMSS',
  'ADW GOI Pre-Matric Component 1',
  'ADW GOI Pre-Matric Component-II-UCO',
  'Muslim Girls Educational Scheme',
  'Pre-Matric Scholarship Scheme - BC',
  'Pre-Matric Scholarship Scheme - MBC/DNC',
  'Rural Girls Incentive Scheme - MBC/DNC',
  'TW GIS',
  'TW GOI Post Matric Scheme',
  'TW GOI Pre-Matric Scholarship Scheme',
];
const SOCIAL_CATEGORIES = ['SC', 'ST', 'BC', 'MBC/DNC', 'Others'];
const SCHOOL_CATEGORIES = ['Primary', 'Middle', 'High', 'Higher Secondary'];
const THIRAN_CLASSES = [2, 3, 4, 5, 6, 7, 8, 9];
const SMC_LEVELS = ['State', 'District', 'School & SMC'];
const SMC_AGEING = ['0-7 Days', '8-15 Days', '16-30 Days', '31-60 Days', '60+ Days'];
const SMC_DEPARTMENTS = [
  'School Education', 'Public Works', 'Rural Development', 'TWAD Board',
  'Electricity Board (TANGEDCO)', 'Municipal Administration', 'Health & Family Welfare',
  'Adi Dravidar Welfare', 'Highways', 'Revenue',
];
const DESIGNATIONS = ['BRTE', 'BEO', 'DEO', 'CEO'];

const districts = enrollment.districts.map((d) => {
  const rnd = rng(hash(d.name) + 17);
  const jitter = (base, spread) => base + (rnd() - 0.5) * spread;
  const students = d.students;
  const schools = d.schools;

  // ================= 1. THIRAN+ =================
  // Remedial/skilling identification across classes 2-9.
  const thiranStudents = round(students * jitter(0.085, 0.03));
  const thiranSchools = round(schools * jitter(0.55, 0.15));
  const thiranBoysShare = jitter(0.51, 0.05);
  const thiranBoys = round(thiranStudents * thiranBoysShare);
  const thiranGirls = Math.max(0, thiranStudents - thiranBoys);
  // spread across classes 2-9, tapering slightly with class
  const classWeights = THIRAN_CLASSES.map((c, i) => jitter(1 - i * 0.05, 0.15));
  const wSum = classWeights.reduce((a, b) => a + b, 0);
  const thiranByClass = THIRAN_CLASSES.map((c, i) => ({
    cls: c, students: round(thiranStudents * (classWeights[i] / wSum)),
  }));
  const catWeights = SCHOOL_CATEGORIES.map(() => jitter(1, 0.5));
  const cSum = catWeights.reduce((a, b) => a + b, 0);
  const thiranByCategory = SCHOOL_CATEGORIES.map((name, i) => ({
    name, students: round(thiranStudents * (catWeights[i] / cSum)),
  }));

  // ================= 2. SCHOLARSHIP =================
  const scholarshipSchemes = SCHOLARSHIP_SCHEMES.map((name) => {
    const r2 = rng(hash(d.name + name));
    const j = (base, spread) => base + (r2() - 0.5) * spread;
    const total = round(students * j(0.035, 0.02));
    const eligible = round(total * j(0.78, 0.15));
    const notEligible = Math.max(0, total - eligible);
    const paySuccess = round(eligible * j(0.82, 0.12));
    const payFailed = round(eligible * j(0.06, 0.04));
    const payPending = Math.max(0, eligible - paySuccess - payFailed);
    const npciActive = round(eligible * j(0.85, 0.1));
    const npciInactive = Math.max(0, eligible - npciActive);
    const aadhaarNotUpdated = round(eligible * j(0.07, 0.05));
    const verificationPending = round(eligible * j(0.09, 0.06));
    const catW = SOCIAL_CATEGORIES.map(() => j(1, 0.7));
    const catSum = catW.reduce((a, b) => a + b, 0);
    return {
      name,
      total, eligible, notEligible, eligibilityPct: pct(eligible, total),
      paySuccess, payFailed, payPending,
      npciActive, npciInactive, aadhaarNotUpdated, verificationPending,
      bySocialCategory: SOCIAL_CATEGORIES.map((c, i) => ({
        name: c, students: round(eligible * (catW[i] / catSum)),
      })),
    };
  });

  // ================= 3. DIGITAL INFRASTRUCTURE =================
  const ictSchools = round(schools * jitter(0.42, 0.14));
  const ictWithInternet = round(ictSchools * jitter(0.72, 0.16));
  const ictWithoutInternet = Math.max(0, ictSchools - ictWithInternet);
  const ictWithTeacher = round(ictSchools * jitter(0.63, 0.16));
  const ictWithoutTeacher = Math.max(0, ictSchools - ictWithTeacher);

  // ================= 4. SMC =================
  const smcRaised = round(schools * jitter(2.6, 1.2) + 40);
  const smcClosed = round(smcRaised * jitter(0.71, 0.16));
  const smcPending = Math.max(0, smcRaised - smcClosed);
  const smcEmergency = round(smcRaised * jitter(0.18, 0.1));
  const smcNonEmergency = Math.max(0, smcRaised - smcEmergency);
  const smcSchools = round(schools * jitter(0.63, 0.18));
  const smcStudents = round(students * jitter(0.58, 0.2));
  // level-wise split of the same raised total
  const lvlW = SMC_LEVELS.map(() => jitter(1, 0.6));
  const lvlSum = lvlW.reduce((a, b) => a + b, 0);
  const smcByLevel = SMC_LEVELS.map((name, i) => {
    const raised = round(smcRaised * (lvlW[i] / lvlSum));
    const closed = round(raised * jitter(0.7, 0.2));
    return { name, raised, closed, pending: Math.max(0, raised - closed), closureRate: pct(closed, raised) };
  });
  // ageing buckets over the pending pile
  const ageW = [0.34, 0.24, 0.18, 0.14, 0.1].map((w) => jitter(w, w * 0.5));
  const ageSum = ageW.reduce((a, b) => a + b, 0);
  const smcAgeing = SMC_AGEING.map((name, i) => ({
    name, count: round(smcPending * (ageW[i] / ageSum)),
  }));
  // department accountability
  const smcDepartments = SMC_DEPARTMENTS.map((name) => {
    const r3 = rng(hash(d.name + name) + 7);
    const j = (base, spread) => base + (r3() - 0.5) * spread;
    const mapped = round(smcRaised * j(0.12, 0.1));
    const resolved = round(mapped * j(0.66, 0.24));
    return {
      name, mapped, resolved, pending: Math.max(0, mapped - resolved),
      schools: round(mapped * j(0.8, 0.3)),
      students: round(mapped * j(120, 80)),
      rate: pct(resolved, mapped),
    };
  }).sort((a, b) => b.pending - a.pending);

  // ================= 5. PALLI PARVAI =================
  const ppTarget = round(schools * jitter(0.92, 0.1));
  const ppVisited = round(ppTarget * jitter(0.68, 0.2));
  const ppNotVisited = Math.max(0, ppTarget - ppVisited);
  const ppObservations = round(ppVisited * jitter(3.2, 1.4));
  const ppPendingObs = round(ppObservations * jitter(0.22, 0.14));
  const ppByDesignation = DESIGNATIONS.map((name, i) => {
    const r4 = rng(hash(d.name + name) + 31);
    const j = (base, spread) => base + (r4() - 0.5) * spread;
    // BRTE carries the most targets, CEO the fewest
    const shareByRole = [0.52, 0.28, 0.14, 0.06][i];
    const target = round(ppTarget * j(shareByRole, shareByRole * 0.3));
    const observed = round(target * j(0.66, 0.24));
    return {
      name, target, observed, pending: Math.max(0, target - observed),
      completionPct: pct(observed, target),
    };
  });
  // officials with a target but zero visits
  const officialCount = round(schools * jitter(0.05, 0.03) + 4);
  const zeroVisitOfficials = [];
  for (let i = 0; i < officialCount; i++) {
    const r5 = rng(hash(d.name + 'official' + i));
    if (r5() < 0.22) {
      const desig = DESIGNATIONS[Math.floor(r5() * DESIGNATIONS.length)];
      const target = 1 + Math.floor(r5() * 6);
      zeroVisitOfficials.push({
        name: `${desig} Officer ${i + 1}`,
        designation: desig,
        district: d.name,
        target,
        visited: 0,
        pending: target,
      });
    }
  }

  return {
    name: d.name,
    students,
    schools,
    thiran: {
      students: thiranStudents, schools: thiranSchools,
      boys: thiranBoys, girls: thiranGirls,
      byClass: thiranByClass, byCategory: thiranByCategory,
    },
    scholarship: { schemes: scholarshipSchemes },
    digital: {
      ictSchools, ictWithInternet, ictWithoutInternet, ictWithTeacher, ictWithoutTeacher,
    },
    smc: {
      raised: smcRaised, closed: smcClosed, pending: smcPending,
      closureRate: pct(smcClosed, smcRaised),
      emergency: smcEmergency, nonEmergency: smcNonEmergency,
      schools: smcSchools, studentsCovered: smcStudents,
      byLevel: smcByLevel, ageing: smcAgeing, departments: smcDepartments,
    },
    palliParvai: {
      target: ppTarget, visited: ppVisited, notVisited: ppNotVisited,
      completionPct: pct(ppVisited, ppTarget),
      observations: ppObservations, pendingObservations: ppPendingObs,
      byDesignation: ppByDesignation,
      zeroVisitOfficials,
    },
  };
});

// ---- state rollups (sums for counts, recomputed rates) ----
const sum = (fn) => districts.reduce((a, d) => a + fn(d), 0);

const thiranStudents = sum((d) => d.thiran.students);
const smcRaised = sum((d) => d.smc.raised);
const smcClosed = sum((d) => d.smc.closed);
const ppTarget = sum((d) => d.palliParvai.target);
const ppVisited = sum((d) => d.palliParvai.visited);

const state = {
  thiran: {
    students: thiranStudents,
    schools: sum((d) => d.thiran.schools),
    boys: sum((d) => d.thiran.boys),
    girls: sum((d) => d.thiran.girls),
    // sum students per class; `cls` is an identifier, never a summed measure
    byClass: THIRAN_CLASSES.map((cls) => ({
      cls,
      students: sum((d) => d.thiran.byClass.find((x) => x.cls === cls)?.students ?? 0),
    })),
    byCategory: SCHOOL_CATEGORIES.map((name) => ({
      name, students: sum((d) => d.thiran.byCategory.find((x) => x.name === name)?.students ?? 0),
    })),
  },
  scholarship: {
    schemes: SCHOLARSHIP_SCHEMES.map((name) => {
      const rows = districts.map((d) => d.scholarship.schemes.find((s) => s.name === name)).filter(Boolean);
      const add = (k) => rows.reduce((a, r) => a + r[k], 0);
      const total = add('total');
      const eligible = add('eligible');
      return {
        name,
        total, eligible, notEligible: add('notEligible'), eligibilityPct: pct(eligible, total),
        paySuccess: add('paySuccess'), payFailed: add('payFailed'), payPending: add('payPending'),
        npciActive: add('npciActive'), npciInactive: add('npciInactive'),
        aadhaarNotUpdated: add('aadhaarNotUpdated'), verificationPending: add('verificationPending'),
        bySocialCategory: SOCIAL_CATEGORIES.map((c) => ({
          name: c,
          students: rows.reduce((a, r) => a + (r.bySocialCategory.find((x) => x.name === c)?.students ?? 0), 0),
        })),
      };
    }),
  },
  digital: {
    ictSchools: sum((d) => d.digital.ictSchools),
    ictWithInternet: sum((d) => d.digital.ictWithInternet),
    ictWithoutInternet: sum((d) => d.digital.ictWithoutInternet),
    ictWithTeacher: sum((d) => d.digital.ictWithTeacher),
    ictWithoutTeacher: sum((d) => d.digital.ictWithoutTeacher),
  },
  smc: {
    raised: smcRaised, closed: smcClosed, pending: sum((d) => d.smc.pending),
    closureRate: pct(smcClosed, smcRaised),
    emergency: sum((d) => d.smc.emergency), nonEmergency: sum((d) => d.smc.nonEmergency),
    schools: sum((d) => d.smc.schools), studentsCovered: sum((d) => d.smc.studentsCovered),
    byLevel: SMC_LEVELS.map((name) => {
      const raised = sum((d) => d.smc.byLevel.find((x) => x.name === name)?.raised ?? 0);
      const closed = sum((d) => d.smc.byLevel.find((x) => x.name === name)?.closed ?? 0);
      return { name, raised, closed, pending: Math.max(0, raised - closed), closureRate: pct(closed, raised) };
    }),
    ageing: SMC_AGEING.map((name) => ({
      name, count: sum((d) => d.smc.ageing.find((x) => x.name === name)?.count ?? 0),
    })),
    departments: SMC_DEPARTMENTS.map((name) => {
      const rows = districts.map((d) => d.smc.departments.find((x) => x.name === name)).filter(Boolean);
      const add = (k) => rows.reduce((a, r) => a + r[k], 0);
      const mapped = add('mapped');
      const resolved = add('resolved');
      return {
        name, mapped, resolved, pending: add('pending'),
        schools: add('schools'), students: add('students'), rate: pct(resolved, mapped),
      };
    }).sort((a, b) => b.pending - a.pending),
  },
  palliParvai: {
    target: ppTarget, visited: ppVisited, notVisited: sum((d) => d.palliParvai.notVisited),
    completionPct: pct(ppVisited, ppTarget),
    observations: sum((d) => d.palliParvai.observations),
    pendingObservations: sum((d) => d.palliParvai.pendingObservations),
    byDesignation: DESIGNATIONS.map((name) => {
      const target = sum((d) => d.palliParvai.byDesignation.find((x) => x.name === name)?.target ?? 0);
      const observed = sum((d) => d.palliParvai.byDesignation.find((x) => x.name === name)?.observed ?? 0);
      return { name, target, observed, pending: Math.max(0, target - observed), completionPct: pct(observed, target) };
    }),
    zeroVisitOfficials: districts.flatMap((d) => d.palliParvai.zeroVisitOfficials),
  },
};

const out = {
  generatedAt: new Date().toISOString(),
  currentYear: enrollment.currentYear,
  note: 'THIRAN+, Scholarship, Digital Infrastructure, SMC and Palli Parvai figures are derived deterministically from district enrolment for the Review Dashboard demo. They are not an official MIS export.',
  scholarshipSchemes: SCHOLARSHIP_SCHEMES,
  socialCategories: SOCIAL_CATEGORIES,
  schoolCategories: SCHOOL_CATEGORIES,
  smcLevels: SMC_LEVELS,
  smcAgeing: SMC_AGEING,
  designations: DESIGNATIONS,
  state,
  districts,
};

const outFile = join(assets, 'kpi-modules.json');
const json = JSON.stringify(out);
writeFileSync(outFile, json, 'utf8');
writeFileSync(`${outFile}.gz`, gzipSync(Buffer.from(json), { level: 9 }));
console.log(`[gen-kpi-modules] wrote ${outFile} (+ .gz)`);
console.log(`[gen-kpi-modules] districts: ${districts.length}, year: ${enrollment.currentYear}`);
console.log(`[gen-kpi-modules] THIRAN+ students: ${thiranStudents.toLocaleString('en-IN')}`);
console.log(`[gen-kpi-modules] SMC raised: ${smcRaised.toLocaleString('en-IN')}, closure ${pct(smcClosed, smcRaised)}%`);
console.log(`[gen-kpi-modules] Palli Parvai: ${ppVisited.toLocaleString('en-IN')} of ${ppTarget.toLocaleString('en-IN')} visited (${pct(ppVisited, ppTarget)}%)`);
console.log(`[gen-kpi-modules] zero-visit officials: ${state.palliParvai.zeroVisitOfficials.length}`);
