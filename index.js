#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { Command } = require('commander');
const program = new Command();

program
  .name('voc-alert')
  .description('Poll IGIQ for vendor order confirmations and flag VOC line MRC variances')
  .version('1.0.0');

program
  .command('poll')
  .description('Continuously poll IGIQ for new VOCs')
  .option('-i, --interval <minutes>', 'Minutes between poll cycles', parseInt)
  .action((opts) => {
    const poll = require('./commands/poll');
    const interval = opts.interval || parseInt(process.env.POLL_INTERVAL, 10) || 30;
    poll(interval);
  });

program
  .command('query')
  .description('One-shot VOC MRC analysis for a specific date or date range')
  .option('-d, --date <date>', 'Analyze a specific date (YYYY-MM-DD)')
  .option('--from <date>', 'Start date for range (YYYY-MM-DD)')
  .option('--to <date>', 'End date for range (YYYY-MM-DD)')
  .option('--today', 'Shorthand for today\'s date')
  .option('-a, --all', 'Show all results including matches')
  .option('-e, --export', 'Export results to JSON file')
  .option('-r, --report', 'Export results to PDF report')
  .action((opts) => {
    const query = require('./commands/query');
    query(opts);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
