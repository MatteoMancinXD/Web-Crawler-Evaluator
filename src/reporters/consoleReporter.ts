// ============================================================
// src/reporters/consoleReporter.ts
// Rich terminal output for interactive CLI usage
// ============================================================

import chalk from 'chalk';
import { AuditReport } from '../types/index.js';
import { BatchSummary } from '../runner/batchRunner.js';
import { bytesToMb, bytesToKb, msToReadable, round } from '../utils/helpers.js';

// ─── Grade colours ───────────────────────────────────────────

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return chalk.bgGreen.black.bold(` ${grade} `);
    case 'B': return chalk.bgCyan.black.bold(` ${grade} `);
    case 'C': return chalk.bgYellow.black.bold(` ${grade} `);
    case 'F': return chalk.bgRed.white.bold(` ${grade} `);
    default:  return chalk.bgGray.white.bold(` ${grade} `);
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return chalk.green.bold(`${score}`);
  if (score >= 65) return chalk.cyan.bold(`${score}`);
  if (score >= 50) return chalk.yellow.bold(`${score}`);
  return chalk.red.bold(`${score}`);
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return chalk.red('✖');
    case 'warning':  return chalk.yellow('⚠');
    default:         return chalk.blue('ℹ');
  }
}

function bar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty  = width - filled;
  const color  = score >= 80 ? chalk.green : score >= 65 ? chalk.cyan : score >= 50 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

const DIVIDER = chalk.gray('─'.repeat(70));

/**
 * Print a rich single-report summary to the terminal.
 */
export function printReport(report: AuditReport): void {
  const { scoring, metrics, critical_issues, quick_wins, errors } = report;

  console.log('\n' + DIVIDER);
  console.log(
    chalk.bold.white('  AUDIT REPORT') +
    chalk.gray(` — ${report.url}`),
  );
  console.log(DIVIDER);

  // ── Header ───────────────────────────────────────────────────
  console.log(`  ${chalk.gray('Scanned:')}       ${chalk.white(report.scanTimestamp)}`);
  console.log(`  ${chalk.gray('Final URL:')}     ${chalk.white(report.finalUrl)}`);
  console.log(`  ${chalk.gray('Duration:')}      ${chalk.white((report.scanDurationMs / 1000).toFixed(1) + 's')}`);
  const emailDisplay = report.contact?.email && report.contact.email !== 'no email found'
    ? chalk.cyan(report.contact.email)
    : chalk.yellow('no email found');
  console.log(`  ${chalk.gray('Contact Email:')} ${emailDisplay}`);
  if (report.contact?.phones?.length) {
    console.log(`  ${chalk.gray('Phone:')}         ${chalk.white(report.contact.phones.join(', '))}`);
  }
  console.log();

  // ── Overall Score ─────────────────────────────────────────────
  console.log(`  ${chalk.bold('Overall Score:')}  ${scoreColor(scoring.overallScore)}/100  ${gradeColor(scoring.grade)}`);
  if (scoring.isHighPriorityTarget) {
    console.log(`  ${chalk.bgRed.white.bold(' ⚡ HIGH-PRIORITY OUTREACH TARGET ')} Score below 50`);
  }
  console.log();

  // ── Category breakdown ────────────────────────────────────────
  console.log(chalk.bold('  Category Scores:'));
  const cats: [string, number, string][] = [
    ['Performance  (20%)', scoring.categoryScores.performance,   'performance'],
    ['Mobile/UX/UI (40%)', scoring.categoryScores.mobileUx,      'mobileUx'],
    ['Accessibility(20%)', scoring.categoryScores.accessibility,  'accessibility'],
    ['Tech & SEO   (20%)', scoring.categoryScores.techAndSeo,     'techAndSeo'],
  ];
  for (const [label, score] of cats) {
    console.log(`  ${chalk.gray(label)}  ${bar(score)}  ${scoreColor(score)}`);
  }
  console.log();

  // ── Key Metrics ───────────────────────────────────────────────
  const perf = metrics.performance;
  const mobile = metrics.mobileUx;
  const tech   = metrics.techStack;
  const a11y   = metrics.accessibility;
  const seo    = metrics.seo;
  const aeth   = mobile.designAesthetics;

  console.log(chalk.bold('  Key Metrics:'));
  console.log(`  ${chalk.gray('LCP:')}         ${chalk.white(msToReadable(perf.lcp))}`);
  console.log(`  ${chalk.gray('CLS:')}         ${chalk.white(perf.cls !== null ? round(perf.cls, 3).toString() : 'N/A')}`);
  console.log(`  ${chalk.gray('INP:')}         ${chalk.white(msToReadable(perf.inp))}`);
  console.log(`  ${chalk.gray('TTFB:')}        ${chalk.white(msToReadable(perf.ttfb))}`);
  console.log(`  ${chalk.gray('Load time:')}   ${chalk.white(msToReadable(perf.totalLoadTime))}`);
  console.log(`  ${chalk.gray('Payload:')}     ${chalk.white(perf.totalPayloadBytes !== null ? bytesToKb(perf.totalPayloadBytes) + ' KB' : 'N/A')}`);
  if (perf.lighthousePerformanceScore !== null) {
    console.log(`  ${chalk.gray('Lighthouse:')}  ${scoreColor(perf.lighthousePerformanceScore)}/100`);
  }
  console.log(`  ${chalk.gray('HTTPS:')}       ${tech.isHttps ? chalk.green('✔') : chalk.red('✖')}`);
  console.log(`  ${chalk.gray('SSL valid:')}   ${tech.sslValid ? chalk.green('✔') : chalk.red(`✖  ${tech.sslError ?? ''}`)}`);
  console.log(`  ${chalk.gray('Viewport:')}    ${mobile.hasViewportMeta ? chalk.green('✔') : chalk.red('✖  Missing')}`);
  if (aeth) {
    if (aeth.isOutdatedOrVintage) {
      console.log(`  ${chalk.gray('Aesthetics:')}  ${chalk.bgRed.white.bold(' ✖ VINTAGE / 1990s DESIGN ')} (Vintage idx: ${aeth.vintageScore}/100)`);
    } else {
      console.log(`  ${chalk.gray('Aesthetics:')}  ${chalk.green('✔ Modern layout & styling')} (Polish: ${aeth.visualStyleScore}/100)`);
    }
  }
  console.log(`  ${chalk.gray('axe issues:')}  ${chalk.white(a11y.axeTotalViolationCount.toString())}`);
  console.log(`  ${chalk.gray('Title tag:')}   ${seo.titleTag ? chalk.green(seo.titleTag.slice(0, 50)) : chalk.red('Missing')}`);
  console.log();

  // ── AI Decisions (RizzoFlow) ──────────────────────────────────
  if (report.aiDecisions) {
    const { websiteClassification: wc, designEpoch: de } = report.aiDecisions;
    const sourceTag = (src: string) => src === 'rizzo-flow'
      ? chalk.magenta('[RizzoFlow]')
      : chalk.gray('[algorithmic]');

    console.log(chalk.bold('  AI Decisions:'));

    // Website classification
    const wcIcon  = wc.isProperWebsite ? chalk.green('✔') : chalk.red('✖');
    const wcLabel = wc.isProperWebsite ? chalk.green('Proper website') : chalk.red('Web service / API (not a website)');
    const wcConf  = `${(wc.confidence * 100).toFixed(0)}% confidence`;
    const wcLat   = wc.rizzoLatencyMs ? chalk.gray(` · ${wc.rizzoLatencyMs}ms`) : '';
    console.log(`  ${wcIcon} ${chalk.bold('Site type:')}  ${wcLabel}  ${chalk.gray(wcConf)}${wcLat}  ${sourceTag(wc.source)}`);
    console.log(`    ${chalk.gray(wc.reason)}`);

    // Design epoch
    const eraColors: Record<string, chalk.Chalk> = {
      modern:       chalk.green,
      dated_2000s:  chalk.yellow,
      vintage_90s:  chalk.red,
      undetermined: chalk.gray,
    };
    const eraColorFn = eraColors[de.designEra] ?? chalk.white;
    const deIcon     = de.isOutdatedOrVintage ? chalk.red('✖') : chalk.green('✔');
    const deLabel    = eraColorFn(de.designEra.replace(/_/g, ' '));
    const deConf     = `${(de.confidence * 100).toFixed(0)}% confidence`;
    const deLat      = de.rizzoLatencyMs ? chalk.gray(` · ${de.rizzoLatencyMs}ms`) : '';
    console.log(`  ${deIcon} ${chalk.bold('Design era:')} ${deLabel}  (vintage score ${de.vintageScore}/100)  ${chalk.gray(deConf)}${deLat}  ${sourceTag(de.source)}`);
    console.log(`    ${chalk.gray(de.reason)}`);
    console.log();
  }

  // ── Critical Issues ───────────────────────────────────────────
  if (critical_issues.length > 0) {
    console.log(chalk.bold('  Critical Issues:'));
    for (const issue of critical_issues.slice(0, 10)) {
      console.log(`  ${severityIcon(issue.severity)} ${chalk.bold(issue.title)}`);
      console.log(`    ${chalk.gray(issue.detail)}`);
      console.log(`    ${chalk.cyan('Impact:')} ${chalk.italic(issue.businessImpact.slice(0, 100))}`);
    }
    if (critical_issues.length > 10) {
      console.log(chalk.gray(`  ... and ${critical_issues.length - 10} more issues in the JSON report`));
    }
    console.log();
  }

  // ── Quick Wins ────────────────────────────────────────────────
  if (quick_wins.length > 0) {
    console.log(chalk.bold('  Quick Wins:'));
    for (const win of quick_wins.slice(0, 5)) {
      console.log(`  ${chalk.green('→')} ${chalk.bold(win.title)}`);
      console.log(`    ${chalk.gray(win.estimatedImpact.slice(0, 100))}`);
    }
    console.log();
  }

  // ── Errors ────────────────────────────────────────────────────
  if (errors.length > 0) {
    console.log(chalk.yellow.bold('  Scan Errors:'));
    for (const err of errors) {
      console.log(`  ${chalk.yellow('⚠')} ${chalk.gray(err)}`);
    }
    console.log();
  }

  console.log(DIVIDER + '\n');
}

/**
 * Print a batch summary to the terminal.
 */
export function printBatchSummary(summary: BatchSummary): void {
  console.log('\n' + '═'.repeat(70));
  console.log(chalk.bold.white('  BATCH AUDIT SUMMARY'));
  console.log('═'.repeat(70));

  console.log(`  ${chalk.gray('Total URLs scanned:')}  ${chalk.white(summary.totalUrls)}`);
  console.log(`  ${chalk.gray('Successful:')}          ${chalk.green(summary.successfulScans.toString())}`);
  console.log(`  ${chalk.gray('Failed:')}              ${summary.failedScans > 0 ? chalk.red(summary.failedScans.toString()) : chalk.green('0')}`);
  console.log(`  ${chalk.gray('Average score:')}       ${scoreColor(summary.averageScore)}/100`);
  console.log(`  ${chalk.gray('Total duration:')}      ${chalk.white((summary.totalDurationMs / 1000).toFixed(1) + 's')}`);
  console.log();

  console.log(chalk.bold('  Grade Distribution:'));
  const grades: [string, string][] = [['A', 'green'], ['B', 'cyan'], ['C', 'yellow'], ['F', 'red']];
  for (const [grade, color] of grades) {
    const count = summary.gradeCounts[grade] ?? 0;
    const colorFn = (chalk as any)[color] as chalk.Chalk;
    console.log(`  ${gradeColor(grade)}  ${colorFn(count.toString())} site(s)`);
  }
  console.log();

  if (summary.highPriorityTargets.length > 0) {
    console.log(chalk.bgRed.white.bold('  HIGH-PRIORITY OUTREACH TARGETS (score < 50):'));
    for (const url of summary.highPriorityTargets) {
      console.log(`  ${chalk.red('⚡')} ${chalk.white(url)}`);
    }
    console.log();
  }

  console.log('═'.repeat(70) + '\n');
}
