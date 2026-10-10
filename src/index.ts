// ============================================================
// src/index.ts
// Public API — re-exports for programmatic use
// ============================================================

export { auditUrl } from './runner/auditor.js';
export { runBatch } from './runner/batchRunner.js';
export { computeScores, generateIssues, generateQuickWins } from './scoring/engine.js';
export { writeJson, writeJsonPerSite } from './reporters/jsonReporter.js';
export { writeCsv } from './reporters/csvReporter.js';
export { printReport, printBatchSummary } from './reporters/consoleReporter.js';
export * from './types/index.js';
