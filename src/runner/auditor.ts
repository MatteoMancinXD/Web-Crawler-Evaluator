// ============================================================
// src/runner/auditor.ts
// Orchestrates a single-URL audit pipeline.
// ============================================================

import { createSession, navigateTo } from './browser.js';
import { evaluatePerformance } from '../evaluators/performance.js';
import { evaluateMobileUx } from '../evaluators/mobileUx.js';
import { evaluateTechStack } from '../evaluators/techStack.js';
import { evaluateAccessibility } from '../evaluators/accessibility.js';
import { evaluateSeo } from '../evaluators/seo.js';
import { evaluateLegacyDesign } from '../evaluators/legacyDesign.js';
import { computeScores, generateIssues, generateQuickWins } from '../scoring/engine.js';
import { harvestContacts } from '../crawler/contactHarvester.js';
import { extractItDomains } from '../crawler/linkExtractor.js';
import { AuditReport, AuditOptions, ConsoleError } from '../types/index.js';
import { normaliseUrl } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { classifyWebsite } from '../ai/websiteClassifier.js';
import { classifyDesignAesthetics } from '../ai/designAestheticsClassifier.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Run a full audit for a single URL.
 * Returns an AuditReport — never throws; errors are captured in report.errors.
 */
export async function auditUrl(options: AuditOptions): Promise<AuditReport | null> {
  const url            = normaliseUrl(options.url);
  const timeoutMs      = options.timeoutMs ?? 30_000;
  const startTime      = Date.now();
  const errors: string[] = [];

  logger.info(`▶ Starting audit: ${url}`);

  // ── Desktop session ─────────────────────────────────────────
  const desktopSession = await createSession(false, true);
  const consoleErrors: ConsoleError[] = [];
  const failedRequests: string[] = [];

  // Capture console messages
  desktopSession.page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push({
        type: msg.type() === 'error' ? 'error' : 'warning',
        message: msg.text().slice(0, 200),
        url: msg.location().url,
      });
    }
  });

  // Capture failed network requests
  desktopSession.page.on('requestfailed', (req) => {
    failedRequests.push(req.url());
    consoleErrors.push({
      type: 'error',
      message: `Failed network request: ${req.failure()?.errorText ?? 'unknown'} — ${req.url().slice(0, 120)}`,
    });
  });

  let finalUrl = url;
  let loadDurationMs = 0;
  let navStatusCode: number | null = null;

  // Navigate with desktop session
  try {
    const nav = await navigateTo(desktopSession.page, url, timeoutMs);
    finalUrl      = nav.finalUrl;
    loadDurationMs = nav.loadDurationMs;
    navStatusCode = nav.statusCode;
  } catch (err) {
    const msg = `Navigation failed: ${(err as Error).message}`;
    logger.warn(msg);
    errors.push(msg);
    await desktopSession.close();

    // Return a minimal error report marked as unreachable
    return buildErrorReport(url, url, startTime, DEFAULT_UA, errors, true);
  }

  // Check if response status code indicates an anti-crawler block or server refusal
  if (navStatusCode && [401, 403, 429, 503].includes(navStatusCode)) {
    const msg = `HTTP ${navStatusCode} response: Site is unreachable or protected by anti-crawler policies`;
    logger.warn(msg);
    errors.push(msg);
    await desktopSession.close();
    return buildErrorReport(url, finalUrl, startTime, DEFAULT_UA, errors, true);
  }

  // Check for common bot challenge / captcha pages in title
  const pageTitle = await desktopSession.page.title().catch(() => '');
  const antiBotPhrases = ['attention required! | cloudflare', 'just a moment...', '403 forbidden', 'access denied', 'ddos-guard', 'sucuri webproxy'];
  if (antiBotPhrases.some((phrase) => pageTitle.toLowerCase().includes(phrase))) {
    const msg = `Anti-crawler challenge detected in page title ("${pageTitle}"): protected by anti-crawler policies`;
    logger.warn(msg);
    errors.push(msg);
    await desktopSession.close();
    return buildErrorReport(url, finalUrl, startTime, DEFAULT_UA, errors, true);
  }

  // ── AI: Website classification (RizzoFlow) ──────────────────────────
  // Run BEFORE the heavy evaluators to short-circuit non-websites.
  let websiteClassification = await (async () => {
    try {
      const pageTitle    = await desktopSession.page.title();
      const contentType  = await desktopSession.page.evaluate(
        () => document.contentType ?? 'text/html',
      ).catch(() => 'text/html');
      const htmlSnippet  = await desktopSession.page.content()
        .then((c) => c.slice(0, 16_000))
        .catch(() => '');
      const hasNavEls    = await desktopSession.page.evaluate(
        () => !!(document.querySelector('nav') || document.querySelector('[role="navigation"]') || document.querySelector('header')),
      ).catch(() => false);
      const hasBodyText  = await desktopSession.page.evaluate(
        () => (document.body?.innerText?.trim().length ?? 0) > 200,
      ).catch(() => false);

      return await classifyWebsite({
        finalUrl,
        pageTitle,
        contentType,
        pageContent:    htmlSnippet,
        httpStatusCode: 200,
        hasHtmlBody:    htmlSnippet.length > 100,
        hasNavElements: hasNavEls,
        hasBodyText,
      });
    } catch (e) {
      logger.warn(`[AI] Website classification error: ${(e as Error).message}`);
      return { isProperWebsite: true, confidence: 0, source: 'algorithmic-fallback' as const, reason: 'Classification error — treating as website.' };
    }
  })();

  if (!websiteClassification.isProperWebsite) {
    logger.info(`⏭ Skipping full audit: classified as NON-WEBSITE (${websiteClassification.reason})`);
    await Promise.all([desktopSession.close()]);
    return null;
  }

  // ── Mobile session for UX checks ─────────────────────────────
  const mobileSession = await createSession(true, true);
  let perfMetrics: any;
  let mobileMetrics: any;
  let techMetrics: any;
  let a11yMetrics: any;
  let seoMetrics: any;
  let legacyResult: any;
  let designEpoch: any;
  let contact = { email: 'no email found', phones: [] as string[], contactPageUrl: null as string | null };
  let discoveredItDomains: string[] = [];

  try {
    try {
      await navigateTo(mobileSession.page, finalUrl, timeoutMs);
    } catch (err) {
      errors.push(`Mobile navigation failed: ${(err as Error).message}`);
    }

    // ── Run all evaluators concurrently ──────────────────────────
    [perfMetrics, mobileMetrics, techMetrics, a11yMetrics, legacyResult] = await Promise.all([
      evaluatePerformance(desktopSession.page, finalUrl, loadDurationMs).catch((e) => {
        errors.push(`Performance eval error: ${e.message}`);
        return getEmptyPerf(loadDurationMs);
      }),
      evaluateMobileUx(mobileSession.page).catch((e) => {
        errors.push(`Mobile UX eval error: ${e.message}`);
        return getEmptyMobile();
      }),
      evaluateTechStack(desktopSession.page, finalUrl).catch((e) => {
        errors.push(`Tech stack eval error: ${e.message}`);
        return getEmptyTech();
      }),
      evaluateAccessibility(desktopSession.page).catch((e) => {
        errors.push(`Accessibility eval error: ${e.message}`);
        return getEmptyA11y();
      }),
      evaluateLegacyDesign(desktopSession.page, mobileSession.page).catch((e) => {
        errors.push(`Legacy design eval error: ${e.message}`);
        return getEmptyLegacyResult();
      })
    ]);

    // SEO needs console errors from the desktop session
    seoMetrics = await evaluateSeo(desktopSession.page, finalUrl, consoleErrors).catch((e) => {
      errors.push(`SEO eval error: ${e.message}`);
      return getEmptySeo(consoleErrors);
    });

    // ── AI: Design aesthetics classification (RizzoFlow) ─────────
    designEpoch = await classifyDesignAesthetics(
      finalUrl,
      legacyResult.metrics, // Note: We might need to update the AI function, passing the new metrics.
    ).catch((e) => {
      logger.warn(`[AI] Design aesthetics classification error: ${e.message}`);
      return {
        isOutdatedOrVintage: legacyResult.scoreBreakdown.is_candidate,
        vintageScore:        legacyResult.scoreBreakdown.score,
        designEra:           legacyResult.scoreBreakdown.estimated_era as any,
        confidence:          0,
        source:              'algorithmic-fallback' as const,
        reason:              'Classification error — using heuristic result.',
      };
    });

    // We no longer inject this into mobileMetrics; the AI logic needs to be updated elsewhere.

    // ── Harvest contact details and discover DOM links for every analyzed site ─────────
    try {
      const pageHtml = await desktopSession.page.content();
      discoveredItDomains = extractItDomains(pageHtml, finalUrl);
      const harvested = await harvestContacts(finalUrl, pageHtml);
      contact = {
        email: harvested.allEmailsStr || 'no email found',
        phones: harvested.phones,
        contactPageUrl: harvested.sourceUrls.find((u) => u !== finalUrl) || null,
      };
    } catch (err) {
      logger.debug(`Contact harvesting/DOM link error: ${(err as Error).message}`);
    }
  } finally {
    // ── Close sessions ───────────────────────────────────────────
    await Promise.all([desktopSession.close(), mobileSession.close()]);
  }

  // ── Compute scores & generate report ─────────────────────────
  const scoring = computeScores(perfMetrics, mobileMetrics, a11yMetrics, techMetrics, seoMetrics, legacyResult.scoreBreakdown);
  const critical_issues = generateIssues(perfMetrics, mobileMetrics, a11yMetrics, techMetrics, seoMetrics, legacyResult.scoreBreakdown);
  const quick_wins       = generateQuickWins(perfMetrics, mobileMetrics, a11yMetrics, techMetrics, seoMetrics, legacyResult.scoreBreakdown);

  const scanDurationMs = Date.now() - startTime;

  logger.info(
    `✔ Audit complete: ${url} — Score: ${scoring.overallScore}/100 (${scoring.grade}) in ${(scanDurationMs / 1000).toFixed(1)}s`,
  );

  return {
    url,
    finalUrl,
    scanTimestamp: new Date().toISOString(),
    scanDurationMs,
    userAgent: DEFAULT_UA,
    contact,
    discoveredItDomains,
    metrics: {
      performance:   perfMetrics,
      mobileUx:      mobileMetrics,
      techStack:      techMetrics,
      accessibility: a11yMetrics,
      seo:           seoMetrics,
      legacyDesign:  legacyResult.metrics,
    },
    scoring,
    legacyScore: legacyResult.scoreBreakdown,
    critical_issues,
    quick_wins,
    errors,
    aiDecisions: {
      websiteClassification,
      designEpoch,
    },
  };
}

// ─── Empty metric fallbacks ───────────────────────────────────

function buildErrorReport(
  url: string,
  finalUrl: string,
  startTime: number,
  userAgent: string,
  errors: string[],
  isUnreachable = true,
): AuditReport {
  const scoring = { overallScore: 0, categoryScores: { performance: 0, mobileUx: 0, accessibility: 0, techAndSeo: 0 }, grade: 'F' as const, isHighPriorityTarget: false };
  return {
    url, finalUrl,
    scanTimestamp: new Date().toISOString(),
    scanDurationMs: Date.now() - startTime,
    userAgent,
    isUnreachable,
    contact: { email: 'no email found', phones: [], contactPageUrl: null },
    metrics: {
      performance:   getEmptyPerf(0),
      mobileUx:      getEmptyMobile(),
      techStack:      getEmptyTech(),
      accessibility: getEmptyA11y(),
      seo:           getEmptySeo([]),
      legacyDesign:  getEmptyLegacyResult().metrics,
    },
    scoring,
    legacyScore: getEmptyLegacyResult().scoreBreakdown,
    critical_issues: [{
      category: 'techAndSeo',
      severity: 'critical',
      title: isUnreachable ? 'Site unreachable (anti-crawler policy suspected)' : 'Evaluation failed',
      detail: errors.join('; '),
      businessImpact: 'Site could not be reached by crawler — likely reachable for real users but protected by anti-crawler policies.',
      metric: null,
    }],
    quick_wins: [],
    errors,
  };
}

function getEmptyPerf(loadDurationMs: number) {
  return { lcp: null, cls: null, inp: null, ttfb: null, totalLoadTime: loadDurationMs, totalPayloadBytes: null, uncompressedImagesCount: 0, uncompressedImagesTotalBytes: 0, lighthousePerformanceScore: null };
}

function getEmptyMobile() {
  return {
    hasViewportMeta: false,
    viewportContent: null,
    hasHorizontalScroll: false,
    smallTapTargets: [],
    hasIntrusivePopup: false,
    contentOverflowOnMobile: false,
  };
}

function getEmptyLegacyResult() {
  return {
    metrics: {
      domNodeCount: 0,
      navLinkCount: 0,
      hasMegaMenu: false,
      hasMobileHorizontalOverflow: false,
      typography: { bodyFontSizePx: 16, bodyLineHeight: 1.5, isLegacyWebSafeFont: false },
      layout: { hasFixedLegacyWidth: false, hasSharpBorders: false, usesLegacyFloatClear: false, usesFlexOrGrid: true },
      legacyTech: { copyrightYear: null, hasObsoleteHtmlTags: false, hasLegacyCssFrameworks: false },
    },
    scoreBreakdown: {
      score: 0,
      is_candidate: false,
      estimated_era: 'Unknown',
      breakdown: {
        typography: { score: 0, reason: '' },
        layout: { score: 0, reason: '' },
        navigation: { score: 0, reason: '' },
        mobile_readiness: { score: 0, reason: '' },
        density: { score: 0, reason: '' },
        tech: { score: 0, reason: '' },
      },
      sales_pitch_hooks: [],
    }
  };
}
function getEmptyTech() {
  return { isHttps: false, hasMixedContent: false, sslValid: false, sslError: 'Evaluation failed', detectedLegacyFrameworks: [], hasTableLayout: false, hasFrameset: false, hasFlashObjects: false, hasObsoleteTags: [], hasHtml5Landmarks: false, missingLandmarks: [], hasInlineCssLayout: false };
}
function getEmptyA11y() {
  return { imagesWithoutAlt: 0, imagesWithEmptyAlt: 0, colorContrastViolations: 0, formInputsWithoutLabel: 0, missingLangAttribute: true, axeViolations: [], axeTotalViolationCount: 0 };
}
function getEmptySeo(consoleErrors: ConsoleError[]) {
  return { titleTag: null, titleTagCount: 0, metaDescription: null, metaDescriptionCount: 0, brokenInternalLinks: [], brokenAssetLinks: [], consoleErrors, hasCanonicalTag: false, hasRobotsTxt: false, hasSitemap: false };
}
