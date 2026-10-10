// ============================================================
// src/reporters/csvReporter.ts
// Flatten AuditReports to CSV rows
// ============================================================

import fs from 'fs';
import path from 'path';
import { writeToPath } from 'fast-csv';
import { AuditReport, AuditCsvRow } from '../types/index.js';
import { bytesToMb, bytesToKb } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

/**
 * Convert an AuditReport to a flat CSV-friendly row.
 */
function toCsvRow(report: AuditReport): AuditCsvRow {
  const { metrics, scoring, critical_issues, quick_wins } = report;
  const perf   = metrics.performance;
  const mobile = metrics.mobileUx;
  const tech   = metrics.techStack;
  const a11y   = metrics.accessibility;
  const seo    = metrics.seo;

  return {
    url:                   report.url,
    finalUrl:              report.finalUrl,
    scanTimestamp:         report.scanTimestamp,
    contactEmail:          report.contact?.email || 'no email found',
    contactPhone:          report.contact?.phones?.join(', ') || '',
    overallScore:          scoring.overallScore,
    grade:                 scoring.grade,
    isHighPriorityTarget:  scoring.isHighPriorityTarget,
    performanceScore:      scoring.categoryScores.performance,
    mobileUxScore:         scoring.categoryScores.mobileUx,
    accessibilityScore:    scoring.categoryScores.accessibility,
    techAndSeoScore:       scoring.categoryScores.techAndSeo,
    lcp:                   perf.lcp,
    cls:                   perf.cls,
    inp:                   perf.inp,
    ttfb:                  perf.ttfb,
    totalLoadTime:         perf.totalLoadTime,
    totalPayloadKb:        perf.totalPayloadBytes !== null ? Math.round(perf.totalPayloadBytes / 1024) : null,
    uncompressedImagesMb:  bytesToMb(perf.uncompressedImagesTotalBytes),
    hasViewportMeta:       mobile.hasViewportMeta,
    hasHorizontalScroll:   mobile.hasHorizontalScroll,
    smallTapTargetsCount:  mobile.smallTapTargets.length,
    isOutdatedOrVintage:   mobile.designAesthetics?.isOutdatedOrVintage ?? false,
    visualStyleScore:      mobile.designAesthetics?.visualStyleScore ?? 0,
    vintageElements:       mobile.designAesthetics?.vintageElementsFound?.join(', ') ?? '',
    isHttps:               tech.isHttps,
    sslValid:              tech.sslValid,
    hasMixedContent:       tech.hasMixedContent,
    legacyFrameworks:      tech.detectedLegacyFrameworks.map((f) => `${f.name}${f.version ? ` v${f.version}` : ''}`).join('; '),
    axeViolations:         a11y.axeTotalViolationCount,
    imagesWithoutAlt:      a11y.imagesWithoutAlt,
    colorContrastViolations: a11y.colorContrastViolations,
    titleTag:              seo.titleTag ?? '',
    metaDescription:       seo.metaDescription ?? '',
    brokenLinksCount:      seo.brokenInternalLinks.length + seo.brokenAssetLinks.length,
    consoleErrorsCount:    seo.consoleErrors.filter((e) => e.type === 'error').length,
    criticalIssueCount:    critical_issues.filter((i) => i.severity === 'critical').length,
    quickWinCount:         quick_wins.length,
    errors:                report.errors.join('; '),
  };
}

/**
 * Write reports to a CSV file.
 */
export async function writeCsv(reports: AuditReport[], outputPath: string): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const rows = reports.map(toCsvRow);

  return new Promise((resolve, reject) => {
    writeToPath(outputPath, rows, { headers: true, quoteColumns: true })
      .on('finish', () => {
        logger.info(`CSV report written: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        logger.error(`CSV write error: ${err.message}`);
        reject(err);
      });
  });
}
