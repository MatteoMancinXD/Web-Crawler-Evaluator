// ============================================================
// src/scoring/engine.ts
// Weighted scoring & grade classification engine
//
// Weight distribution:
//   Performance  20%
//   Mobile / UX  40% (Includes Design Aesthetics & Visual Polish)
//   Accessibility 20%
//   Tech & SEO   20%
// ============================================================

import {
  AuditReport,
  CategoryScores,
  Grade,
  Issue,
  QuickWin,
  PerformanceMetrics,
  MobileUxMetrics,
  AccessibilityMetrics,
  TechStackMetrics,
  SeoMetrics,
  ScoringResult,
  LegacyScoreBreakdown,
} from '../types/index.js';
import { bytesToMb, bytesToKb, msToReadable, round } from '../utils/helpers.js';

// ─── Thresholds (based on Google / WCAG guidelines) ──────────

const PERF = {
  LCP_GOOD:     2500,   // ms
  LCP_POOR:     4000,
  CLS_GOOD:     0.1,
  CLS_POOR:     0.25,
  INP_GOOD:     200,    // ms
  INP_POOR:     500,
  TTFB_GOOD:    800,    // ms
  TTFB_POOR:    1800,
  LOAD_GOOD:    3000,   // ms
  LOAD_POOR:    8000,
  PAYLOAD_GOOD: 1 * 1024 * 1024,   // 1 MB
  PAYLOAD_POOR: 5 * 1024 * 1024,   // 5 MB
};

// ─── Helpers ─────────────────────────────────────────────────

/** Linear interpolation: returns score 100→0 as value goes from good→poor */
function linearScore(value: number, good: number, poor: number): number {
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round(100 * (1 - (value - good) / (poor - good)));
}

/** Deduct `penalty` points from `base`, floor at 0 */
function deduct(base: number, penalty: number): number {
  return Math.max(0, base - penalty);
}

// ─── Category Scorers ─────────────────────────────────────────

function scorePerformance(m: PerformanceMetrics): number {
  let score = 100;
  const signals: number[] = [];

  // Lighthouse score is our primary performance signal if available
  if (m.lighthousePerformanceScore !== null) {
    return m.lighthousePerformanceScore; // already 0–100
  }

  // Fallback: individual metric scoring
  if (m.lcp !== null) signals.push(linearScore(m.lcp, PERF.LCP_GOOD, PERF.LCP_POOR));
  if (m.cls !== null) signals.push(linearScore(m.cls, PERF.CLS_GOOD, PERF.CLS_POOR));
  if (m.inp !== null) signals.push(linearScore(m.inp, PERF.INP_GOOD, PERF.INP_POOR));
  if (m.ttfb !== null) signals.push(linearScore(m.ttfb, PERF.TTFB_GOOD, PERF.TTFB_POOR));
  if (m.totalLoadTime !== null) signals.push(linearScore(m.totalLoadTime, PERF.LOAD_GOOD, PERF.LOAD_POOR));

  if (signals.length === 0) return 50; // No data — neutral

  score = Math.round(signals.reduce((a, b) => a + b, 0) / signals.length);

  // Payload penalty
  if (m.totalPayloadBytes !== null) {
    if (m.totalPayloadBytes > PERF.PAYLOAD_POOR) score = deduct(score, 20);
    else if (m.totalPayloadBytes > PERF.PAYLOAD_GOOD) score = deduct(score, 8);
  }

  // Uncompressed image penalty
  if (m.uncompressedImagesCount > 0) {
    const mbUncomp = bytesToMb(m.uncompressedImagesTotalBytes);
    score = deduct(score, Math.min(20, Math.round(mbUncomp * 4)));
  }

  return Math.max(0, Math.min(100, score));
}

function scoreMobileUx(m: MobileUxMetrics): number {
  let score = 100;

  if (!m.hasViewportMeta) score = deduct(score, 30);
  else if (m.viewportContent && !m.viewportContent.includes('width=device-width')) {
    score = deduct(score, 15);
  }

  if (m.hasHorizontalScroll || m.contentOverflowOnMobile) score = deduct(score, 20);

  // Tap target penalty: scale with violation count
  const tapPenalty = Math.min(25, m.smallTapTargets.length * 3);
  score = deduct(score, tapPenalty);

  if (m.hasIntrusivePopup) score = deduct(score, 15);

  if (m.hasIntrusivePopup) score = deduct(score, 15);

  return Math.max(0, Math.min(100, score));
}

function scoreAccessibility(m: AccessibilityMetrics): number {
  let score = 100;

  if (m.missingLangAttribute) score = deduct(score, 15);

  // Images without alt attribute (not empty alt — empty alt is valid for decorative images)
  const altPenalty = Math.min(20, m.imagesWithoutAlt * 4);
  score = deduct(score, altPenalty);

  // Form inputs without labels
  const labelPenalty = Math.min(15, m.formInputsWithoutLabel * 5);
  score = deduct(score, labelPenalty);

  // Colour contrast violations
  const contrastPenalty = Math.min(15, m.colorContrastViolations * 3);
  score = deduct(score, contrastPenalty);

  // axe-core violations weighted by impact
  const criticalAxe = m.axeViolations.filter((v) => v.impact === 'critical').reduce((s, v) => s + v.nodeCount, 0);
  const seriousAxe  = m.axeViolations.filter((v) => v.impact === 'serious').reduce((s, v) => s + v.nodeCount, 0);
  score = deduct(score, Math.min(20, criticalAxe * 5));
  score = deduct(score, Math.min(15, seriousAxe * 2));

  return Math.max(0, Math.min(100, score));
}

function scoreTechAndSeo(t: TechStackMetrics, s: SeoMetrics): number {
  let score = 100;

  // Security
  if (!t.isHttps) score = deduct(score, 25);
  else if (!t.sslValid) score = deduct(score, 20);
  if (t.hasMixedContent) score = deduct(score, 10);

  // Legacy tech
  const criticalFrameworks = t.detectedLegacyFrameworks.filter((f) => f.severity === 'critical').length;
  const warningFrameworks  = t.detectedLegacyFrameworks.filter((f) => f.severity === 'warning').length;
  score = deduct(score, Math.min(15, criticalFrameworks * 8));
  score = deduct(score, Math.min(10, warningFrameworks * 3));

  if (t.hasFrameset)  score = deduct(score, 10);
  if (t.hasFlashObjects) score = deduct(score, 10);
  if (t.hasTableLayout) score = deduct(score, 5);
  if (!t.hasHtml5Landmarks) score = deduct(score, 5);

  // SEO basics
  if (!s.titleTag) score = deduct(score, 10);
  else if (s.titleTagCount > 1) score = deduct(score, 5);
  if (!s.metaDescription) score = deduct(score, 8);
  else if (s.metaDescriptionCount > 1) score = deduct(score, 3);

  // Broken links penalty
  const brokenCount = s.brokenInternalLinks.length + s.brokenAssetLinks.length;
  score = deduct(score, Math.min(15, brokenCount * 3));

  // Console errors
  const errCount = s.consoleErrors.filter((e) => e.type === 'error').length;
  score = deduct(score, Math.min(10, errCount * 2));

  return Math.max(0, Math.min(100, score));
}

// ─── Overall Scoring ─────────────────────────────────────────

function gradeFromScore(score: number): Grade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'F';
}

export function computeScores(
  perf: PerformanceMetrics,
  mobile: MobileUxMetrics,
  a11y: AccessibilityMetrics,
  tech: TechStackMetrics,
  seo: SeoMetrics,
  legacy: LegacyScoreBreakdown,
): ScoringResult {
  const categoryScores: CategoryScores = {
    performance:   scorePerformance(perf),
    mobileUx:      scoreMobileUx(mobile),
    accessibility: scoreAccessibility(a11y),
    techAndSeo:    scoreTechAndSeo(tech, seo),
  };

  let overallScore = Math.round(
    categoryScores.performance   * 0.20 +
    categoryScores.mobileUx      * 0.40 +
    categoryScores.accessibility * 0.20 +
    categoryScores.techAndSeo    * 0.20,
  );

  // ── Vintage / Outdated Design Hard Cap ─────────────────────────
  // If the site exhibits 1990s/early-2000s design hallmarks (no modern layout,
  // raw default serif, unstyled blue links, obsolete HTML tags, no visual depth),
  // fast load times (low HTML payload) must NEVER disguise a dated visual presentation.
  // We cap overall score at 42 to guarantee a Grade F and immediate lead qualification.
  if (legacy.is_candidate) {
    overallScore = Math.min(overallScore, 42);
  }

  return {
    overallScore,
    categoryScores,
    grade: gradeFromScore(overallScore),
    isHighPriorityTarget: overallScore < 50,
  };
}

// ─── Issue & Quick-Win Generator ─────────────────────────────

export function generateIssues(
  perf: PerformanceMetrics,
  mobile: MobileUxMetrics,
  a11y: AccessibilityMetrics,
  tech: TechStackMetrics,
  seo: SeoMetrics,
  legacy: LegacyScoreBreakdown,
): Issue[] {
  const issues: Issue[] = [];

  // ── Performance issues ──────────────────────────────────────
  if (perf.lcp !== null && perf.lcp > PERF.LCP_POOR) {
    issues.push({
      category: 'performance',
      severity: 'critical',
      title: 'Extremely slow Largest Contentful Paint',
      detail: `LCP is ${msToReadable(perf.lcp)}, which is considered "poor" by Google (threshold: 4s).`,
      businessImpact: `Slow LCP directly increases bounce rates. Google data shows 53% of mobile users abandon pages that take over 3 seconds to load.`,
      metric: perf.lcp,
    });
  } else if (perf.lcp !== null && perf.lcp > PERF.LCP_GOOD) {
    issues.push({
      category: 'performance',
      severity: 'warning',
      title: 'Slow Largest Contentful Paint (LCP needs improvement)',
      detail: `LCP is ${msToReadable(perf.lcp)}. Good threshold is under 2.5s.`,
      businessImpact: 'Poor LCP is a Core Web Vital that negatively affects Google Search rankings.',
      metric: perf.lcp,
    });
  }

  if (perf.cls !== null && perf.cls > PERF.CLS_POOR) {
    issues.push({
      category: 'performance',
      severity: 'critical',
      title: 'High Cumulative Layout Shift (CLS)',
      detail: `CLS score is ${round(perf.cls, 3)}. Google's threshold for "poor" is above 0.25.`,
      businessImpact: 'Layout instability causes users to mis-click and erodes trust. CLS is a Core Web Vital affecting SEO rankings.',
      metric: perf.cls,
    });
  }

  if (perf.totalPayloadBytes !== null && perf.totalPayloadBytes > PERF.PAYLOAD_POOR) {
    issues.push({
      category: 'performance',
      severity: 'critical',
      title: 'Excessive page payload size',
      detail: `Total page weight is ${bytesToMb(perf.totalPayloadBytes)} MB — far exceeding the recommended 1–3 MB.`,
      businessImpact: 'Heavy pages consume mobile data allowances and load slowly on 4G connections, dramatically increasing bounce rates.',
      metric: `${bytesToMb(perf.totalPayloadBytes)} MB`,
    });
  }

  if (perf.uncompressedImagesCount > 0) {
    const mbStr = bytesToMb(perf.uncompressedImagesTotalBytes);
    issues.push({
      category: 'performance',
      severity: perf.uncompressedImagesTotalBytes > 2_000_000 ? 'critical' : 'warning',
      title: 'Uncompressed legacy image formats detected',
      detail: `${perf.uncompressedImagesCount} image(s) served as PNG/JPEG totalling ${mbStr} MB. Modern formats like WebP or AVIF would reduce this by 30–80%.`,
      businessImpact: 'Large images are the #1 cause of slow page loads and wasted bandwidth on mobile devices.',
      metric: `${mbStr} MB in ${perf.uncompressedImagesCount} image(s)`,
    });
  }

  if (perf.ttfb !== null && perf.ttfb > PERF.TTFB_POOR) {
    issues.push({
      category: 'performance',
      severity: 'warning',
      title: 'Slow Time to First Byte (TTFB)',
      detail: `TTFB is ${msToReadable(perf.ttfb)}. Target is under 800ms.`,
      businessImpact: 'High TTFB indicates slow server response — may indicate unoptimised backend, absent CDN, or resource bottlenecks.',
      metric: perf.ttfb,
    });
  }

  // ── Mobile UX issues ────────────────────────────────────────
  if (!mobile.hasViewportMeta) {
    issues.push({
      category: 'mobileUx',
      severity: 'critical',
      title: 'Missing viewport meta tag',
      detail: 'The page has no <meta name="viewport"> tag, preventing proper mobile scaling.',
      businessImpact: 'Without a viewport meta tag, mobile browsers render the page at desktop width, making it unusable on phones. Google also penalises non-mobile-friendly pages in search rankings.',
      metric: null,
    });
  }

  if (mobile.hasHorizontalScroll || mobile.contentOverflowOnMobile) {
    issues.push({
      category: 'mobileUx',
      severity: 'critical',
      title: 'Horizontal scroll / content overflow on mobile',
      detail: 'Content extends beyond the mobile viewport width, forcing users to scroll horizontally.',
      businessImpact: 'Horizontal scrolling is a major UX failure on mobile devices, indicating the layout is not responsive. This is a Google mobile-friendliness ranking factor.',
      metric: null,
    });
  }

  if (mobile.smallTapTargets.length > 3) {
    issues.push({
      category: 'mobileUx',
      severity: 'warning',
      title: `${mobile.smallTapTargets.length} interactive elements have undersized tap targets`,
      detail: `Touch targets smaller than 48×48px cause frequent mis-taps. Found: ${mobile.smallTapTargets.slice(0, 3).map((t) => `${t.label} (${t.width}×${t.height}px)`).join(', ')}${mobile.smallTapTargets.length > 3 ? ` and ${mobile.smallTapTargets.length - 3} more` : ''}.`,
      businessImpact: 'Small tap targets frustrate mobile users, increase interaction errors, and signal poor mobile-first design.',
      metric: mobile.smallTapTargets.length,
    });
  }

  if (mobile.hasIntrusivePopup) {
    issues.push({
      category: 'mobileUx',
      severity: 'warning',
      title: 'Intrusive interstitial / popup detected on page load',
      detail: 'A large overlay or popup is blocking the main content on initial page load.',
      businessImpact: 'Google penalises pages with intrusive interstitials in mobile search rankings. Users immediately bounce when key content is hidden behind popups.',
      metric: null,
    });
  }

  // ── Design Aesthetics & Visual Obsoleteness (Legacy Pipeline) ─
  if (legacy.is_candidate) {
    issues.push({
      category: 'mobileUx',
      severity: 'critical',
      title: `Severely outdated visual design (${legacy.estimated_era})`,
      detail: `The site exhibits obsolete design hallmarks. Ugliness score: ${legacy.score}/100. Issues: ${Object.values(legacy.breakdown).filter(b => b.score > 0).map(b => b.reason).join('; ')}`,
      businessImpact: 'Users form brand credibility impressions within 50 milliseconds. Websites with 90s/00s-era aesthetics suffer immediate trust deficit, high bounce rates, and lost conversions.',
      metric: `${legacy.score}/100 ugliness score`,
    });
  } else if (legacy.score >= 20) {
    issues.push({
      category: 'mobileUx',
      severity: 'warning',
      title: 'Dated visual styling & lack of modern design polish',
      detail: `The website lacks modern layout techniques or typographic hierarchy. Ugliness Score: ${legacy.score}/100.`,
      businessImpact: 'A dated look-and-feel diminishes perceived service quality and causes modern visitors to seek competitors.',
      metric: `${legacy.score}/100 ugliness score`,
    });
  }

  // ── Accessibility issues ────────────────────────────────────
  if (a11y.missingLangAttribute) {
    issues.push({
      category: 'accessibility',
      severity: 'critical',
      title: 'Missing lang attribute on <html> element',
      detail: 'The root <html> element does not have a lang attribute (e.g., lang="en").',
      businessImpact: 'Screen readers cannot correctly pronounce content without a language declaration. This is a WCAG 2.1 Level A failure that may create legal compliance risk.',
      metric: null,
    });
  }

  if (a11y.imagesWithoutAlt > 0) {
    issues.push({
      category: 'accessibility',
      severity: 'critical',
      title: `${a11y.imagesWithoutAlt} image(s) missing alt attribute`,
      detail: `${a11y.imagesWithoutAlt} <img> element(s) have no alt attribute. Screen readers will read out the filename instead.`,
      businessImpact: 'Missing alt text excludes blind and visually-impaired users, violates WCAG 2.1 Level A (1.1.1), and may result in ADA/accessibility lawsuit exposure.',
      metric: a11y.imagesWithoutAlt,
    });
  }

  if (a11y.colorContrastViolations > 5) {
    issues.push({
      category: 'accessibility',
      severity: 'warning',
      title: 'Colour contrast violations detected',
      detail: `${a11y.colorContrastViolations} text element(s) have insufficient contrast ratio (WCAG requires 4.5:1 for normal text).`,
      businessImpact: 'Poor contrast makes text unreadable for users with low vision or colour blindness (~8% of males). Violates WCAG 2.1 Level AA (1.4.3).',
      metric: a11y.colorContrastViolations,
    });
  }

  if (a11y.formInputsWithoutLabel > 0) {
    issues.push({
      category: 'accessibility',
      severity: 'critical',
      title: `${a11y.formInputsWithoutLabel} form input(s) missing accessible labels`,
      detail: 'Form inputs without associated <label> elements are inaccessible to screen reader users.',
      businessImpact: 'Unlabelled form fields make checkout, signup, and contact forms unusable for assistive technology users — violating WCAG 2.1 Level A (1.3.1).',
      metric: a11y.formInputsWithoutLabel,
    });
  }

  // Top axe-core critical violations
  const criticalAxeViolations = a11y.axeViolations.filter((v) => v.impact === 'critical' || v.impact === 'serious').slice(0, 3);
  for (const v of criticalAxeViolations) {
    if (!issues.some((i) => i.title.includes(v.id))) {
      issues.push({
        category: 'accessibility',
        severity: v.impact === 'critical' ? 'critical' : 'warning',
        title: `WCAG violation: ${v.id} (${v.nodeCount} element${v.nodeCount > 1 ? 's' : ''})`,
        detail: v.description,
        businessImpact: 'Automated WCAG violations indicate real accessibility barriers for users with disabilities.',
        metric: v.nodeCount,
      });
    }
  }

  // ── Tech & SEO issues ───────────────────────────────────────
  if (!tech.isHttps) {
    issues.push({
      category: 'techAndSeo',
      severity: 'critical',
      title: 'Site is not served over HTTPS',
      detail: 'The page is delivered over HTTP without encryption.',
      businessImpact: 'Chrome marks HTTP sites as "Not Secure". Google has used HTTPS as a ranking signal since 2014. User data is transmitted in plaintext, creating legal and security exposure.',
      metric: null,
    });
  } else if (!tech.sslValid) {
    issues.push({
      category: 'techAndSeo',
      severity: 'critical',
      title: `SSL certificate issue: ${tech.sslError}`,
      detail: 'The SSL certificate is invalid or expired, causing browser security warnings.',
      businessImpact: 'An invalid SSL certificate triggers browser "Your connection is not private" errors, effectively blocking access for most users and destroying conversions.',
      metric: tech.sslError,
    });
  }

  if (tech.hasMixedContent) {
    issues.push({
      category: 'techAndSeo',
      severity: 'warning',
      title: 'Mixed content: HTTP resources loaded on HTTPS page',
      detail: 'The HTTPS page loads some resources (scripts, images) over HTTP.',
      businessImpact: 'Mixed content blocks active resources in modern browsers and triggers security warnings, breaking page functionality.',
      metric: null,
    });
  }

  for (const fw of tech.detectedLegacyFrameworks) {
    issues.push({
      category: 'techAndSeo',
      severity: fw.severity,
      title: `Legacy framework detected: ${fw.name}${fw.version ? ` v${fw.version}` : ''}`,
      detail: fw.reason,
      businessImpact: 'Legacy frameworks carry security vulnerabilities, increase page weight, and signal technical debt to users and search engines.',
      metric: fw.version,
    });
  }

  if (tech.hasFlashObjects) {
    issues.push({
      category: 'techAndSeo',
      severity: 'critical',
      title: 'Flash / SWF objects detected',
      detail: 'The page contains Flash objects. Flash support was removed from all browsers in 2020.',
      businessImpact: 'Flash content is completely non-functional in all modern browsers. Users see blank boxes where content should appear.',
      metric: null,
    });
  }

  if (!seo.titleTag) {
    issues.push({
      category: 'techAndSeo',
      severity: 'critical',
      title: 'Missing <title> tag',
      detail: 'The page has no <title> element.',
      businessImpact: 'Without a title tag, the page cannot appear properly in search engine results. Google uses the title as the clickable headline in SERPs.',
      metric: null,
    });
  }

  if (!seo.metaDescription) {
    issues.push({
      category: 'techAndSeo',
      severity: 'warning',
      title: 'Missing meta description',
      detail: 'No <meta name="description"> tag found.',
      businessImpact: 'Without a meta description, Google auto-generates snippets, often producing irrelevant text. This reduces click-through rates from search results.',
      metric: null,
    });
  }

  if (seo.brokenInternalLinks.length > 0) {
    issues.push({
      category: 'techAndSeo',
      severity: 'warning',
      title: `${seo.brokenInternalLinks.length} broken internal link(s) detected`,
      detail: `Broken links found: ${seo.brokenInternalLinks.slice(0, 3).map((l) => l.url).join(', ')}${seo.brokenInternalLinks.length > 3 ? '...' : ''}`,
      businessImpact: 'Broken links damage user experience, waste crawl budget, and signal site neglect to search engines.',
      metric: seo.brokenInternalLinks.length,
    });
  }

  const jsErrors = seo.consoleErrors.filter((e) => e.type === 'error');
  if (jsErrors.length > 0) {
    issues.push({
      category: 'techAndSeo',
      severity: 'warning',
      title: `${jsErrors.length} JavaScript console error(s) detected`,
      detail: `Errors: ${jsErrors.slice(0, 2).map((e) => e.message.slice(0, 80)).join('; ')}`,
      businessImpact: 'Uncaught JavaScript errors break interactive features and indicate code quality issues that degrade user experience.',
      metric: jsErrors.length,
    });
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

export function generateQuickWins(
  perf: PerformanceMetrics,
  mobile: MobileUxMetrics,
  a11y: AccessibilityMetrics,
  tech: TechStackMetrics,
  seo: SeoMetrics,
  legacy: LegacyScoreBreakdown,
): QuickWin[] {
  const wins: QuickWin[] = [];

  if (perf.uncompressedImagesCount > 0) {
    wins.push({
      category: 'performance',
      effort: 'low',
      title: 'Convert images to WebP/AVIF',
      action: `Run: for img in *.{jpg,png}; do cwebp "$img" -o "${'${img%.*}'}.webp"; done — or use Squoosh.app for batch conversion.`,
      estimatedImpact: `Could reduce image payload by ~50%, saving ${bytesToMb(perf.uncompressedImagesTotalBytes * 0.5)} MB. Directly improves LCP.`,
    });
  }

  if (!mobile.hasViewportMeta) {
    wins.push({
      category: 'mobileUx',
      effort: 'low',
      title: 'Add viewport meta tag',
      action: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> to <head>.',
      estimatedImpact: 'Immediately fixes mobile rendering. Single-line change with dramatic mobile UX improvement.',
    });
  }

  if (legacy.is_candidate) {
    wins.push({
      category: 'mobileUx',
      effort: 'medium',
      title: 'Modernize layout and visual typography design system',
      action: 'Adopt CSS Flexbox/Grid for containers, implement a modern sans-serif system font stack (e.g. system-ui, -apple-system, sans-serif), replace raw blue links with branded interactive styles, and add modern card/button radius.',
      estimatedImpact: 'Transforms the site from a legacy aesthetic into a professional, trustworthy modern presence. Immediately restores visitor trust and conversion rates.',
    });
  }

  if (a11y.missingLangAttribute) {
    wins.push({
      category: 'accessibility',
      effort: 'low',
      title: 'Add lang attribute to <html> element',
      action: 'Change <html> to <html lang="en"> (or appropriate language code).',
      estimatedImpact: 'Fixes WCAG 2.1 Level A violation. Screen readers will announce content in the correct language. One-word change.',
    });
  }

  if (a11y.imagesWithoutAlt > 0) {
    wins.push({
      category: 'accessibility',
      effort: 'low',
      title: `Add alt attributes to ${a11y.imagesWithoutAlt} image(s)`,
      action: 'For meaningful images: alt="describe the image content". For decorative images: alt="".',
      estimatedImpact: 'Fixes WCAG 1.1.1 (Level A). Improves screen reader experience and image SEO simultaneously.',
    });
  }

  if (!seo.titleTag) {
    wins.push({
      category: 'techAndSeo',
      effort: 'low',
      title: 'Add a descriptive <title> tag',
      action: 'Add <title>Your Page Title | Brand Name</title> to <head>. Keep it under 60 characters.',
      estimatedImpact: 'Essential for appearing in search results. Improves CTR from SERPs. Takes minutes to implement.',
    });
  }

  if (!seo.metaDescription) {
    wins.push({
      category: 'techAndSeo',
      effort: 'low',
      title: 'Add meta description',
      action: 'Add <meta name="description" content="Your 150-160 character description here."> to <head>.',
      estimatedImpact: 'Improves click-through rate from search results by providing a compelling search snippet. 15-minute implementation.',
    });
  }

  if (tech.hasMixedContent) {
    wins.push({
      category: 'techAndSeo',
      effort: 'low',
      title: 'Fix mixed content: upgrade HTTP resource URLs to HTTPS',
      action: 'Find-and-replace http:// with https:// in your templates for all internal asset paths. Add a Content-Security-Policy: upgrade-insecure-requests header.',
      estimatedImpact: 'Eliminates browser mixed-content warnings. Prevents browser from blocking active mixed content.',
    });
  }

  if (!tech.hasHtml5Landmarks) {
    wins.push({
      category: 'accessibility',
      effort: 'low',
      title: 'Add HTML5 semantic landmarks',
      action: `Wrap your page sections: <header>, <nav>, <main>, and <footer>. Missing: ${tech.missingLandmarks.join(', ')}.`,
      estimatedImpact: 'Allows keyboard and screen reader users to jump between sections. Improves semantic HTML structure scored by search engines.',
    });
  }

  if (!seo.hasRobotsTxt) {
    wins.push({
      category: 'techAndSeo',
      effort: 'low',
      title: 'Add a robots.txt file',
      action: 'Create /robots.txt at your domain root with basic directives: User-agent: *\\nAllow: /',
      estimatedImpact: 'Helps search engine crawlers navigate your site correctly. Missing robots.txt triggers crawl warnings in Google Search Console.',
    });
  }

  if (perf.totalLoadTime !== null && perf.totalLoadTime > PERF.LOAD_GOOD && perf.ttfb !== null && perf.ttfb > PERF.TTFB_GOOD) {
    wins.push({
      category: 'performance',
      effort: 'medium',
      title: 'Add server-side caching or CDN',
      action: 'Implement a CDN (Cloudflare free tier, AWS CloudFront) and enable server-side caching headers (Cache-Control: max-age=31536000 for static assets).',
      estimatedImpact: `Could reduce TTFB from ${msToReadable(perf.ttfb)} to under 200ms for returning visitors. Major performance boost with no code changes.`,
    });
  }

  if (a11y.formInputsWithoutLabel > 0) {
    wins.push({
      category: 'accessibility',
      effort: 'low',
      title: `Label ${a11y.formInputsWithoutLabel} unlabelled form input(s)`,
      action: 'Add <label for="inputId">Field name</label> paired with id="inputId" on the input, or use aria-label="Field name" directly on the input element.',
      estimatedImpact: 'Fixes WCAG 1.3.1 and 4.1.2. Makes forms accessible to screen reader users and improves conversion rates.',
    });
  }

  return wins;
}
