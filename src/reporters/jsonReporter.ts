// ============================================================
// src/reporters/jsonReporter.ts
// Serialize AuditReports to JSON file(s)
// ============================================================

import fs from 'fs';
import path from 'path';
import { AuditReport } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Write a single report or array of reports to a JSON file.
 */
export function writeJson(reports: AuditReport | AuditReport[], outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(reports, null, 2);
  fs.writeFileSync(outputPath, json, 'utf-8');
  logger.info(`JSON report written: ${outputPath}`);
}

/**
 * Write each report as an individual JSON file named by domain.
 */
export function writeJsonPerSite(reports: AuditReport[], outputDir: string): string[] {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const paths: string[] = [];
  for (const report of reports) {
    const safeName = report.url
      .replace(/https?:\/\//i, '')
      .replace(/[^a-z0-9.-]/gi, '_')
      .slice(0, 80);
    const filePath = path.join(outputDir, `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    paths.push(filePath);
  }
  logger.info(`${paths.length} individual JSON report(s) written to: ${outputDir}`);
  return paths;
}
