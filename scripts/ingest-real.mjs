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
import { inflateRawSync } from 'node:zlib';

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
async function ingestSmc() {
  const path = join(RES, 'SMC', 'SMC - All Resolutions ReportReport.csv');
  const init = () => ({ raised: 0, closed: 0, emergency: 0, emergencyOpen: 0 });
  const agg = makeAgg(init);

  await streamCsv(path, (row) => {
    const dist = row['District'], block = row['Block'], ud = row['udise_code'];
    if (!dist) return;
    const status = (row['Final status'] ?? '').toString().trim().toLowerCase();
    const emergency = (row['is_emergency'] ?? '').toString().trim().toUpperCase() === 'YES';
    // "closed" = Resolved or withdrawn; still-open = Unresolved / work in progress
    const isClosed = status === 'resolved' || status === 'withdrawn';
    bump(agg, dist, block, ud, (o) => {
      o.raised++;
      if (isClosed) o.closed++;
      if (emergency) { o.emergency++; if (!isClosed) o.emergencyOpen++; }
    });
  });

  const fin = (o) => ({
    raised: o.raised,
    closed: o.closed,
    pending: Math.max(0, o.raised - o.closed),
    closureRate: o.raised ? round1((o.closed / o.raised) * 100) : null,
    emergency: o.emergency,
    emergencyOpen: o.emergencyOpen,
  });
  return finalize(agg, fin, 'SMC resolutions incl. emergency-not-closed (real EMIS export)');
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

// ---------- run ----------
const only = process.argv[2]; // optional: academic|thiran|palli|digital
(async () => {
  if (!only || only === 'academic') write('academic-real.json', ingestAcademic());
  if (!only || only === 'digital') write('digital-infra-real.json', ingestDigitalInfra());
  if (!only || only === 'thiran') write('thiran-real.json', await ingestThiran());
  if (!only || only === 'palli') write('palli-real.json', await ingestPalli());
  if (!only || only === 'infra') write('infra-real.json', await ingestInfra());
  if (!only || only === 'smc') write('smc-real.json', await ingestSmc());
  console.log('done');
})();
