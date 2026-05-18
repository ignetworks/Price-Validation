'use strict';

const chalk = require('chalk');
const Table = require('cli-table3');

const STATUS_ORDER = { 'MISMATCH': 0, 'WARNING': 1, 'NEW ITEM': 2, 'MATCH': 3 };

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function formatRate(rate, currency) {
  if (rate === null || rate === undefined) return '-';
  return `${rate.toFixed(2)} ${currency}`;
}

function formatVariance(pct) {
  if (pct === null || pct === undefined) return chalk.cyan('N/A');
  const sign = pct >= 0 ? '+' : '';
  const formatted = `${sign}${pct.toFixed(2)}%`;
  if (pct > 0) return chalk.red(formatted);
  if (pct < 0) return chalk.green(formatted);
  return formatted;
}

function colorStatus(status) {
  switch (status) {
    case 'MISMATCH': return chalk.red.bold(status);
    case 'WARNING':  return chalk.yellow(status);
    case 'NEW ITEM': return chalk.cyan(status);
    case 'MATCH':    return chalk.green(status);
    default:         return status;
  }
}

function printSummary(results) {
  const bills = new Set(results.map((r) => r.billRef)).size;
  const vocItems = results.length;
  const mismatches = results.filter((r) => r.status === 'MISMATCH').length;
  const warnings = results.filter((r) => r.status === 'WARNING').length;
  const newItems = results.filter((r) => r.status === 'NEW ITEM').length;
  const matches = results.filter((r) => r.status === 'MATCH').length;

  console.log('');
  console.log(
    '  ' +
    `Bills: ${chalk.white.bold(bills)}  |  ` +
    `VOC Items: ${chalk.white.bold(vocItems)}  |  ` +
    `${chalk.red('\u2717')} Mismatches: ${chalk.red.bold(mismatches)}  |  ` +
    `${chalk.yellow('\u26A0')} Warnings: ${chalk.yellow.bold(warnings)}  |  ` +
    `${chalk.cyan('\u2605')} New: ${chalk.cyan.bold(newItems)}  |  ` +
    `${chalk.green('\u2713')} Matches: ${chalk.green.bold(matches)}`
  );
  console.log('');
}

function printAlertsTable(results) {
  const filtered = results;

  if (filtered.length === 0) {
    console.log(chalk.green('  \u2713 All VOC item rates are consistent with prior month.'));
    return;
  }

  filtered.sort((a, b) => {
    const orderA = STATUS_ORDER[a.status] !== undefined ? STATUS_ORDER[a.status] : 99;
    const orderB = STATUS_ORDER[b.status] !== undefined ? STATUS_ORDER[b.status] : 99;
    return orderA - orderB;
  });

  const table = new Table({
    head: [
      chalk.white.bold('Status'),
      chalk.white.bold('VOC Ref'),
      chalk.white.bold('Date'),
      chalk.white.bold('Vendor'),
      chalk.white.bold('VOC Item'),
      chalk.white.bold('Curr Total'),
      chalk.white.bold('Prior Total'),
      chalk.white.bold('Variance %'),
    ],
    style: { head: [], border: [] },
    colWidths: [12, 20, 12, 30, 38, 14, 14, 12],
    wordWrap: true,
  });

  for (const r of filtered) {
    table.push([
      colorStatus(r.status),
      truncate(r.billRef, 18),
      r.billDate || '-',
      truncate(r.vendor, 28),
      truncate(r.vocItem, 35),
      formatRate(r.currentRate, r.currency),
      formatRate(r.priorRate, r.currency),
      formatVariance(r.variancePct),
    ]);
  }

  console.log(table.toString());
}

module.exports = { printSummary, printAlertsTable, truncate, formatRate, formatVariance };
