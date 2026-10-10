// ============================================================
// src/crawler/engine.ts
// Main crawler orchestrator:
//   Stage 1 → lightweight HTTP link discovery
//   Stage 2 → full audit via Playwright audit engine
//
// Saves:
//   - Exactly ONE JSON report per visited site
//   - Exactly ONE line in the database per visited site (minimum information)
//   - Unreachable sites (anti-crawler blocks / errors) are NEVER added to the database.
// ============================================================

import pLimit from 'p-limit';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { CrawlerDb } from './db.js';
import { fetchWithFallback } from './httpFetcher.js';
import { extractItDomains, extractAllHrefs, findDirectoryPageUrls } from './linkExtractor.js';
import { harvestContacts } from './contactHarvester.js';
import { isAllowedDomain, extractHostname } from './domainFilter.js';
import {
  printProgress,
  printNewLead,
  printCrawlSummary,
  parseDuration,
  formatElapsed,
} from './reporter.js';
import { auditUrl } from '../runner/auditor.js';
import { writeJson } from '../reporters/jsonReporter.js';
import { AuditReport } from '../types/index.js';
import { normaliseUrl, sleep } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────

export interface CrawlerOptions {
  seeds?: string[];
  maxDomains?: number;
  duration?: string;         // e.g. "2h", "30m"
  concurrency?: number;
  dbPath?: string;
  outputDir?: string;
  auditTimeoutMs?: number;
  politenessDelayMs?: number; // between requests to same origin
  leadScoreThreshold?: number; // score below which a site is flagged as lead
  clearQueue?: boolean; // clear the crawling queue before starting
}

function formatTopIssues(report: AuditReport): string {
  return report.critical_issues
    .filter((i) => i.severity === 'critical')
    .slice(0, 3)
    .map((i) => i.title)
    .join('; ') || 'See full report';
}

// ─── CrawlerEngine ───────────────────────────────────────────

export class CrawlerEngine {
  private db!: CrawlerDb;
  private opts: Required<CrawlerOptions>;
  private startTime = 0;
  private stopRequested = false;
  private activeTasks = 0;
  private seenHostnames = new Set<string>();
  private unreachableHostnames = new Set<string>();
  private totalDiscovered = 0;

  constructor(opts: CrawlerOptions) {
    this.opts = {
      seeds: opts.seeds ?? [],
      maxDomains: opts.maxDomains ?? Infinity,
      duration: opts.duration ?? '0', // 0 = no limit
      concurrency: Math.max(1, opts.concurrency ?? 3),
      dbPath: opts.dbPath ?? './data/crawler.db',
      outputDir: opts.outputDir ?? './reports',
      auditTimeoutMs: opts.auditTimeoutMs ?? 35_000,
      politenessDelayMs: opts.politenessDelayMs ?? 750,
      leadScoreThreshold: opts.leadScoreThreshold ?? 50,
      clearQueue: opts.clearQueue ?? false,
    };
  }

  async run(): Promise<void> {
    // ── Initialise DB ────────────────────────────────────────
    this.db = new CrawlerDb(this.opts.dbPath);
    await this.db.init();

    if (this.opts.clearQueue) {
      this.db.clearQueue();
      logger.info('Queue cleared by --clear-queue flag.');
    }

    this.startTime = Date.now();

    // Populate seen hostnames from existing DB records & queue
    for (const site of this.db.getAllVisitedSites()) {
      this.seenHostnames.add(site.domain);
    }
    for (const url of this.db.getAllQueuedUrls()) {
      const h = extractHostname(url);
      if (h) this.seenHostnames.add(h);
    }

    // Parse duration limit
    let durationMs = Infinity;
    if (this.opts.duration && this.opts.duration !== '0') {
      durationMs = parseDuration(this.opts.duration);
      logger.info(`Crawl duration limit: ${this.opts.duration} (${durationMs}ms)`);
    }

    // ── Seed the queue (if seeds provided) ─────────────────────
    if (this.opts.seeds && this.opts.seeds.length > 0) {
      for (const seed of this.opts.seeds) {
        const normalised = normaliseUrl(seed);
        const hostname = extractHostname(normalised);
        if (hostname && isAllowedDomain(hostname, true)) {
          const startUrl = normalised.startsWith('http') ? normalised : `https://${hostname}/`;
          this.db.enqueue(startUrl);
          this.seenHostnames.add(hostname);
          this.totalDiscovered++;
          logger.info(`Seeded: ${hostname} (${startUrl})`);
        } else {
          logger.warn(`Seed rejected: ${seed}`);
        }
      }
    } else {
      logger.info(`No new seeds provided — resuming from existing queue (${this.db.queueLength()} pending URLs)...`);
    }

    if (this.db.queueLength() === 0) {
      logger.error('No pending URLs in queue. Provide --seeds <urls> to seed the crawler.');
      this.db.close();
      return;
    }

    // ── Graceful shutdown handler ─────────────────────────────
    const shutdown = (): void => {
      console.log('\n\nShutdown requested — finishing active tasks...');
      this.stopRequested = true;
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // ── Main crawl loop ───────────────────────────────────────
    const limit = pLimit(this.opts.concurrency);
    const runningTasks = new Set<Promise<void>>();

    console.log(`\n  🕷  Starting crawler | Concurrency: ${this.opts.concurrency}\n`);

    let inProgressAudits = 0;

    while (!this.stopRequested) {
      // Check stopping conditions
      const elapsed = Date.now() - this.startTime;
      if (elapsed >= durationMs) {
        logger.info('Duration limit reached — stopping crawler.');
        break;
      }

      const visitedCount = this.db.countVisited();
      if (visitedCount >= this.opts.maxDomains) {
        logger.info(`Max domains (${this.opts.maxDomains}) reached — stopping.`);
        break;
      }

      // If scheduled audits already meet maxDomains, wait for active tasks to conclude
      if (visitedCount + inProgressAudits >= this.opts.maxDomains) {
        if (this.activeTasks === 0) {
          logger.info(`Max domains (${this.opts.maxDomains}) reached — stopping.`);
          break;
        }
        this.printStats();
        await sleep(300);
        continue;
      }

      // Concurrency backpressure
      if (this.activeTasks >= this.opts.concurrency) {
        this.printStats();
        await sleep(200);
        continue;
      }

      // Dequeue next URL
      const nextUrl = this.db.dequeue();
      if (!nextUrl) {
        if (this.activeTasks === 0) {
          logger.info('Queue exhausted and no active tasks. Stopping.');
          break;
        }
        this.printStats();
        await sleep(500);
        continue;
      }

      const hostname = extractHostname(nextUrl);
      if (!hostname) continue;

      // Skip if already visited in DB, marked unreachable, or already has a JSON report
      if (this.db.hasVisited(hostname) || this.unreachableHostnames.has(hostname)) continue;
      if (this.hasExistingReport(hostname)) {
        this.seenHostnames.add(hostname);
        continue;
      }

      // Filter against current blacklist
      if (!isAllowedDomain(hostname)) {
        this.unreachableHostnames.add(hostname);
        continue;
      }

      this.activeTasks++;
      inProgressAudits++;
      const task = limit(async () => {
        try {
          await this.processUrl(nextUrl, hostname);
        } finally {
          this.activeTasks--;
          inProgressAudits = Math.max(0, inProgressAudits - 1);
        }
      });
      runningTasks.add(task);
      task.finally(() => runningTasks.delete(task));

      this.printStats();
      await sleep(50);
    }

    // Wait for all running tasks
    await Promise.allSettled(Array.from(runningTasks));
    this.printStats();

    // ── Final output ──────────────────────────────────────────
    await this.writeOutput();

    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    this.db.close();
  }

  // ── Core processing pipeline ──────────────────────────────

  private async processUrl(rootUrl: string, hostname: string): Promise<void> {
    logger.info(`🔍 Auditing ${chalk.cyan(hostname)}... [Active: ${this.activeTasks}/${this.opts.concurrency}] [Queue: ${this.db.queueLength()}]`);

    // ── Stage 1: Lightweight HTTP fetch ──────────────────────
    const targetUrl = rootUrl.startsWith('http') ? rootUrl : `https://${hostname}/`;
    const fetchResult = await fetchWithFallback(targetUrl, 7_000);

    // If HTTP fetch failed or returned anti-crawler bot response, do NOT add to database
    if (!fetchResult.ok && (fetchResult.statusCode <= 0 || [401, 403, 429, 503].includes(fetchResult.statusCode))) {
      this.unreachableHostnames.add(hostname);
      logger.warn(`⚠ ${chalk.yellow(hostname)}: Skipped — unreachable during HTTP fetch (${fetchResult.error || `HTTP ${fetchResult.statusCode}`}).`);
      return;
    }

    // Polite delay
    await sleep(this.opts.politenessDelayMs);

    // Discover new domains from outbound links
    const finalUrl = fetchResult.url || targetUrl;
    let discovered = extractItDomains(fetchResult.html, finalUrl);
    discovered = discovered.filter((d) => extractHostname(d) !== hostname);

    // Subpage exploration fallback if homepage yielded very few outbound domains
    if (discovered.length < 3) {
      const internalHrefs = extractAllHrefs(fetchResult.html, finalUrl);
      const dirPages = findDirectoryPageUrls(internalHrefs);
      const contentPages = internalHrefs.filter((h) => {
        try {
          const p = new URL(h).pathname;
          return p.length > 5 && !p.includes('#') && !p.includes('wp-json') && !p.includes('feed');
        } catch {
          return false;
        }
      });

      const candidateSubpages = [...new Set([...dirPages, ...contentPages])].slice(0, 4);
      if (candidateSubpages.length > 0) {
        for (const subpageUrl of candidateSubpages) {
          try {
            const subRes = await fetchWithFallback(subpageUrl, 5_000);
            if (subRes.ok && subRes.html) {
              const subDiscovered = extractItDomains(subRes.html, subRes.url);
              for (const d of subDiscovered) {
                if (extractHostname(d) !== hostname) {
                  discovered.push(d);
                }
              }
            }
          } catch {}
          if (discovered.length >= 10) break;
        }
      }
    }

    // Enqueue newly discovered domains (ONLY added to queue, NOT to database)
    let newlyEnqueued = 0;
    const uniqueDiscovered = Array.from(new Set(discovered));
    for (const domainRoot of uniqueDiscovered) {
      const dh = extractHostname(domainRoot);
      if (dh && dh !== hostname && !this.seenHostnames.has(dh) && !this.db.hasVisited(dh) && !this.unreachableHostnames.has(dh)) {
        this.db.enqueue(domainRoot);
        this.seenHostnames.add(dh);
        this.totalDiscovered++;
        newlyEnqueued++;
      }
    }

    if (newlyEnqueued > 0) {
      logger.info(`🔗 Discovered ${newlyEnqueued} new domains from ${hostname} (Queue: ${this.db.queueLength()})`);
    }

    // ── Stage 2: Full audit via Playwright ────────────────────
    let report: AuditReport | null;
    try {
      report = await auditUrl({ url: finalUrl, timeoutMs: this.opts.auditTimeoutMs });
    } catch (err) {
      this.unreachableHostnames.add(hostname);
      logger.warn(`⚠ ${chalk.yellow(hostname)}: Skipped — audit failed (${(err as Error).message}).`);
      return;
    }

    if (!report) {
      logger.info(`⏭ ${chalk.gray(hostname)}: Classified as NON-WEBSITE.`);
      return;
    }

    // If unreachable (navigation failed or anti-crawler policy detected), DO NOT add to database!
    if (report.isUnreachable) {
      this.unreachableHostnames.add(hostname);
      logger.warn(`⚠ ${chalk.yellow(hostname)}: Skipped — site unreachable or anti-crawler protected.`);
      return;
    }

    // Enqueue any additional domains found in rendered DOM
    if (report.discoveredItDomains && report.discoveredItDomains.length > 0) {
      for (const domainRoot of report.discoveredItDomains) {
        const dh = extractHostname(domainRoot);
        if (dh && dh !== hostname && !this.seenHostnames.has(dh) && !this.db.hasVisited(dh) && !this.unreachableHostnames.has(dh)) {
          this.db.enqueue(domainRoot);
          this.seenHostnames.add(dh);
          this.totalDiscovered++;
        }
      }
    }

    // ── Resolve contact details ───────────────────────────────
    let contactEmail = report.contact?.email;
    let contactPhone = report.contact?.phones?.join(', ') || '';
    let contactPageUrl = report.contact?.contactPageUrl || finalUrl;

    if (!contactEmail || contactEmail === 'no email found') {
      const fallbackContacts = await harvestContacts(finalUrl, fetchResult.html);
      if (fallbackContacts.emails.length > 0) {
        contactEmail = fallbackContacts.allEmailsStr;
        contactPhone = fallbackContacts.phones.join(', ');
        contactPageUrl = fallbackContacts.sourceUrls.find((u) => u !== finalUrl) || finalUrl;
      } else {
        contactEmail = 'no email found';
      }
    }

    report.contact = {
      email: contactEmail,
      phones: contactPhone ? contactPhone.split(', ') : [],
      contactPageUrl,
    };

    // ── Save ONE line in the database reporting minimum information ──
    this.db.saveVisitedSite({
      domain: hostname,
      url: finalUrl,
      score: report.scoring.overallScore,
      grade: report.scoring.grade,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      visited_at: new Date().toISOString(),
    });

    // ── Save exactly ONE JSON report file for this visited site ──
    this.writeAuditReport(report, hostname);

    logger.info(
      `✔ Audited ${chalk.cyan(hostname)} — Score: ${report.scoring.overallScore}/100 (${report.scoring.grade}) [Queue: ${this.db.queueLength()}, Visited: ${this.db.countVisited()}]`
    );

    // Print lead notification if below threshold
    if (report.scoring.overallScore < this.opts.leadScoreThreshold) {
      printNewLead({
        domain: hostname,
        overall_score: report.scoring.overallScore,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        top_issues: formatTopIssues(report),
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private lastProgressPrint = 0;
  private printStats(): void {
    const now = Date.now();
    if (now - this.lastProgressPrint < 2_000) return;
    this.lastProgressPrint = now;

    printProgress({
      queued: this.db.queueLength(),
      active: this.activeTasks,
      visited: this.db.countVisited(),
      leads: this.db.countLeads(this.opts.leadScoreThreshold),
      unreachable: this.unreachableHostnames.size,
      elapsed: formatElapsed(Date.now() - this.startTime),
    });
  }

  private writeAuditReport(report: AuditReport, hostname: string): void {
    try {
      const safeName = hostname.replace(/[^a-z0-9.-]/gi, '_').slice(0, 60);
      writeJson(report, path.join(this.opts.outputDir, `${safeName}.json`));
    } catch {
      // Non-critical — don't crash crawler
    }
  }

  /**
   * Check if a JSON report already exists on disk for this hostname.
   * Avoids re-auditing sites that were already processed in a previous session.
   */
  private hasExistingReport(hostname: string): boolean {
    const safeName = hostname.replace(/[^a-z0-9.-]/gi, '_').slice(0, 60);
    return fs.existsSync(path.join(this.opts.outputDir, `${safeName}.json`));
  }

  private async writeOutput(): Promise<void> {
    printCrawlSummary({
      totalDiscovered: this.totalDiscovered,
      totalVisited: this.db.countVisited(),
      totalLeads: this.db.countLeads(this.opts.leadScoreThreshold),
      totalUnreachable: this.unreachableHostnames.size,
      durationMs: Date.now() - this.startTime,
      dbPath: this.opts.dbPath,
      outputDir: this.opts.outputDir,
    });
  }
}
