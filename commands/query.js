'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { getVocsByDate, isDemoMode, closePool } = require('../services/netsuite');
const { analyzeBills } = require('../services/analysis');
const { printSummary, printAlertsTable } = require('../utils/format');
const { generatePdfReport } = require('../utils/report');

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getDatesInRange(from, to) {
  const dates = [];
  const current = new Date(from);
  const end = new Date(to);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

module.exports = async function query(opts) {
  if (isDemoMode()) {
    console.log(chalk.yellow.bold('\n  \u26A1 DEMO MODE \u2014 no credentials configured, using mock data\n'));
  }

  let dates = [];

  if (opts.today) {
    dates = [todayDate()];
  } else if (opts.date) {
    dates = [opts.date];
  } else if (opts.from && opts.to) {
    dates = getDatesInRange(opts.from, opts.to);
  } else {
    console.error(chalk.red('  Error: Provide --date, --today, or --from/--to range.'));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  VOC Alert \u2014 Query Mode`));
  console.log(chalk.dim(`  Date(s): ${dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`}`));
  console.log('');

  let allResults = [];
  let totalBills = 0;

  try {
    for (const date of dates) {
      if (dates.length > 1) {
        console.log(chalk.dim(`  \u2500\u2500 ${date} \u2500\u2500`));
      }

      const vocs = await getVocsByDate(date);
      totalBills += vocs.length;

      if (vocs.length === 0) {
        console.log('  No VOCs found for this date.');
        continue;
      }

      const results = await analyzeBills(vocs);
      allResults = allResults.concat(results);
    }

    if (allResults.length > 0) {
      printSummary(allResults);
      printAlertsTable(allResults);
    } else {
      console.log(chalk.yellow('\n  No VOCs found for the specified date(s).\n'));
    }

    const alertCount = allResults.filter((r) => r.status !== 'MATCH').length;
    console.log(chalk.dim(`\n  Analysis complete. ${totalBills} VOC(s) processed, ${alertCount} alert(s).\n`));

    if (opts.export && allResults.length > 0) {
      const dateLabel = dates.length === 1 ? dates[0] : `${dates[0]}_to_${dates[dates.length - 1]}`;
      const filename = `voc-analysis-${dateLabel}.json`;
      const filepath = path.join(process.cwd(), filename);
      fs.writeFileSync(filepath, JSON.stringify(allResults, null, 2), 'utf-8');
      console.log(chalk.green(`  Exported to ${filename}\n`));
    }

    if (opts.report && allResults.length > 0) {
      console.log(chalk.dim('  Generating PDF report...'));
      const filename = await generatePdfReport(allResults, dates);
      console.log(chalk.green(`  Report saved to ${filename}\n`));
    }
  } catch (err) {
    process.stderr.write(chalk.red(`  Error: ${err.message}\n`));
    process.exit(1);
  } finally {
    await closePool();
  }
};
