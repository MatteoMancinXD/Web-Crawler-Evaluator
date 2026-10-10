// ============================================================
// src/runner/batchRunner.ts
// Concurrent batch scanning with concurrency control
// ============================================================

import pLimit from 'p-limit';
import { auditUrl } from './auditor.js';
import { AuditReport, AuditOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface BatchOptions {
  urls: string[];
  concurrency?: number;
  timeoutMs?: number;
  onProgress?: (completed: number, total: number, report?: AuditReport) => void;
}

export interface BatchResult {
  reports: AuditReport[];
  summary: BatchSummary;
}

export interface BatchSummary {
  totalUrls: number;
  successfulScans: number;
  failedScans: number;
  averageScore: number;
  highPriorityTargets: string[];
  gradeCounts: Record<string, number>;
  totalDurationMs: number;
}

/**
 * Run audits for multiple URLs with a concurrency cap.
 * Default concurrency: 3 simultaneous headless browser instances.
 */
export async function runBatch(options: BatchOptions): Promise<BatchResult> {
  const { urls, concurrency = 3, timeoutMs = 30_000, onProgress } = options;
  const limit = pLimit(concurrency);

  logger.info(`Starting batch audit: ${urls.length} URL(s) with concurrency=${concurrency}`);
  const startTime = Date.now();

  let completed = 0;
  const reports: AuditReport[] = [];

  const tasks = urls.map((url) =>
    limit(async () => {
      const auditOpts: AuditOptions = { url, timeoutMs };
      const report = await auditUrl(auditOpts);
      completed++;
      if (report) {
        reports.push(report);
      }
      if (onProgress) onProgress(completed, urls.length, report ?? undefined);
      return report;
    }),
  );

  await Promise.all(tasks);

  const totalDurationMs = Date.now() - startTime;

  // ── Build summary ────────────────────────────────────────────
  const successfulScans = reports.filter((r) => r.errors.length === 0).length;
  const failedScans     = reports.filter((r) => r.errors.length > 0).length;
  const scores          = reports.map((r) => r.scoring.overallScore);
  const averageScore    = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const highPriorityTargets = reports.filter((r) => r.scoring.isHighPriorityTarget).map((r) => r.url);

  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, F: 0 };
  for (const r of reports) {
    gradeCounts[r.scoring.grade] = (gradeCounts[r.scoring.grade] ?? 0) + 1;
  }

  const summary: BatchSummary = {
    totalUrls: urls.length,
    successfulScans,
    failedScans,
    averageScore,
    highPriorityTargets,
    gradeCounts,
    totalDurationMs,
  };

  logger.info(
    `Batch complete: ${urls.length} URLs in ${(totalDurationMs / 1000).toFixed(1)}s | ` +
    `Avg score: ${averageScore} | High-priority targets: ${highPriorityTargets.length}`,
  );

  return { reports, summary };
}
