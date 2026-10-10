// ============================================================
// src/cli.ts
// CLI entry point — uses Commander.js for argument parsing
// ============================================================

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { auditUrl } from './runner/auditor.js';
import { runBatch } from './runner/batchRunner.js';
import { writeJson, writeJsonPerSite } from './reporters/jsonReporter.js';
import { writeCsv } from './reporters/csvReporter.js';
import { printReport, printBatchSummary } from './reporters/consoleReporter.js';
import { normaliseUrl } from './utils/helpers.js';
import { logger } from './utils/logger.js';
import { AuditReport } from './types/index.js';

const program = new Command();

program
  .name('web-audit')
  .description(
    chalk.bold('Web Quality & UX Audit Engine') +
    '\nScores websites on Performance, Mobile/UX, Accessibility, and Tech Modernity.',
  )
  .version('1.0.0');

// ─── Single URL audit ─────────────────────────────────────────

program
  .command('scan')
  .description('Audit a single URL')
  .requiredOption('--url <url>', 'Target URL to audit')
  .option('--timeout <ms>', 'Navigation timeout in milliseconds', '30000')
  .option('--output <dir>', 'Directory to write report files', './reports')
  .option('--json', 'Export report as JSON (default: true)')
  .option('--csv', 'Export report as CSV')
  .option('--db <path>', 'Optional SQLite database file to save visited site')
  .option('--no-console', 'Suppress rich console output')
  .action(async (opts) => {
    const spinner = ora(`Auditing ${chalk.cyan(opts.url)}...`).start();
    try {
      const report = await auditUrl({
        url: opts.url,
        timeoutMs: parseInt(opts.timeout, 10),
      });

      if (!report) {
        spinner.info(`Audit skipped: ${chalk.cyan(opts.url)} was classified as a NON-WEBSITE.`);
        return;
      }

      if (report.isUnreachable) {
        spinner.warn(`Site unreachable: ${chalk.yellow(opts.url)}`);
        console.log(chalk.gray(`  ${report.errors.join('; ')}`));
        console.log(chalk.gray(`  (Not added to database — site is likely reachable but protected by anti-crawler policies)`));
        process.exit(0);
      }

      spinner.succeed(`Audit complete: ${report.url}`);

      if (opts.console !== false) {
        printReport(report);
      }

      const outDir = path.resolve(opts.output);
      fs.mkdirSync(outDir, { recursive: true });

      // Always write JSON unless explicitly not wanted
      if (opts.json !== false || !opts.csv) {
        const jsonPath = path.join(outDir, `${sanitiseFilename(report.url)}.json`);
        writeJson(report, jsonPath);
        console.log(chalk.green(`  JSON: ${jsonPath}`));
      }

      if (opts.csv) {
        const csvPath = path.join(outDir, `${sanitiseFilename(report.url)}.csv`);
        await writeCsv([report], csvPath);
        console.log(chalk.green(`  CSV:  ${csvPath}`));
      }

      if (opts.db) {
        const { CrawlerDb } = await import('./crawler/db.js');
        const db = new CrawlerDb(opts.db);
        await db.init();
        let domain = report.url;
        try { domain = new URL(report.finalUrl || report.url).hostname; } catch {}
        db.saveVisitedSite({
          domain,
          url: report.finalUrl || report.url,
          score: report.scoring.overallScore,
          grade: report.scoring.grade,
          contact_email: report.contact?.email || 'no email found',
          contact_phone: report.contact?.phones?.join(', ') || null,
          visited_at: new Date().toISOString(),
        });
        db.close();
        console.log(chalk.green(`  DB:   Saved 1 row to ${opts.db}`));
      }

      process.exit(report.scoring.isHighPriorityTarget ? 2 : 0);
    } catch (err) {
      spinner.fail(`Audit failed: ${(err as Error).message}`);
      logger.error((err as Error).stack ?? (err as Error).message);
      process.exit(1);
    }
  });

// ─── Batch URL audit ──────────────────────────────────────────

program
  .command('batch')
  .description('Audit multiple URLs from a file or comma-separated list')
  .option('--url <urls>', 'Comma-separated list of URLs')
  .option('--list <file>', 'Path to a text file with one URL per line')
  .option('--concurrency <n>', 'Max simultaneous browser instances', '3')
  .option('--timeout <ms>', 'Navigation timeout in milliseconds', '30000')
  .option('--output <dir>', 'Directory to write report files', './reports')
  .option('--json', 'Export combined JSON report')
  .option('--json-per-site', 'Export one JSON file per site (default: true)')
  .option('--csv', 'Export combined CSV report')
  .option('--db <path>', 'Optional SQLite database file to save visited sites')
  .option('--no-console', 'Suppress rich console output')
  .action(async (opts) => {
    // Collect URLs
    let urls: string[] = [];

    if (opts.list) {
      const filePath = path.resolve(opts.list);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      urls = fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map(normaliseUrl);
    }

    if (opts.url) {
      const fromArg = opts.url.split(',').map((u: string) => normaliseUrl(u.trim())).filter(Boolean);
      urls = [...urls, ...fromArg];
    }

    if (urls.length === 0) {
      console.error(chalk.red('No URLs provided. Use --url or --list'));
      process.exit(1);
    }

    // Deduplicate
    urls = [...new Set(urls)];

    console.log(chalk.bold(`\n  Web Quality Audit Engine — ${urls.length} URL(s) queued\n`));

    const concurrency = Math.max(1, parseInt(opts.concurrency, 10));
    const reports: AuditReport[] = [];

    const { summary } = await runBatch({
      urls,
      concurrency,
      timeoutMs: parseInt(opts.timeout, 10),
      onProgress: (completed, total, report) => {
        if (!report) {
          console.log(`  [${completed}/${total}] ⏭  Skipped (NON-WEBSITE)`);
          return;
        }
        if (report.isUnreachable) {
          console.log(`  [${completed}/${total}] ⚠️  ${chalk.yellow(report.url)} — Unreachable / anti-crawler policy`);
          return;
        }
        const pct = Math.round((completed / total) * 100);
        const icon = report.scoring.grade === 'F' ? chalk.red('✖') :
                     report.scoring.grade === 'A' ? chalk.green('✔') : chalk.yellow('~');
        console.log(
          `  [${completed}/${total}] ${icon} ${chalk.white(report.url)} — ` +
          `Score: ${report.scoring.overallScore} (${report.scoring.grade})`,
        );
        reports.push(report);
      },
    });

    if (opts.console !== false) {
      printBatchSummary(summary);
    }

    // Write outputs
    const outDir = path.resolve(opts.output);
    fs.mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Filter to reachable reports only for reports & database
    const reachableReports = reports.filter((r) => !r.isUnreachable);

    if (opts.jsonPerSite !== false) {
      writeJsonPerSite(reachableReports, outDir);
      console.log(chalk.green(`  JSON: 1 report per visited site written to ${outDir}`));
    }

    if (opts.json) {
      const jsonPath = path.join(outDir, `batch-report-${timestamp}.json`);
      writeJson(reachableReports, jsonPath);
      console.log(chalk.green(`  JSON (combined): ${jsonPath}`));
    }

    if (opts.csv) {
      const csvPath = path.join(outDir, `batch-report-${timestamp}.csv`);
      await writeCsv(reachableReports, csvPath);
      console.log(chalk.green(`  CSV:  ${csvPath}`));
    }

    if (opts.db) {
      const { CrawlerDb } = await import('./crawler/db.js');
      const db = new CrawlerDb(opts.db);
      await db.init();
      for (const rep of reachableReports) {
        let domain = rep.url;
        try { domain = new URL(rep.finalUrl || rep.url).hostname; } catch {}
        db.saveVisitedSite({
          domain,
          url: rep.finalUrl || rep.url,
          score: rep.scoring.overallScore,
          grade: rep.scoring.grade,
          contact_email: rep.contact?.email || 'no email found',
          contact_phone: rep.contact?.phones?.join(', ') || null,
          visited_at: new Date().toISOString(),
        });
      }
      db.close();
      console.log(chalk.green(`  DB:   Saved ${reachableReports.length} visited site(s) to ${opts.db}`));
    }

    // Exit with non-zero if any high-priority targets found
    if (summary.highPriorityTargets.length > 0) {
      process.exit(2); // Signal "issues found" (not a crash)
    }
  });

// ─── Helpers ──────────────────────────────────────────────────

function sanitiseFilename(url: string): string {
  return url
    .replace(/https?:\/\//i, '')
    .replace(/[^a-z0-9.-]/gi, '_')
    .slice(0, 60);
}

program.parse(process.argv);
