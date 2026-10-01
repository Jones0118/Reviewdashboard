import { Injectable } from '@angular/core';
import { AggregateNode, DistrictNode } from '../models/enrollment.model';
import { inr, inrAxis } from '../utils/format';

/** UDISE/EMIS-style palette. */
const UDISE = {
  yellow: '#f5c243',
  orange: '#ef7e56',
  green: '#a5d15a',
  maroon: '#7c1d3f',
  teal: '#3bb0b0',
  blue: '#2f6db0',
  purple: '#7c5cbf',
};
const PIE_COLORS = [UDISE.yellow, UDISE.orange, UDISE.green, UDISE.maroon, UDISE.teal, UDISE.blue, UDISE.purple, '#d69e2e'];

/** Download icon for the custom toolbox action. */
const DOWNLOAD_ICON =
  'path://M13 3v9.6l3.3-3.3 1.4 1.4L12 16.4 6.3 10.7l1.4-1.4L11 12.6V3h2zM5 18h14v2H5v-2z';

@Injectable({ providedIn: 'root' })
export class ChartService {
  /** Set by the dashboard component; invoked when a chart's download icon is clicked. */
  private downloadHandler: ((id: string, title: string) => void) | null = null;

  setDownloadHandler(fn: (id: string, title: string) => void): void {
    this.downloadHandler = fn;
  }

  /**
   * Standard toolbox: switch chart type, refresh, data table view, and download.
   * When `meta` is supplied the download opens a format chooser (PDF / PNG / JPG)
   * and names the file after the chart heading.
   */
  private toolbox(magic: string[] = ['bar', 'line'], meta?: { id: string; title: string }): any {
    const feature: any = {
      restore: { title: 'Refresh' },
      dataView: {
        title: 'Table View',
        readOnly: true,
        lang: ['Table View', 'Close', 'Refresh'],
        optionToContent: (opt: any) => this.tableHtml(opt),
      },
    };
    if (magic.length) {
      feature.magicType = {
        type: magic,
        title: { bar: 'Bar Chart', line: 'Line Chart', stack: 'Stack' },
      };
    }
    if (meta) {
      feature.myDownload = {
        show: true,
        title: 'Download (PDF / PNG / JPG)',
        icon: DOWNLOAD_ICON,
        onclick: () => this.downloadHandler?.(meta.id, meta.title),
      };
    } else {
      feature.saveAsImage = { title: 'Download', pixelRatio: 2 };
    }
    return { show: true, itemSize: 13, itemGap: 8, right: 8, top: 0, feature };
  }

  /** Render the chart's series as an HTML table for the dataView feature. */
  private tableHtml(opt: any): string {
    const cats: string[] = opt?.xAxis?.[0]?.data ?? [];
    const series: any[] = opt?.series ?? [];

    // radar: categories come from radar.indicator[], each series datum is
    // { name, value: number[] } aligned to those indicators.
    const radar = Array.isArray(opt?.radar) ? opt.radar[0] : opt?.radar;
    const indicators: any[] = radar?.indicator ?? [];
    const isRadar = indicators.length > 0 && series[0]?.type === 'radar';

    let html =
      '<div style="padding:12px;max-height:60vh;overflow:auto;font-family:Segoe UI,Arial,sans-serif">' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">';

    if (isRadar) {
      const lines: any[] = series[0]?.data ?? [];
      html += '<thead><tr><th style="text-align:left;padding:7px 10px;background:#1b3a7a;color:#fff">Subject</th>';
      for (const ln of lines) {
        html += `<th style="text-align:right;padding:7px 10px;background:#1b3a7a;color:#fff">${ln?.name ?? 'Value'}</th>`;
      }
      html += '</tr></thead><tbody>';
      indicators.forEach((ind, i) => {
        html += `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:6px 10px">${ind?.name ?? ''}</td>`;
        for (const ln of lines) {
          const v = Array.isArray(ln?.value) ? ln.value[i] : undefined;
          const cell = v == null || !isFinite(Number(v)) ? '-' : Number(v).toFixed(1);
          html += `<td style="padding:6px 10px;text-align:right">${cell}</td>`;
        }
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      return html;
    }

    if (cats.length) {
      html += '<thead><tr><th style="text-align:left;padding:7px 10px;background:#1b3a7a;color:#fff">Category</th>';
      for (const s of series) {
        html += `<th style="text-align:right;padding:7px 10px;background:#1b3a7a;color:#fff">${s.name ?? 'Value'}</th>`;
      }
      html += '</tr></thead><tbody>';
      cats.forEach((c, i) => {
        html += `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:6px 10px">${c}</td>`;
        for (const s of series) {
          const raw = s.data?.[i];
          const v = typeof raw === 'object' && raw !== null ? raw.value : raw;
          html += `<td style="padding:6px 10px;text-align:right">${inr(v)}</td>`;
        }
        html += '</tr>';
      });
      html += '</tbody>';
    } else {
      // pie/donut: series[0].data is [{name, value}]
      html += '<thead><tr><th style="text-align:left;padding:7px 10px;background:#1b3a7a;color:#fff">Category</th>' +
        '<th style="text-align:right;padding:7px 10px;background:#1b3a7a;color:#fff">Students</th>' +
        '<th style="text-align:right;padding:7px 10px;background:#1b3a7a;color:#fff">Share</th></tr></thead><tbody>';
      const data: any[] = series?.[0]?.data ?? [];
      const total = data.reduce((s, x) => s + (x?.value ?? 0), 0) || 1;
      for (const x of data) {
        const pct = (((x?.value ?? 0) / total) * 100).toFixed(2);
        html += `<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:6px 10px">${x?.name ?? ''}</td>` +
          `<td style="padding:6px 10px;text-align:right">${inr(x?.value)}</td>` +
          `<td style="padding:6px 10px;text-align:right">${pct}%</td></tr>`;
      }
      html += '</tbody>';
    }
    html += '</table></div>';
    return html;
  }

  // ===================== donuts =====================
  donutByDimension(node: AggregateNode, dim: string, meta?: { id: string; title: string }): any {
    switch (dim) {
      case 'level': return this.levelDonut(node, meta);
      case 'schoolType': return this.schoolTypeDonut(node, meta);
      case 'caste': return this.casteDonut(node, meta);
      case 'gender': return this.genderDonut(node, meta);
      default: return this.managementDonut(node, meta);
    }
  }

  managementDonut(node: AggregateNode, meta?: { id: string; title: string }): any {
    return this.donut('Management-Wise', this.groupManagement(node), PIE_COLORS, meta);
  }
  levelDonut(node: AggregateNode, meta?: { id: string; title: string }): any {
    return this.donut('Level of Education', node.byCategoryType.map((c) => ({ name: c.name, value: c.students })), PIE_COLORS, meta);
  }
  schoolTypeDonut(node: AggregateNode, meta?: { id: string; title: string }): any {
    return this.donut('School Type', node.bySchoolType.map((c) => ({ name: this.shorten(c.name), value: c.students })), PIE_COLORS, meta);
  }
  genderDonut(node: AggregateNode, meta?: { id: string; title: string }): any {
    return this.donut('Gender', [
      { name: 'Boys', value: node.boys },
      { name: 'Girls', value: node.girls },
      { name: 'Transgender', value: node.transgen },
    ], ['#3bb0b0', '#ef7e56', '#7c5cbf'], meta);
  }
  casteDonut(node: AggregateNode, meta?: { id: string; title: string }): any {
    const c = node.caste;
    return this.donut('Social Category', [
      { name: 'OC', value: c.OC }, { name: 'BC', value: c.BC }, { name: 'MBC', value: c.MBC },
      { name: 'DNC', value: c.DNC }, { name: 'SC', value: c.SC }, { name: 'ST', value: c.ST },
    ], PIE_COLORS, meta);
  }

  private groupManagement(node: AggregateNode) {
    let govt = 0, pvt = 0, aided = 0, central = 0, other = 0;
    for (const m of node.byManagement) {
      const n = m.name.toLowerCase();
      if (n.includes('central') || n.includes('kendriya') || n.includes('sainik') || n.includes('atomic') || n.includes('army') || n.includes('railway') || n.includes('defence')) central += m.students;
      else if (n.includes('unaided') || n.includes('private') || n.includes('un-aided')) pvt += m.students;
      else if (n.includes('aided')) aided += m.students;
      else if (n.includes('department') || n.includes('corporation') || n.includes('municipal') || n.includes('government') || n.includes('welfare') || n.includes('kgbv') || n.includes('tribal') || n.includes('forest') || n.includes('kallar')) govt += m.students;
      else other += m.students;
    }
    return [
      { name: 'Government', value: govt },
      { name: 'Private', value: pvt },
      { name: 'Aided', value: aided },
      { name: 'Central Govt', value: central },
      { name: 'Others', value: other },
    ].filter((x) => x.value > 0);
  }

  private donut(
    name: string,
    data: { name: string; value: number }[],
    colors: string[] = PIE_COLORS,
    meta?: { id: string; title: string },
  ): any {
    return {
      color: colors,
      toolbox: this.toolbox([], meta),
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `<b>${p.name}</b><br/>${inr(p.value)} (${p.percent}%)`,
      },
      legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      series: [
        {
          name,
          type: 'pie',
          // Smaller radius + higher centre leaves room for full outside labels
          radius: ['38%', '58%'],
          center: ['50%', '45%'],
          minAngle: 2,
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            position: 'outside',
            formatter: '{d}%',
            fontSize: 11,
            fontWeight: 'bold',
            color: '#333',
            // Critical: stop ECharts truncating labels to "4..." / "33.1..."
            overflow: 'none',
            width: undefined,
            distanceToLabelLine: 3,
            alignTo: 'none',
          },
          labelLine: { show: true, length: 12, length2: 14, smooth: true, maxSurfaceAngle: 80 },
          labelLayout: { hideOverlap: false },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 'bold', overflow: 'none' },
            scaleSize: 5,
          },
          data,
        },
      ],
    };
  }

  // ===================== bars / lines =====================
  gradeBar(node: AggregateNode, meta?: { id: string; title: string }): any {
    return {
      color: ['#3bb0b0', '#ef7e56'],
      toolbox: this.toolbox(['bar', 'line', 'stack'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => inr(v),
      },
      legend: { data: ['Boys', 'Girls'], bottom: 0, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 76, right: 28, top: 44, bottom: 52 },
      xAxis: [{ type: 'category', data: node.byGrade.map((g) => g.name), axisLabel: { fontSize: 10, interval: 0, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 58, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: [
        { name: 'Boys', type: 'bar', stack: 'g', data: node.byGrade.map((g) => g.boys), barMaxWidth: 30 },
        { name: 'Girls', type: 'bar', stack: 'g', data: node.byGrade.map((g) => g.girls), barMaxWidth: 30 },
      ],
    };
  }

  /** District combo: bars = metric, line = share %. Clickable bars. */
  districtCombo(districts: DistrictNode[], metric: 'students' | 'schools', meta?: { id: string; title: string }): any {
    const top = districts.slice(0, 20);
    const total = top.reduce((s, d) => s + ((d as any)[metric] ?? 0), 0) || 1;
    const label = metric === 'students' ? 'Students' : 'Schools';
    return {
      color: [UDISE.blue, UDISE.orange],
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          let s = `<b>${ps[0].axisValue}</b>`;
          for (const p of ps) {
            const v = p.seriesName === 'Share %' ? p.value + '%' : inr(p.value);
            s += `<br/>${p.marker} ${p.seriesName}: ${v}`;
          }
          return s;
        },
      },
      legend: { data: [label, 'Share %'], top: 26, left: 'center', itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 86, right: 74, top: 62, bottom: 96 },
      xAxis: [{
        type: 'category',
        data: top.map((d) => this.titleCase(d.name)),
        axisLabel: { fontSize: 10, rotate: 40, interval: 0, hideOverlap: false, margin: 12 },
        axisTick: { alignWithLabel: true },
      }],
      yAxis: [
        {
          type: 'value', name: label,
          nameLocation: 'middle', nameGap: 64, nameRotate: 90,
          nameTextStyle: { fontSize: 11, fontWeight: 600 },
          axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
        },
        {
          type: 'value', name: 'Share %',
          nameLocation: 'middle', nameGap: 52, nameRotate: -90,
          nameTextStyle: { fontSize: 11, fontWeight: 600 },
          axisLabel: { formatter: '{value}%', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: label, type: 'bar',
          data: top.map((d) => (d as any)[metric]),
          barMaxWidth: 30,
          itemStyle: { color: UDISE.blue, borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Share %', type: 'line', yAxisIndex: 1,
          data: top.map((d) => +((((d as any)[metric] ?? 0) / total) * 100).toFixed(2)),
          smooth: true, symbol: 'circle', symbolSize: 7,
          itemStyle: { color: UDISE.orange }, lineStyle: { width: 2 },
        },
      ],
      _names: top.map((d) => d.name),
    };
  }

  /** Enrolment trend line/area. */
  trendLine(years: string[], students: number[], label: string, meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.blue],
      toolbox: this.toolbox(['line', 'bar'], meta),
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => inr(v) },
      grid: { left: 86, right: 34, top: 46, bottom: 48 },
      xAxis: [{ type: 'category', boundaryGap: false, data: years, axisLabel: { fontSize: 10, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 66, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        scale: true,
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: [
        {
          name: label, type: 'line', data: students,
          smooth: true, symbol: 'circle', symbolSize: 8,
          lineStyle: { width: 3, color: UDISE.blue },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(47,109,176,0.35)' },
                { offset: 1, color: 'rgba(47,109,176,0.02)' },
              ],
            },
          },
          label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => inrAxis(p.value) },
        },
      ],
    };
  }

  /** Boys vs Girls trend for any scope. */
  genderTrend(years: string[], boys: number[], girls: number[], meta?: { id: string; title: string }): any {
    return {
      color: ['#3bb0b0', '#ef7e56'],
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => inr(v) },
      legend: { data: ['Boys', 'Girls'], top: 26, left: 'center', itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 86, right: 28, top: 62, bottom: 48 },
      xAxis: [{ type: 'category', data: years, axisLabel: { fontSize: 10, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 66, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        scale: true,
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: [
        { name: 'Boys', type: 'bar', data: boys, barMaxWidth: 22, itemStyle: { color: '#3bb0b0' } },
        { name: 'Girls', type: 'bar', data: girls, barMaxWidth: 22, itemStyle: { color: '#ef7e56' } },
      ],
    };
  }

  /** Transition Rate by stage (Class V->VI, VIII->IX, X->XI) over the years. */
  transitionTrend(years: string[], stages: { label: string; rate: number[] }[], meta?: { id: string; title: string }): any {
    const colors = [UDISE.blue, UDISE.green, UDISE.orange];
    // Derive a padded y-range from the data so near-100% lines are not crushed
    // into a thin band, while a lower floor keeps the Class X->XI dip readable.
    const allRates = stages.flatMap((s) => s.rate).filter((v) => v > 0);
    const dataMin = allRates.length ? Math.min(...allRates) : 0;
    const dataMax = allRates.length ? Math.max(...allRates) : 100;
    const yMin = Math.max(0, Math.floor((dataMin - 8) / 5) * 5);
    const yMax = Math.min(105, Math.ceil((dataMax + 4) / 5) * 5);
    return {
      color: colors,
      toolbox: this.toolbox(['line', 'bar'], meta),
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => `${v}%`,
      },
      // Two rows of legend so all three stages show without a pager; extra top
      // padding on the grid keeps the plot clear of the wrapped legend.
      legend: {
        top: 24, left: 'center', width: '92%', type: 'plain',
        itemWidth: 16, itemHeight: 9, itemGap: 14,
        textStyle: { fontSize: 10.5 },
      },
      grid: { left: 66, right: 34, top: 92, bottom: 46 },
      xAxis: [{ type: 'category', boundaryGap: false, data: years, axisLabel: { fontSize: 10, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'Transition %',
        nameLocation: 'middle', nameGap: 46, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        min: yMin, max: yMax, interval: Math.max(5, Math.round((yMax - yMin) / 6 / 5) * 5),
        axisLabel: { formatter: '{value}%', fontSize: 10 },
      }],
      series: stages.map((s, i) => ({
        name: s.label, type: 'line', data: s.rate,
        smooth: true, symbol: 'circle', symbolSize: 7,
        itemStyle: { color: colors[i % colors.length] }, lineStyle: { width: 2.5 },
        label: { show: true, position: 'top', fontSize: 9, formatter: '{c}%' },
      })),
    };
  }

  /** GER by schooling level, per year (grouped bars). */
  gerTrend(years: string[], series: { label: string; ger: number[] }[], meta?: { id: string; title: string }): any {
    const colors = [UDISE.blue, UDISE.green, UDISE.orange, UDISE.purple];
    return {
      color: colors,
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => `${v}%`,
      },
      legend: { top: 26, left: 'center', width: '80%', type: 'scroll', itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 10 } },
      grid: { left: 66, right: 30, top: 66, bottom: 46 },
      xAxis: [{ type: 'category', data: years, axisLabel: { fontSize: 10, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'GER %',
        nameLocation: 'middle', nameGap: 46, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 }, scale: true,
      }],
      series: series.map((s, i) => ({
        name: s.label, type: 'bar', data: s.ger, barMaxWidth: 22,
        itemStyle: { color: colors[i % colors.length], borderRadius: [3, 3, 0, 0] },
      })),
    };
  }

  /**
   * Births → Class 1 entry monitor: expected entrants (line, with the
   * projected tail dashed) against actual EMIS Class 1 enrolment (line, only
   * where recorded). Academic year on the x-axis.
   */
  class1Monitor(
    years: string[],
    expected: number[],
    actual: (number | null)[],
    firstProjectedIdx: number,
    meta?: { id: string; title: string },
  ): any {
    // Split expected into a solid (historical) and dashed (projected) segment
    // so the projection reads as an estimate, not a recorded figure.
    const solid = expected.map((v, i) => (i <= firstProjectedIdx - 1 || firstProjectedIdx < 0 ? v : (i === firstProjectedIdx ? v : null)));
    const dashed = expected.map((v, i) => (firstProjectedIdx >= 0 && i >= firstProjectedIdx - 1 ? v : null));
    const useSplit = firstProjectedIdx >= 0 && firstProjectedIdx < expected.length;
    return {
      color: [UDISE.blue, UDISE.orange, UDISE.blue],
      toolbox: this.toolbox(['line', 'bar'], meta),
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number | null) => (v == null ? '—' : inr(v)),
      },
      legend: {
        top: 24, left: 'center', width: '90%', itemWidth: 16, itemHeight: 9,
        textStyle: { fontSize: 10.5 },
        data: useSplit
          ? ['Expected entrants', 'Expected (projected)', 'Actual Class 1 enrolment']
          : ['Expected entrants', 'Actual Class 1 enrolment'],
      },
      grid: { left: 78, right: 34, top: 66, bottom: 56 },
      xAxis: [{
        type: 'category', boundaryGap: false, data: years,
        axisLabel: { fontSize: 10, rotate: 30, margin: 10, interval: 0 },
      }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 60, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        scale: true,
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: useSplit
        ? [
            {
              name: 'Expected entrants', type: 'line', data: solid,
              smooth: true, symbol: 'circle', symbolSize: 6,
              itemStyle: { color: UDISE.blue }, lineStyle: { width: 2.5 },
              connectNulls: false,
            },
            {
              name: 'Expected (projected)', type: 'line', data: dashed,
              smooth: true, symbol: 'emptyCircle', symbolSize: 6,
              itemStyle: { color: UDISE.blue }, lineStyle: { width: 2.5, type: 'dashed' },
              connectNulls: true,
            },
            {
              name: 'Actual Class 1 enrolment', type: 'line', data: actual,
              smooth: true, symbol: 'circle', symbolSize: 6,
              itemStyle: { color: UDISE.orange }, lineStyle: { width: 2.5 },
              connectNulls: false,
            },
          ]
        : [
            {
              name: 'Expected entrants', type: 'line', data: expected,
              smooth: true, symbol: 'circle', symbolSize: 6,
              itemStyle: { color: UDISE.blue }, lineStyle: { width: 2.5 },
            },
            {
              name: 'Actual Class 1 enrolment', type: 'line', data: actual,
              smooth: true, symbol: 'circle', symbolSize: 6,
              itemStyle: { color: UDISE.orange }, lineStyle: { width: 2.5 },
              connectNulls: false,
            },
          ],
    };
  }

  /** Multi-line comparison of top districts across years. */
  districtTrendCompare(data: any): any {
    if (!data) return {};
    const years: string[] = data.years ?? [];
    const top = (data.districtTrend ?? []).slice(0, 8);
    return {
      color: PIE_COLORS,
      toolbox: this.toolbox(['line', 'bar']),
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => inr(v) },
      legend: { type: 'scroll', top: 26, left: 'center', width: '72%', textStyle: { fontSize: 10 }, itemWidth: 14, itemHeight: 9 },
      grid: { left: 86, right: 34, top: 62, bottom: 48 },
      xAxis: [{ type: 'category', boundaryGap: false, data: years, axisLabel: { fontSize: 10, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 66, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        scale: true,
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: top.map((d: any, i: number) => ({
        name: this.titleCase(d.name), type: 'line', smooth: true,
        symbol: 'circle', symbolSize: 5, data: d.series,
        itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] }, lineStyle: { width: 2 },
      })),
    };
  }
  /**
   * Clickable multi-line trend for the children of the current scope.
   * Clicking any line/point drills into that child. Returns `_names` so the
   * component can map a clicked seriesIndex back to the child key.
   */
  childTrendLines(
    years: string[],
    items: { key: string; name: string; series: number[] }[],
    childLabel: string,
    meta?: { id: string; title: string },
  ): any {
    const top = items;
    return {
      color: PIE_COLORS,
      toolbox: this.toolbox(['line', 'bar'], meta),
      tooltip: {
        trigger: 'axis',
        order: 'valueDesc',
        valueFormatter: (v: number) => inr(v),
        extraCssText: 'max-height:320px;overflow:auto;',
      },
      legend: {
        type: 'scroll', top: 26, left: 'center', width: '78%',
        textStyle: { fontSize: 10 }, itemWidth: 14, itemHeight: 9,
      },
      grid: { left: 86, right: 34, top: 66, bottom: 48 },
      xAxis: [{ type: 'category', boundaryGap: false, data: years, axisLabel: { fontSize: 10, margin: 10 } }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 66, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        scale: true,
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: top.map((it, i) => ({
        name: it.name,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: it.series,
        itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
        lineStyle: { width: 2 },
        emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
      })),
      _names: top.map((it) => it.key),
      _childLabel: childLabel,
    };
  }

  /**
   * Comparison chart: ranked horizontal bars for a chosen indicator, with a
   * dashed state-average reference line so outliers are obvious.
   */
  comparisonBar(
    rows: { name: string; [k: string]: any }[],
    metric: string,
    metricLabel: string,
    baseline: number,
    meta?: { id: string; title: string },
  ): any {
    // Show every child (38 districts / all blocks) - no cap, the chart scrolls with height
    const sorted = [...rows].sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0));
    const asc = [...sorted].reverse();
    const isRatio = metric === 'gpi' || metric === 'ptr' || metric === 'girlsPct';
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const v = ps[0].value;
          return `<b>${ps[0].axisValue}</b><br/>${metricLabel}: ${isRatio ? v : inr(v)}`;
        },
      },
      grid: { left: 150, right: 70, top: 34, bottom: 44 },
      xAxis: [{
        type: 'value', name: metricLabel,
        nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => (isRatio ? String(v) : inrAxis(v)), fontSize: 10 },
      }],
      yAxis: [{
        type: 'category',
        data: asc.map((r) => this.titleCase(r.name)),
        axisLabel: { fontSize: 10, width: 140, overflow: 'truncate' },
      }],
      series: [
        {
          type: 'bar',
          data: asc.map((r) => ({
            value: r[metric] ?? 0,
            itemStyle: {
              color: (r[metric] ?? 0) >= baseline ? UDISE.blue : UDISE.orange,
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barMaxWidth: 16,
          label: {
            show: true, position: 'right', fontSize: 9,
            formatter: (p: any) => (isRatio ? String(p.value) : inrAxis(p.value)),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: '#7c1d3f', width: 1.5 },
            label: {
              formatter: `State avg: ${isRatio ? baseline : inrAxis(baseline)}`,
              fontSize: 10, color: '#7c1d3f', position: 'insideEndTop',
            },
            data: [{ xAxis: baseline }],
          },
        },
      ],
      _names: asc.map((r) => r.name),
    };
  }

  /** Alert distribution by category. */
  alertBar(byKind: { kind: string; count: number }[], meta?: { id: string; title: string }): any {
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => inr(v) },
      grid: { left: 60, right: 30, top: 30, bottom: 80 },
      xAxis: [{
        type: 'category',
        data: byKind.map((k) => k.kind),
        axisLabel: { fontSize: 10, interval: 0, rotate: 22, width: 110, overflow: 'break' },
      }],
      yAxis: [{ type: 'value', name: 'Districts', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10 } }],
      series: [
        {
          type: 'bar',
          data: byKind.map((k, i) => ({
            value: k.count,
            itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length], borderRadius: [4, 4, 0, 0] },
          })),
          barMaxWidth: 54,
          label: { show: true, position: 'top', fontSize: 11, fontWeight: 600 },
        },
      ],
    };
  }

  // ===================== REVIEW DASHBOARD =====================

  /** Donut from ready-made slices, styled like every other donut in the app. */
  reviewDonut(
    name: string,
    data: { name: string; value: number }[],
    meta?: { id: string; title: string },
  ): any {
    return this.donut(name, data.filter((d) => d.value > 0), PIE_COLORS, meta);
  }

  /**
   * Horizontal ranked bar for the review lists (attendance low performers,
   * school-type attendance, infrastructure gaps, scheme coverage).
   * `baseline` draws the app's standard dashed reference line.
   */
  reviewRankBar(
    rows: { name: string; value: number }[],
    metricLabel: string,
    opts: { suffix?: string; baseline?: number; baselineLabel?: string; red?: number; amber?: number } = {},
    meta?: { id: string; title: string },
  ): any {
    const suffix = opts.suffix ?? '';
    // category axis draws bottom-up, so reverse to keep rank #1 on top
    const asc = [...rows].reverse();
    const colour = (v: number) => {
      if (opts.red === undefined || opts.amber === undefined) return UDISE.blue;
      return v < opts.red ? UDISE.maroon : v < opts.amber ? UDISE.yellow : UDISE.green;
    };
    const opt: any = {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) =>
          ps?.length ? `<b>${ps[0].axisValue}</b><br/>${metricLabel}: ${inr(ps[0].value)}${suffix}` : '',
      },
      grid: { left: 160, right: 74, top: 30, bottom: 40 },
      xAxis: [{
        type: 'value', name: metricLabel,
        nameLocation: 'middle', nameGap: 26, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => `${inrAxis(v)}${suffix}`, fontSize: 10 },
      }],
      yAxis: [{
        type: 'category',
        data: asc.map((r) => r.name),
        axisLabel: { fontSize: 10, width: 150, overflow: 'truncate' },
      }],
      series: [{
        type: 'bar',
        data: asc.map((r) => ({
          value: r.value,
          itemStyle: { color: colour(r.value), borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 18,
        label: {
          show: true, position: 'right', fontSize: 10,
          formatter: (p: any) => `${inrAxis(p.value)}${suffix}`,
        },
      }],
    };
    if (opts.baseline !== undefined) {
      opt.series[0].markLine = {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', color: UDISE.purple, width: 1.5 },
        label: {
          formatter: `${opts.baselineLabel ?? 'Average'}: ${opts.baseline}${suffix}`,
          fontSize: 10, color: UDISE.purple, position: 'insideEndTop',
        },
        data: [{ xAxis: opts.baseline }],
      };
    }
    return opt;
  }

  /**
   * Class-wise academic bars with the State average drawn as a reference line,
   * using the app's standard markLine treatment.
   */
  reviewClassBar(
    rows: { name: string; value: number; board?: boolean }[],
    stateAvg: number,
    periodLabel: string,
    meta?: { id: string; title: string },
  ): any {
    return {
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const row = rows[ps[0].dataIndex];
          const diff = Math.round((row.value - stateAvg) * 10) / 10;
          return `<b>${ps[0].axisValue}</b><br/>${periodLabel} average: ${row.value}`
            + `<br/>State average: ${stateAvg}`
            + `<br/>Difference: ${diff > 0 ? '+' : ''}${diff} pt`
            + (row.board ? '<br/><i>Board exam (Annual only)</i>' : '');
        },
      },
      grid: { left: 60, right: 30, top: 34, bottom: 44 },
      xAxis: [{
        type: 'category',
        data: rows.map((r) => r.name),
        axisLabel: { fontSize: 10, interval: 0 },
      }],
      yAxis: [{
        type: 'value', name: 'Average mark',
        nameLocation: 'middle', nameGap: 40, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        scale: true, axisLabel: { fontSize: 10 },
      }],
      series: [{
        type: 'bar',
        data: rows.map((r) => ({
          value: r.value,
          itemStyle: {
            color: r.value < stateAvg ? UDISE.maroon : UDISE.blue,
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barMaxWidth: 46,
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 600 },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: UDISE.purple, width: 1.5 },
          label: {
            formatter: `State avg: ${stateAvg}`,
            fontSize: 10, color: UDISE.purple, position: 'insideEndTop',
          },
          data: [{ yAxis: stateAvg }],
        },
      }],
    };
  }

  /** Vertical column bar for the module breakdowns (class-wise, ageing). */
  reviewColumnBar(
    rows: { name: string; value: number }[],
    metricLabel: string,
    meta?: { id: string; title: string },
  ): any {
    return {
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => inr(v) },
      grid: { left: 70, right: 26, top: 32, bottom: 58 },
      xAxis: [{
        type: 'category',
        data: rows.map((r) => r.name),
        axisLabel: { fontSize: 10, interval: 0, rotate: rows.length > 6 ? 22 : 0 },
      }],
      yAxis: [{
        type: 'value', name: metricLabel,
        nameLocation: 'middle', nameGap: 52, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: [{
        type: 'bar',
        data: rows.map((r, i) => ({
          value: r.value,
          itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length], borderRadius: [4, 4, 0, 0] },
        })),
        barMaxWidth: 46,
        label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => inrAxis(p.value) },
      }],
    };
  }

  /** Grouped columns comparing two or more series across the same categories. */
  reviewGroupedBar(
    categories: string[],
    series: { name: string; values: number[] }[],
    metricLabel: string,
    meta?: { id: string; title: string },
  ): any {
    const colours = [UDISE.blue, UDISE.teal, UDISE.yellow, UDISE.orange];
    return {
      color: colours,
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => inr(v) },
      legend: { top: 0, right: 8, itemWidth: 12, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 26, top: 36, bottom: 44 },
      xAxis: [{ type: 'category', data: categories, axisLabel: { fontSize: 10, interval: 0 } }],
      yAxis: [{
        type: 'value', name: metricLabel,
        nameLocation: 'middle', nameGap: 52, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: series.map((s, i) => ({
        name: s.name, type: 'bar', data: s.values,
        itemStyle: { color: colours[i % colours.length], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 26,
        label: { show: true, position: 'top', fontSize: 9, formatter: (p: any) => inrAxis(p.value) },
      })),
    };
  }

  /** Grievance split as a single stacked bar (resolved / open / critical). */
  reviewStackBar(
    parts: { name: string; value: number; color: string }[],
    meta?: { id: string; title: string },
  ): any {
    return {
      toolbox: this.toolbox([], meta),
      tooltip: { trigger: 'item', formatter: (p: any) => `<b>${p.seriesName}</b><br/>${inr(p.value)}` },
      legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 20, right: 24, top: 30, bottom: 46, containLabel: true },
      xAxis: [{ type: 'value', axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 } }],
      yAxis: [{ type: 'category', data: ['Cases'], axisLabel: { fontSize: 11 } }],
      series: parts.map((p) => ({
        name: p.name, type: 'bar', stack: 'total',
        data: [p.value],
        itemStyle: { color: p.color },
        barMaxWidth: 46,
        label: { show: true, fontSize: 10, formatter: (x: any) => (x.value ? inrAxis(x.value) : '') },
      })),
    };
  }

  // ===================== ACADEMIC SCORES =====================

  /** Subject radar: current scope against the state average. */
  subjectRadar(subjects: any[], stateSubjects: any[], scopeLabel: string, meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.blue, '#c9ced6'],
      toolbox: this.toolbox([], meta),
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      radar: {
        indicator: subjects.map((s) => ({ name: s.name, max: 100 })),
        radius: '66%',
        center: ['50%', '47%'],
        splitNumber: 4,
        axisName: { fontSize: 11, color: '#40506a', fontWeight: 600 },
        splitArea: { areaStyle: { color: ['#fbfcfe', '#f2f6fb'] } },
        splitLine: { lineStyle: { color: '#dde5ef' } },
        axisLine: { lineStyle: { color: '#dde5ef' } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: subjects.map((s) => s.avg),
              name: scopeLabel,
              areaStyle: { color: 'rgba(47,109,176,0.28)' },
              lineStyle: { width: 2.5 },
              symbolSize: 6,
            },
            {
              value: stateSubjects.map((s) => s.avg),
              name: 'Tamil Nadu average',
              areaStyle: { color: 'rgba(160,170,185,0.18)' },
              lineStyle: { width: 2, type: 'dashed' },
              symbolSize: 4,
            },
          ],
        },
      ],
    };
  }

  /** Grade-band distribution per subject (stacked, 100% share). */
  gradeBandStack(subjects: any[], meta?: { id: string; title: string }): any {
    const bands = [
      { key: 'below35', name: 'Below 35', color: '#c0392b' },
      { key: 'b35_60', name: '35 - 60', color: '#e8973a' },
      { key: 'b61_80', name: '61 - 80', color: '#7cb342' },
      { key: 'above80', name: 'Above 80', color: '#2f7d32' },
    ];
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const tot = ps.reduce((s, p) => s + (p.value ?? 0), 0) || 1;
          let out = `<b>${ps[0].axisValue}</b>`;
          for (const p of ps) {
            out += `<br/>${p.marker} ${p.seriesName}: ${inr(p.value)} (${((p.value / tot) * 100).toFixed(1)}%)`;
          }
          return out;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 80, right: 28, top: 62, bottom: 44 },
      xAxis: [{ type: 'category', data: subjects.map((s) => s.name), axisLabel: { fontSize: 11 } }],
      yAxis: [{
        type: 'value', name: 'Students',
        nameLocation: 'middle', nameGap: 62, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: bands.map((b) => ({
        name: b.name, type: 'bar', stack: 'g',
        data: subjects.map((s) => s[b.key] ?? 0),
        itemStyle: { color: b.color },
        barMaxWidth: 46,
      })),
    };
  }

  /** Subject x district heatmap of average marks. */
  subjectHeatmap(
    districts: string[], subjects: string[], cells: [number, number, number][],
    meta?: { id: string; title: string },
  ): any {
    const vals = cells.map((c) => c[2]).filter((v) => v > 0);
    const min = vals.length ? Math.floor(Math.min(...vals)) : 0;
    const max = vals.length ? Math.ceil(Math.max(...vals)) : 100;
    return {
      toolbox: this.toolbox([], meta),
      tooltip: {
        position: 'top',
        formatter: (p: any) =>
          `<b>${districts[p.value[1]]}</b><br/>${subjects[p.value[0]]}: <b>${p.value[2]}</b> avg mark`,
      },
      grid: { left: 150, right: 24, top: 40, bottom: 66 },
      xAxis: {
        type: 'category', data: subjects, position: 'top',
        splitArea: { show: true }, axisLabel: { fontSize: 11, fontWeight: 600 },
      },
      yAxis: {
        type: 'category', data: districts,
        splitArea: { show: true }, axisLabel: { fontSize: 9.5, width: 140, overflow: 'truncate' },
      },
      visualMap: {
        min, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 12,
        itemWidth: 14, itemHeight: 140, precision: 0,
        inRange: { color: ['#c0392b', '#e8973a', '#f5d76e', '#9ccc65', '#2f7d32'] },
        textStyle: { fontSize: 10 },
      },
      series: [
        {
          type: 'heatmap', data: cells,
          label: { show: true, fontSize: 9, formatter: (p: any) => p.value[2] },
          itemStyle: { borderColor: '#fff', borderWidth: 1 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.4)' } },
        },
      ],
    };
  }

  /**
   * Risk quadrant: two percentage measures plotted against each other with
   * reference lines, so the bottom-left quadrant isolates the worst cases.
   * Axis labels are supplied by the caller (academic and attendance differ).
   */
  riskQuadrant(
    points: { name: string; key: string; x: number; y: number; size: number }[],
    xRef: number, yRef: number,
    meta?: { id: string; title: string },
    xName = 'Data Compliance %',
    yName = 'Pass %',
    sizeName = 'Students',
  ): any {
    const maxSize = points.reduce((m, p) => Math.max(m, p.size), 0) || 1;
    return {
      toolbox: this.toolbox([], meta),
      tooltip: {
        formatter: (p: any) =>
          `<b>${p.data.name}</b><br/>${xName}: ${p.data.value[0]}%<br/>${yName}: ${p.data.value[1]}%<br/>${sizeName}: ${inr(p.data.size)}`,
      },
      grid: { left: 76, right: 34, top: 40, bottom: 56 },
      xAxis: {
        type: 'value', name: xName, scale: true,
        nameLocation: 'middle', nameGap: 30, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 },
        splitLine: { lineStyle: { type: 'dashed', color: '#eef2f7' } },
      },
      yAxis: {
        type: 'value', name: yName, scale: true,
        nameLocation: 'middle', nameGap: 52, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 },
        splitLine: { lineStyle: { type: 'dashed', color: '#eef2f7' } },
      },
      series: [
        {
          type: 'scatter',
          data: points.map((p) => ({
            name: p.name, key: p.key, size: p.size, value: [p.x, p.y],
            itemStyle: {
              color: p.x < xRef && p.y < yRef ? '#c0392b'
                : p.y < yRef ? '#e8973a'
                : p.x < xRef ? '#7c5cbf'
                : UDISE.green,
              opacity: 0.85, borderColor: '#fff', borderWidth: 1,
            },
          })),
          symbolSize: (v: any, p: any) => 10 + Math.sqrt((p?.data?.size ?? 0) / maxSize) * 26,
          label: {
            show: true, position: 'right', fontSize: 8.5, color: '#556',
            formatter: (p: any) => p.data.name,
          },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#94a3b8', width: 1.2 },
            label: { fontSize: 9, color: '#64748b' },
            data: [
              { xAxis: xRef, label: { formatter: `State ${xName.replace(' %', '')}` } },
              { yAxis: yRef, label: { formatter: `State ${yName.replace(' %', '')}` } },
            ],
          },
        },
      ],
    };
  }

  /** Exam-type progression: Quarterly -> Half Yearly -> Annual. */
  examProgression(byExam: any[], order: string[], meta?: { id: string; title: string }): any {
    const rows = order.map((n) => byExam.find((x) => x.name === n)).filter(Boolean) as any[];
    return {
      color: [UDISE.blue, UDISE.green, UDISE.orange],
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 60, top: 62, bottom: 44 },
      xAxis: [{ type: 'category', data: rows.map((r) => r.name), axisLabel: { fontSize: 11 } }],
      yAxis: [
        { type: 'value', name: 'Marks / %', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10 }, max: 100 },
      ],
      series: [
        { name: 'Average Mark', type: 'bar', data: rows.map((r) => r.avg), barMaxWidth: 40, label: { show: true, position: 'top', fontSize: 10 } },
        { name: 'Pass %', type: 'line', data: rows.map((r) => r.pass), smooth: true, symbol: 'circle', symbolSize: 8, lineStyle: { width: 3 } },
        { name: 'Compliance %', type: 'line', data: rows.map((r) => r.compliance), smooth: true, symbol: 'diamond', symbolSize: 8, lineStyle: { width: 2, type: 'dashed' } },
      ],
    };
  }

  /** Class-wise performance bar (board classes highlighted). */
  classPerformance(byClass: any[], boardClasses: number[], meta?: { id: string; title: string }): any {
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const cls = ps[0].axisValue;
          const board = boardClasses.includes(+cls);
          let out = `<b>Class ${cls}</b>${board ? ' <i>(Board exam)</i>' : ''}`;
          for (const p of ps) out += `<br/>${p.marker} ${p.seriesName}: ${p.value}`;
          return out;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 30, top: 62, bottom: 48 },
      xAxis: [{
        type: 'category', data: byClass.map((c) => c.name),
        name: 'Class', nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { fontSize: 11 },
      }],
      yAxis: [{ type: 'value', name: 'Marks / %', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10 }, max: 100 }],
      series: [
        {
          name: 'Average Mark', type: 'bar', barMaxWidth: 34,
          data: byClass.map((c) => ({
            value: c.avg,
            itemStyle: {
              color: boardClasses.includes(+c.name) ? UDISE.maroon : UDISE.blue,
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
        {
          name: 'Pass %', type: 'line', data: byClass.map((c) => c.pass),
          smooth: true, symbol: 'circle', symbolSize: 7, itemStyle: { color: UDISE.green }, lineStyle: { width: 2.5 },
        },
      ],
    };
  }

  /** Academic trend: three metrics over the selected years. */
  academicTrend(years: string[], avg: number[], pass: number[], comp: number[], meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.blue, UDISE.green, UDISE.orange],
      toolbox: this.toolbox(['line', 'bar'], meta),
      tooltip: { trigger: 'axis' },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 34, top: 62, bottom: 44 },
      xAxis: [{ type: 'category', boundaryGap: false, data: years, axisLabel: { fontSize: 11 } }],
      yAxis: [{ type: 'value', name: 'Marks / %', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10 }, scale: true }],
      series: [
        { name: 'Average Mark', type: 'line', data: avg, smooth: true, symbol: 'circle', symbolSize: 8, lineStyle: { width: 3 }, label: { show: true, position: 'top', fontSize: 10 } },
        { name: 'Pass %', type: 'line', data: pass, smooth: true, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2.5 } },
        { name: 'Compliance %', type: 'line', data: comp, smooth: true, symbol: 'diamond', symbolSize: 8, lineStyle: { width: 2, type: 'dashed' } },
      ],
    };
  }

  /**
   * Academic/attendance comparison: ranked bars with a state reference line.
   * `lowerIsBetter` inverts the colour scale for metrics such as dropout risk,
   * where a HIGH value is bad (red) and a LOW value is good (green).
   */
  academicCompare(
    rows: any[], metric: string, metricLabel: string, suffix: string,
    baseline: number, meta?: { id: string; title: string },
    lowerIsBetter = false,
  ): any {
    const asc = [...rows].sort((a, b) => (a[metric] ?? 0) - (b[metric] ?? 0));
    const good = '#2f7d32';
    const bad = '#c0392b';
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => (ps?.length ? `<b>${ps[0].axisValue}</b><br/>${metricLabel}: ${ps[0].value}${suffix}` : ''),
      },
      grid: { left: 150, right: 76, top: 30, bottom: 44 },
      xAxis: [{
        type: 'value', name: metricLabel + (suffix ? ' (' + suffix + ')' : ''),
        nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { fontSize: 10 },
      }],
      yAxis: [{
        type: 'category', data: asc.map((r) => r.name),
        axisLabel: { fontSize: 9.5, width: 140, overflow: 'truncate' },
      }],
      series: [
        {
          type: 'bar', barMaxWidth: 15,
          data: asc.map((r) => {
            const v = r[metric] ?? 0;
            // for "lower is better" metrics a value above the baseline is bad
            const isGood = lowerIsBetter ? v <= baseline : v >= baseline;
            return {
              value: v,
              itemStyle: { color: isGood ? good : bad, borderRadius: [0, 4, 4, 0] },
            };
          }),
          label: { show: true, position: 'right', fontSize: 9, formatter: (p: any) => p.value + suffix },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#1b3a7a', width: 1.5 },
            label: { formatter: `State: ${baseline}${suffix}`, fontSize: 10, color: '#1b3a7a', position: 'insideEndTop' },
            data: [{ xAxis: baseline }],
          },
        },
      ],
      _names: asc.map((r) => r.key),
    };
  }

  /**
   * Head-to-head comparison of two exam sittings: grouped bars per subject
   * plus a delta line showing where the gap is widest.
   */
  examHeadToHead(
    subjects: { name: string; aAvg: number; bAvg: number; avgDiff: number }[],
    labelA: string, labelB: string,
    meta?: { id: string; title: string },
  ): any {
    return {
      color: [UDISE.blue, UDISE.green, UDISE.orange],
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          let out = `<b>${ps[0].axisValue}</b>`;
          for (const p of ps) {
            const v = p.seriesName === 'Difference' ? (p.value > 0 ? '+' + p.value : p.value) : p.value;
            out += `<br/>${p.marker} ${p.seriesName}: ${v}`;
          }
          return out;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 66, top: 62, bottom: 46 },
      xAxis: [{ type: 'category', data: subjects.map((s) => s.name), axisLabel: { fontSize: 11 } }],
      yAxis: [
        {
          type: 'value', name: 'Average Mark',
          nameLocation: 'middle', nameGap: 48, nameRotate: 90,
          nameTextStyle: { fontSize: 11, fontWeight: 600 },
          axisLabel: { fontSize: 10 }, max: 100,
        },
        {
          type: 'value', name: 'Difference',
          nameTextStyle: { fontSize: 11, fontWeight: 600 },
          axisLabel: { fontSize: 10, formatter: (v: number) => (v > 0 ? '+' + v : v) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: labelA, type: 'bar', data: subjects.map((s) => s.aAvg), barMaxWidth: 26,
          itemStyle: { color: UDISE.blue, borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', fontSize: 9 },
        },
        {
          name: labelB, type: 'bar', data: subjects.map((s) => s.bAvg), barMaxWidth: 26,
          itemStyle: { color: UDISE.green, borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', fontSize: 9 },
        },
        {
          name: 'Difference', type: 'line', yAxisIndex: 1,
          data: subjects.map((s) => s.avgDiff),
          smooth: true, symbol: 'circle', symbolSize: 8,
          itemStyle: { color: UDISE.orange }, lineStyle: { width: 2.5, type: 'dashed' },
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dotted', color: '#94a3b8' },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }

  /**
   * Exam sittings: one bar per (exam type + class). Board sittings
   * (class 10 & 12 Annual) are coloured differently since they are
   * externally examined rather than EMIS-entered.
   */
  examSittingCompare(rows: any[], meta?: { id: string; title: string }): any {
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = rows[ps[0].dataIndex];
          let out = `<b>${r.label}</b>${r.board ? ' <i>(Board exam)</i>' : ' <i>(EMIS entry)</i>'}`;
          for (const p of ps) out += `<br/>${p.marker} ${p.seriesName}: ${p.value}`;
          out += `<br/>Students entered: ${inr(r.updated)}`;
          return out;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 30, top: 62, bottom: 104 },
      xAxis: [{
        type: 'category',
        data: rows.map((r) => r.label),
        axisLabel: { fontSize: 9, interval: 0, rotate: 40 },
      }],
      yAxis: [{
        type: 'value', name: 'Marks / %',
        nameLocation: 'middle', nameGap: 48, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { fontSize: 10 }, max: 100,
      }],
      series: [
        {
          name: 'Average Mark', type: 'bar', barMaxWidth: 26,
          data: rows.map((r) => ({
            value: r.avg,
            itemStyle: { color: r.board ? UDISE.maroon : UDISE.blue, borderRadius: [3, 3, 0, 0] },
          })),
          label: { show: true, position: 'top', fontSize: 9 },
        },
        {
          name: 'Pass %', type: 'line', data: rows.map((r) => r.pass),
          smooth: true, symbol: 'circle', symbolSize: 6,
          itemStyle: { color: UDISE.green }, lineStyle: { width: 2 },
        },
      ],
    };
  }

  /** Exam x subject grouped bars: one series per exam across the core subjects. */
  examSubjectCompare(
    subjects: string[],
    rows: { exam: string; values: number[] }[],
    meta?: { id: string; title: string },
  ): any {
    const colors = [UDISE.blue, UDISE.green, UDISE.orange];
    return {
      color: colors,
      toolbox: this.toolbox(['bar'], meta),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 30, top: 62, bottom: 46 },
      xAxis: [{ type: 'category', data: subjects, axisLabel: { fontSize: 11 } }],
      yAxis: [{
        type: 'value', name: 'Average Mark',
        nameLocation: 'middle', nameGap: 48, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { fontSize: 10 }, max: 100,
      }],
      series: rows.map((r, i) => ({
        name: r.exam, type: 'bar', data: r.values, barMaxWidth: 26,
        itemStyle: { color: colors[i % colors.length], borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', fontSize: 9 },
      })),
    };
  }

  /**
   * Exam improvement ranking: Quarterly vs Annual per district with the gain.
   * Clicking a bar drills into that district.
   */
  examGainCompare(
    rows: { key: string; name: string; quarterly: number; annual: number; gain: number }[],
    firstLabel: string, lastLabel: string,
    meta?: { id: string; title: string },
  ): any {
    const asc = [...rows].reverse();
    return {
      color: [UDISE.blue, UDISE.green, UDISE.orange],
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          let out = `<b>${ps[0].axisValue}</b>`;
          for (const p of ps) out += `<br/>${p.marker} ${p.seriesName}: ${p.value}`;
          return out;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 150, right: 60, top: 62, bottom: 46 },
      xAxis: [{ type: 'value', name: 'Average Mark', nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 }, axisLabel: { fontSize: 10 } }],
      yAxis: [{ type: 'category', data: asc.map((r) => r.name), axisLabel: { fontSize: 9.5, width: 140, overflow: 'truncate' } }],
      series: [
        { name: firstLabel, type: 'bar', data: asc.map((r) => r.quarterly), barMaxWidth: 9, itemStyle: { color: UDISE.blue } },
        { name: lastLabel, type: 'bar', data: asc.map((r) => r.annual), barMaxWidth: 9, itemStyle: { color: UDISE.green } },
        {
          name: 'Gain', type: 'line', symbol: 'circle', symbolSize: 6,
          data: asc.map((r) => r.gain), itemStyle: { color: UDISE.orange }, lineStyle: { width: 0 },
          label: { show: true, position: 'right', fontSize: 9, formatter: (p: any) => (p.value > 0 ? '+' : '') + p.value },
        },
      ],
      _names: asc.map((r) => r.key),
    };
  }

  /** Higher-secondary stream comparison. */
  streamCompare(streams: any[], meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.purple, UDISE.green],
      toolbox: this.toolbox(['bar'], meta),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 70, right: 30, top: 62, bottom: 60 },
      xAxis: [{ type: 'category', data: streams.map((s) => s.name), axisLabel: { fontSize: 10, interval: 0, rotate: 16 } }],
      yAxis: [{ type: 'value', name: 'Marks / %', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10 }, max: 100 }],
      series: [
        { name: 'Average Mark', type: 'bar', data: streams.map((s) => s.avg), barMaxWidth: 40, label: { show: true, position: 'top', fontSize: 10 } },
        { name: 'Pass %', type: 'line', data: streams.map((s) => s.pass), smooth: true, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2.5 } },
      ],
    };
  }

  // ===================== ATTENDANCE =====================

  /** Daily attendance / compliance / teacher trend over the selected window. */
  attendanceDaily(days: any[], meta?: { id: string; title: string }): any {
    const labels = days.map((d) => (d.date ?? '').slice(5));  // MM-DD
    return {
      color: [UDISE.blue, UDISE.orange, UDISE.green],
      toolbox: this.toolbox(['line', 'bar'], meta),
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const i = ps[0].dataIndex;
          let out = `<b>${days[i]?.date ?? ''}</b>`;
          for (const p of ps) out += `<br/>${p.marker} ${p.seriesName}: ${p.value}%`;
          out += `<br/>Absentees: ${inr(days[i]?.absentees ?? 0)}`;
          return out;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 66, right: 30, top: 62, bottom: 58 },
      xAxis: [{ type: 'category', boundaryGap: false, data: labels, axisLabel: { fontSize: 9, rotate: 40 } }],
      yAxis: [{
        type: 'value', name: 'Percent',
        nameLocation: 'middle', nameGap: 46, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 }, scale: true,
      }],
      series: [
        {
          name: 'Student Attendance', type: 'line', data: days.map((d) => d.attendance),
          smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 3 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(47,109,176,0.30)' },
                { offset: 1, color: 'rgba(47,109,176,0.02)' },
              ],
            },
          },
        },
        {
          name: 'Marking Compliance', type: 'line', data: days.map((d) => d.compliance),
          smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2, type: 'dashed' },
        },
        {
          name: 'Teacher Attendance', type: 'line', data: days.map((d) => d.teacher),
          smooth: true, symbol: 'diamond', symbolSize: 5, lineStyle: { width: 2 },
        },
      ],
    };
  }

  /** Marked vs unmarked school-days donut. */
  complianceDonut(marked: number, unmarked: number, meta?: { id: string; title: string }): any {
    return this.donut(
      'Marking Compliance',
      [
        { name: 'Marked', value: marked },
        { name: 'Unmarked', value: unmarked },
      ],
      ['#2f7d32', '#c0392b'],
      meta,
    );
  }

  /** Present vs absent donut. */
  presenceDonut(present: number, absent: number, label: string, meta?: { id: string; title: string }): any {
    return this.donut(
      label,
      [
        { name: 'Present', value: present },
        { name: 'Absent', value: absent },
      ],
      [UDISE.green, UDISE.orange],
      meta,
    );
  }

  /** Attendance and absentees across the rolling windows (3/5/7/15/30 days). */
  windowCompare(windows: any[], meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.blue, UDISE.orange],
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const i = ps[0].dataIndex;
          const w = windows[i];
          return `<b>Last ${w.days} working days</b><br/>Attendance: ${w.attendance}%`
            + `<br/>Absentee-days: ${inr(w.absentees)}`
            + `<br/>Compliance: ${w.compliance}%`
            + `<br/>Unmarked school-days: ${inr(w.unmarked)}`;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 66, right: 70, top: 62, bottom: 46 },
      xAxis: [{ type: 'category', data: windows.map((w) => `Last ${w.days}d`), axisLabel: { fontSize: 11 } }],
      yAxis: [
        { type: 'value', name: 'Percent', axisLabel: { formatter: '{value}%', fontSize: 10 }, nameTextStyle: { fontSize: 11 }, max: 100 },
        { type: 'value', name: 'Absentee-days', axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 }, nameTextStyle: { fontSize: 11 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Attendance %', type: 'bar', data: windows.map((w) => w.attendance),
          barMaxWidth: 40, itemStyle: { color: UDISE.blue, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', fontSize: 10, formatter: '{c}%' },
        },
        {
          name: 'Absentee-days', type: 'line', yAxisIndex: 1,
          data: windows.map((w) => w.absentees), smooth: true,
          symbol: 'circle', symbolSize: 7, itemStyle: { color: UDISE.orange }, lineStyle: { width: 2.5 },
        },
      ],
    };
  }

  /** Dropout-risk ranking bars. */
  dropoutRanking(rows: any[], threshold: number, meta?: { id: string; title: string }): any {
    const asc = [...rows].reverse();
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = asc[ps[0].dataIndex];
          return `<b>${r.name}</b><br/>Risk rate: ${r.rate}%<br/>Students: ${inr(r.risk)}`
            + `<br/>Enrolled: ${inr(r.enrolled)}<br/><i>absent ${threshold}+ days</i>`;
        },
      },
      grid: { left: 150, right: 70, top: 30, bottom: 46 },
      xAxis: [{
        type: 'value', name: 'Dropout risk %',
        nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 },
      }],
      yAxis: [{ type: 'category', data: asc.map((r) => r.name), axisLabel: { fontSize: 9.5, width: 140, overflow: 'truncate' } }],
      series: [
        {
          type: 'bar', barMaxWidth: 15,
          data: asc.map((r) => ({
            value: r.rate,
            itemStyle: {
              color: r.rate > 8 ? '#c0392b' : r.rate > 5 ? '#e8973a' : UDISE.green,
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: 'right', fontSize: 9, formatter: '{c}%' },
        },
      ],
      _names: asc.map((r) => r.key),
    };
  }

  // ===================== INFRASTRUCTURE =====================

  /** Available vs required against norms, per type. */
  infraTypeOverview(rows: any[], meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.green, '#c0392b', UDISE.blue],
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = rows[ps[0].dataIndex];
          return `<b>${r.label}</b><br/>Available: ${inr(r.available)}`
            + `<br/>Required (shortfall): ${inr(r.required)}`
            + `<br/>Surplus: ${inr(r.surplus)}`
            + `<br/>Norms: ${inr(r.norms)}`
            + `<br/>Availability: ${r.availabilityPct}%`;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 78, right: 30, top: 62, bottom: 78 },
      xAxis: [{
        type: 'category', data: rows.map((r) => r.label),
        axisLabel: { fontSize: 9.5, interval: 0, rotate: 28 },
      }],
      yAxis: [{
        type: 'value', name: 'Units',
        nameLocation: 'middle', nameGap: 58, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: [
        { name: 'Available', type: 'bar', stack: 'a', data: rows.map((r) => r.available), barMaxWidth: 34 },
        { name: 'Shortfall', type: 'bar', stack: 'a', data: rows.map((r) => r.required), barMaxWidth: 34 },
      ],
    };
  }

  /** Condition split donut: good / need repair / demolish. */
  infraCondition(t: any, label: string, meta?: { id: string; title: string }): any {
    return this.donut(
      label,
      [
        { name: 'Good condition', value: t.good ?? 0 },
        { name: 'Needs repair', value: t.needRepair ?? 0 },
        { name: 'To be demolished', value: t.demolish ?? 0 },
      ].filter((x) => x.value > 0),
      ['#2f7d32', '#e8973a', '#c0392b'],
      meta,
    );
  }

  /** Availability gauge-style donut against norms. */
  infraAvailability(t: any, label: string, meta?: { id: string; title: string }): any {
    const avail = Math.min(t.available ?? 0, t.norms ?? 0);
    const short = Math.max(0, (t.norms ?? 0) - avail);
    return this.donut(
      label,
      [
        { name: 'Met', value: avail },
        { name: 'Shortfall', value: short },
      ].filter((x) => x.value > 0),
      [UDISE.blue, '#c0392b'],
      meta,
    );
  }

  /** Shortfall ranking bars. */
  infraGapRanking(rows: any[], meta?: { id: string; title: string }): any {
    const asc = [...rows].reverse();
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = asc[ps[0].dataIndex];
          return `<b>${r.name}</b><br/>Gap: ${r.gapPct}%`
            + `<br/>Shortfall: ${inr(r.required)}`
            + `<br/>Available: ${inr(r.available)} of ${inr(r.norms)} required by norms`;
        },
      },
      grid: { left: 150, right: 70, top: 30, bottom: 46 },
      xAxis: [{
        type: 'value', name: 'Shortfall gap %',
        nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 },
      }],
      yAxis: [{ type: 'category', data: asc.map((r) => r.name), axisLabel: { fontSize: 9.5, width: 140, overflow: 'truncate' } }],
      series: [
        {
          type: 'bar', barMaxWidth: 15,
          data: asc.map((r) => ({
            value: r.gapPct,
            itemStyle: {
              color: r.gapPct > 20 ? '#c0392b' : r.gapPct > 10 ? '#e8973a' : '#2f7d32',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: 'right', fontSize: 9, formatter: '{c}%' },
        },
      ],
      _names: asc.map((r) => r.key),
    };
  }

  /**
   * Monthly data-entry compliance: bars for schools submitted vs pending,
   * with a compliance % line. Highlights the selected month.
   */
  infraEntryTrend(points: any[], activePeriod: string, meta?: { id: string; title: string }): any {
    return {
      color: ['#2f7d32', '#c0392b', UDISE.blue],
      toolbox: this.toolbox(['bar', 'line'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const p0 = points[ps[0].dataIndex];
          return `<b>${p0.period}</b><br/>Submitted: ${inr(p0.entered)}`
            + `<br/>Pending: ${inr(p0.notEntered)}`
            + `<br/>Expected: ${inr(p0.expected)}`
            + `<br/>Compliance: ${p0.entryPct}%`;
        },
      },
      legend: { top: 26, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 74, right: 58, top: 62, bottom: 86 },
      xAxis: [{ type: 'category', data: points.map((p) => p.period), axisLabel: { fontSize: 9.5, rotate: 32, interval: 0 } }],
      yAxis: [
        {
          type: 'value', name: 'Schools',
          nameLocation: 'middle', nameGap: 56, nameRotate: 90,
          nameTextStyle: { fontSize: 11, fontWeight: 600 },
          axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
        },
        {
          type: 'value', name: 'Compliance %', max: 100,
          nameTextStyle: { fontSize: 11, fontWeight: 600 },
          axisLabel: { formatter: '{value}%', fontSize: 10 }, splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Submitted', type: 'bar', stack: 's', barMaxWidth: 40,
          data: points.map((p) => ({
            value: p.entered,
            // the month being viewed is drawn solid, the others muted
            itemStyle: { color: '#2f7d32', opacity: p.period === activePeriod ? 1 : 0.55 },
          })),
        },
        {
          name: 'Pending', type: 'bar', stack: 's', barMaxWidth: 40,
          data: points.map((p) => ({
            value: p.notEntered,
            itemStyle: { color: '#c0392b', opacity: p.period === activePeriod ? 1 : 0.55 },
          })),
        },
        {
          name: 'Compliance %', type: 'line', yAxisIndex: 1,
          data: points.map((p) => p.entryPct),
          smooth: true, symbol: 'circle', symbolSize: 8,
          lineStyle: { width: 3 },
          label: { show: true, position: 'top', fontSize: 10, formatter: '{c}%' },
        },
      ],
    };
  }

  /** Submitted vs pending donut for one month. */
  infraEntryDonut(entered: number, pending: number, meta?: { id: string; title: string }): any {
    return this.donut(
      'Data Entry',
      [
        { name: 'Submitted', value: entered },
        { name: 'Pending', value: pending },
      ].filter((x) => x.value > 0),
      ['#2f7d32', '#c0392b'],
      meta,
    );
  }

  /** Data-entry compliance ranking bars (worst first). */
  infraEntryRanking(rows: any[], meta?: { id: string; title: string }): any {
    const asc = [...rows].reverse();
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = asc[ps[0].dataIndex];
          return `<b>${r.name}</b><br/>Compliance: ${r.entryPct}%`
            + `<br/>Submitted: ${inr(r.entered)} of ${inr(r.expected)}`
            + `<br/>Pending: ${inr(r.notEntered)}`;
        },
      },
      grid: { left: 150, right: 70, top: 30, bottom: 46 },
      xAxis: [{
        type: 'value', name: 'Data entry compliance %', max: 100,
        nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 },
      }],
      yAxis: [{ type: 'category', data: asc.map((r) => r.name), axisLabel: { fontSize: 9.5, width: 140, overflow: 'truncate' } }],
      series: [
        {
          type: 'bar', barMaxWidth: 15,
          data: asc.map((r) => ({
            value: r.entryPct,
            itemStyle: {
              color: r.entryPct < 55 ? '#c0392b' : r.entryPct < 70 ? '#e8973a' : '#2f7d32',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: 'right', fontSize: 9, formatter: '{c}%' },
        },
      ],
      _names: asc.map((r) => r.key),
    };
  }

  /**
   * How many schools sit in each attendance band. Replaces the daily trend in
   * the Numbers view: a distribution answers "where do schools stand" whereas
   * a trend answers "how has it moved", which belongs in Trend Analysis.
   */
  attendanceBands(rows: any[], meta?: { id: string; title: string }): any {
    return {
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = rows[ps[0].dataIndex];
          return `<b>${r.label}</b><br/>Schools: ${inr(r.schools)} (${r.pct}%)`
            + `<br/>Students: ${inr(r.students)} (${r.studentPct}%)`;
        },
      },
      grid: { left: 78, right: 30, top: 28, bottom: 52 },
      xAxis: [{
        type: 'category', data: rows.map((r) => r.label),
        name: 'Attendance band', nameLocation: 'middle', nameGap: 34,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { fontSize: 10.5 },
      }],
      yAxis: [{
        type: 'value', name: 'Schools',
        nameLocation: 'middle', nameGap: 58, nameRotate: 90,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: (v: number) => inrAxis(v), fontSize: 10 },
      }],
      series: [{
        type: 'bar', barMaxWidth: 54,
        data: rows.map((r) => ({
          value: r.schools,
          itemStyle: { color: r.color, borderRadius: [4, 4, 0, 0] },
        })),
        label: {
          show: true, position: 'top', fontSize: 10, fontWeight: 600,
          formatter: (p: any) => `${inr(p.value)}\n${rows[p.dataIndex].pct}%`,
          lineHeight: 13,
        },
      }],
    };
  }

  /** Attendance metrics by school management type. */
  attendanceByMgmt(rows: any[], meta?: { id: string; title: string }): any {
    return {
      color: [UDISE.blue, '#2f7d32', '#8e44ad'],
      toolbox: this.toolbox(['bar'], meta),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: any[]) => {
          if (!ps?.length) return '';
          const r = rows[ps[0].dataIndex];
          return `<b>${r.name}</b><br/>Schools: ${inr(r.schools)}`
            + `<br/>Students: ${inr(r.enrolled)}`
            + `<br/>Attendance: ${r.attendance}%`
            + `<br/>Compliance: ${r.compliance}%`
            + `<br/>Teacher: ${r.teacherAttendance}%`
            + `<br/>Dropout risk: ${r.dropoutRate}%`;
        },
      },
      legend: { top: 0, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 26, top: 34, bottom: 44 },
      xAxis: [{ type: 'category', data: rows.map((r) => r.name), axisLabel: { fontSize: 10.5, interval: 0 } }],
      yAxis: [{
        type: 'value', name: '%', max: 100,
        nameTextStyle: { fontSize: 11, fontWeight: 600 },
        axisLabel: { formatter: '{value}%', fontSize: 10 },
      }],
      series: [
        {
          name: 'Student Attendance', type: 'bar', barMaxWidth: 26,
          data: rows.map((r) => r.attendance),
          label: { show: true, position: 'top', fontSize: 9, formatter: '{c}%' },
        },
        {
          name: 'Marking Compliance', type: 'bar', barMaxWidth: 26,
          data: rows.map((r) => r.compliance),
          label: { show: true, position: 'top', fontSize: 9, formatter: '{c}%' },
        },
        {
          name: 'Teacher Attendance', type: 'bar', barMaxWidth: 26,
          data: rows.map((r) => r.teacherAttendance),
          label: { show: true, position: 'top', fontSize: 9, formatter: '{c}%' },
        },
      ],
    };
  }

  /** TN choropleth map with district name labels, sized to fill its panel. */
  tnMap(
    mapName: string,
    series: { name: string; value: number }[],
    maxVal: number,
    metricLabel: string,
    meta?: { id: string; title: string },
    zoom = 1,
  ): any {
    return {
      toolbox: {
        show: true, itemSize: 13, itemGap: 8, right: 8, top: 0,
        feature: meta
          ? {
              myDownload: {
                show: true, title: 'Download (PDF / PNG / JPG)', icon: DOWNLOAD_ICON,
                onclick: () => this.downloadHandler?.(meta.id, meta.title),
              },
            }
          : { saveAsImage: { title: 'Download', pixelRatio: 2 } },
      },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) =>
          `<b>${this.titleCase(p.name)}</b><br/>${metricLabel}: ${
            p.value != null && !isNaN(p.value) ? inr(p.value) : 'N/A'
          }`,
      },
      // Continuous gradient bar with a draggable grabber, on a light backing panel
      // so it stays legible over the map. Keep orient VERTICAL - a horizontal orient
      // with a large itemHeight makes ECharts stretch the bar across the canvas.
      visualMap: {
        type: 'continuous',
        orient: 'vertical',
        left: 10,
        bottom: 16,
        min: 0,
        max: maxVal || 1,
        calculable: true,
        realtime: true,
        itemWidth: 13,
        itemHeight: 118,
        text: ['High', 'Low'],
        inRange: { color: ['#dff0d0', '#a5d15a', '#5fae4e', '#2f7d32', '#1b5e20'] },
        textStyle: { fontSize: 10, color: '#4b5563' },
        formatter: (v: number) => inrAxis(v),
        backgroundColor: 'rgba(255,255,255,0.9)',
        borderColor: '#dbe3ec',
        borderWidth: 1,
        padding: [8, 9, 8, 9],
      },
      series: [
        {
          name: metricLabel, type: 'map', map: mapName,
          roam: true,
          zoom,
          // Slightly inset so the map never overlaps the legend panel
          layoutCenter: ['54%', '47%'],
          layoutSize: '94%',
          // Toned-down labels: normal weight, soft slate-green, subtle white halo
          label: {
            show: true,
            fontSize: 7.5,
            color: '#6b7a71',
            fontWeight: 'normal',
            textBorderColor: 'rgba(255,255,255,0.9)',
            textBorderWidth: 2.5,
            formatter: (p: any) => this.titleCase(p.name),
          },
          emphasis: {
            label: { show: true, fontSize: 10.5, color: '#1f2937', fontWeight: 600 },
            itemStyle: { areaColor: '#ffb066' },
          },
          select: { itemStyle: { areaColor: '#ff9a3d' }, label: { show: true, color: '#1f2937' } },
          itemStyle: { borderColor: '#ffffff', borderWidth: 0.8 },
          data: series,
        },
      ],
    };
  }

  private shorten(s: string): string {
    return s
      .replace(' School', '')
      .replace('School Education Department', 'Govt (SED)')
      .replace('Unaided (Private)', 'Private')
      .replace('Partially Aided', 'Part. Aided');
  }
  private titleCase(s: string): string {
    return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
