'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');

const STATUS_COLOR = {
  'MISMATCH': '#c0392b',
  'WARNING':  '#d35400',
  'NEW ITEM': '#2980b9',
  'MATCH':    '#27ae60',
};

// Column widths for landscape A4 (usable width ~780)
const COLS = [
  { label: 'Status',    width: 68  },
  { label: 'VOC Ref',   width: 80  },
  { label: 'Date',      width: 58  },
  { label: 'Vendor',    width: 130 },
  { label: 'VOC Item',  width: 165 },
  { label: 'Curr MRC',  width: 72  },
  { label: 'Prior MRC', width: 72  },
  { label: 'Variance',  width: 68  },
];

const TABLE_WIDTH = COLS.reduce((s, c) => s + c.width, 0);
const MARGIN      = 28;
const ROW_H       = 18;
const HEADER_H    = 22;
const PAGE_BOTTOM = 555; // A4 landscape usable height

function trunc(str, max) {
  if (str == null) return '-';
  const s = String(str);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function drawTableHeader(doc, y) {
  doc.rect(MARGIN, y, TABLE_WIDTH, HEADER_H).fill('#2c3e50');
  let x = MARGIN;
  COLS.forEach(col => {
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#ffffff')
       .text(col.label, x + 3, y + 7, { width: col.width - 6, lineBreak: false });
    x += col.width;
  });
  return y + HEADER_H;
}

function drawRow(doc, row, y, even) {
  // Row background
  doc.rect(MARGIN, y, TABLE_WIDTH, ROW_H).fill(even ? '#f4f6f7' : '#ffffff');

  // Status cell
  const sc = STATUS_COLOR[row.status] || '#555555';
  doc.rect(MARGIN, y, COLS[0].width, ROW_H).fill(sc);
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#ffffff')
     .text(row.status, MARGIN + 3, y + 5, { width: COLS[0].width - 6, lineBreak: false });

  // Data cells
  const curr  = row.currentRate != null ? `${Number(row.currentRate).toFixed(2)} ${row.currency || ''}`.trim() : '-';
  const prior = row.priorRate   != null ? `${Number(row.priorRate).toFixed(2)} ${row.currency || ''}`.trim() : '-';
  const variance = row.variancePct != null
    ? `${row.variancePct > 0 ? '+' : ''}${Number(row.variancePct).toFixed(2)}%`
    : 'N/A';

  const cells = [
    trunc(row.billRef,  14),
    trunc(row.billDate, 10),
    trunc(row.vendor,   22),
    trunc(row.vocItem,  30),
    curr,
    prior,
    variance,
  ];

  let x = MARGIN + COLS[0].width;
  cells.forEach((cell, i) => {
    const col = COLS[i + 1];
    // Color variance text
    let color = '#2c3e50';
    if (i === 6 && row.variancePct != null) {
      color = row.variancePct > 3 ? '#c0392b' : row.variancePct < -3 ? '#c0392b' : '#27ae60';
    }
    doc.fontSize(6.5).font('Helvetica').fillColor(color)
       .text(cell, x + 3, y + 5, { width: col.width - 6, lineBreak: false });
    x += col.width;
  });

  // Row border
  doc.rect(MARGIN, y, TABLE_WIDTH, ROW_H).stroke('#dce1e7');
}

async function generatePdfReport(results, dates) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });

  const dateLabel = dates.length === 1
    ? dates[0]
    : `${dates[0]} to ${dates[dates.length - 1]}`;

  const isoDate = dates[0].replace(/\//g, '-');
  const filename = `voc-report-${isoDate}.pdf`;
  const stream   = fs.createWriteStream(filename);
  doc.pipe(stream);

  // ── Summary counts ──
  const byStatus = { MISMATCH: 0, WARNING: 0, 'NEW ITEM': 0, MATCH: 0 };
  results.forEach(r => { if (byStatus[r.status] != null) byStatus[r.status]++; });
  const billCount = new Set(results.map(r => r.billId)).size;

  // ── Page 1 header ──
  doc.fontSize(15).font('Helvetica-Bold').fillColor('#2c3e50')
     .text('VOC Alert — Price Validation Report', MARGIN, MARGIN);

  doc.fontSize(9).font('Helvetica').fillColor('#7f8c8d')
     .text(`Period: ${dateLabel}   |   Generated: ${new Date().toLocaleString('pt-BR')}`, MARGIN, MARGIN + 20);

  // Summary bar
  const sumY = MARGIN + 36;
  doc.rect(MARGIN, sumY, TABLE_WIDTH, 20).fill('#ecf0f1');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#2c3e50')
     .text(
       `Bills: ${billCount}   Items: ${results.length}   ` +
       `Mismatches: ${byStatus.MISMATCH}   Warnings: ${byStatus.WARNING}   ` +
       `New: ${byStatus['NEW ITEM']}   Matches: ${byStatus.MATCH}`,
       MARGIN + 6, sumY + 6, { lineBreak: false }
     );

  // ── Table ──
  let y = sumY + 28;
  y = drawTableHeader(doc, y);

  results.forEach((row, idx) => {
    if (y + ROW_H > PAGE_BOTTOM) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }
    drawRow(doc, row, y, idx % 2 === 0);
    y += ROW_H;
  });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);
  });
}

module.exports = { generatePdfReport };
