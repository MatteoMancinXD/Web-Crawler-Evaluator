// ============================================================
// src/crawlCli.ts
// Standalone CLI entry point for the domain discovery crawler
// Usage: node dist/crawlCli.js --seeds https://seed.it --duration 3h
// ============================================================

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { CrawlerEngine, CrawlerOptions } from './crawler/engine.js';
import { normaliseUrl } from './utils/helpers.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
  .name('web-crawl')
  .description(
    chalk.bold('Domain Discovery Crawler') +
    '\nAutonomously discovers websites, audits them, and identifies low-quality leads.',
  )
  .version('1.0.0');

program
  .option(
    '--seeds <urls>',
    'Comma-separated seed URLs to start crawling from',
  )
  .option('--resume', 'Resume crawling directly from the existing queue in SQLite without adding new seeds')
  .option('--max-domains <n>', 'Maximum number of domains to fully audit (0 = unlimited)', '0')
  .option('--duration <time>', 'Run duration limit (e.g. 2h, 30m, 90s). 0 = unlimited', '0')
  .option('--concurrency <n>', 'Concurrent headless browser instances', '3')
  .option('--output <dir>', 'Output directory for reports and leads file', './reports')
  .option('--db <path>', 'Path to SQLite database file (persisted across runs)', './data/crawler.db')
  .option('--timeout <ms>', 'Per-site audit timeout in milliseconds', '35000')
  .option('--delay <ms>', 'Politeness delay between requests to same origin (ms)', '750')
  .option('--lead-threshold <score>', 'Score below which a site is flagged as a lead', '50')
  .option('--fresh', 'Wipe existing database and start a completely fresh crawl session')
  .option('--clear-queue', 'Clear the existing crawling queue before starting (keeps visited sites)')
  .parse(process.argv);

const opts = program.opts();
const dbFile = path.resolve(opts.db as string);

if (opts.fresh) {
  if (fs.existsSync(dbFile)) {
    try {
      fs.unlinkSync(dbFile);
      console.log(chalk.yellow(`\n  🗑️  Database reset (--fresh flag passed): ${dbFile}\n`));
    } catch (e) {
      console.warn(`Could not delete db file: ${(e as Error).message}`);
    }
  }
}

// ── Parse seeds ────────────────────────────────────────────────
let seeds: string[] = [];

if (opts.resume) {
  if (!fs.existsSync(dbFile)) {
    console.error(chalk.red(`\n❌ Cannot resume: database file not found at ${dbFile}`));
    console.error(chalk.yellow('Start a new crawl first by specifying --seeds <urls>\n'));
    process.exit(1);
  }
} else if (opts.seeds) {
  seeds = (opts.seeds as string)
    .split(',')
    .map((s: string) => normaliseUrl(s.trim()))
    .filter(Boolean);

  if (seeds.length === 0) {
    console.error(chalk.red('No valid seeds provided via --seeds'));
    process.exit(1);
  }
} else if (fs.existsSync(dbFile) && !opts.fresh) {
  // If no seeds passed and DB exists, automatically resume from existing queue!
  console.log(chalk.cyan(`\n  🔄 Existing database found: resuming directly from queue...\n`));
} else {
  // Default seeds for first-time runs
  seeds = ['https://www.corriere.it', 'https://www.repubblica.it'];
}

// ── Build options ─────────────────────────────────────────────
const crawlerOpts: CrawlerOptions = {
  seeds,
  maxDomains: parseInt(opts.maxDomains, 10) || Infinity,
  duration: opts.duration === '0' ? undefined : (opts.duration as string),
  concurrency: Math.max(1, parseInt(opts.concurrency, 10)),
  outputDir: opts.output as string,
  dbPath: opts.db as string,
  auditTimeoutMs: parseInt(opts.timeout, 10),
  politenessDelayMs: parseInt(opts.delay, 10),
  leadScoreThreshold: parseInt(opts.leadThreshold, 10),
  clearQueue: opts.clearQueue === true,
};

// ── Print config ──────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(chalk.bold.white('  🕷  Web Quality Crawler — IT Domain Discovery'));
console.log('─'.repeat(70));
console.log(`  ${chalk.gray('Seeds:')}            ${chalk.cyan(seeds.join(', '))}`);
console.log(`  ${chalk.gray('Max domains:')}      ${chalk.white(crawlerOpts.maxDomains === Infinity ? 'unlimited' : String(crawlerOpts.maxDomains))}`);
console.log(`  ${chalk.gray('Duration limit:')}   ${chalk.white(opts.duration === '0' ? 'unlimited' : opts.duration)}`);
console.log(`  ${chalk.gray('Concurrency:')}      ${chalk.white(String(crawlerOpts.concurrency))}`);
console.log(`  ${chalk.gray('Lead threshold:')}   ${chalk.white('< ' + crawlerOpts.leadScoreThreshold)}`);
console.log(`  ${chalk.gray('DB path:')}          ${chalk.white(crawlerOpts.dbPath ?? './data/crawler.db')}`);
console.log(`  ${chalk.gray('Output dir:')}       ${chalk.white(crawlerOpts.outputDir ?? './reports')}`);
console.log('─'.repeat(70));
console.log(chalk.gray('  💡 PowerShell tip: If output pauses, press Enter/Esc (QuickEdit pauses on click).\n'));


// ── Launch crawler ────────────────────────────────────────────
const engine = new CrawlerEngine(crawlerOpts);

engine
  .run()
  .then(() => {
    process.exit(0);
  })
  .catch((err: Error) => {
    logger.error(`Crawler crashed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
