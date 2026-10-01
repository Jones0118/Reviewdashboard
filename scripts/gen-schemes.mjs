/**
 * Generates src/assets/schemes.json for the Review Dashboard.
 *
 * The Dashboard spec's "Schemes" section lists six programmes that have no
 * dedicated source dataset in this repo:
 *   Thiran, TN SPARK, Breakfast (integration), Scholarship,
 *   CM Cell Petition, 14417 Critical Case.
 *
 * Rather than hard-code magic numbers, we derive every figure deterministically
 * from the real per-district enrolment already shipped in enrollment.json, so
 * the scheme figures scale sensibly with district size and stay reproducible
 * between builds. A small seeded PRNG adds district-to-district variation
 * without making the output random.
 *
 * The Review Dashboard also exposes a school-programme filter
 * (All / Model School / Vetri Palli / TN SPARKS / PAL). Those programmes are
 * not tagged in the source rolls, so we publish a deterministic share of each
 * district's schools/students per programme here; the filter scales the review
 * KPIs by that share. "All" is the unscaled total.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'src', 'assets');
const enrollment = JSON.parse(readFileSync(join(assets, 'enrollment.json'), 'utf8'));

/** Deterministic, seedable PRNG (mulberry32) so builds are reproducible. */
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

/** Stable integer hash of a string, used to seed each district. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const round = (n) => Math.max(0, Math.round(n));

// School-programme shares (fraction of a district's schools that belong to
// each programme). These overlap-free shares define the cross-KPI filter.
// "All" is implicit (share = 1).
const PROGRAMS = [
  { id: 'all', label: 'All', share: 1 },
  { id: 'model', label: 'Model School', share: 0.04 },
  { id: 'vetri', label: 'Vetri Palli', share: 0.06 },
  { id: 'sparks', label: 'TN SPARKS', share: 0.09 },
  { id: 'pal', label: 'PAL', share: 0.12 },
];

const districts = enrollment.districts.map((d) => {
  const rnd = rng(hash(d.name));
  const students = d.students;
  const schools = d.schools;
  // vary each rate a little per district around a state norm
  const jitter = (base, spread) => base + (rnd() - 0.5) * spread;

  // ---- Schemes ----
  // Thiran: skilling/assessment programme — coverage of eligible students.
  const thiranEligible = round(students * jitter(0.62, 0.12));
  const thiranEnrolled = round(thiranEligible * jitter(0.78, 0.14));
  const thiranAssessed = round(thiranEnrolled * jitter(0.83, 0.12));

  // TN SPARK: STEM programme — schools onboarded + students reached.
  const sparkSchools = round(schools * jitter(0.28, 0.1));
  const sparkStudents = round(students * jitter(0.22, 0.08));

  // Breakfast (integration): primary-stage beneficiaries + meals served.
  const breakfastEligible = round(students * jitter(0.38, 0.08));
  const breakfastServed = round(breakfastEligible * jitter(0.94, 0.06));
  const breakfastSchools = round(schools * jitter(0.72, 0.1));

  // Scholarship: applications -> sanctioned -> disbursed (with amount).
  const scholApplied = round(students * jitter(0.18, 0.06));
  const scholSanctioned = round(scholApplied * jitter(0.81, 0.12));
  const scholDisbursed = round(scholSanctioned * jitter(0.9, 0.08));
  const scholAmountLakh = round((scholDisbursed * jitter(1150, 300)) / 1e5);

  // CM Cell Petition: received / resolved / pending.
  const cmReceived = round(schools * jitter(0.6, 0.4) + 20);
  const cmResolved = round(cmReceived * jitter(0.86, 0.12));
  const cmPending = Math.max(0, cmReceived - cmResolved);

  // 14417 Critical Case (child-safety / distress helpline): reported/critical.
  const helplineCases = round(schools * jitter(0.12, 0.08) + 5);
  const helplineCritical = round(helplineCases * jitter(0.18, 0.1));
  const helplineResolved = round(helplineCases * jitter(0.9, 0.1));

  // ---- Programme membership (for the cross-KPI filter) ----
  const programs = {};
  for (const p of PROGRAMS) {
    const s = p.id === 'all' ? 1 : jitter(p.share, p.share * 0.4);
    programs[p.id] = {
      schools: p.id === 'all' ? schools : round(schools * s),
      students: p.id === 'all' ? students : round(students * s),
    };
  }

  return {
    name: d.name,
    students,
    schools,
    thiran: { eligible: thiranEligible, enrolled: thiranEnrolled, assessed: thiranAssessed },
    tnSpark: { schools: sparkSchools, students: sparkStudents },
    breakfast: { eligible: breakfastEligible, served: breakfastServed, schools: breakfastSchools },
    scholarship: {
      applied: scholApplied,
      sanctioned: scholSanctioned,
      disbursed: scholDisbursed,
      amountLakh: scholAmountLakh,
    },
    cmCell: { received: cmReceived, resolved: cmResolved, pending: cmPending },
    helpline14417: { cases: helplineCases, critical: helplineCritical, resolved: helplineResolved },
    programs,
  };
});

// State totals = sum of districts (keeps the header KPIs consistent with the
// leaderboard rows).
function sumBy(path) {
  return districts.reduce((acc, d) => {
    const v = path.split('.').reduce((o, k) => (o ? o[k] : 0), d);
    return acc + (typeof v === 'number' ? v : 0);
  }, 0);
}

const state = {
  thiran: {
    eligible: sumBy('thiran.eligible'),
    enrolled: sumBy('thiran.enrolled'),
    assessed: sumBy('thiran.assessed'),
  },
  tnSpark: { schools: sumBy('tnSpark.schools'), students: sumBy('tnSpark.students') },
  breakfast: {
    eligible: sumBy('breakfast.eligible'),
    served: sumBy('breakfast.served'),
    schools: sumBy('breakfast.schools'),
  },
  scholarship: {
    applied: sumBy('scholarship.applied'),
    sanctioned: sumBy('scholarship.sanctioned'),
    disbursed: sumBy('scholarship.disbursed'),
    amountLakh: sumBy('scholarship.amountLakh'),
  },
  cmCell: {
    received: sumBy('cmCell.received'),
    resolved: sumBy('cmCell.resolved'),
    pending: sumBy('cmCell.pending'),
  },
  helpline14417: {
    cases: sumBy('helpline14417.cases'),
    critical: sumBy('helpline14417.critical'),
    resolved: sumBy('helpline14417.resolved'),
  },
};

const out = {
  generatedAt: new Date().toISOString(),
  currentYear: enrollment.currentYear,
  note: 'Schemes figures are derived deterministically from district enrolment for the Review Dashboard demo. They are not an official scheme MIS export.',
  programs: PROGRAMS,
  state,
  districts,
};

const outFile = join(assets, 'schemes.json');
const json = JSON.stringify(out);
writeFileSync(outFile, json, 'utf8');
writeFileSync(`${outFile}.gz`, gzipSync(Buffer.from(json), { level: 9 }));
console.log(`[gen-schemes] wrote ${outFile} (+ .gz)`);
console.log(`[gen-schemes] districts: ${districts.length}, year: ${enrollment.currentYear}`);
