$u8 = New-Object Text.UTF8Encoding($false)
$p = 'src\app\services\academic.service.ts'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8).Replace("`r`n", "`n")
function Rep([string]$o, [string]$n) {
  $c = ([regex]::Matches($script:t, [regex]::Escape($o))).Count
  if ($c -ne 1) { throw "expected 1 match, got $c for: $($o.Substring(0, [Math]::Min(70, $o.Length)))" }
  $script:t = $script:t.Replace($o, $n)
}
Rep @'
  private readonly _data = signal<AcademicData | null>(null);
  private readonly _schools = signal<AcademicSchoolsData | null>(null);
'@ @'
  private readonly _raw = signal<AcademicData | null>(null);
  private readonly _rawSchools = signal<AcademicSchoolsData | null>(null);

  // ================= Board mode (Class X & XII tab) =================
  /**
   * When on, every node (state / district / block / school, every year) is
   * re-derived from its `examClass` sittings restricted to the board classes
   * (10 and 12) and the selected exam type, so the whole Academic page
   * (Numbers, Trend, Comparison, Alarming, Caution) shows Class X & XII only
   * with no per-view changes. Mark-band counts (below 35 / 35-60 / ...) do
   * not exist per sitting in the export, so they are 0 in board mode and the
   * UI hides them. Scopes with no board sitting are dropped, not shown as 0.
   */
  readonly boardMode = signal(false);
  /** Exam type in board mode: 'Quarterly' | 'Half Yearly' | 'Annual' | '' (all sittings). */
  readonly boardExam = signal<string>('Annual');
  readonly boardExamOptions = ['Quarterly', 'Half Yearly', 'Annual'];

  private projectNode<T extends AcademicNode>(n: T, board: Set<number>, exam: string): T | null {
    const rows = (n.examClass ?? []).filter((r) => board.has(r.cls) && (!exam || r.exam === exam));
    if (!rows.length) return null;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const w = (pick: (r: ExamClassStat) => number) => {
      const den = rows.reduce((s, r) => s + (r.updated || 0), 0);
      return den ? r1(rows.reduce((s, r) => s + pick(r) * (r.updated || 0), 0) / den) : 0;
    };
    const total = rows.reduce((s, r) => s + (r.total || 0), 0);
    const updated = rows.reduce((s, r) => s + (r.updated || 0), 0);
    const subj = (sel: ExamClassStat[]): SubjectStat[] => {
      const m = new Map<string, { a: number; p: number; w: number }>();
      for (const r of sel) for (const s of r.subjects ?? []) {
        const e = m.get(s.name) ?? { a: 0, p: 0, w: 0 };
        e.a += s.avg * (r.updated || 0); e.p += s.pass * (r.updated || 0); e.w += r.updated || 0;
        m.set(s.name, e);
      }
      return [...m.entries()].map(([name, e]) => ({
        name, avg: e.w ? r1(e.a / e.w) : 0, pass: e.w ? r1(e.p / e.w) : 0,
        below35: 0, b35_60: 0, b61_80: 0, above80: 0, absent: 0,
      }));
    };
    const group = (key: (r: ExamClassStat) => string): AcademicBreakdown[] => {
      const m = new Map<string, ExamClassStat[]>();
      for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
      return [...m.entries()].map(([name, sel]) => {
        const den = sel.reduce((s, r) => s + (r.updated || 0), 0);
        const tot = sel.reduce((s, r) => s + (r.total || 0), 0);
        return {
          name, total: tot, updated: den,
          avg: den ? r1(sel.reduce((s, r) => s + r.avg * (r.updated || 0), 0) / den) : 0,
          pass: den ? r1(sel.reduce((s, r) => s + r.pass * (r.updated || 0), 0) / den) : 0,
          compliance: tot ? r1((den / tot) * 100) : 0,
        };
      });
    };
    const examSubject: ExamSubjectStat[] = [];
    for (const e of new Set(rows.map((r) => r.exam))) {
      for (const s of subj(rows.filter((r) => r.exam === e))) examSubject.push({ exam: e, subject: s.name, avg: s.avg, pass: s.pass });
    }
    return {
      ...n,
      total, updated, compliance: total ? r1((updated / total) * 100) : 0,
      avgMark: w((r) => r.avg), passPct: w((r) => r.pass),
      // Class X = the five core subjects, Class XII = stream subjects
      bySubject: subj(rows.filter((r) => r.cls === 10)),
      byHsSubject: subj(rows.filter((r) => r.cls === 12)),
      byExam: group((r) => r.exam), byClass: group((r) => String(r.cls)),
      examSubject, examClass: rows,
    };
  }
  private projectMap<T extends AcademicNode>(m: Record<string, T>, board: Set<number>, exam: string): Record<string, T> {
    const out: Record<string, T> = {};
    for (const k of Object.keys(m)) { const p = this.projectNode(m[k], board, exam); if (p) out[k] = p; }
    return out;
  }
  /** The dataset the rest of the service reads: raw, or the board projection. */
  private readonly _data = computed<AcademicData | null>(() => {
    const d = this._raw();
    if (!d || !this.boardMode()) return d;
    const board = new Set(d.boardClasses?.length ? d.boardClasses : [10, 12]);
    const exam = this.boardExam();
    const byYear = <T extends AcademicNode>(m: Record<string, Record<string, T>>) =>
      Object.fromEntries(Object.entries(m).map(([y, v]) => [y, this.projectMap(v, board, exam)]));
    const state: Record<string, AcademicNode> = {};
    for (const y of Object.keys(d.state)) { const p = this.projectNode(d.state[y], board, exam); if (p) state[y] = p; }
    return {
      ...d, coreClasses: [10], hsClasses: [12], subjects: d.subjects, hsSubjects: d.hsSubjects,
      state, districts: byYear(d.districts), blocks: byYear(d.blocks),
    };
  });
  private readonly _schools = computed<AcademicSchoolsData | null>(() => {
    const s = this._rawSchools();
    if (!s || !this.boardMode()) return s;
    const board = new Set(this._raw()?.boardClasses?.length ? this._raw()!.boardClasses : [10, 12]);
    const exam = this.boardExam();
    const out: AcademicSchoolsData = {};
    for (const k of Object.keys(s)) {
      const rows = s[k].map((sc) => this.projectNode(sc as unknown as AcademicNode & AcademicSchool, board, exam)).filter((x): x is AcademicNode & AcademicSchool => !!x);
      if (rows.length) out[k] = rows;
    }
    return out;
  });
'@
Rep "  readonly data = this._data.asReadonly();" "  readonly data = this._data;"
Rep "    this._data.set(d);`n    this._schools.set(s);" "    this._raw.set(d);`n    this._rawSchools.set(s);"
Rep @'
  readonly subjectSetLabel = computed(() =>
    this.subjectSet() === 'hs'
'@ @'
  readonly subjectSetLabel = computed(() =>
    this.boardMode()
      ? (this.subjectSet() === 'hs' ? 'Class XII (streams)' : 'Class X (5 subjects)')
      : this.subjectSet() === 'hs'
'@
# model imports
$imp = [regex]::Match($t, "import \{[^}]*\} from '../models/academic.model';").Value
foreach ($need in 'ExamClassStat','SubjectStat','AcademicBreakdown','ExamSubjectStat') { if ($imp -notmatch "\b$need\b") { $imp2 = $imp.Replace('import {', "import { $need,"); $t = $t.Replace($imp, $imp2); $imp = $imp2 } }
[IO.File]::WriteAllText($p, $t.Replace("
", "
"), $u8)

# ---- app.ts: tab, flags, setTab ----
$p = 'src\app\app.ts'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
Rep "    { label: 'Academic Scores' },`n" "    { label: 'Academic Scores' },`n    // Same page as Academic Scores, projected to the board classes (AcademicService.boardMode)`n    { label: 'Academic Scores X & XII' },`n"
Rep "  readonly isAcademic = computed(() => this.activeTab() === 'Academic Scores');" "  readonly isBoard = computed(() => this.activeTab() === 'Academic Scores X & XII');`n  readonly isAcademic = computed(() => this.activeTab() === 'Academic Scores' || this.isBoard());"
Rep "  setTab(t: string): void {`n    this.activeTab.set(t);" "  setTab(t: string): void {`n    this.activeTab.set(t);`n    // Class X & XII tab = the Academic page in board mode`n    this.ac.boardMode.set(t === 'Academic Scores X & XII');"
Rep "  setAcYear(y: string): void { this.ac.year.set(y); }" "  setAcYear(y: string): void { this.ac.year.set(y); }`n  setAcBoardExam(e: string): void { this.ac.boardExam.set(e); }"
[IO.File]::WriteAllText($p, $t, $u8)

# ---- app.html: control bar + labels in board mode ----
$p = 'src\app\app.html'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
Rep @'
      @if (activeSub() === 'numbers') {
        <div class="tc-rank">
          <button [class.on]="ac.subjectSet()==='core'" (click)="setAcSubjectSet('core')">
            <i class="fa-solid fa-book"></i> Class 6-10 (5 subjects)
          </button>
          <button [class.on]="ac.subjectSet()==='hs'" (click)="setAcSubjectSet('hs')">
            <i class="fa-solid fa-flask"></i> Class 11-12 (streams)
          </button>
        </div>
      }
      <span class="ac-note"><i class="fa-solid fa-circle-info"></i>
        <b>Scope:</b> Government, Partially Aided &amp; Fully Aided schools only.
        Class 10 &amp; 12 = board exam (Annual only); classes 6-10 sit 5 core subjects, 11-12 are stream based.
      </span>
'@ @'
      @if (isBoard() && activeSub() === 'numbers') {
        <div class="tc-rank" role="group" aria-label="Exam type">
          @for (e of ac.boardExamOptions; track e) {
            <button [class.on]="ac.boardExam() === e" [attr.aria-pressed]="ac.boardExam() === e" (click)="setAcBoardExam(e)">
              <i class="fa-solid fa-file-pen"></i> {{ e }}
            </button>
          }
        </div>
      }
      @if (activeSub() === 'numbers') {
        <div class="tc-rank">
          <button [class.on]="ac.subjectSet()==='core'" (click)="setAcSubjectSet('core')">
            <i class="fa-solid fa-book"></i> {{ isBoard() ? 'Class X (5 subjects)' : 'Class 6-10 (5 subjects)' }}
          </button>
          <button [class.on]="ac.subjectSet()==='hs'" (click)="setAcSubjectSet('hs')">
            <i class="fa-solid fa-flask"></i> {{ isBoard() ? 'Class XII (streams)' : 'Class 11-12 (streams)' }}
          </button>
        </div>
      }
      @if (isBoard()) {
        <span class="ac-note"><i class="fa-solid fa-circle-info"></i>
          <b>Scope:</b> Class X &amp; XII (board classes) in Government, Partially Aided &amp; Fully Aided schools.
          The current export carries the <b>Annual</b> sitting only for these classes; Quarterly and Half Yearly fill in once exported.
        </span>
      } @else {
        <span class="ac-note"><i class="fa-solid fa-circle-info"></i>
          <b>Scope:</b> Government, Partially Aided &amp; Fully Aided schools only.
          Class 10 &amp; 12 = board exam (Annual only); classes 6-10 sit 5 core subjects, 11-12 are stream based.
        </span>
      }
'@
Rep @'
        <i class="fa-solid fa-graduation-cap"></i> Academic Scores - {{ acScopeLabel() }}
        <span class="yr">{{ ac.activeYear() }}</span>
      </div>

      @if (!ac.schoolHasData()) {
'@ @'
        <i class="fa-solid fa-graduation-cap"></i> {{ isBoard() ? 'Academic Scores, Class X & XII' : 'Academic Scores' }} - {{ acScopeLabel() }}
        <span class="yr">{{ ac.activeYear() }}@if (isBoard()) { &middot; {{ ac.boardExam() }}}</span>
      </div>

      @if (isBoard() && !ac.current()) {
        <div class="no-data"><i class="fa-solid fa-circle-exclamation"></i>
          No {{ ac.boardExam() }} sitting for Class X or XII at this scope in the export. Choose <b>Annual</b> to see the board results.
        </div>
      } @else if (!ac.schoolHasData()) {
'@
Rep @'
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-layer-group"></i> Mark Band Distribution - {{ ac.subjectSetLabel() }}</div>
          <div echarts [options]="acBandOpt()" (chartInit)="registerChart('acBand', $event)" class="chart tall-chart"></div>
        </div>
'@ @'
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-layer-group"></i> Mark Band Distribution - {{ ac.subjectSetLabel() }}</div>
          @if (isBoard()) {
            <div class="no-data"><i class="fa-solid fa-circle-info"></i> Mark bands (below 35 / 35-60 / 61-80 / above 80) are not in the board-exam export; only subject averages and pass % are.</div>
          } @else {
            <div echarts [options]="acBandOpt()" (chartInit)="registerChart('acBand', $event)" class="chart tall-chart"></div>
          }
        </div>
'@
Rep @'
              <th>Subject</th><th class="num">Average Mark</th><th class="num">Pass %</th>
              <th class="num">Below 35</th><th class="num">35-60</th>
              <th class="num">61-80</th><th class="num">Above 80</th><th class="num">Absentees</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-s>
            <tr>
              <td class="strong">{{ s.name }}</td>
              <td class="num" [class.bad]="s.avg < 50" [class.good]="s.avg >= 60">{{ s.avg }}</td>
              <td class="num" [class.bad]="s.pass < 70">{{ s.pass }}%</td>
              <td class="num bad">{{ fmt(s.below35) }}</td>
              <td class="num">{{ fmt(s.b35_60) }}</td>
              <td class="num">{{ fmt(s.b61_80) }}</td>
              <td class="num good">{{ fmt(s.above80) }}</td>
              <td class="num">{{ fmt(s.absent) }}</td>
            </tr>
'@ @'
              <th>Subject</th><th class="num">Average Mark</th><th class="num">Pass %</th>
              @if (!isBoard()) {
                <th class="num">Below 35</th><th class="num">35-60</th>
                <th class="num">61-80</th><th class="num">Above 80</th><th class="num">Absentees</th>
              }
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-s>
            <tr>
              <td class="strong">{{ s.name }}</td>
              <td class="num" [class.bad]="s.avg < 50" [class.good]="s.avg >= 60">{{ s.avg }}</td>
              <td class="num" [class.bad]="s.pass < 70">{{ s.pass }}%</td>
              @if (!isBoard()) {
                <td class="num bad">{{ fmt(s.below35) }}</td>
                <td class="num">{{ fmt(s.b35_60) }}</td>
                <td class="num">{{ fmt(s.b61_80) }}</td>
                <td class="num good">{{ fmt(s.above80) }}</td>
                <td class="num">{{ fmt(s.absent) }}</td>
              }
            </tr>
'@
[IO.File]::WriteAllText($p, $t, $u8)
'ok'
