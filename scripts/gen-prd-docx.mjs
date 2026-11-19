// One-off generator: At-a-Glance-Requirements.md -> At-a-Glance-Requirements.docx
// Parses the markdown structurally (headings, tables, paragraphs, bullet/numbered
// rules) and builds a Word document with matching structure using the `docx`
// package. Run with: node scripts/gen-prd-docx.mjs
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType,
} from 'docx';

const SRC = 'At-a-Glance-Requirements.md';
const OUT = 'At-a-Glance-Requirements.docx';
const md = fs.readFileSync(SRC, 'utf8');
const lines = md.split(/\r?\n/);

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function inlineRuns(text) {
  // Bold **...**, keep everything else literal (good enough for this doc's prose).
  const runs = [];
  let rest = text;
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    runs.push(new TextRun({ text: m[1], bold: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun(text)];
}

function mdTableToDocxTable(rows) {
  // rows: array of arrays of cell-text (first row = header)
  const header = rows[0];
  const body = rows.slice(2); // skip the |---|---| separator row
  const makeRow = (cells, isHeader) => new TableRow({
    tableHeader: isHeader,
    children: cells.map((c) => new TableCell({
      borders,
      shading: isHeader ? { type: ShadingType.CLEAR, fill: '1F4E79' } : undefined,
      width: { size: Math.floor(100 / cells.length), type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: inlineRuns(c.trim()).map((r) => isHeader
        ? new TextRun({ ...r, bold: true, color: 'FFFFFF' }) : r) })],
    })),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [makeRow(header, true), ...body.map((r) => makeRow(r, false))],
  });
}

function splitTableRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|');
}

const children = [];
let i = 0;
let inCodeBlock = false;

while (i < lines.length) {
  const line = lines[i];

  if (/^```/.test(line)) { inCodeBlock = !inCodeBlock; i++; continue; }
  if (inCodeBlock) {
    children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18 })] }));
    i++; continue;
  }
  if (!line.trim()) { i++; continue; }
  if (/^---+$/.test(line.trim())) { i++; continue; }
  if (/^\*This document/.test(line.trim())) {
    children.push(new Paragraph({ children: [new TextRun({ text: line.replace(/^\*|\*$/g, ''), italics: true, color: '666666' })], spacing: { before: 200 } }));
    i++; continue;
  }

  // Title
  if (/^# /.test(line)) {
    children.push(new Paragraph({ text: line.replace(/^# /, ''), heading: HeadingLevel.TITLE }));
    i++; continue;
  }
  if (/^## /.test(line)) {
    children.push(new Paragraph({ text: line.replace(/^## /, ''), heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }));
    i++; continue;
  }
  if (/^### /.test(line)) {
    children.push(new Paragraph({ text: line.replace(/^### /, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    i++; continue;
  }

  // Markdown table block
  if (/^\|/.test(line.trim())) {
    const tblLines = [];
    while (i < lines.length && /^\|/.test(lines[i].trim())) { tblLines.push(splitTableRow(lines[i].trim())); i++; }
    children.push(mdTableToDocxTable(tblLines));
    children.push(new Paragraph({ text: '' }));
    continue;
  }

  // Code-fenced ASCII tree (``` already handled above); plain numbered/bulleted lists
  const bulletMatch = /^- (.*)$/.exec(line.trim());
  const numMatch = /^(\d+)\. (.*)$/.exec(line.trim());
  if (bulletMatch) {
    children.push(new Paragraph({ children: inlineRuns(bulletMatch[1]), bullet: { level: 0 } }));
    i++; continue;
  }
  if (numMatch) {
    children.push(new Paragraph({ children: inlineRuns(numMatch[2]), numbering: { reference: 'prd-num', level: 0 } }));
    i++; continue;
  }

  // Default paragraph
  children.push(new Paragraph({ children: inlineRuns(line) }));
  i++;
}

const doc = new Document({
  numbering: { config: [{ reference: 'prd-num', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] },
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
  },
  sections: [{ properties: {}, children }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log('wrote', OUT, buf.length, 'bytes');
