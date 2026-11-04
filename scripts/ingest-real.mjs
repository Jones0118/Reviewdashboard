// Ingests REAL EMIS exports from D:\general\Dashboard\Resources into aggregated
// JSON assets consumed by the review dashboard. Covers four domains:
//   Academic Score, Palli Parvai, THIRAN+, Digital Infrastructure.
// Infrastructure (SIDS) is deferred until that folder is populated.
//
// Each domain is aggregated to three scopes keyed to match the dashboard join:
//   districts : UPPERCASE district name          (ReviewService district rows)
//   blocks    : `DISTRICT||UPPERCASE_BLOCK`       (normalized block key)
//   schools   : UDISE code                        (clean school join key)
//
// Large CSVs are streamed line-by-line; XLSX files are read via a minimal
// zip + sharedStrings parser (no external deps).
//
// Run:  node scripts/ingest-real.mjs

import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync, gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RES = 'D:\\general\\Dashboard\\Resources';
const OUT_DIR = join(ROOT, 'src', 'assets');

// ---------- helpers ----------
const UP = (s) => (s ?? '').toString().trim().toUpperCase();
const blockKey = (dist, block) => `${UP(dist)}||${UP(block)}`;
const num = (v) => {
  const n = parseFloat((v ?? '').toString().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const isNull = (v) => {
  const s = (v ?? '').toString().trim().toLowerCase();
  return s === '' || s === 'null' || s === 'not updated' || s === 'na' || s === 'n/a';
};

// Parse a single CSV line honoring double-quoted fields.
// (kept for reference; streaming parser below handles embedded newlines)

// Stream a CSV; call onRow(rowObject) for each data row. Handles quoted fields
// containing commas AND embedded newlines (parses across the raw byte stream,
// not line-by-line). Header on first record. Strips UTF-8 BOM.
async function streamCsv(path, onRow) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  let header = null;
  let field = '';
  let record = [];
  let inQuotes = false;
  let n = 0;
  let started = false;

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => {
    endField();
    // ignore blank trailing record
    const blank = record.length === 1 && record[0] === '';
    if (!blank) {
      if (!header) {
        header = record.map((h) => h.replace(/^\ufeff/, '').trim());
      } else {
        const row = {};
        for (let i = 0; i < header.length; i++) row[header[i]] = record[i];
        onRow(row);
        n++;
      }
    }
    record = [];
  };

  for await (const chunk of stream) {
    let c = chunk;
    if (!started) { if (c.charCodeAt(0) === 0xfeff) c = c.slice(1); started = true; }
    for (let i = 0; i < c.length; i++) {
      const ch = c[i];
      if (inQuotes) {
        if (ch === '"') {
          if (c[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') endField();
        else if (ch === '\n') { endRecord(); }
        else if (ch === '\r') { /* ignore, handled by \n */ }
        else field += ch;
      }
    }
  }
  // flush last record if file didn't end with newline
  if (field.length || record.length) endRecord();
  return n;
}

// ---------- minimal XLSX reader (first sheet) ----------
function readXlsx(path) {
  const buf = readFileSync(path);
  const entries = unzip(buf);
  const sharedXml = entries['xl/sharedStrings.xml']?.toString('utf8') ?? '';
  const shared = [];
  for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const txt = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
    shared.push(decodeXml(txt));
  }
  // find first worksheet
  const sheetName = Object.keys(entries).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k))
    ?? Object.keys(entries).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  const sheetXml = entries[sheetName].toString('utf8');
  const rows = [];
  for (const rm of sheetXml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNum = parseInt(/r="(\d+)"/.exec(rm[1])?.[1] ?? '0', 10);
    const cells = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const isMatch = /<is>(?:<t[^>]*>([\s\S]*?)<\/t>)?<\/is>/.exec(inner);
      let val;
      if (/t="s"/.test(attrs)) val = shared[parseInt(vMatch?.[1] ?? '-1', 10)] ?? '';
      else if (isMatch) val = decodeXml(isMatch[1] ?? '');
      else val = vMatch ? decodeXml(vMatch[1]) : '';
      cells.push({ col: colNum(ref), val });
    }
    const arr = [];
    for (const c of cells) arr[c.col] = c.val;
    // place at the real (1-based) row index so empty rows don't shift things
    if (rowNum > 0) rows[rowNum - 1] = arr;
    else rows.push(arr);
  }
  return rows;
}
function colNum(ref) {
  if (!ref) return 0;
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function decodeXml(s) {
  return (s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
// Minimal ZIP reader: returns { entryName: Buffer }. Uses the central directory
// (authoritative sizes/offsets), which handles data-descriptor entries that
// XLSX writers commonly emit.
function unzip(buf) {
  return unzipViaCentral(buf);
}
function unzipViaCentral(buf) {
  const out = {};
  // find End of Central Directory
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return out;
  let cd = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  for (let e = 0; e < total; e++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
    // read local header to find data start
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    try { out[name] = method === 0 ? Buffer.from(data) : inflateRawSync(data); } catch { /* skip */ }
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Generic 3-scope accumulator.
function makeAgg(init) {
  return { districts: new Map(), blocks: new Map(), schools: new Map(), init };
}
function bump(agg, dist, block, udise, fn) {
  const dk = UP(dist);
  if (dk) { if (!agg.districts.has(dk)) agg.districts.set(dk, agg.init()); fn(agg.districts.get(dk)); }
  const bk = blockKey(dist, block);
  if (block) { if (!agg.blocks.has(bk)) agg.blocks.set(bk, agg.init()); fn(agg.blocks.get(bk)); }
  const uk = (udise ?? '').toString().trim();
  if (uk) { if (!agg.schools.has(uk)) agg.schools.set(uk, agg.init()); fn(agg.schools.get(uk)); }
}
function toObj(map) { return Object.fromEntries(map); }

// =====================================================================
// 1) ACADEMIC — Cls-10-Aca-Sco-Res-Ana-Rpt-24-25.xlsx
// =====================================================================
function ingestAcademic() {
  const path = join(RES, 'Academic Score', 'Cls-10-Aca-Sco-Res-Ana-Rpt-24-25.xlsx');
  const rows = readXlsx(path);
  // header is row index 4 (row 5 in 1-based); data from index 5
  const header = rows[4].map((h) => (h ?? '').toString().trim());
  const idx = (name) => header.indexOf(name);
  const subjects = ['Language', 'English', 'Maths', 'Science', 'Social'];
  const iDist = idx('district_name'), iBlock = idx('block_name'), iUd = idx('udise_code');
  const iOverall = idx('overall_school_percentage');
  const avgIdx = Object.fromEntries(subjects.map((s) => [s, idx(`${s}_Average_Mark`)]));

  const init = () => ({
    sections: 0, overallSum: 0, overallN: 0,
    subj: Object.fromEntries(subjects.map((s) => [s, { sum: 0, n: 0 }])),
  });
  const agg = makeAgg(init);

  for (let r = 5; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const dist = row[iDist], block = row[iBlock], ud = row[iUd];
    if (!dist) continue;
    const overall = row[iOverall];
    bump(agg, dist, block, ud, (o) => {
      o.sections++;
      // Treat 0 and null/"Not Updated" alike as "no real mark yet" for averaging,
      // so sparse not-yet-entered rows don't drag the mean to ~0.
      if (!isNull(overall) && num(overall) > 0) { o.overallSum += num(overall); o.overallN++; }
      for (const s of subjects) {
        const v = row[avgIdx[s]];
        if (!isNull(v) && num(v) > 0) { o.subj[s].sum += num(v); o.subj[s].n++; }
      }
    });
  }
  const fin = (o) => {
    const subjAvg = {};
    for (const s of subjects) subjAvg[s.toLowerCase()] = o.subj[s].n ? round1(o.subj[s].sum / o.subj[s].n) : null;
    return {
      sections: o.sections,
      overallAvg: o.overallN ? round1(o.overallSum / o.overallN) : null,
      subjectAvg: subjAvg,
      updatedSections: o.overallN,
      completionPct: o.sections ? round1((o.overallN / o.sections) * 100) : null,
    };
  };
  return finalize(agg, fin, 'Class 10 academic result analysis 2024-2025 (real EMIS export)');
}

// =====================================================================
// 2) THIRAN+ — compliance + endline performance CSVs
// =====================================================================
async function ingestThiran() {
  const compliance = join(RES, 'THIRAN', 'Thiran Compliance Report_.csv.csv');
  const endline = join(RES, 'THIRAN', 'Endline Assessment Thiran performance Report_.csv.csv');

  const init = () => ({
    total: 0, thiran: 0, baseline: 0, absent: 0, notSelected: 0, notTagged: 0,
    endThiran: 0, notTamil: 0, notEnglish: 0, notMaths: 0, attainBLO: 0,
    schools: new Set(),
  });
  const agg = makeAgg(init);

  await streamCsv(compliance, (row) => {
    const dist = row['district_name'], block = row['block_name'], ud = row['udise_code'];
    if (!dist) return;
    bump(agg, dist, block, ud, (o) => {
      o.total += num(row['Total_students']);
      o.thiran += num(row['Thiran_student']);
      o.baseline += num(row['Baseline_update_student']);
      o.absent += num(row['Absent_students']);
      o.notSelected += num(row['Not_selected_thiran']);
      o.notTagged += num(row['Not_taged']);
      if (ud) o.schools.add(ud.toString().trim());
    });
  });

  await streamCsv(endline, (row) => {
    const dist = row['district_name'], block = row['block_name'], ud = row['udise_code'];
    if (!dist) return;
    bump(agg, dist, block, ud, (o) => {
      o.endThiran += num(row['thiran_students']);
      o.notTamil += num(row['students_Not_attain_BLO_tamil']);
      o.notEnglish += num(row['students_Not_attain_BLO_english']);
      o.notMaths += num(row['students_Not_attain_BLO_maths']);
      o.attainBLO += num(row['students_attain_BLO']);
    });
  });

  const fin = (o) => ({
    students: o.thiran,
    schools: o.schools.size,
    totalStudents: o.total,
    sharePct: o.total ? round1((o.thiran / o.total) * 100) : null,
    baselineUpdated: o.baseline,
    baselineUpdatePct: o.total ? round1((o.baseline / o.total) * 100) : null,
    absent: o.absent,
    notSelected: o.notSelected,
    notTagged: o.notTagged,
    endlineThiran: o.endThiran,
    attainBLO: o.attainBLO,
    notAttainTamil: o.notTamil,
    notAttainEnglish: o.notEnglish,
    notAttainMaths: o.notMaths,
    bloAttainmentPct: o.endThiran ? round1((o.attainBLO / o.endThiran) * 100) : null,
  });
  return finalize(agg, fin, 'THIRAN+ compliance + endline (real EMIS export)');
}

// =====================================================================
// 3) PALLI PARVAI — observation CSV (+ designation target xlsx)
// =====================================================================
async function ingestPalli() {
  const obs = join(RES, 'Palli Parvai', 'Palli Paarvai 2.0 ReportReport (6).csv');

  const init = () => ({
    observations: 0,
    schools: new Set(),
    observers: new Set(),
    byDesignation: {},   // stackholder -> count
  });
  const agg = makeAgg(init);

  await streamCsv(obs, (row) => {
    const dist = row['District'], block = row['block_name'], ud = row['udise_code'];
    if (!dist) return;
    const desig = (row['stackholders'] ?? '').toString().trim() || 'Unknown';
    const observer = (row['observer_name'] ?? '').toString().trim();
    bump(agg, dist, block, ud, (o) => {
      o.observations++;
      if (ud) o.schools.add(ud.toString().trim());
      if (observer) o.observers.add(observer);
      o.byDesignation[desig] = (o.byDesignation[desig] || 0) + 1;
    });
  });

  const fin = (o) => ({
    observations: o.observations,
    visitedSchools: o.schools.size,
    officials: o.observers.size,
    byDesignation: o.byDesignation,
  });
  const result = finalize(agg, fin, 'Palli Paarvai 2.0 observations (real EMIS export)');

  // attach designation target model from the xlsx (state-level reference)
  try {
    const targetPath = join(RES, 'Palli Parvai', 'Designation_wise_Target_Calculation.xlsx');
    const trows = readXlsx(targetPath);
    const thead = trows[3].map((h) => (h ?? '').toString().trim());
    const ti = (n) => thead.indexOf(n);
    const targets = [];
    for (let r = 4; r < trows.length; r++) {
      const row = trows[r];
      if (!row || !row[ti('Official')]) continue;
      targets.push({
        official: row[ti('Official')],
        classesPerMonth: num(row[ti('Total classes / month')]),
        newSchoolsPerMonth: num(row[ti('Total new schools / month')]),
        sanctionedPosts: num(row[ti('Sanctioned posts used')]),
      });
    }
    result.targetModel = targets;
  } catch (e) {
    result.targetModel = [];
  }
  return result;
}

// ---------------------------------------------------------------------
// 3b) PALLI PARVAI — observation LINE LIST with start / end time (one row per observation)
// ---------------------------------------------------------------------
/**
 * Source: `Palli Parvai\PP_Oct_2026_Start and End 20261103.xlsx` — October 2026,
 * one row per observation, WITH the observer (user id + name) and the
 * observation start / end timestamps. Drives the user-wise drill (US 4–8):
 * district → user → the user's school observations → observation details,
 * plus the observation-duration KPI.
 *
 * Duration rules (US 2/7): duration = end_time − start_time.
 *   valid    0 < duration ≤ PALLI_MAX_VALID_MIN
 *   invalid  missing / unparsable timestamps, end ≤ start, or longer than
 *            PALLI_MAX_VALID_MIN (sessions left open — the export has sessions
 *            of several days). Invalid rows keep durSec = -1 and are excluded
 *            from every duration category, reported separately.
 *
 * Every export row is kept (no de-duplication); the export has no observation
 * id, so two observations of the same school/class/time cannot be told apart.
 * NOT in the export: section, the observation report (findings).
 * UDISE arrives as a float ("3.3071904004E10") and is restored to 11 digits.
 */
const PALLI_MAX_VALID_MIN = 480;   // 8 hours — a school day

async function ingestPalliObs() {
  const path = join(RES, 'Palli Parvai', 'PP_Oct_2026_Start and End 20261103.xlsx');
  const rows = readXlsx(path);
  const H = (rows[0] ?? []).map((h) => (h ?? '').toString().trim());
  const col = (n) => { const i = H.indexOf(n); if (i < 0) throw new Error(`palli-obs: column "${n}" not found`); return i; };
  const iDate = col('Date_of_Observation'), iDist = col('District'), iBlock = col('block_name');
  const iU = col('udise_code'), iSch = col('School_Observed'), iUid = col('Observed by');
  const iCls = col('class'), iDesig = col('stackholders'), iName = col('observer_name');
  const iStart = col('start_time'), iEnd = col('end_time');

  const BASE = '2026-10-01';
  const baseMs = Date.parse(`${BASE}T00:00:00Z`);
  const ts = (s) => {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((s ?? '').toString().trim());
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN;
  };
  const udise = (v) => {
    const s = (v ?? '').toString().trim();
    if (/^\d+$/.test(s)) return s;
    const n = Number(s);
    return Number.isFinite(n) ? String(Math.round(n)) : s;
  };

  const schoolIdx = new Map(), schools = [];      // [{ d, b, u, s }]
  const desigIdx = new Map(), desigs = [];
  const userIdx = new Map(), users = [];          // [{ id, n }]
  const observations = [];  // [day, school, cls, desig, user, durSec, startSecOfDay]
  const dq = { noDate: 0, noUdise: 0, missingTime: 0, endBeforeStart: 0, tooLong: 0 };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const date = (row[iDate] ?? '').toString().trim().slice(0, 10);
    const u = udise(row[iU]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { dq.noDate++; continue; }
    if (!u) { dq.noUdise++; continue; }
    if (!schoolIdx.has(u)) {
      schoolIdx.set(u, schools.length);
      schools.push({ d: (row[iDist] ?? '').toString().trim(), b: (row[iBlock] ?? '').toString().trim(), u, s: (row[iSch] ?? '').toString().trim() });
    }
    const desig = (row[iDesig] ?? '').toString().trim() || 'Unknown';
    if (!desigIdx.has(desig)) { desigIdx.set(desig, desigs.length); desigs.push(desig); }
    const uid = (row[iUid] ?? '').toString().trim().replace(/\.0$/, '');
    if (!userIdx.has(uid)) { userIdx.set(uid, users.length); users.push({ id: uid, n: (row[iName] ?? '').toString().trim() }); }

    const s = ts(row[iStart]), e = ts(row[iEnd]);
    let dur = -1, startSod = -1;
    if (!Number.isFinite(s) || !Number.isFinite(e)) dq.missingTime++;
    else {
      const sec = Math.round((e - s) / 1000);
      startSod = Math.round((s % 86400000) / 1000);
      if (sec <= 0) dq.endBeforeStart++;
      else if (sec > PALLI_MAX_VALID_MIN * 60) dq.tooLong++;
      else dur = sec;
    }
    const cls = parseInt((row[iCls] ?? '').toString(), 10);
    observations.push([
      Math.round((Date.parse(`${date}T00:00:00Z`) - baseMs) / 86400000),
      schoolIdx.get(u), cls >= 1 && cls <= 12 ? cls : 0,
      desigIdx.get(desig), userIdx.get(uid), dur, startSod,
    ]);
  }
  observations.sort((a, b) => b[0] - a[0] || b[6] - a[6]);   // newest first

  const valid = observations.filter((o) => o[5] > 0);
  const cat = (lo, hi) => valid.filter((o) => o[5] >= lo * 60 && o[5] < hi * 60).length;
  console.log(`[palli-obs] rows ${(rows.length - 1).toLocaleString('en-IN')} → kept ${observations.length.toLocaleString('en-IN')} · ` +
    `${schools.length.toLocaleString('en-IN')} schools · ${users.length.toLocaleString('en-IN')} users · ${desigs.length} designations`);
  console.log(`[palli-obs] duration valid ${valid.length.toLocaleString('en-IN')} | <15 ${cat(0, 15).toLocaleString('en-IN')} | ` +
    `15–30 ${cat(15, 30).toLocaleString('en-IN')} | ≥30 ${cat(30, 1e9).toLocaleString('en-IN')} | data-quality ${JSON.stringify(dq)}`);

  return {
    note: 'Palli Parvai observations Oct 2026 with start/end time (positional; see fields[])',
    generatedAt: new Date().toISOString(),
    source: 'PP_Oct_2026_Start and End 20261103.xlsx',
    baseDate: BASE,
    maxValidMinutes: PALLI_MAX_VALID_MIN,
    fields: ['day', 'school', 'cls', 'desig', 'user', 'durSec', 'startSecOfDay'],
    dataQuality: dq,
    schools, desigs, users,
    observations,
  };
}

// =====================================================================
// 4) DIGITAL INFRASTRUCTURE — ICT_hit tech.xlsx
// =====================================================================
function ingestDigitalInfra() {
  const path = join(RES, 'Digital Infra', 'ICT_hit tech.xlsx');
  const rows = readXlsx(path);
  // header on row 1 (index 0); data from index 1
  const header = rows[0].map((h) => (h ?? '').toString().trim());
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iDist = idx('District_Name_&_Code');
  const iBlock = idx('Block_Name_&_Code');
  const iUd = idx('UDISE_Code');
  const iFunc = idx('Functional Status');
  const iIct = idx('School with ICT facilities');
  const iNet = idx('Internet status');
  const iLab = idx('Lab Count');

  const init = () => ({ total: 0, ict: 0, functional: 0, partial: 0, notFunc: 0, internet: 0, labs: 0 });
  const agg = makeAgg(init);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const dist = stripCode(row[iDist]), block = stripCode(row[iBlock]), ud = row[iUd];
    if (!dist) continue;
    const status = (row[iFunc] ?? '').toString().trim().toLowerCase();
    const ict = (row[iIct] ?? '').toString().trim().toLowerCase();
    const net = (row[iNet] ?? '').toString().trim().toLowerCase();
    const isIct = ict.includes('ict school') || ict === 'yes';
    bump(agg, dist, block, ud, (o) => {
      o.total++;
      if (isIct) o.ict++;
      if (status.startsWith('functional')) o.functional++;
      else if (status.startsWith('partial')) o.partial++;
      else if (status.startsWith('not')) o.notFunc++;
      if (net === 'yes') o.internet++;
      o.labs += num(row[iLab]);
    });
  }
  const fin = (o) => ({
    schools: o.total,
    ictSchools: o.ict,
    functional: o.functional,
    partiallyFunctional: o.partial,
    notFunctional: o.notFunc,
    internet: o.internet,
    noInternet: Math.max(0, o.ict - o.internet),
    labs: o.labs,
    functionalPct: o.ict ? round1((o.functional / o.ict) * 100) : null,
    internetPct: o.ict ? round1((o.internet / o.ict) * 100) : null,
  });
  return finalize(agg, fin, 'ICT functional + internet status (real EMIS export)');
}

// Strip a trailing " (code)" from "NAMAKKAL (3309)" -> "NAMAKKAL".
function stripCode(s) {
  return (s ?? '').toString().replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// =====================================================================
// 5) INFRASTRUCTURE — SIDS (DSE secondary + DEE elementary assessments)
// =====================================================================
async function ingestInfra() {
  const files = [
    join(RES, 'SIDS', 'DSE- Infra Assessment Need ReportReport (2).csv'),
    join(RES, 'SIDS', 'DEE Infrastructure Assessment Detail ReportReport.csv'),
  ];

  const init = () => ({
    schools: 0,
    noToilet: 0, noWater: 0, noCwsnToilet: 0, noKitchen: 0, noPlayground: 0,
    noFirstAid: 0, noFire: 0, noRamp: 0,
    classDemolish: 0, classRepair: 0, classShortage: 0,
    toiletRepair: 0, anyGap: 0,
    schoolSet: new Set(),
  });
  const agg = makeAgg(init);

  // field accessor tolerant of DSE vs DEE casing
  const get = (row, ...names) => {
    for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
    return '';
  };
  const yes = (v) => {
    const s = (v ?? '').toString().trim().toLowerCase();
    return s === 'yes' || s === 'y' || s === '1' || s === 'true';
  };

  for (const path of files) {
    if (!existsSync(path)) continue;
    await streamCsv(path, (row) => {
      const dist = row['district_name'], block = row['block_name'], ud = row['udise_code'];
      if (!dist) return;

      // functional toilets: DSE has *_toilet_func; DEE has *_Toilet_good_condt
      const boysToiletOk = num(get(row, 'boys_toilet_func', 'Boys_Toilet_good_condt'));
      const girlsToiletOk = num(get(row, 'girls_toilet_func', 'Girls_Toilet_good_condt'));
      const cwsnToiletOk = num(get(row, 'cwsn_toilet_func', 'CWSN_Toilet_good_condt'));
      const boysToiletReq = num(get(row, 'boys_toilet_required', 'Boys_Toilet_req'));
      const girlsToiletReq = num(get(row, 'girls_toilet_required', 'Girls_Toilet_req'));
      const cwsnToiletReq = num(get(row, 'cwsn_toilet_required', 'CWSN_Toilet_req'));
      const toiletRepairCnt = num(get(row, 'boys_toilet_repair')) + num(get(row, 'girls_toilet_repair'));

      const water = get(row, 'exist_drink_water_yn');
      const kitchen = get(row, 'kitchen_shed_avl', 'Kitchen_Shed');
      const playground = get(row, 'sch_playgrd_yn');
      const firstAid = get(row, 'first_aid_kit');
      const fire = get(row, 'fire_extingu_avl');
      const ramp = get(row, 'build_wth_ramp', 'avail_handrail_ramp');

      const classReq = num(get(row, 'Rcc_Classroom_req'));
      const classRepair = num(get(row, 'Rcc_Classroom_needrepair'));
      const classDemolish = num(get(row, 'Rcc_Classroom_tobe_demolish'));

      bump(agg, dist, block, ud, (o) => {
        if (ud && o.schoolSet.has(ud.toString().trim())) return; // de-dup if a school repeats
        if (ud) o.schoolSet.add(ud.toString().trim());
        o.schools++;
        let gap = false;
        if (boysToiletOk === 0 && girlsToiletOk === 0) { o.noToilet++; gap = true; }
        if (!yes(water)) { o.noWater++; gap = true; }
        if (cwsnToiletOk === 0 && cwsnToiletReq > 0) { o.noCwsnToilet++; gap = true; }
        if (!yes(kitchen)) { o.noKitchen++; gap = true; }
        if (!yes(playground)) o.noPlayground++;
        if (!yes(firstAid)) o.noFirstAid++;
        if (!yes(fire)) o.noFire++;
        if (!yes(ramp)) o.noRamp++;
        if (classDemolish > 0) { o.classDemolish++; gap = true; }
        if (classRepair > 0) { o.classRepair++; gap = true; }
        if (classReq > 0) o.classShortage++;
        if (toiletRepairCnt > 0) o.toiletRepair++;
        if (gap) o.anyGap++;
      });
    });
  }

  const fin = (o) => ({
    schools: o.schools,
    noToilet: o.noToilet,
    noWater: o.noWater,
    noCwsnToilet: o.noCwsnToilet,
    noKitchen: o.noKitchen,
    noPlayground: o.noPlayground,
    noFirstAid: o.noFirstAid,
    noFire: o.noFire,
    noRamp: o.noRamp,
    classDemolish: o.classDemolish,
    classRepair: o.classRepair,
    classShortage: o.classShortage,
    toiletRepair: o.toiletRepair,
    schoolsWithGap: o.anyGap,
    gapPct: o.schools ? round1((o.anyGap / o.schools) * 100) : null,
  });
  return finalize(agg, fin, 'SIDS infrastructure assessment DSE + DEE (real EMIS export)');
}

// =====================================================================
// 6) SMC — emergency resolutions NOT closed (real)
// =====================================================================
/**
 * SMC covers two things that share the same scopes:
 *
 *   "SMC Attendance Abstract"  one row per MEETING held (school, date, present /
 *                              absent / vacant seats). Drives "meetings held",
 *                              "meetings not held" and meeting attendance.
 *   "SMC - All Resolutions"    one row per resolution raised, with is_emergency,
 *                              Final status and the mapped department.
 *
 * Both are bucketed into the four rolling windows the metric sheet asks for
 * (last 12 / 9 / 6 / 3 months) plus `all`. The windows are anchored to the
 * LATEST date present in the data, not to today's clock, so the filter keeps
 * meaning as the export ages. Counters are emitted as positional arrays
 * (SMC_PERIOD_COLS) to keep the asset small — ~27k school keys × 5 windows.
 *
 * Note the export spans ~14.5 months (2025-07-24 → 2026-10-01), so "last 1
 * year" legitimately excludes the first few months; `all` is the full export.
 */
const SMC_PERIODS = ['all', 'p12', 'p9', 'p6', 'p3'];
/** Column order of every period array. Mirrored by SmcPeriodCol in the model. */
const SMC_PERIOD_COLS = [
  'raised', 'resolved', 'unresolved', 'withdrawn', 'wip',
  'emgRaised', 'emgResolved', 'emgUnresolved',
  'othRaised', 'othResolved', 'othUnresolved',
  'meetings', 'schoolsHeld', 'present', 'absent', 'vacant',
];
/** Day 0 for the compact date offsets in the detail asset. */
const SMC_BASE_DATE = '2025-07-01';

/** Managements the SMC programme covers (government / local body / welfare). */
const SMC_MANAGEMENTS = [
  'School Education Department School', 'Adi-Dravida Welfare School', 'Municipal School',
  'Corporation School', 'Kallar BC/MBC Department School', 'Tribal Welfare School',
  'Differently Abled Welfare Department School', 'Forest Department School',
  'Kasturba Gandhi Balika Vidhyalaya (KGBV)',
  'Netaji Subhash Chandra Bose Awasiya Vidyalaya (ARS Schools)',
];

/** Whole days between two ISO dates. */
function smcDayOffset(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -1;
  return Math.round((t - Date.parse(SMC_BASE_DATE)) / 86400000);
}

/** ISO date `months` before `iso`. */
function smcMinusMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Resolution status code: 0 unresolved, 1 resolved, 2 withdrawn, 3 work-in-progress. */
function smcStatusCode(raw) {
  const s = (raw ?? '').toString().trim().toLowerCase();
  if (s === 'resolved') return 1;
  if (s === 'withdrawn') return 2;
  if (s === 'work in progress') return 3;
  return 0;
}

async function ingestSmc() {
  const resPath = join(RES, 'SMC', 'SMC - All Resolutions ReportReport.csv');
  const attPath = join(RES, 'SMC', 'SMC Attendance Abstract ReportReport.csv');

  // ---- interning tables for the detail asset ----
  const schoolIdx = new Map();
  const schools = [];
  const depts = [];
  const deptIdx = new Map();
  const levels = [];
  const levelIdx = new Map();
  const intern = (list, map, label) => {
    const k = (label ?? '').toString().trim() || '—';
    if (!map.has(k)) { map.set(k, list.length); list.push(k); }
    return map.get(k);
  };
  const schoolRef = (dist, block, udise, name, mgmt, cat) => {
    const u = (udise ?? '').toString().trim();
    const k = u || `${dist}|${block}|${name}`;
    if (!schoolIdx.has(k)) {
      schoolIdx.set(k, schools.length);
      schools.push({
        d: (dist ?? '').toString().trim(),
        b: (block ?? '').toString().trim(),
        u,
        s: (name ?? '').toString().trim(),
        m: (mgmt ?? '').toString().trim() || '—',
        c: (cat ?? '').toString().trim() || '—',
      });
    }
    return schoolIdx.get(k);
  };

  // ---- pass 1: read both files into memory as compact rows ----
  const meetings = [];     // [schIdx, dayOffset, present, absent, vacant, members]
  const resolutions = [];  // [schIdx, deptIdx, status, emergency, levelIdx, dayOffset]
  let maxDate = '';
  const seeDate = (d) => { if (d && d > maxDate && d <= '2099-12-31') maxDate = d; };

  const attRows = await streamCsv(attPath, (row) => {
    const dist = row['DistName'];
    if (!dist || !dist.trim()) return;
    const date = (row['attendance_date'] ?? '').toString().trim();
    seeDate(date);
    meetings.push([
      schoolRef(dist, row['BlkName'], row['UDISE'], row['SchName'], row['Mgmt'], row['SchCategory']),
      date,
      num(row['present']), num(row['absent']), num(row['vacant']), num(row['member_count']),
    ]);
  });

  const resIds = new Set();
  const resRows = await streamCsv(resPath, (row) => {
    const dist = row['District'];
    if (!dist || !dist.trim()) return;
    const date = (row['Resolution uploaded - Date'] ?? '').toString().trim();
    seeDate(date);
    resIds.add((row['resolution_id'] ?? '').toString().trim());
    resolutions.push([
      schoolRef(dist, row['Block'], row['udise_code'], row['School'], row['Management'], row['Schl_Category']),
      intern(depts, deptIdx, row['mapped_department_name']),
      smcStatusCode(row['Final status']),
      (row['is_emergency'] ?? '').toString().trim().toUpperCase() === 'YES' ? 1 : 0,
      intern(levels, levelIdx, row['Level']),
      date,
    ]);
  });

  // ---- window boundaries, anchored to the latest date in the data ----
  const anchor = maxDate;
  const cutoff = {
    all: '0000-00-00',
    p12: smcMinusMonths(anchor, 12),
    p9: smcMinusMonths(anchor, 9),
    p6: smcMinusMonths(anchor, 6),
    p3: smcMinusMonths(anchor, 3),
  };
  /** Which windows an ISO date falls inside. */
  const windowsFor = (date) => SMC_PERIODS.filter((p) => date && date >= cutoff[p]);

  // ---- aggregate to the three dashboard scopes, per window ----
  const C = Object.fromEntries(SMC_PERIOD_COLS.map((c, i) => [c, i]));
  const init = () => {
    const o = {};
    for (const p of SMC_PERIODS) o[p] = new Array(SMC_PERIOD_COLS.length).fill(0);
    // distinct schools that held a meeting, per window (district/block scopes)
    o.held = Object.fromEntries(SMC_PERIODS.map((p) => [p, new Set()]));
    return o;
  };
  const agg = makeAgg(init);

  for (const m of meetings) {
    const s = schools[m[0]];
    const wins = windowsFor(m[1]);
    if (!wins.length) continue;
    bump(agg, s.d, s.b, s.u, (o) => {
      for (const p of wins) {
        const a = o[p];
        a[C.meetings]++;
        a[C.present] += m[2];
        a[C.absent] += m[3];
        a[C.vacant] += m[4];
        o.held[p].add(s.u || s.s);
      }
    });
  }

  for (const r of resolutions) {
    const s = schools[r[0]];
    const wins = windowsFor(r[5]);
    if (!wins.length) continue;
    const status = r[2];
    const emg = r[3] === 1;
    bump(agg, s.d, s.b, s.u, (o) => {
      for (const p of wins) {
        const a = o[p];
        a[C.raised]++;
        if (status === 1) a[C.resolved]++;
        else if (status === 2) a[C.withdrawn]++;
        else if (status === 3) a[C.wip]++;
        else a[C.unresolved]++;
        if (emg) {
          a[C.emgRaised]++;
          if (status === 1) a[C.emgResolved]++;
          else if (status !== 2) a[C.emgUnresolved]++;
        } else {
          a[C.othRaised]++;
          if (status === 1) a[C.othResolved]++;
          else if (status !== 2) a[C.othUnresolved]++;
        }
      }
    });
  }

  const fin = (o) => {
    const p = {};
    for (const w of SMC_PERIODS) {
      const a = o[w].slice();
      a[C.schoolsHeld] = o.held[w].size;
      p[w] = a;
    }
    const all = p.all;
    const closed = all[C.resolved] + all[C.withdrawn];
    return {
      // all-time headline figures (unchanged semantics: closed = resolved + withdrawn)
      raised: all[C.raised],
      closed,
      pending: Math.max(0, all[C.raised] - closed),
      closureRate: all[C.raised] ? round1((closed / all[C.raised]) * 100) : null,
      emergency: all[C.emgRaised],
      emergencyOpen: all[C.emgUnresolved],
      p,
    };
  };
  const out = finalize(agg, fin,
    'SMC resolutions + meeting attendance, bucketed into rolling windows (real EMIS export)');
  out.periodCols = SMC_PERIOD_COLS;
  out.periods = SMC_PERIODS;
  out.anchorDate = anchor;
  out.cutoffs = cutoff;
  out.managements = SMC_MANAGEMENTS;

  // ---- detail asset for the dedicated drill (lazily loaded) ----
  const detail = {
    note: 'SMC meetings + resolutions (positional rows; dates are day offsets from baseDate)',
    generatedAt: new Date().toISOString(),
    baseDate: SMC_BASE_DATE,
    anchorDate: anchor,
    cutoffs: cutoff,
    managements: SMC_MANAGEMENTS,
    meetingFields: ['school', 'day', 'present', 'absent', 'vacant', 'members'],
    resolutionFields: ['school', 'dept', 'status', 'emergency', 'level', 'day'],
    statusLabels: ['Unresolved', 'Resolved', 'Withdrawn', 'Work in progress'],
    schools, depts, levels,
    meetings: meetings.map((m) => [m[0], smcDayOffset(m[1]), m[2], m[3], m[4], m[5]]),
    resolutions: resolutions.map((r) => [r[0], r[1], r[2], r[3], r[4], smcDayOffset(r[5])]),
  };

  const distAll = Object.values(out.districts);
  const sum = (i) => distAll.reduce((t, d) => t + d.p.all[i], 0);
  console.log(`[smc] anchor ${anchor} | cutoffs 12m ${cutoff.p12}, 9m ${cutoff.p9}, 6m ${cutoff.p6}, 3m ${cutoff.p3}`);
  console.log(`[smc] meeting rows ${attRows.toLocaleString('en-IN')}, resolution rows ${resRows.toLocaleString('en-IN')} ` +
    `(${resIds.size.toLocaleString('en-IN')} distinct resolution_id), schools seen ${schools.length.toLocaleString('en-IN')}`);
  console.log(`[smc] all-window: raised ${sum(C.raised).toLocaleString('en-IN')} ` +
    `(resolved ${sum(C.resolved).toLocaleString('en-IN')}, unresolved ${sum(C.unresolved).toLocaleString('en-IN')}, ` +
    `withdrawn ${sum(C.withdrawn).toLocaleString('en-IN')}, wip ${sum(C.wip)})`);
  console.log(`[smc] emergency ${sum(C.emgRaised).toLocaleString('en-IN')} ` +
    `(resolved ${sum(C.emgResolved).toLocaleString('en-IN')}, unresolved ${sum(C.emgUnresolved).toLocaleString('en-IN')}) | ` +
    `other ${sum(C.othRaised).toLocaleString('en-IN')} ` +
    `(resolved ${sum(C.othResolved).toLocaleString('en-IN')}, unresolved ${sum(C.othUnresolved).toLocaleString('en-IN')})`);
  console.log(`[smc] meetings ${sum(C.meetings).toLocaleString('en-IN')} | present ${sum(C.present).toLocaleString('en-IN')} ` +
    `absent ${sum(C.absent).toLocaleString('en-IN')} vacant ${sum(C.vacant).toLocaleString('en-IN')} | ` +
    `attendance ${round1((sum(C.present) / (sum(C.present) + sum(C.absent))) * 100)}%`);
  for (const w of SMC_PERIODS) {
    const s = (i) => distAll.reduce((t, d) => t + d.p[w][i], 0);
    const held = distAll.reduce((t, d) => t + d.p[w][C.schoolsHeld], 0);
    console.log(`[smc]   ${w.padEnd(4)} raised ${s(C.raised).toString().padStart(7)} | ` +
      `meetings ${s(C.meetings).toString().padStart(7)} | schools-held(sum of districts) ${held.toString().padStart(6)}`);
  }

  writeGz('smc-detail.json', detail);
  return out;
}

// =====================================================================
// 7) RECOGNITION ORDER — DPS (RC Pending Applications)
// =====================================================================
/**
 * Recognition Certificate (RC) pending applications for private/self-finance
 * schools, handled by the Directorate of Private Schools (DPS).
 *
 * `Pending_with` identifies who currently holds the file, which is what
 * separates a DISTRICT-level pendency from a STATE-level one:
 *   district : Pending_in_App_by_deo, Pending_by_deo, doc_verifi_pending
 *   state    : State_Section_office, State_Superintendent, Pending_by_JD_*,
 *              Pending_by_director
 * `pending_days` is bucketed into <15 / 15-30 / >30 (mutually exclusive, so
 * the three buckets sum back to the total).
 */
const DPS_STATE_STAGES = new Set([
  'state_section_office', 'state_superintendent',
  'pending_by_jd_matric', 'pending_by_jd_private', 'pending_by_director',
]);
const DPS_DISTRICT_STAGES = new Set([
  'pending_in_app_by_deo', 'pending_by_deo', 'doc_verifi_pending',
]);

/** Human label for a raw Pending_with stage code. */
function dpsStageLabel(raw) {
  const s = (raw ?? '').toString().trim();
  if (!s) return 'Unspecified';
  const map = {
    pending_in_app_by_deo: 'Pending in application by DEO',
    pending_by_deo: 'Pending by DEO',
    doc_verifi_pending: 'Document verification pending',
    state_section_office: 'State Section Office',
    state_superintendent: 'State Superintendent',
    pending_by_jd_matric: 'Joint Director (Matric)',
    pending_by_jd_private: 'Joint Director (Private)',
    pending_by_director: 'Director',
  };
  return map[s.toLowerCase()] ?? s.replace(/_/g, ' ');
}

function dpsLevel(raw) {
  const s = (raw ?? '').toString().trim().toLowerCase();
  if (DPS_STATE_STAGES.has(s)) return 'State';
  if (DPS_DISTRICT_STAGES.has(s)) return 'District';
  return 'Unspecified';
}

function dpsBucket(days) {
  if (days > 30) return '>30';
  if (days >= 15) return '15-30';
  return '<15';
}

async function ingestDps() {
  const path = join(RES, 'DPS', 'RC Pending ApplicationsReport.csv');
  const init = () => ({
    total: 0, districtPending: 0, statePending: 0,
    lt15: 0, d15to30: 0, gt30: 0, daysSum: 0, maxDays: 0,
  });
  const agg = makeAgg(init);
  const applications = [];

  await streamCsv(path, (row) => {
    const dist = row['district_name'];
    if (!dist || !dist.trim()) return;
    const block = row['block_name'];
    const ud = (row['udise_code'] ?? '').toString().trim();
    const days = num(row['pending_days']);
    const level = dpsLevel(row['Pending_with']);
    const bucket = dpsBucket(days);

    bump(agg, dist, block, ud, (o) => {
      o.total++;
      if (level === 'State') o.statePending++;
      else if (level === 'District') o.districtPending++;
      if (bucket === '>30') o.gt30++;
      else if (bucket === '15-30') o.d15to30++;
      else o.lt15++;
      o.daysSum += days;
      if (days > o.maxDays) o.maxDays = days;
    });

    applications.push({
      appId: (row['application_id'] ?? '').toString().trim(),
      district: dist.trim(),
      block: (block ?? '').toString().trim(),
      udise: ud,
      schoolType: (row['school_type'] ?? '').toString().trim() || '—',
      applicationName: (row['application_name'] ?? '').toString().trim(),
      pendingWith: dpsStageLabel(row['Pending_with']),
      level,
      status: (row['status'] ?? '').toString().trim() || '—',
      days,
      bucket,
      updatedOn: (row['updation_ts'] ?? '').toString().trim(),
    });
  });

  const fin = (o) => ({
    total: o.total,
    districtPending: o.districtPending,
    statePending: o.statePending,
    lt15: o.lt15,
    d15to30: o.d15to30,
    gt30: o.gt30,
    avgDays: o.total ? round1(o.daysSum / o.total) : null,
    maxDays: o.maxDays,
  });
  const out = finalize(agg, fin, 'Recognition Order (RC) pending applications — DPS (real EMIS export)');
  out.applications = applications;
  return out;
}

// =====================================================================
// 8) ALL CHILDREN IN SCHOOL (ACiS) — Common Pool
// =====================================================================
/**
 * Two EMIS exports describe the same population from different angles:
 *
 *   "Common Pool - To be Surveyed"      = the FULL common pool roster. Carries
 *                                         transfer_date (the TC date that moved
 *                                         the child out of universal data),
 *                                         Survey_Status and Admit_status.
 *   "Common Pool - Surveyed students"   = the surveyed subset, with the dropout
 *                                         reason tree, dropout_bucket (SMC
 *                                         validation vs re-admission), the
 *                                         survey (observe) date and umis_status.
 *
 * The roster is the UNION of both keyed on EMIS_ID — a child appearing in either
 * export is in the common pool. A child present only in the surveyed export is
 * counted as surveyed. The two files disagree slightly on the surveyed count
 * (260,438 flagged in the roster vs ~268k rows in the surveyed export); the
 * reconciliation is printed at ingest time so the gap stays visible.
 *
 * "Bridging duration" is approximated as observe_date - common_pool_date: the
 * days between the child entering the common pool and being reached by the
 * survey/re-admission drive. There is no admission-date column in the export.
 */

/** Reason category -> department that owns the follow-up action. */
const ACIS_REASON_DEPT = {
  'RELATED TO MIGRATION': 'School Education',
  'RELATED TO SCHOOL/ ACADEMICS': 'School Education',
  'RELATED TO HEALTH': 'Health & Family Welfare',
  'RELATED TO WELFARE OF THE DIFFERENTLY -ABLED PERSONS': 'Welfare of Differently Abled',
  'RELATED TO SOCIO - CULTURAL': 'BC/MBC & Minorities Welfare',
  'RELATED TO TRANSPORT': 'Transport',
  'RELATED TO CARE & PROTECTION': 'Social Welfare & Women Empowerment',
  'RELATED TO ENFORCEMENT - LABOUR': 'Labour Welfare & Skill Development',
  'RELATED TO ENFORCEMENT - POLICE': 'Home (Police)',
  'RELATED TO ENVIRONMENTAL CONDITIONS': 'Revenue & Disaster Management',
  'RELATED TO  REVENUE': 'Revenue',
  'OTHERS REASONS FOR BEING OUT OF SCHOOL': 'School Education',
};

/** Sub-reasons inside the catch-all category that belong to another department. */
const ACIS_SUBREASON_DEPT = [
  [/\b(ITI|Polytechnic|Industrial Schools|vocational)\b/i, 'Higher / Technical Education'],
  [/\b(nursing|DMLT|Medical Laboratory)\b/i, 'Higher / Technical Education'],
  [/Catering college/i, 'Higher / Technical Education'],
  [/Madrassa|Madapalli|religious schools/i, 'Minorities Welfare / HR & CE'],
  [/Expired/i, 'No action — child deceased'],
];

/** Department that owns the action for one surveyed child. */
function acisDepartment(reason, subReason) {
  const sub = (subReason ?? '').toString();
  for (const [re, dept] of ACIS_SUBREASON_DEPT) if (re.test(sub)) return dept;
  return ACIS_REASON_DEPT[(reason ?? '').toString().trim()] ?? 'Unmapped';
}

const ACIS_NO_DISABILITY = new Set(['', 'none', 'null', 'na', 'n/a', 'not applicable']);
/** CWSN = any recorded disability other than "None"/blank. */
function acisIsCwsn(v) {
  return !ACIS_NO_DISABILITY.has((v ?? '').toString().trim().toLowerCase());
}

/** Whole-day difference between two ISO dates, or null when either is missing. */
function acisDayGap(fromIso, toIso) {
  const a = (fromIso ?? '').toString().trim();
  const b = (toIso ?? '').toString().trim();
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

async function ingestAcis() {
  const DIR = join(RES, 'ACiS');
  const ROSTER = join(DIR, 'Common Pool - To be Surveyed 2026-27 ReportReport.csv');
  const SURVEYED = join(DIR, 'Common Pool - Surveyed students report for 2026-27Report.csv');

  // ---- interning tables so the 290k-row student asset stays small ----
  const schoolIdx = new Map();   // udise|name -> index
  const schools = [];            // [{ d, b, u, s, t, c }]
  const reasons = [];            // reason labels
  const reasonIdx = new Map();
  const subReasons = [];         // sub-reason labels
  const subIdx = new Map();
  const depts = [];
  const deptIdx = new Map();
  const intern = (list, map, label) => {
    const k = label || '—';
    if (!map.has(k)) { map.set(k, list.length); list.push(k); }
    return map.get(k);
  };
  const schoolRef = (row) => {
    const u = (row['udise_code'] ?? '').toString().trim();
    const name = (row['school_name'] ?? '').toString().trim();
    const k = `${u}|${name}`;
    if (!schoolIdx.has(k)) {
      schoolIdx.set(k, schools.length);
      schools.push({
        d: (row['district_name'] ?? '').toString().trim(),
        b: (row['block_name'] ?? '').toString().trim(),
        u,
        s: name,
        t: (row['school_type'] ?? '').toString().trim() || '—',
        m: (row['management'] ?? '').toString().trim() || '—',
        c: (row['School_Category'] ?? '').toString().trim() || '—',
      });
    }
    return schoolIdx.get(k);
  };

  // ---- pass 1: the roster (full common pool) ----
  /** EMIS_ID -> student record. */
  const roster = new Map();
  let rosterRows = 0, rosterDupes = 0;
  rosterRows = await streamCsv(ROSTER, (row) => {
    const emis = (row['EMIS_ID'] ?? '').toString().trim();
    const dist = (row['district_name'] ?? '').toString().trim();
    if (!emis || !dist) return;
    if (roster.has(emis)) { rosterDupes++; return; }
    roster.set(emis, {
      sch: schoolRef(row),
      e: emis,
      n: (row['Student_Name'] ?? '').toString().trim(),
      c: (row['class'] ?? '').toString().trim(),
      g: (row['Gender'] ?? '').toString().trim(),
      w: acisIsCwsn(row['Disability_Type']) ? 1 : 0,
      dis: (row['Disability_Type'] ?? '').toString().trim(),
      sv: /^surveyed$/i.test((row['Survey_Status'] ?? '').toString().trim()) ? 1 : 0,
      ad: /^admitted$/i.test((row['Admit_status'] ?? '').toString().trim()) ? 1 : 0,
      td: (row['transfer_date'] ?? '').toString().trim(),
      // filled by pass 2
      cp: '', od: '', r: -1, sr: -1, dp: -1, bk: '', um: 0, days: null,
    });
  });

  // ---- pass 2: the surveyed export (reason tree + buckets) ----
  let surveyedRows = 0, surveyedOnly = 0;
  surveyedRows = await streamCsv(SURVEYED, (row) => {
    const emis = (row['EMIS_ID'] ?? '').toString().trim();
    const dist = (row['district_name'] ?? '').toString().trim();
    if (!emis || !dist) return;
    let st = roster.get(emis);
    if (!st) {
      // in the surveyed export but missing from the roster — still in the pool
      surveyedOnly++;
      st = {
        sch: schoolRef(row),
        e: emis,
        n: (row['Student_Name'] ?? '').toString().trim(),
        c: (row['class'] ?? '').toString().trim(),
        g: (row['Gender'] ?? '').toString().trim(),
        w: acisIsCwsn(row['Disability_Type']) ? 1 : 0,
        dis: (row['Disability_Type'] ?? '').toString().trim(),
        sv: 1,
        ad: 0,
        td: (row['common_pool_date'] ?? '').toString().trim(),
        cp: '', od: '', r: -1, sr: -1, dp: -1, bk: '', um: 0, days: null,
      };
      roster.set(emis, st);
    }
    st.sv = 1;                                  // present here => surveyed
    if (/^admitted$/i.test((row['Admit_status'] ?? '').toString().trim())) st.ad = 1;
    const reason = (row['reason'] ?? '').toString().trim();
    const sub = (row['sub_reason'] ?? '').toString().trim();
    st.r = intern(reasons, reasonIdx, reason);
    st.sr = intern(subReasons, subIdx, sub);
    st.dp = intern(depts, deptIdx, acisDepartment(reason, sub));
    const bucket = (row['dropout_bucket'] ?? '').toString().trim();
    st.bk = /validat/i.test(bucket) ? 'V' : /admit/i.test(bucket) ? 'A' : '';
    st.um = /joined/i.test((row['umis_status'] ?? '').toString()) ? 1 : 0;
    st.cp = (row['common_pool_date'] ?? '').toString().trim();
    st.od = (row['observe_date'] ?? '').toString().trim();
    const gap = acisDayGap(st.cp, st.od);
    st.days = gap !== null && gap >= 0 ? gap : null;
  });

  // ---- aggregate to the three dashboard scopes ----
  const init = () => ({
    pool: 0, surveyed: 0, admitted: 0, bridged: 0, toBeAdmitted: 0, toBeValidated: 0,
    withReason: 0, deptTaken: 0, deptPending: 0, cwsn: 0, umis: 0,
    bridgeSum: 0, bridgeN: 0,
  });
  const agg = makeAgg(init);
  /** state-level breakdowns for the drill views */
  const byClass = new Map();      // class -> { pool, boys, girls, cwsn, bridgeSum, bridgeN }
  const byReason = new Map();     // reason -> { total, admitted, pending, subs: Map }
  const byDept = new Map();       // dept -> { total, taken, pending }
  const byMonth = new Map();      // YYYY-MM -> { entered, surveyed, admitted }
  const deadIdx = deptIdx.get('No action — child deceased') ?? -1;

  for (const st of roster.values()) {
    const sc = schools[st.sch];
    // department action is "taken" once the child is back in school or in a
    // tracked higher-education / closed state.
    const taken = st.ad === 1 || st.um === 1 || st.dp === deadIdx;
    bump(agg, sc.d, sc.b, sc.u, (o) => {
      o.pool++;
      if (st.sv) o.surveyed++;
      if (st.ad) o.admitted++;
      if (st.ad && st.days !== null) { o.bridged++; o.bridgeSum += st.days; o.bridgeN++; }
      if (st.bk === 'A') o.toBeAdmitted++;
      if (st.bk === 'V') o.toBeValidated++;
      if (st.r >= 0) o.withReason++;
      if (st.w) o.cwsn++;
      if (st.um) o.umis++;
      if (st.sv) { if (taken) o.deptTaken++; else o.deptPending++; }
    });

    const cls = st.c || '—';
    if (!byClass.has(cls)) byClass.set(cls, { pool: 0, boys: 0, girls: 0, cwsn: 0, admitted: 0, bridgeSum: 0, bridgeN: 0 });
    const ca = byClass.get(cls);
    ca.pool++;
    if (/^m/i.test(st.g)) ca.boys++; else if (/^f/i.test(st.g)) ca.girls++;
    if (st.w) ca.cwsn++;
    if (st.ad) ca.admitted++;
    if (st.ad && st.days !== null) { ca.bridgeSum += st.days; ca.bridgeN++; }

    if (st.r >= 0) {
      const rl = reasons[st.r];
      if (!byReason.has(rl)) byReason.set(rl, { total: 0, admitted: 0, pending: 0, subs: new Map() });
      const ra = byReason.get(rl);
      ra.total++;
      if (st.ad) ra.admitted++; else ra.pending++;
      const sl = st.sr >= 0 ? subReasons[st.sr] : '—';
      ra.subs.set(sl, (ra.subs.get(sl) ?? 0) + 1);
    }
    if (st.dp >= 0) {
      const dl = depts[st.dp];
      if (!byDept.has(dl)) byDept.set(dl, { total: 0, taken: 0, pending: 0 });
      const da = byDept.get(dl);
      da.total++;
      if (taken) da.taken++; else da.pending++;
    }
    const m = (st.td || st.cp || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) {
      if (!byMonth.has(m)) byMonth.set(m, { entered: 0, surveyed: 0, admitted: 0 });
      const ma = byMonth.get(m);
      ma.entered++;
      if (st.sv) ma.surveyed++;
      if (st.ad) ma.admitted++;
    }
  }

  const fin = (o) => ({
    pool: o.pool,
    surveyed: o.surveyed,
    pendingSurvey: o.pool - o.surveyed,
    surveyPct: o.pool ? round1((o.surveyed / o.pool) * 100) : null,
    admitted: o.admitted,
    bridged: o.bridged,
    bridgeDays: o.bridgeN ? round1(o.bridgeSum / o.bridgeN) : null,
    toBeAdmitted: o.toBeAdmitted,
    toBeValidated: o.toBeValidated,
    withReason: o.withReason,
    deptTaken: o.deptTaken,
    deptPending: o.deptPending,
    cwsn: o.cwsn,
    umis: o.umis,
  });
  const out = finalize(agg, fin, 'All Children in School — Common Pool (real EMIS export, AY 2026-27)');

  out.classWise = [...byClass.entries()]
    .sort((a, b) => (parseInt(a[0], 10) || 99) - (parseInt(b[0], 10) || 99))
    .map(([cls, o]) => ({
      cls,
      pool: o.pool, boys: o.boys, girls: o.girls, cwsn: o.cwsn, admitted: o.admitted,
      bridgeDays: o.bridgeN ? round1(o.bridgeSum / o.bridgeN) : null,
    }));
  out.reasonWise = [...byReason.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([reason, o]) => ({
      reason, total: o.total, admitted: o.admitted, pending: o.pending,
      subs: [...o.subs.entries()].sort((a, b) => b[1] - a[1]).map(([sub, count]) => ({ sub, count })),
    }));
  out.deptWise = [...byDept.entries()]
    .sort((a, b) => b[1].pending - a[1].pending)
    .map(([dept, o]) => ({ dept, total: o.total, taken: o.taken, pending: o.pending }));
  out.monthWise = [...byMonth.entries()].sort()
    .map(([month, o]) => ({ month, entered: o.entered, surveyed: o.surveyed, admitted: o.admitted }));

  // ---- the student asset (separate file, lazily loaded by the drill) ----
  const students = [];
  for (const st of roster.values()) {
    students.push([
      st.sch, st.c, /^m/i.test(st.g) ? 1 : /^f/i.test(st.g) ? 2 : 0, st.w,
      st.sv, st.ad, st.bk === 'V' ? 1 : st.bk === 'A' ? 2 : 0,
      st.r, st.sr, st.dp, st.um, st.days === null ? -1 : st.days,
      st.e, st.n, st.td, st.od, st.dis,
    ]);
  }
  const studentAsset = {
    note: 'ACiS common-pool students (positional rows; see fields[])',
    generatedAt: new Date().toISOString(),
    fields: ['sch', 'cls', 'gender', 'cwsn', 'surveyed', 'admitted', 'bucket',
      'reason', 'subReason', 'dept', 'umis', 'days', 'emis', 'name',
      'transferDate', 'surveyDate', 'disability'],
    schools, reasons, subReasons, depts,
    students,
  };

  console.log(`[acis] roster rows ${rosterRows.toLocaleString('en-IN')} (dupes ${rosterDupes}), ` +
    `surveyed rows ${surveyedRows.toLocaleString('en-IN')} (not in roster ${surveyedOnly.toLocaleString('en-IN')})`);
  const s = out.districts;
  const tot = Object.values(s).reduce((t, d) => ({
    pool: t.pool + d.pool, surveyed: t.surveyed + d.surveyed, admitted: t.admitted + d.admitted,
    bridged: t.bridged + d.bridged, tba: t.tba + d.toBeAdmitted, tbv: t.tbv + d.toBeValidated,
    cwsn: t.cwsn + d.cwsn, umis: t.umis + d.umis,
  }), { pool: 0, surveyed: 0, admitted: 0, bridged: 0, tba: 0, tbv: 0, cwsn: 0, umis: 0 });
  console.log(`[acis] pool ${tot.pool.toLocaleString('en-IN')} | surveyed ${tot.surveyed.toLocaleString('en-IN')} | ` +
    `pending ${(tot.pool - tot.surveyed).toLocaleString('en-IN')} | admitted ${tot.admitted.toLocaleString('en-IN')} | ` +
    `bridged ${tot.bridged.toLocaleString('en-IN')} | to-be-admitted ${tot.tba.toLocaleString('en-IN')} | ` +
    `to-be-validated ${tot.tbv.toLocaleString('en-IN')} | CWSN ${tot.cwsn.toLocaleString('en-IN')} | ` +
    `UMIS ${tot.umis.toLocaleString('en-IN')}`);
  console.log(`[acis] schools ${schools.length.toLocaleString('en-IN')}, reasons ${reasons.length}, ` +
    `sub-reasons ${subReasons.length}, departments ${depts.length}`);

  writeGz('acis-students.json', studentAsset);
  return out;
}

// =====================================================================
// 9) ACiS — POTENTIAL DROPOUTS (real EMIS report)
// =====================================================================
/**
 * `Enrollment\Potential Dropout StudentsReport.csv` — one row per student who
 * was absent 15+ days in the report window (from_date..to_date, the last 30
 * days). Carries school type / management / category, gender, class, the
 * dropout reason (`department` = reason category, `dropout_reason` = detail),
 * `absent_days`, and `Red_Flag_Status` (Repeater = appeared in the last two
 * PD reports, as tagged by EMIS; "Not updated" = no follow-up recorded).
 *
 * The export is a SINGLE report window, so duration-on-list, monthly trend
 * and "regularised" cannot be derived from it and are deliberately not built.
 * A reason of "0" means the school has not recorded a reason yet.
 */
async function ingestPd() {
  const path = join(RES, 'Enrollment', 'Potential Dropout StudentsReport.csv');

  const schoolIdx = new Map();
  const schools = [];               // [{ d, b, u, s, t, m, c }]
  const reasons = [];               // dropout_reason labels
  const reasonIdx = new Map();
  const cats = [];                  // department (reason category) labels
  const catIdx = new Map();
  const intern = (list, map, label) => {
    const k = label || '—';
    if (!map.has(k)) { map.set(k, list.length); list.push(k); }
    return map.get(k);
  };
  /** "0" / blank = reason not yet recorded by the school. */
  const clean = (v) => {
    const s = (v ?? '').toString().trim();
    return !s || s === '0' ? 'Not updated' : s;
  };

  const init = () => ({ pd: 0, repeaters: 0, notRepeater: 0, notUpdated: 0, boys: 0, girls: 0, withReason: 0, absentSum: 0 });
  const agg = makeAgg(init);
  const students = [];
  let from = '', to = '';
  const seen = new Set();
  let dupes = 0;

  const rows = await streamCsv(path, (r) => {
    const dist = (r['District_Name'] ?? '').toString().trim();
    const emis = (r['EMIS_ID'] ?? '').toString().trim();
    if (!dist || !emis) return;
    if (seen.has(emis)) { dupes++; return; }
    seen.add(emis);
    from = from || (r['from_date'] ?? '').toString().trim();
    to = to || (r['to_date'] ?? '').toString().trim();

    const u = (r['UDISE_Code'] ?? '').toString().trim();
    const block = (r['Block_Name'] ?? '').toString().trim();
    const sk = `${u}|${r['School_Name'] ?? ''}`;
    if (!schoolIdx.has(sk)) {
      schoolIdx.set(sk, schools.length);
      schools.push({
        d: dist, b: block, u,
        s: (r['School_Name'] ?? '').toString().trim(),
        t: (r['School_Type'] ?? '').toString().trim() || '—',
        m: (r['Management'] ?? '').toString().trim() || '—',
        c: (r['Category'] ?? '').toString().trim() || '—',
      });
    }
    const flag = (r['Red_Flag_Status'] ?? '').toString().trim().toLowerCase();
    // 1 = Repeater, 0 = Not Repeater, -1 = Not updated
    const rep = flag === 'repeater' ? 1 : flag === 'not repeater' ? 0 : -1;
    const g = (r['Gender'] ?? '').toString().trim();
    const gender = /^m/i.test(g) ? 1 : /^f/i.test(g) ? 2 : 0;
    const cat = clean(r['department']);
    const reason = clean(r['dropout_reason']);
    const absent = num(r['absent_days']);

    bump(agg, dist, block, u, (o) => {
      o.pd++;
      if (rep === 1) o.repeaters++; else if (rep === 0) o.notRepeater++; else o.notUpdated++;
      if (gender === 1) o.boys++; else if (gender === 2) o.girls++;
      if (reason !== 'Not updated') o.withReason++;
      o.absentSum += absent;
    });

    students.push([
      schoolIdx.get(sk),
      (r['class'] ?? '').toString().trim(),
      gender,
      rep,
      intern(cats, catIdx, cat),
      intern(reasons, reasonIdx, reason),
      absent,
      emis,
      (r['Student_Name'] ?? '').toString().trim(),
      (r['section'] ?? '').toString().trim(),
    ]);
  });

  const fin = (o) => ({
    pd: o.pd,
    repeaters: o.repeaters,
    notRepeater: o.notRepeater,
    notUpdated: o.notUpdated,
    boys: o.boys,
    girls: o.girls,
    withReason: o.withReason,
    avgAbsent: o.pd ? round1(o.absentSum / o.pd) : null,
  });
  const out = finalize(agg, fin, 'Potential dropouts — absent 15+ days in the last 30 (real EMIS report)');
  out.reportFrom = from;
  out.reportTo = to;
  out.fields = ['school', 'cls', 'gender', 'repeater', 'category', 'reason', 'absentDays', 'emis', 'name', 'section'];
  out.schoolRefs = schools;
  out.categories = cats;
  out.reasons = reasons;
  out.students = students;

  const tot = Object.values(out.districts).reduce((t, d) => ({
    pd: t.pd + d.pd, rep: t.rep + d.repeaters, nr: t.nr + d.notRepeater, nu: t.nu + d.notUpdated,
  }), { pd: 0, rep: 0, nr: 0, nu: 0 });
  console.log(`[pd] rows ${rows.toLocaleString('en-IN')} (dupes ${dupes}) | window ${from} → ${to}`);
  console.log(`[pd] PD ${tot.pd.toLocaleString('en-IN')} | repeaters ${tot.rep.toLocaleString('en-IN')} | ` +
    `not repeater ${tot.nr.toLocaleString('en-IN')} | not updated ${tot.nu.toLocaleString('en-IN')} | ` +
    `${cats.length} categories, ${reasons.length} reasons, ${schools.length.toLocaleString('en-IN')} schools`);
  return out;
}

// ---------- shared finalize/write ----------
function round1(n) { return Math.round(n * 10) / 10; }
function finalize(agg, fin, note) {
  const districts = {};
  for (const [k, v] of agg.districts) districts[k] = fin(v);
  const blocks = {};
  for (const [k, v] of agg.blocks) blocks[k] = fin(v);
  const schools = {};
  for (const [k, v] of agg.schools) schools[k] = fin(v);
  return { note, generatedAt: new Date().toISOString(), districts, blocks, schools };
}
function write(name, data) {
  const p = join(OUT_DIR, name);
  writeFileSync(p, JSON.stringify(data));
  const dc = Object.keys(data.districts).length;
  const bc = Object.keys(data.blocks).length;
  const sc = Object.keys(data.schools).length;
  console.log(`wrote ${name}: ${dc} districts, ${bc} blocks, ${sc} schools`);
}

/**
 * Write a large asset as plain JSON plus a gzip sibling. `loadAsset()` asks for
 * `<name>.gz` first, so the browser only ever downloads the compressed copy.
 */
function writeGz(name, data) {
  const p = join(OUT_DIR, name);
  const json = JSON.stringify(data);
  writeFileSync(p, json, 'utf8');
  const gz = gzipSync(Buffer.from(json), { level: 9 });
  writeFileSync(`${p}.gz`, gz);
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  const scopes = data.districts
    ? `, ${Object.keys(data.districts).length} districts, ${Object.keys(data.blocks).length} blocks, ` +
      `${Object.keys(data.schools).length} schools`
    : '';
  console.log(`wrote ${name}: ${mb(json.length)} (+ .gz ${mb(gz.length)})${scopes}`);
}

// ---------- run ----------
const only = process.argv[2]; // optional: academic|thiran|palli|digital|infra|smc|dps|acis
(async () => {
  if (!only || only === 'academic') write('academic-real.json', ingestAcademic());
  if (!only || only === 'digital') write('digital-infra-real.json', ingestDigitalInfra());
  if (!only || only === 'thiran') write('thiran-real.json', await ingestThiran());
  if (!only || only === 'palli') write('palli-real.json', await ingestPalli());
  if (!only || only === 'palli' || only === 'palli-obs') writeGz('palli-obs.json', await ingestPalliObs());
  if (!only || only === 'infra') write('infra-real.json', await ingestInfra());
  // SMC now carries five rolling windows per scope, so it is worth gzipping.
  if (!only || only === 'smc') writeGz('smc-real.json', await ingestSmc());
  if (!only || only === 'dps') write('dps-real.json', await ingestDps());
  // ACiS covers every school in the state, so even the aggregate asset is large
  // enough to be worth gzipping.
  if (!only || only === 'acis') writeGz('acis-real.json', await ingestAcis());
  if (!only || only === 'acis' || only === 'pd') writeGz('acis-pd.json', await ingestPd());
  console.log('done');
})();
