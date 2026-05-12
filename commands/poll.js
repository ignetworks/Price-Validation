'use strict';

const chalk = require('chalk');
const { getVocsByDate, isDemoMode } = require('../services/netsuite');
const { analyzeBills } = require('../services/analysis');
const { isNew, markSeen } = require('../utils/cache');
const { printSummary, printAlertsTable } = require('../utils/format');

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function printStartup(intervalMinutes) {
  console.log('');
  console.log(chalk.bold('='.repeat(60)));
  console.log(chalk.bold('  VOC Alert — Polling Mode'));
  console.log(chalk.bold('='.repeat(60)));

  if (isDemoMode()) {
    console.log(chalk.yellow.bold('  \u26A1 DEMO MODE — no credentials configured, using mock data'));
  } else {
    const url = process.env.IGIQ_DATABASE_URL || '';
    // Mask password in connection string
    const masked = url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
    console.log(`  Database: ${masked}`);
  }

  console.log(`  Interval: every ${intervalMinutes} minute(s)`);
  console.log(chalk.bold('='.repeat(60)));
  console.log('');
}

async function pollCycle() {
  const date = todayDate();
  console.log(chalk.dim(`\u2500\u2500 Polling IGIQ @ ${now()} \u2500\u2500`));

  try {
    const vocs = await getVocsByDate(date);
    const newVocs = vocs.filter((v) => isNew(v.id));

    if (newVocs.length === 0) {
      console.log('  No new VOCs since last check.');
      return;
    }

    console.log(`  Found ${chalk.bold(newVocs.length)} new VOC(s). Analyzing...`);

    const results = await analyzeBills(newVocs);

    printSummary(results);
    printAlertsTable(results);

    const ids = newVocs.map((v) => String(v.id));
    markSeen(ids);
  } catch (err) {
    process.stderr.write(chalk.red(`  Error: ${err.message}\n`));
  }
}

module.exports = function poll(intervalMinutes) {
  printStartup(intervalMinutes);

  pollCycle().then(() => {
    setInterval(() => {
      pollCycle();
    }, intervalMinutes * 60 * 1000);
  });
};
