// ============================================================
// src/evaluators/legacyDesign.ts
// Outdated & Cluttered Website Scoring Pipeline
// ============================================================

import { Page } from 'playwright';
import { LegacyDesignMetrics, LegacyScoreBreakdown } from '../types/index.js';
import { LEGACY_THRESHOLDS } from '../scoring/legacyThresholds.js';
import { logger } from '../utils/logger.js';

/**
 * Stage 1 & 2: Fast DOM Parser & Computed Layouts
 * Combines everything in one fast page.evaluate call.
 */
export async function evaluateLegacyDesign(
  desktopPage: Page,
  mobilePage: Page,
): Promise<{ metrics: LegacyDesignMetrics; scoreBreakdown: LegacyScoreBreakdown }> {
  try {
    // Collect DOM metrics from Desktop Viewport
    const desktopMetrics = await desktopPage.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));
      const domNodeCount = allEls.length;

      // Nav Links
      let navLinkCount = 0;
      let hasMegaMenu = false;
      const navs = document.querySelectorAll('nav, [role="navigation"], header .menu, header ul');
      navs.forEach((nav) => {
        const links = nav.querySelectorAll('a').length;
        if (links > navLinkCount) {
          navLinkCount = links;
        }
      });
      if (navLinkCount > 30) hasMegaMenu = true;

      // Typography
      const bodyComputed = window.getComputedStyle(document.body);
      const pEl = document.querySelector('p');
      const pComputed = pEl ? window.getComputedStyle(pEl) : bodyComputed;
      
      const bodyFontSizePx = parseFloat(pComputed.fontSize) || 16;
      let bodyLineHeight = 1.5;
      if (pComputed.lineHeight !== 'normal') {
        const lhPx = parseFloat(pComputed.lineHeight);
        if (!isNaN(lhPx) && bodyFontSizePx > 0) {
          bodyLineHeight = lhPx / bodyFontSizePx;
        }
      }

      const fontStr = pComputed.fontFamily.toLowerCase();
      const isLegacyWebSafeFont = /arial|verdana|tahoma|trebuchet ms|times new roman|comic sans/i.test(fontStr) && !fontStr.includes('system-ui') && !fontStr.includes('inter');

      // Layout
      let hasFixedLegacyWidth = false;
      let usesLegacyFloatClear = false;
      let usesFlexOrGrid = false;
      let hasSharpBorders = true; // Assume sharp unless rounded found

      const topContainers = Array.from(document.querySelectorAll<HTMLElement>('body > div, body > table, #wrapper, #container, .container, .main, table')).slice(0, 10);
      for (const el of topContainers) {
        const style = window.getComputedStyle(el);
        const w = parseFloat(style.width);
        if (w >= 800 && w <= 1024 && style.maxWidth === 'none' && !el.style.width.includes('%')) {
          hasFixedLegacyWidth = true;
        }
      }

      // Check floats/flex
      const layoutCandidates = Array.from(document.querySelectorAll<HTMLElement>('header, nav, main, footer, section, article, div, ul, li')).slice(0, 50);
      let roundedCount = 0;
      for (const el of layoutCandidates) {
        const style = window.getComputedStyle(el);
        if (style.display === 'flex' || style.display === 'grid') usesFlexOrGrid = true;
        if (style.float === 'left' || style.float === 'right') usesLegacyFloatClear = true;
        if (parseFloat(style.borderRadius) > 2) roundedCount++;
      }
      if (roundedCount > 2) hasSharpBorders = false;

      // Legacy Tech
      let copyrightYear: number | null = null;
      const footer = document.querySelector('footer') || document.body;
      const copyrightMatch = footer.innerText.match(/©\s*(?:19|20)\d{2}\s*(?:-|to)?\s*(20\d{2})/i) || footer.innerText.match(/©\s*(20\d{2})/i) || footer.innerText.match(/copyright(?:.*)?\s+(20\d{2})/i);
      if (copyrightMatch && copyrightMatch[1]) {
        copyrightYear = parseInt(copyrightMatch[1], 10);
      }

      const obsoleteTags = ['font', 'center', 'marquee', 'blink', 'table[cellpadding]'];
      const hasObsoleteHtmlTags = obsoleteTags.some((tag) => !!document.querySelector(tag));
      
      const hasLegacyCssFrameworks = !!document.querySelector('link[href*="bootstrap/2"], link[href*="bootstrap/3"], link[href*="960.css"]');

      return {
        domNodeCount,
        navLinkCount,
        hasMegaMenu,
        typography: {
          bodyFontSizePx,
          bodyLineHeight,
          isLegacyWebSafeFont,
        },
        layout: {
          hasFixedLegacyWidth,
          hasSharpBorders,
          usesLegacyFloatClear,
          usesFlexOrGrid,
        },
        legacyTech: {
          copyrightYear,
          hasObsoleteHtmlTags,
          hasLegacyCssFrameworks,
        }
      };
    });

    // Check Horizontal Overflow from Mobile Viewport
    const hasMobileHorizontalOverflow = await mobilePage.evaluate(() => {
      const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;
      return bodyScrollWidth > window.innerWidth + 5;
    }).catch(() => false);

    const metrics: LegacyDesignMetrics = {
      ...desktopMetrics,
      hasMobileHorizontalOverflow,
    };

    // Stage 3: Compute Score (0-100 Ugliness Score, higher = worse)
    const scoreBreakdown = computeLegacyScore(metrics);

    return { metrics, scoreBreakdown };
  } catch (err) {
    logger.warn(`Legacy design evaluation failed: ${(err as Error).message}`);
    return { metrics: getEmptyLegacyMetrics(), scoreBreakdown: getEmptyLegacyScore() };
  }
}

/**
 * Stage 3: Scoring Engine
 */
function computeLegacyScore(metrics: LegacyDesignMetrics): LegacyScoreBreakdown {
  let totalScore = 0;
  const breakdown = {
    typography: { score: 0, reason: 'Modern typography' },
    layout: { score: 0, reason: 'Modern layout' },
    navigation: { score: 0, reason: 'Clean navigation' },
    mobile_readiness: { score: 0, reason: 'Responsive on mobile' },
    density: { score: 0, reason: 'Good content density' },
    tech: { score: 0, reason: 'Modern tech footprint' },
  };
  const hooks: string[] = [];
  const { WEIGHTS } = LEGACY_THRESHOLDS;

  // 1. Density
  if (metrics.domNodeCount > LEGACY_THRESHOLDS.HIGH_DENSITY_DOM_NODES) {
    breakdown.density = { score: WEIGHTS.INFORMATION_DENSITY, reason: `Massive DOM node count (${metrics.domNodeCount}) indicating extreme clutter` };
    hooks.push(`The website is heavily cluttered with over ${metrics.domNodeCount} elements loading at once, overwhelming visitors.`);
  } else if (metrics.domNodeCount > LEGACY_THRESHOLDS.MAX_DOM_NODES) {
    breakdown.density = { score: WEIGHTS.INFORMATION_DENSITY / 2, reason: `High DOM node count (${metrics.domNodeCount})` };
  }
  totalScore += breakdown.density.score;

  // 2. Navigation
  if (metrics.navLinkCount > LEGACY_THRESHOLDS.MEGA_NAV_LINKS || metrics.hasMegaMenu) {
    breakdown.navigation = { score: WEIGHTS.NAVIGATION_BLOAT, reason: `Mega-menu detected with ${metrics.navLinkCount} links` };
    hooks.push(`The navigation menu contains ${metrics.navLinkCount} links, creating a confusing maze for potential customers trying to find information.`);
  } else if (metrics.navLinkCount > LEGACY_THRESHOLDS.MAX_NAV_LINKS) {
    breakdown.navigation = { score: WEIGHTS.NAVIGATION_BLOAT / 2, reason: `Dense navigation menu (${metrics.navLinkCount} links)` };
  }
  totalScore += breakdown.navigation.score;

  // 3. Typography
  let typoPenalty = 0;
  let typoReasons = [];
  if (metrics.typography.bodyFontSizePx < LEGACY_THRESHOLDS.MIN_BODY_FONT_PX) {
    typoPenalty += (WEIGHTS.TYPOGRAPHY * 0.4);
    typoReasons.push(`Body font size is ${Math.round(metrics.typography.bodyFontSizePx)}px (too small)`);
    hooks.push(`The body text size is only ${Math.round(metrics.typography.bodyFontSizePx)}px, which fails modern accessibility standards and is difficult to read on modern high-res screens.`);
  }
  if (metrics.typography.bodyLineHeight < LEGACY_THRESHOLDS.MIN_LINE_HEIGHT) {
    typoPenalty += (WEIGHTS.TYPOGRAPHY * 0.3);
    typoReasons.push(`Line-height is very tight (${metrics.typography.bodyLineHeight.toFixed(2)})`);
  }
  if (metrics.typography.isLegacyWebSafeFont) {
    typoPenalty += (WEIGHTS.TYPOGRAPHY * 0.3);
    typoReasons.push(`Using obsolete web-safe font stack`);
  }
  if (typoPenalty > 0) {
    breakdown.typography = { score: typoPenalty, reason: typoReasons.join(', ') };
    totalScore += typoPenalty;
  }

  // 4. Layout
  let layoutPenalty = 0;
  let layoutReasons = [];
  if (metrics.layout.hasFixedLegacyWidth) {
    layoutPenalty += (WEIGHTS.RIGID_LAYOUT * 0.5);
    layoutReasons.push('Rigid fixed-width container (e.g. 960px) detected');
    hooks.push('The website is locked into a rigid 2010s box-layout that wastes screen space on modern widescreen monitors.');
  }
  if (metrics.layout.usesLegacyFloatClear && !metrics.layout.usesFlexOrGrid) {
    layoutPenalty += (WEIGHTS.RIGID_LAYOUT * 0.3);
    layoutReasons.push('Using legacy float/clear instead of Flexbox/Grid');
  }
  if (metrics.layout.hasSharpBorders && !metrics.layout.usesFlexOrGrid) {
    layoutPenalty += (WEIGHTS.RIGID_LAYOUT * 0.2);
    layoutReasons.push('Harsh unstyled boxy UI');
  }
  if (layoutPenalty > 0) {
    breakdown.layout = { score: layoutPenalty, reason: layoutReasons.join(', ') };
    totalScore += layoutPenalty;
  }

  // 5. Mobile
  if (metrics.hasMobileHorizontalOverflow) {
    breakdown.mobile_readiness = { score: WEIGHTS.MOBILE_UNFRIENDLINESS, reason: 'Horizontal scroll overflow on mobile viewports' };
    hooks.push('The mobile layout is broken, forcing mobile users to scroll sideways to read content (horizontal overflow).');
    totalScore += WEIGHTS.MOBILE_UNFRIENDLINESS;
  }

  // 6. Tech
  let techPenalty = 0;
  let techReasons = [];
  if (metrics.legacyTech.copyrightYear !== null && metrics.legacyTech.copyrightYear < LEGACY_THRESHOLDS.MAX_ACCEPTABLE_COPYRIGHT_YEAR) {
    techPenalty += (WEIGHTS.LEGACY_FOOTPRINT * 0.5);
    techReasons.push(`Footer copyright is outdated (${metrics.legacyTech.copyrightYear})`);
    hooks.push(`The footer copyright is stuck in ${metrics.legacyTech.copyrightYear}, making the business look abandoned or unprofessional.`);
  }
  if (metrics.legacyTech.hasObsoleteHtmlTags || metrics.legacyTech.hasLegacyCssFrameworks) {
    techPenalty += (WEIGHTS.LEGACY_FOOTPRINT * 0.5);
    techReasons.push('Obsolete HTML tags (<center>, <font>) or legacy CSS framework detected');
  }
  if (techPenalty > 0) {
    breakdown.tech = { score: techPenalty, reason: techReasons.join(', ') };
    totalScore += techPenalty;
  }

  // Rounding
  totalScore = Math.min(100, Math.round(totalScore));
  Object.values(breakdown).forEach((b) => (b.score = Math.round(b.score)));

  let estimated_era = 'Modern';
  if (totalScore >= 70) estimated_era = '2000-2008 (Extremely Outdated)';
  else if (totalScore >= 40) estimated_era = '2009-2015 (Legacy/Boxy)';
  else if (totalScore >= 20) estimated_era = '2016-2019 (Aging)';

  return {
    score: totalScore,
    is_candidate: totalScore >= 40,
    estimated_era,
    breakdown,
    sales_pitch_hooks: Array.from(new Set(hooks)), // Unique hooks
  };
}

function getEmptyLegacyMetrics(): LegacyDesignMetrics {
  return {
    domNodeCount: 0,
    navLinkCount: 0,
    hasMegaMenu: false,
    hasMobileHorizontalOverflow: false,
    typography: { bodyFontSizePx: 16, bodyLineHeight: 1.5, isLegacyWebSafeFont: false },
    layout: { hasFixedLegacyWidth: false, hasSharpBorders: false, usesLegacyFloatClear: false, usesFlexOrGrid: true },
    legacyTech: { copyrightYear: null, hasObsoleteHtmlTags: false, hasLegacyCssFrameworks: false },
  };
}

function getEmptyLegacyScore(): LegacyScoreBreakdown {
  return {
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
  };
}
