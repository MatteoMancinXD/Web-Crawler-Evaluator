// ============================================================
// src/crawler/reporter.ts
// Console reporting and summaries for crawler progress & visited sites
// ============================================================

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { writeToPath } from 'fast-csv';
import { VisitedSiteRow } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ─── Progress line ────────────────────────────────────────────

export interface ProgressStats {
  queued: number;
  active: number;
  visited: number;
  leads: number;
  unreachable: number;
  elapsed: string;
}

export function printProgress(stats: ProgressStats): void {
  process.stdout.write(
    `\r\x1b[K  ${chalk.gray('Queue:')} ${chalk.white(stats.queued.toString().padStart(4))}  ` +
    `${chalk.gray('Active:')} ${chalk.cyan(stats.active.toString().padStart(2))}  ` +
    `${chalk.gray('Visited:')} ${chalk.green(stats.visited.toString().padStart(4))}  ` +
    `${chalk.gray('Leads:')} ${chalk.yellow(stats.leads.toString().padStart(4))}  ` +
    `${chalk.gray('Unreachable:')} ${chalk.red(stats.unreachable.toString().padStart(3))}  ` +
    `${chalk.gray('Elapsed:')} ${chalk.white(stats.elapsed)}   `,
  );
}


// ─── Lead notification ────────────────────────────────────────

export function printNewLead(lead: {
  domain: string;
  overall_score: number | null;
  contact_email?: string;
  contact_phone?: string | null;
  top_issues?: string;
}): void {
  console.log(); // newline after progress bar
  console.log(
    `  ${chalk.bgYellow.black.bold(' ⚡ LEAD ')}  ` +
    `${chalk.white.bold(lead.domain)}  ` +
    `Score: ${chalk.red(String(lead.overall_score ?? '?'))}/100`,
  );
  const emailDisplay = lead.contact_email && lead.contact_email !== 'no email found'
    ? chalk.cyan(lead.contact_email)
    : chalk.yellow('no email found');
  console.log(`    ${chalk.gray('Email:')}  ${emailDisplay}`);
  if (lead.contact_phone) {
    console.log(`    ${chalk.gray('Phone:')}  ${chalk.cyan(lead.contact_phone)}`);
  }
  if (lead.top_issues) {
    console.log(`    ${chalk.gray('Issues:')} ${chalk.italic(lead.top_issues.slice(0, 100))}`);
  }
}

// ─── Final summary ────────────────────────────────────────────

export function printCrawlSummary(stats: {
  totalDiscovered: number;
  totalVisited: number;
  totalLeads: number;
  totalUnreachable: number;
  durationMs: number;
  dbPath: string;
  outputDir: string;
}): void {
  console.log('\n\n' + '═'.repeat(70));
  console.log(chalk.bold.white('  CRAWL SESSION SUMMARY'));
  console.log('═'.repeat(70));
  console.log(`  ${chalk.gray('Domains discovered:')}      ${chalk.white(stats.totalDiscovered)}`);
  console.log(`  ${chalk.gray('Websites visited (in DB):')} ${chalk.green(stats.totalVisited)}`);
  console.log(`  ${chalk.gray('Leads identified:')}        ${chalk.yellow(stats.totalLeads)}`);
  console.log(`  ${chalk.gray('Unreachable / blocked:')}   ${chalk.red(stats.totalUnreachable)}`);
  console.log(`  ${chalk.gray('Total duration:')}          ${chalk.white((stats.durationMs / 60_000).toFixed(1) + 'm')}`);
  console.log(`  ${chalk.gray('Database:')}                ${chalk.cyan(stats.dbPath)}`);
  console.log(`  ${chalk.gray('Reports dir (1 JSON/site):')}${chalk.cyan(stats.outputDir)}`);
  console.log('═'.repeat(70) + '\n');
}

// ─── Optional CSV export for visited sites ────────────────────

export async function exportVisitedSitesCsv(sites: VisitedSiteRow[], outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const rows = sites.map((s) => ({
    domain: s.domain,
    url: s.url,
    score: s.score,
    grade: s.grade,
    contact_email: s.contact_email && s.contact_email.trim() !== '' ? s.contact_email : 'no email found',
    contact_phone: s.contact_phone ?? '',
    visited_at: s.visited_at,
  }));

  return new Promise((resolve, reject) => {
    writeToPath(outputPath, rows, { headers: true, quoteColumns: true })
      .on('finish', () => {
        logger.info(`Visited sites CSV written: ${outputPath} (${rows.length} rows)`);
        resolve();
      })
      .on('error', reject);
  });
}

// ─── Duration parser ──────────────────────────────────────────

/**
 * Parse a duration string like "2h", "30m", "90s" into milliseconds.
 */
export function parseDuration(str: string): number {
  const match = str.trim().match(/^(\d+(?:\.\d+)?)(h|m|s)$/i);
  if (!match) throw new Error(`Invalid duration format: "${str}". Use e.g. "2h", "30m", "90s".`);
  const value = parseFloat(match[1]);
  switch (match[2].toLowerCase()) {
    case 'h': return value * 3_600_000;
    case 'm': return value * 60_000;
    case 's': return value * 1_000;
    default:  return value * 1_000;
  }
}

/**
 * Format elapsed milliseconds as "Xh Ym Zs".
 */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
