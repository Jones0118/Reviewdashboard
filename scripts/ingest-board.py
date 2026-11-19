# -*- coding: utf-8 -*-
"""
Board Exam ingest  ->  src/assets/board-exam.json

Sources (D:\\general\\Dashboard\\Resources\\Board Exam):
  10th_STATE_REPORT_GOVT.pdf, 12th_STATE_REPORT_GOVT.pdf
      Image-only PDFs (no text layer). The 38-district table was transcribed
      by hand from the rendered page into STATE_ROWS below. Govt schools only.
  ARIYALUR_{10th,12th}_DISTRICT_REPORT_{GOVT,AIDED}.pdf
      Page 1: results summary (by management), subject pass % / average marks
              (by management), subject category counts, school category counts
              (parsed from text; the stacked-bar counts are read from the
              chart labels in reading order).
      Page 2+: school annexure table (parsed with PyMuPDF find_tables()).

Run:  python scripts/ingest-board.py
"""
import io, json, os, re, sys
import pymupdf

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
SRC = r"D:\general\Dashboard\Resources\Board Exam"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "board-exam.json")
YEAR = "2025-26"
PREV = "2024-25"

# ---------------------------------------------------------------------------
# State report tables (transcribed from the image-only PDFs, Govt schools).
# (sno, district, schools, appeared, pass, passDelta, avg, avgDelta, rank)
# ---------------------------------------------------------------------------
STATE_ROWS = {
  10: {
    "total": {"schools": 6269, "appeared": 407044, "pass": 91.9, "passDelta": 0.6, "avg": 64.4, "avgDelta": -0.5},
    "rows": [
      (1,"SIVAGANGAI",138,7870,97.4,-0.1,69.5,-1.1,9),(2,"PUDUKOTTAI",222,15192,97.1,5.2,67.9,2.3,2),
      (3,"THANJAVUR",230,12800,96.9,2.8,66.5,0.7,5),(4,"RAMANATHAPURAM",138,7026,96.8,5.1,69.1,2.4,1),
      (5,"TRICHY",224,13167,96.5,1.1,68.2,1.8,3),(6,"TUTICORIN",89,5443,95.8,0.4,67.7,-0.5,12),
      (7,"KANYAKUMARI",136,6139,95.7,0.3,69.6,0.3,7),(8,"ERODE",189,12541,95.4,1.3,66.4,-0.4,15),
      (9,"TIRUNELVELI",92,6746,94.9,2.2,67.4,0.4,8),(11,"COIMBATORE",197,13819,94.6,0.7,65.8,-0.1,18),
      (10,"THENI",106,5603,94.6,6.3,64.8,2.3,6),(13,"DINDIGUL",171,10111,94.4,3.3,63.6,0.0,17),
      (12,"NAMAKKAL",162,10202,94.4,2.1,65.2,0.1,16),(14,"TENKASI",80,6875,94.2,1.3,66.4,1.0,11),
      (15,"TIRUPPUR",163,14729,94.1,2.6,66.1,0.9,10),(16,"OOTY",95,2437,93.7,4.4,61.3,0.9,19),
      (17,"VIRUDHU NAGAR",191,9147,93.7,-1.9,66.4,-0.7,22),(18,"CUDDALORE",247,15910,93.2,-0.6,64.6,-2.4,26),
      (19,"KANCHEEPURAM",100,8290,93.1,-0.3,66.2,-0.1,21),(20,"SALEM",296,23515,92.8,3.1,65.5,1.1,14),
      (21,"MADURAI",215,13148,92.6,1.5,64.6,0.3,20),(22,"NAGAPATTINAM",95,5070,92.5,2.3,66.4,1.0,13),
      (23,"TIRUPPATHUR (V)",115,7820,92.4,0.4,64.3,-0.2,25),(24,"DHARMAPURI",226,13797,92.3,-2.8,64.7,-1.5,27),
      (25,"PERAMBALUR",92,4335,92.2,-2.2,64.1,-1.3,29),(26,"KALLACURICHY",148,13547,92.0,8.9,64.5,4.8,4),
      (27,"TIRUVARUR",143,7515,90.9,-1.9,62.7,-2.7,31),(28,"TIRUVALLORE",226,15795,89.5,4.7,62.4,2.1,23),
      (30,"TIRUVANNAMALAI",348,21087,89.5,-2.6,62.9,-2.3,32),(29,"VELLORE",135,10342,89.5,7.4,61.3,2.3,24),
      (31,"KARUR",115,6091,89.0,-5.5,63.6,0.2,30),(32,"CHENGALPATTU",150,13027,87.3,3.3,61.7,1.7,28),
      (33,"CHENNAI",163,16115,86.4,3.3,60.3,-0.1,33),(34,"KRISHNAGIRI",273,16529,86.0,-7.1,60.8,-6.0,34),
      (35,"VILLUPURAM",242,15892,85.3,-8.9,61.0,-8.1,37),(37,"MAYILADUTHURAI",78,4600,84.0,-5.4,58.6,-2.6,36),
      (36,"RANIPETTAI",120,8935,84.0,-5.6,59.7,-3.6,35),(38,"ARIYALUR",119,5837,82.4,-13.0,60.6,-10.7,38),
    ],
  },
  12: {
    "total": {"schools": 3178, "appeared": 350353, "pass": 92.2, "passDelta": 0.21, "avg": 61.8, "avgDelta": -0.88},
    "rows": [
      (1,"ERODE",113,11322,98.2,1.4,66.3,0.0,2),(2,"SIVAGANGAI",70,6143,97.0,2.9,65.5,1.0,1),
      (3,"TRICHY",106,10819,96.6,4.1,62.7,0.7,4),(4,"TENKASI",54,7008,96.2,4.7,64.3,1.5,3),
      (5,"KANYAKUMARI",60,6212,96.1,1.1,66.1,-0.7,8),(6,"TIRUNELVELI",50,5828,96.0,3.5,64.1,0.2,5),
      (7,"THANJAVUR",106,10187,95.8,2.1,63.5,0.7,11),(8,"RAMANATHAPURAM",71,5260,95.5,3.4,63.0,0.8,9),
      (9,"TUTICORIN",57,4703,95.4,1.5,65.1,0.0,10),(10,"NAMAKKAL",95,9526,95.4,2.6,62.7,-0.1,14),
      (11,"SALEM",160,20218,95.3,3.0,62.8,0.1,12),(12,"TIRUPPUR",77,12119,94.9,-0.8,63.2,-1.0,18),
      (13,"PUDUKOTTAI",110,12799,94.5,4.1,62.8,1.7,7),(14,"VIRUDHU NAGAR",101,7064,94.4,1.3,62.9,-0.5,16),
      (15,"KARUR",59,5117,94.1,4.6,61.4,1.5,13),(16,"NAGAPATTINAM",44,4191,93.5,-1.4,63.3,-1.9,21),
      (17,"MADURAI",112,10650,93.4,1.5,62.6,-1.1,17),(18,"KANCHEEPURAM",52,7661,93.4,3.7,63.5,2.1,6),
      (19,"CUDDALORE",117,13570,93.2,-1.8,63.1,-2.8,24),(20,"DINDIGUL",90,8484,93.2,1.9,61.5,-0.7,20),
      (21,"COIMBATORE",114,11182,93.1,-1.5,62.6,-1.4,23),(22,"KALLACURICHY",77,11510,92.5,4.2,60.9,1.2,15),
      (23,"THENI",71,4970,92.0,0.7,61.6,-0.8,25),(24,"TIRUPPATHUR (V)",60,6113,91.4,-0.2,60.8,0.0,27),
      (25,"TIRUVANNAMALAI",151,18221,91.0,-0.9,61.8,-0.8,26),(26,"DHARMAPURI",108,12352,91.0,-2.3,61.1,-1.8,28),
      (27,"CHENNAI",89,14530,90.8,2.7,60.7,-0.2,22),(28,"PERAMBALUR",43,3813,90.7,-3.3,61.3,-2.9,29),
      (29,"TIRUVALLORE",102,13717,90.6,4.4,60.1,1.1,19),(30,"OOTY",38,2247,90.3,0.5,58.4,-1.0,30),
      (31,"MAYILADUTHURAI",37,3931,88.5,1.4,58.3,-1.4,32),(32,"KRISHNAGIRI",108,14025,87.9,-4.7,59.3,-2.3,34),
      (33,"CHENGALPATTU",82,12326,87.8,-1.2,59.1,0.0,31),(34,"ARIYALUR",56,4846,87.6,-10.7,61.5,-12.3,37),
      (35,"VELLORE",72,8772,87.1,-0.3,58.6,0.0,33),(36,"TIRUVARUR",78,5887,85.7,-5.0,57.5,-3.2,36),
      (37,"RANIPETTAI",67,7996,84.3,-6.3,58.9,-2.7,35),(38,"VILLUPURAM",121,15034,82.1,-11.6,57.7,-8.9,38),
    ],
  },
}
# Performance trend (section B) 2022-2026, read from the district reports' line charts
TREND = {
  10: {"years": [2022, 2023, 2024, 2025, 2026],
       "pass": {"district": [87.0, 91.2, 96.2, 95.4, 82.4], "state": [85.0, 84.2, 88.1, 91.3, 91.9], "best": [95.8, 94.2, 97.5, 97.5, 97.4],
                "bestNames": ["Perambalur", "Sivagangai", "Ariyalur", "Sivagangai", "Sivagangai"]},
       "avg":  {"district": [51.0, 62.0, 69.7, 71.4, 60.6], "state": [50.8, 58.0, 62.7, 64.9, 64.4], "best": [58.2, 64.4, 69.7, 71.4, 69.6],
                "bestNames": ["Kanyakumari", "Perambalur", "Ariyalur", "Ariyalur", "Kanyakumari"]}},
  12: {"years": [2022, 2023, 2024, 2025, 2026],
       "pass": {"district": [94.0, 95.6, 95.6, 98.3, 87.6], "state": [89.0, 91.2, 91.1, 92.0, 92.2], "best": [96.4, 97.2, 95.6, 98.3, 98.2],
                "bestNames": ["Tiruppur", "Perambalur", "Tiruppur", "Ariyalur", "Erode"]},
       "avg":  {"district": [59.1, 61.2, 66.0, 73.7, 61.5], "state": [56.2, 59.3, 60.8, 62.7, 61.8], "best": [61.2, 64.3, 66.0, 73.7, 66.3],
                "bestNames": ["Perambalur", "Tuticorin", "Ariyalur", "Ariyalur", "Erode"]}},
}
MGMTS = ["Govt SED", "Other Govt Depts", "Aided", "Private", "All Managements"]
SUBJECTS = {10: ["Language", "English", "Maths", "Science", "Social"],
            12: ["Language", "English", "Maths", "Physics", "Chemistry", "Biology", "Botany", "Zoology", "Commerce",
                 "Accountancy", "Economics", "Computer Application", "Computer Science", "Arts", "Vocational"]}
CATS = ["Good", "Satisfactory", "Needs Improvement", "Poor"]

NUM = re.compile(r"^-?\d[\d,]*(?:\.\d+)?$")
VAL = re.compile(r"^(-?[\d.]+)\s*(?:\(\s*([+\u2212\u2013-]?\s*[\d.]+|-)\s*[\u2191\u2193\u2b06\u2b07]?\s*\))?$")

def num(s):
    return float(s.replace(",", ""))

def val(s):
    """'82.4 (−12.9 ↓)' -> (82.4, -12.9); '100 (-)' -> (100, None); '' -> (None, None)."""
    s = (s or "").strip().replace("\n", " ")
    if not s:
        return None, None
    m = VAL.match(s)
    if not m:
        return None, None
    v = float(m.group(1))
    d = m.group(2)
    if d is None or d == "-":
        return v, None
    d = d.replace("\u2212", "-").replace("\u2013", "-").replace("+", "").replace(" ", "")
    return v, float(d)

def page_lines(page):
    return [l.strip() for l in page.get_text("text").split("\n") if l.strip()]

def take_after(lines, label, n):
    i = lines.index(label)
    return lines[i + 1:i + 1 + n]

def parse_summary(lines, cls):
    """Section A + D from page 1 text (positional)."""
    def row(label):
        return take_after(lines, label, 5)
    def cell_rows(label):
        # 'Number of Students Appeared ' may carry a trailing space in the PDF
        key = next(l for l in lines if l.startswith(label))
        return take_after(lines, key, 5)
    schools = [int(num(x)) for x in cell_rows("Number of Schools")]
    appeared = [int(num(x)) for x in cell_rows("Number of Students Appeared")]
    appearedPct = [int(x.rstrip("%")) for x in cell_rows("Students Appeared %")]
    dpass = [val(x) for x in row("District Pass %")]
    davg = [val(x) for x in row("District Average Mark")]
    spass = [val(x) for x in row("State Pass %")]
    savg = [val(x) for x in row("State Average Mark")]
    si = next(i for i, l in enumerate(lines) if l.startswith("District's Student Count for Supplementary"))
    # the label wraps over two lines
    j = si + 1
    while not NUM.match(lines[j]):
        j += 1
    suppl = [int(num(x)) for x in lines[j:j + 5]]
    byMgmt = []
    for i, m in enumerate(MGMTS):
        byMgmt.append({"mgmt": m, "schools": schools[i], "appeared": appeared[i], "appearedPct": appearedPct[i],
                       "pass": dpass[i][0], "passDelta": dpass[i][1], "avg": davg[i][0], "avgDelta": davg[i][1],
                       "statePass": spass[i][0], "statePassDelta": spass[i][1], "stateAvg": savg[i][0], "stateAvgDelta": savg[i][1],
                       "supplementary": suppl[i]})
    # ---- section D: subject pass % and average marks by management ----
    # Values sit between consecutive management labels. The text layer drops
    # EMPTY cells, so a management row with fewer tokens than columns cannot
    # be mapped positionally and is marked unreliable (12th: Other Govt Depts,
    # Private leave some subjects blank).
    subs = SUBJECTS[cls]
    ncol = len(subs) + 1
    STOP = {"Subject Average Marks", "Subject-wise Performance", "D. 12th Subject-wise Details", "D. 10th Subject-wise Details",
            "B. Performance Trend (District vs State vs Best District)", "C. 10th District Performance (All Govt Schools)",
            "C. 12th District Performance (All Govt Schools)"}
    def block(title):
        i = next(k for k, l in enumerate(lines) if l.strip() == title)
        out = {}
        j = i + 1
        while j < len(lines) and lines[j] != "Govt SED":
            j += 1
        for mi, m in enumerate(MGMTS[:4]):
            assert lines[j] == m, (title, m, lines[j - 2:j + 2])
            k = j + 1
            vals = []
            while k < len(lines) and lines[k] not in MGMTS and lines[k] not in STOP:
                vals.append(lines[k]); k += 1
            parsed = [val(x) for x in vals]
            out[m] = {"cells": parsed if len(vals) == ncol else [], "complete": len(vals) == ncol}
            j = k
        return out
    sp = block("Subject Pass %")
    sa = block("Subject Average Marks")
    subject = []
    for k, s in enumerate(subs + ["All Subjects"]):
        rowv = {"subject": s}
        for m in MGMTS[:4]:
            p = sp[m]["cells"][k] if sp[m]["complete"] else (None, None)
            a = sa[m]["cells"][k] if sa[m]["complete"] else (None, None)
            rowv[m] = {"pass": p[0], "passDelta": p[1], "avg": a[0], "avgDelta": a[1],
                       "reliable": sp[m]["complete"] and sa[m]["complete"]}
        subject.append(rowv)
    return byMgmt, subject

def parse_school_table(doc, cls, start_page=1):
    """Annexure: find_tables() on pages 2.., 10th = 27 cols; 12th = 2 pages (24 + 24 cols)."""
    subs = SUBJECTS[cls]
    tables = []
    for pi in range(start_page, len(doc)):
        for t in doc[pi].find_tables().tables:
            rows = t.extract()
            if len(rows) > 2:
                tables.append(rows)
    if not tables:
        return []
    def clean(c):
        return (c or "").replace("\n", " ").strip()
    def hdr_key(h):
        return re.sub(r"[^A-Z]", "", clean(h).upper())
    schools = []
    def is_row_table(rows):
        return any(re.match(r"^\d{11}$", clean(r[1]) if len(r) > 1 else "") for r in rows[1:4])
    row_tables = [r for r in tables if is_row_table(r)]
    cont_tables = [r for r in tables if not is_row_table(r)]
    for first in row_tables:
      hdr = [hdr_key(h) for h in first[0]]
      # locate subject column triplets by header text
      def subject_cols(hdr_keys):
          cols = {}
          for i, h in enumerate(hdr_keys):
              for s in subs:
                  k = re.sub(r"[^A-Z]", "", s.upper())
                  if h in (k + "AVERAGEMARK", k + "SAVERAGEMARK"):   # "COMPUTER APPLICATIONS" in the annexure header
                      cols[s] = i
          return cols
      cols1 = subject_cols(hdr)
      for r in first[1:]:
          r = [clean(c) for c in r]
          if len(r) < 12 or not re.match(r"^\d{11}$", r[1] or ""):
              continue
          p, pd = val(r[8]); a, ad = val(r[9])
          rec = {"block": r[0], "udise": r[1], "name": r[2], "mgmt": r[3],
                 "appeared": int(num(r[4])) if r[4] else None, "supplementary": int(num(r[5])) if r[5] else None,
                 "prevPerf": re.sub(r"^\d\.", "", r[6]), "perf": re.sub(r"^\d\.", "", r[7]),
                 "pass": p, "passDelta": pd, "avg": a, "avgDelta": ad,
                 "rankState": r[10], "rankDistrict": r[11], "subjects": {}}
          for s, i in cols1.items():
              sv, sd = val(r[i])
              if sv is not None:
                  rec["subjects"][s] = {"avg": sv, "avgDelta": sd, "rankState": r[i + 1], "rankDistrict": r[i + 2]}
          schools.append(rec)
    # continuation pages (12th): keyed by school name
    byname = {s["name"]: s for s in schools}
    for rows in cont_tables:
        h = [hdr_key(x) for x in rows[0]]
        cols = subject_cols(h)
        if not cols:
            continue
        for r in rows[1:]:
            r = [clean(c) for c in r]
            rec = byname.get(r[0])
            if not rec:
                continue
            for s, i in cols.items():
                sv, sd = val(r[i])
                if sv is not None:
                    rec["subjects"][s] = {"avg": sv, "avgDelta": sd, "rankState": r[i + 1], "rankDistrict": r[i + 2]}
    return schools

def category_counts(doc, cls):
    """Subject × category and school × category counts, derived from the annexure rather than the chart labels
    (the bar labels are not in the text layer in reading order). Subject category = avg band; school category = perf."""
    return None  # computed in build() from the school rows

def band(avg):
    if avg is None: return None
    if avg > 70: return "Good"
    if avg > 60: return "Satisfactory"
    if avg > 50: return "Needs Improvement"
    return "Poor"


# ---------------------------------------------------------------------------
# School reports: one .xlsx per school, named by UDISE ("33320100206.xlsx",
# "33320100206 (1).xlsx"). Sheet "10th School Report" / "12th School Report":
# A. results summary + B. subject performance for two academic years, with
# school / district / state pass % and average mark, ranks and rating.
# ---------------------------------------------------------------------------
import zipfile
def load_xlsx(path):
    """openpyxl chokes on these files' dangling drawing relationships; strip them first."""
    import openpyxl
    z = zipfile.ZipFile(path); buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as o:
        for n in z.namelist():
            d = z.read(n)
            if n.endswith(".rels") and "xl/worksheets/_rels" in n:
                d = re.sub(rb"<Relationship[^>]*drawing[^>]*/>", b"", d)
            o.writestr(n, d)
    buf.seek(0)
    return openpyxl.load_workbook(buf, data_only=True)

def parse_school_report(path):
    wb = load_xlsx(path)
    ws = wb.worksheets[0]
    cls = 10 if "10th" in ws.title else 12
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    S = lambda v: "" if v is None else str(v).strip()
    def find_cell(prefix):
        for r in rows:
            for v in r:
                if S(v).upper().startswith(prefix): return S(v)
        return ""
    def after(label):
        s = find_cell(label); return s.split(":", 1)[1].strip() if ":" in s else ""
    name, district, block, udise = after("SCHOOL:"), after("DISTRICT:"), after("BLOCK:"), after("SCHOOL UDISE CODE:")
    if not udise:
        udise = re.sub(r"\D", "", os.path.basename(path))[:11]
    # header rows
    hi = next(i for i, r in enumerate(rows) if any(S(v) == "OVERALL PERFORMANCE" for v in r))
    yi = next(i for i, r in enumerate(rows) if any(S(v) == "ACADEMIC YEAR" for v in r))
    groups = [(S(v), ci) for ci, v in enumerate(rows[hi]) if S(v)]
    years = [S(v) for v in rows[yi] if re.match(r"^\d{4}-\d{2}$", S(v))][:2]
    LABELS = {"TOTAL STUDENTS APPEARED": "appeared", "SCHOOL PASS %": "pass", "DISTRICT PASS %": "distPass", "STATE PASS %": "statePass",
              "SCHOOL AVERAGE MARK": "avg", "DISTRICT AVERAGE MARK": "distAvg", "STATE AVERAGE MARK": "stateAvg",
              "RANK IN DISTRICT": "rankDistrict", "RANK IN STATE": "rankState"}
    def cellnum(v):
        s = S(v).replace(",", "")
        try: return float(s) if s else None
        except ValueError: return None
    def two(r, ci, as_num=True):
        a, b = (r[ci] if ci < len(r) else None), (r[ci + 1] if ci + 1 < len(r) else None)
        return [cellnum(a), cellnum(b)] if as_num else [S(a).replace(" ", "") or None, S(b).replace(" ", "") or None]
    blocks = {}
    for gname, ci in groups:
        g = {}
        for r in rows[yi + 1:]:
            labs = [S(v).upper() for v in r[:4] if S(v)]
            lab = labs[-1] if labs else ""   # sub-label (col D), not the group heading in col C
            key = LABELS.get(lab)
            if key:
                g[key] = two(r, ci, as_num=key not in ("rankDistrict", "rankState"))
        # performance rating: the row whose first label starts with PERFORMANCE RATING
        ri = next((i for i, r in enumerate(rows) if any(S(v).upper().startswith("PERFORMANCE RATING") for v in r[:4])), None)
        if ri is not None:
            g["rating"] = [S(rows[ri][ci]).title() or None, S(rows[ri][ci + 1]).title() or None]
        blocks[gname] = g
    overall = blocks.pop("OVERALL PERFORMANCE", {})
    subjects = [{"subject": k.title().replace("Computer Applications", "Computer Application"), **v} for k, v in blocks.items() if v.get("appeared") and any(x is not None for x in v["appeared"])]
    return cls, {"udise": udise, "name": name, "district": district, "block": block, "years": years, "overall": overall, "subjects": subjects}

def build():
    out = {"year": YEAR, "prevYear": PREV, "generatedAt": __import__("datetime").datetime.now(__import__("datetime").UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "note": "Board exam performance reports, AY 2025-26. State table: Govt schools, transcribed from the image-only state report. "
                   "District + school detail: ARIYALUR only (sample reports). Categories: avg >70 Good, >60 Satisfactory, >50 Needs Improvement, <=50 Poor.",
           "subjects": {str(k): v for k, v in SUBJECTS.items()}, "managements": MGMTS, "categories": CATS,
           "classes": {}}
    for cls in (10, 12):
        st = STATE_ROWS[cls]
        state = {"total": st["total"], "districts": [
            {"sno": r[0], "district": r[1], "schools": r[2], "appeared": r[3], "pass": r[4], "passDelta": r[5], "avg": r[6], "avgDelta": r[7], "rank": r[8]}
            for r in st["rows"]]}
        districts = {}
        for mg in ("GOVT", "AIDED"):
            f = os.path.join(SRC, f"ARIYALUR_{cls}th_DISTRICT_REPORT_{mg}.pdf")
            doc = pymupdf.open(f)
            lines = page_lines(doc[0])
            byMgmt, subject = parse_summary(lines, cls)
            schools = parse_school_table(doc, cls)
            d = districts.setdefault("ARIYALUR", {"district": "ARIYALUR", "byMgmt": byMgmt, "subject": subject,
                                                   "trend": TREND[cls], "schools": [], "overall": None})
            for s in schools:
                s["annexure"] = mg.title()
            d["schools"].extend(schools)
            print(f"{f.split(os.sep)[-1]}: {len(schools)} schools")
        for d in districts.values():
            govt = [s for s in d["schools"] if s["annexure"] == "Govt"]
            # school performance category counts (Govt annexure, as in section C)
            d["schoolCats"] = {c: sum(1 for s in govt if s["perf"] == c) for c in CATS}
            d["schoolCatsPrev"] = {c: sum(1 for s in govt if s["prevPerf"] == c) for c in CATS}
            # subject category counts from each school's subject average
            d["subjectCats"] = []
            for sub in SUBJECTS[cls]:
                cnt = {c: 0 for c in CATS}
                for s in govt:
                    b = band((s["subjects"].get(sub) or {}).get("avg"))
                    if b: cnt[b] += 1
                d["subjectCats"].append({"subject": sub, **cnt})
            # district overall category (section C): the report shows "Poor" for Ariyalur for both classes
            d["overall"] = "Poor"
        out["classes"][str(cls)] = {"state": state, "districts": districts, "schoolReports": {}}
    for f in sorted(os.listdir(SRC)):
        if not f.lower().endswith(".xlsx") or not re.match(r"^\d{11}", f):
            continue
        cls, rep = parse_school_report(os.path.join(SRC, f))
        out["classes"][str(cls)]["schoolReports"][rep["udise"]] = rep
        print(f"school report {f}: class {cls}, {rep['name']}, {len(rep['subjects'])} subjects, years {rep['years']}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("wrote", os.path.abspath(OUT), os.path.getsize(OUT) // 1024, "KB")
    for cls in ("10", "12"):
        d = out["classes"][cls]["districts"]["ARIYALUR"]
        print(cls, "byMgmt[0]", d["byMgmt"][0])
        print(cls, "subject[0]", d["subject"][0])
        print(cls, "schoolCats", d["schoolCats"], "schools", len(d["schools"]))
        print(cls, "school[0]", {k: v for k, v in d["schools"][0].items() if k != "subjects"}, list(d["schools"][0]["subjects"].items())[:2])

if __name__ == "__main__":
    build()
