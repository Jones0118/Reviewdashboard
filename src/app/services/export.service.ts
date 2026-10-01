import { Injectable } from '@angular/core';
import { inr } from '../utils/format';

/** A column definition for table export. */
export interface ExportColumn {
  header: string;
  field: string;
  /** 'number' applies Indian grouping; 'percent' appends %; default is raw text. */
  type?: 'text' | 'number' | 'percent';
}

export interface ExportRequest {
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: any[];
}

/**
 * Exports the COMPLETE dataset behind a table (not just the visible page)
 * to Excel, CSV or PDF.
 *
 * Excel output uses SpreadsheetML markup with an .xls extension, which Excel
 * opens natively. This avoids adding a spreadsheet library to the project.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private cell(row: any, col: ExportColumn): string {
    const raw = row?.[col.field];
    if (raw === null || raw === undefined || raw === '') return '';
    if (col.type === 'number') return inr(Number(raw));
    if (col.type === 'percent') return `${raw}%`;
    return String(raw);
  }

  /** Raw value for Excel, so numbers stay sortable in the spreadsheet. */
  private rawCell(row: any, col: ExportColumn): { value: string; numeric: boolean } {
    const raw = row?.[col.field];
    if (raw === null || raw === undefined || raw === '') return { value: '', numeric: false };
    if (col.type === 'number' || col.type === 'percent') {
      const n = Number(raw);
      if (isFinite(n)) return { value: String(n), numeric: true };
    }
    return { value: String(raw), numeric: false };
  }

  private slug(s: string): string {
    return (s || 'table')
      .replace(/[—–]/g, '-')
      .replace(/[^\w\s()-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120);
  }

  private save(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Excel (.xls via SpreadsheetML) containing every row. */
  toExcel(req: ExportRequest): void {
    const { title, subtitle, columns, rows } = req;
    let body = '';
    // title rows
    body += `<Row><Cell ss:StyleID="sTitle" ss:MergeAcross="${columns.length - 1}">`
      + `<Data ss:Type="String">${this.esc(title)}</Data></Cell></Row>`;
    if (subtitle) {
      body += `<Row><Cell ss:StyleID="sSub" ss:MergeAcross="${columns.length - 1}">`
        + `<Data ss:Type="String">${this.esc(subtitle)}</Data></Cell></Row>`;
    }
    body += `<Row><Cell ss:StyleID="sSub" ss:MergeAcross="${columns.length - 1}">`
      + `<Data ss:Type="String">${this.esc(`Total rows: ${rows.length}`)}</Data></Cell></Row>`;
    body += '<Row></Row>';
    // header
    body += '<Row>';
    for (const c of columns) {
      body += `<Cell ss:StyleID="sHead"><Data ss:Type="String">${this.esc(c.header)}</Data></Cell>`;
    }
    body += '</Row>';
    // data
    for (const r of rows) {
      body += '<Row>';
      for (const c of columns) {
        const { value, numeric } = this.rawCell(r, c);
        body += `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${this.esc(value)}</Data></Cell>`;
      }
      body += '</Row>';
    }

    const xml =
      `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
      ` xmlns:o="urn:schemas-microsoft-com:office:office"\n` +
      ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n` +
      ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
      `<Styles>\n` +
      `<Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="13" ss:Color="#1B3A7A"/></Style>\n` +
      `<Style ss:ID="sSub"><Font ss:Size="10" ss:Color="#666666"/></Style>\n` +
      `<Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/>` +
      `<Interior ss:Color="#1B3A7A" ss:Pattern="Solid"/></Style>\n` +
      `</Styles>\n` +
      `<Worksheet ss:Name="Data"><Table>${body}</Table></Worksheet>\n</Workbook>`;

    this.save(
      new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }),
      `${this.slug(title)}.xls`,
    );
  }

  /** CSV containing every row. */
  toCsv(req: ExportRequest): void {
    const { title, columns, rows } = req;
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [columns.map((c) => q(c.header)).join(',')];
    for (const r of rows) lines.push(columns.map((c) => q(this.cell(r, c))).join(','));
    // BOM so Excel reads UTF-8 correctly
    this.save(
      new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `${this.slug(title)}.csv`,
    );
  }

  /** PDF containing every row, paginated automatically. */
  async toPdf(req: ExportRequest): Promise<void> {
    const { title, subtitle, columns, rows } = req;
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = (autoTableMod as any).default ?? autoTableMod;

    // landscape when there are many columns, so nothing is squeezed
    const landscape = columns.length > 6;
    const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();

    pdf.setFontSize(13);
    pdf.setTextColor(27, 58, 122);
    pdf.text(title, 10, 12, { maxWidth: pageW - 20 });
    let y = 18;
    pdf.setFontSize(9);
    pdf.setTextColor(90);
    if (subtitle) {
      pdf.text(subtitle, 10, y, { maxWidth: pageW - 20 });
      y += 5;
    }
    pdf.text(`Total rows: ${inr(rows.length)}`, 10, y);

    autoTable(pdf, {
      startY: y + 4,
      head: [columns.map((c) => c.header)],
      body: rows.map((r) => columns.map((c) => this.cell(r, c))),
      styles: { fontSize: 7.5, cellPadding: 1.6 },
      headStyles: { fillColor: [27, 58, 122], fontSize: 8 },
      alternateRowStyles: { fillColor: [246, 249, 252] },
      columnStyles: columns.reduce((acc: any, c, i) => {
        if (c.type === 'number' || c.type === 'percent') acc[i] = { halign: 'right' };
        return acc;
      }, {}),
      didDrawPage: (data: any) => {
        const page = pdf.getNumberOfPages();
        pdf.setFontSize(8);
        pdf.setTextColor(140);
        pdf.text(
          `Page ${data.pageNumber} of ${page}`,
          pageW - 10,
          pdf.internal.pageSize.getHeight() - 6,
          { align: 'right' },
        );
      },
    });

    pdf.save(`${this.slug(title)}.pdf`);
  }
}
