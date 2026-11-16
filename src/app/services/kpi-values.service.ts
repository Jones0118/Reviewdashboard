import { Injectable, computed, inject } from '@angular/core';
import { ReviewService, DrillRow } from './review.service';
import { KpiDef } from '../models/kpi-catalog.model';

/**
 * Scope-level KPI values + the catalog band / format rules, shared by the
 * Review Dashboard tiles (app.ts) and the standalone "At a glance" page
 * (glance/glance.ts). Moved out of App so both pages compute the same figure
 * from the same rule.
 */
@Injectable({ providedIn: 'root' })
export class KpiValuesService {
  private readonly rv = inject(ReviewService);
  /**
   * Aggregate the current drill scope into a single value map by combining the
   * child rows (drillRows). Percentages are student-weighted; counts are summed.
   * This gives a scope-level value for every KPI field at State/District/Block.
   */
  readonly scopeValues = computed<Record<string, number | null>>(() => {
    const rows = this.rv.drillRows();
    if (!rows.length) return {};
    const totalStudents = rows.reduce((s, r) => s + (r.n || 0), 0) || 1;
    const out: Record<string, number | null> = {};
    // percentage fields are weighted by students; everything else is summed
    const PCT = new Set(['att', 'teacherAtt', 'compliance', 'academicAvg', 'academicChange',
      'sch', 'tnSparkPct', 'breakfastPct', 'h14417ResPct', 'scholarEligibilityPct',
      'smcClosureRate', 'palliCompletionPct', 'chg', 'girlsPct', 'dropRate', 'thiranSharePct',
      'palliClassObsPct', 'palliSchoolsNotObsPct', 'palliOfficialsNotObsPct', 'palliSchools3PlusPct',
      // real-data percentages
      'acaLanguageAvg', 'acaEnglishAvg', 'acaMathsAvg', 'acaScienceAvg', 'acaSocialAvg',
      'acaCompletionPct', 'acaPassPct', 'acaExamToExam', 'acaCoveragePct',
      'thiranBaselinePct', 'thiranBloPct', 'ictFunctionalPct',
      'ictInternetPct', 'infGapPct', 'scholarPaySuccessPct', 'cwsnPct', 'slasPct',
      // new enrollment/attendance percentages
      'schoolsNotMarkedPct', 'ptr', 'transitionPendingPct',
      // All Children in School
      'acisSurveyPct',
      // SMC meetings / emergency / other / grants
      'smcMeetAttendPct', 'smcEmergencyClosureRate', 'smcOtherClosureRate']);
    const keys: (keyof DrillRow)[] = ['ns', 'n', 'teaching', 'att', 'teacherAtt', 'compliance',
      'drop', 'tl', 'gaps', 'academicAvg', 'academicChange', 'sch', 'cases', 'tnSparkPct',
      'breakfastPct', 'cmOpen', 'h14417Open', 'h14417Critical', 'h14417ResPct', 'girlsPct',
      'dropRate', 'thiranStudents', 'thiranSchools', 'scholarEligibilityPct', 'scholarAadhaar',
      'scholarPayPending', 'smcRaised', 'smcClosed', 'smcPending', 'smcClosureRate',
      'palliTarget', 'palliVisited', 'palliNotVisited', 'palliCompletionPct',
      // ---- real-data counts ----
      'palliObservations', 'palliOfficials', 'palliBrte', 'palliBeo',
      'thiranAttainBLO', 'thiranNotTagged',
      'ictSchools', 'ictInternet', 'ictNoInternet', 'ictFunctional', 'ictNotFunctional',
      'smcEmergency', 'smcEmergencyOpen',
      'infNoToilet', 'infNoWater', 'infNoCwsnToilet', 'infNoKitchen', 'infDemolish', 'infRepair',
      'infNoPlayground', 'infNoFirstAid', 'infNoFire', 'infNoRamp', 'infClassShortage',
      // ---- percentages (also listed in PCT above) ----
      'acaLanguageAvg', 'acaEnglishAvg', 'acaMathsAvg', 'acaScienceAvg', 'acaSocialAvg',
      'acaCompletionPct', 'thiranBaselinePct', 'thiranBloPct', 'thiranSharePct', 'ictFunctionalPct',
      'ictInternetPct', 'infGapPct', 'scholarPaySuccessPct', 'cwsnPct', 'slasPct',
      'acaPassPct', 'acaExamToExam', 'acaCoveragePct',
      // ---- synthetic counts still referenced by catalog KPIs ----
      'declSchools', 'attPending', 'breakfastExcept', 'cmCritical',
      'scholarPayFailed', 'scholarNpciInactive', 'acaUp', 'acaDown',
      // ---- new Enrollment school-count + Attendance fields ----
      'zeroEnrol', 'zeroTeacher', 'singleTeacher', 'under10', 'ptrOver60',
      'enrolIncreaseSchools', 'enrolDeclinedSchools', 'notMoved',
      'boys', 'girls', 'ptr', 'schoolsNotMarkedPct', 'transitionPendingPct',
      'boysAbsent', 'girlsAbsent', 'teacherAbsent', 'teacherLong30',
      'attStudentBelow60', 'attTeacherBelow60',
      // ---- Palli Parvai KPIs ----
      'palliClassObsPct', 'palliSchoolsNotObsPct', 'palliOfficialsNotObsPct',
      'palliSchools3PlusPct', 'palliLowPerformers', 'palliTopPerformers',
      // ---- Recognition Order (DPS) pending RC applications ----
      'dpsTotal', 'dpsDistrictPending', 'dpsStatePending',
      'dpsLt15', 'dpsD15to30', 'dpsGt30',
      // ---- All Children in School (ACiS) common pool ----
      'acisPool', 'acisSurveyed', 'acisPendingSurvey', 'acisSurveyPct',
      'acisAdmitted', 'acisBridged', 'acisToBeAdmitted', 'acisToBeValidated',
      'acisWithReason', 'acisDeptTaken', 'acisDeptPending', 'acisCwsn', 'acisUmis',
      'acisPdRepeat', 'acisPd', 'acisPdWithReason', 'acisPdBase', 'acisDropOut', 'acisEnrolI12',
      // ---- SMC meetings, emergency/other split, grants ----
      'smcMeetings', 'smcSchoolsHeld', 'smcSchoolsNotHeld', 'smcEligibleSchools',
      'smcPresent', 'smcAbsent', 'smcVacant', 'smcMeetAttendPct',
      'smcEmergencyRaised', 'smcEmergencyResolved', 'smcEmergencyClosureRate',
      'smcOtherRaised', 'smcOtherResolved', 'smcOtherOpen', 'smcOtherClosureRate',
      'smcGrantAllocated', 'smcGrantUtilised'];
    for (const k of keys) {
      const kk = k as string;
      if (PCT.has(kk)) {
        out[kk] = Math.round((rows.reduce((s, r) => s + ((r[k] as number) || 0) * (r.n || 0), 0) / totalStudents) * 10) / 10;
      } else {
        out[kk] = rows.reduce((s, r) => s + ((r[k] as number) || 0), 0);
      }
    }
    // Averages that must be weighted by their own base rather than by enrolment
    // (summing per-district means, or weighting them by school roll, would both
    // be wrong). field -> the count each unit's mean is an average over.
    // Averages that must be weighted by their own base rather than by enrolment
    // (summing per-district means, or weighting them by school roll, would both
    // be wrong). field -> the count each unit's mean is an average over.
    const WAVG: Record<string, keyof DrillRow> = {
      acisBridgeDays: 'acisBridged',
    };
    for (const [field, wField] of Object.entries(WAVG)) {
      const w = rows.reduce((s, r) => s + ((r[wField] as number) || 0), 0);
      out[field] = w
        ? Math.round((rows.reduce(
          (s, r) => s + ((r[field as keyof DrillRow] as number) || 0) * ((r[wField] as number) || 0), 0,
        ) / w) * 10) / 10
        : null;
    }
    // Ratios are recomputed from their own summed numerator and denominator —
    // exact, rather than a student-weighted average of per-unit percentages.
    // field -> [numerator, denominator parts (summed)].
    const RATIO: Record<string, [keyof DrillRow, (keyof DrillRow)[]]> = {
      smcClosureRate: ['smcClosed', ['smcRaised']],
      smcMeetAttendPct: ['smcPresent', ['smcPresent', 'smcAbsent']],
      smcEmergencyClosureRate: ['smcEmergencyResolved', ['smcEmergencyResolved', 'smcEmergency']],
      smcOtherClosureRate: ['smcOtherResolved', ['smcOtherResolved', 'smcOtherOpen']],
      smcGrantUtilPct: ['smcGrantUtilised', ['smcGrantAllocated']],
      acisSurveyPct: ['acisSurveyed', ['acisPool']],
    };
    for (const [field, [numKey, denKeys]] of Object.entries(RATIO)) {
      const num = rows.reduce((s, r) => s + ((r[numKey] as number) || 0), 0);
      const den = denKeys.reduce(
        (t, k) => t + rows.reduce((s, r) => s + ((r[k] as number) || 0), 0), 0,
      );
      out[field] = den ? Math.round((num / den) * 1000) / 10 : null;
    }
    // PD % is small (well under 1%), so it keeps two decimals rather than one.
    const pdBase = rows.reduce((s, r) => s + (r.acisPdBase || 0), 0);
    const pdNum = rows.reduce((s, r) => s + (r.acisPd || 0), 0);
    out['acisPdPct'] = pdBase ? Math.round((pdNum / pdBase) * 10000) / 100 : null;
    // Dropout rate: not-re-enrolled common-pool children ÷ enrolment in classes I–XII
    const drBase = rows.reduce((s, r) => s + (r.acisEnrolI12 || 0), 0);
    const drNum = rows.reduce((s, r) => s + (r.acisDropOut || 0), 0);
    out['acisDropRate'] = drBase ? Math.round((drNum / drBase) * 10000) / 100 : null;
    return out;
  });

  /** RAG band for a KPI at a given value, using its catalog range/direction. */
  band(def: KpiDef, v: number | null): 'good' | 'warn' | 'bad' | 'none' {
    if (v == null || def.dir === 0) return 'none';
    if (def.fmt === 'pct' && def.lo != null && def.hi != null) {
      let s = (v - def.lo) / (def.hi - def.lo || 1);
      if (def.dir < 0) s = 1 - s;
      s = Math.max(0, Math.min(1, s));
      return s > 0.66 ? 'good' : s > 0.33 ? 'warn' : 'bad';
    }
    // counts / flags: neutral unless direction known — leave as none (no fabricated cutoff)
    return 'none';
  }

  /** Format a KPI value for display; null -> "–". */
  format(def: KpiDef, v: number | null): string {
    if (v == null || isNaN(v as number)) return '–';
    if (def.fmt === 'pct') {
      // sub-1% rates (e.g. potential dropout %) need two decimals to be readable
      const dp = Math.abs(v as number) < 1 ? 2 : 1;
      // rates, not changes — no sign prefix
      const sign = def.dir < 0 && v > 0 && def.id !== 'ac_pdp' && def.id !== 'ac_dr' ? '+' : '';
      return `${sign}${(v as number).toFixed(dp)}%`;
    }
    return Math.round(v as number).toLocaleString('en-IN');
  }
}
