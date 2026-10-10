// ============================================================
// src/evaluators/mobileUx.ts
// Mobile responsiveness & UX failure detection
// ============================================================

import { Page } from 'playwright';
import { MobileUxMetrics, TapTargetViolation, DesignAestheticsMetrics } from '../types/index.js';
import { logger } from '../utils/logger.js';

const MIN_TAP_TARGET_PX = 48;

/**
 * Evaluate mobile UX metrics & visual design aesthetics:
 * - Viewport meta tag
 * - Horizontal scroll / content overflow
 * - Tap target sizes
 * - Intrusive popup/overlay detection
 * - 1990s/vintage aesthetics detection (CSS Flexbox/Grid, typography, unstyled links, vintage tags, modern depth)
 */
export async function evaluateMobileUx(page: Page): Promise<MobileUxMetrics> {
  try {
    return await page.evaluate((minTap) => {
      // ── 1. Viewport meta ────────────────────────────────────
      const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      const hasViewportMeta = !!viewportMeta;
      const viewportContent = viewportMeta?.content ?? null;

      // ── 2. Horizontal scroll / overflow ─────────────────────
      const bodyScrollWidth = document.body ? document.body.scrollWidth : 0;
      const windowWidth = window.innerWidth;
      const hasHorizontalScroll = bodyScrollWidth > windowWidth + 5; // 5px tolerance

      // Check if any element overflows beyond viewport
      const allElements = Array.from(document.querySelectorAll('*'));
      const contentOverflowOnMobile = allElements.some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > windowWidth + 10 || rect.left < -10;
      });

      // ── 3. Tap target size audit ─────────────────────────────
      const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [onclick]';
      const interactiveEls = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelectors));
      const smallTapTargets: TapTargetViolation[] = [];

      for (const el of interactiveEls) {
        const rect = el.getBoundingClientRect();
        // Skip invisible elements
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.width < minTap || rect.height < minTap) {
          const label =
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.textContent?.trim().slice(0, 40) ||
            el.tagName.toLowerCase();
          smallTapTargets.push({
            selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            label,
          });
        }
      }

      // ── 4. Intrusive popup / overlay detection ───────────────
      const viewportArea = window.innerWidth * window.innerHeight;
      const overlaySelectors = [
        '[class*="modal"]', '[class*="popup"]', '[class*="overlay"]',
        '[class*="cookie"]', '[class*="gdpr"]', '[class*="banner"]',
        '[role="dialog"]', '[aria-modal="true"]',
      ];
      let hasIntrusivePopup = false;

      for (const sel of overlaySelectors) {
        const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
        for (const el of els) {
          const style = window.getComputedStyle(el);
          const rect  = el.getBoundingClientRect();
          const area   = rect.width * rect.height;
          const coversPct = area / viewportArea;
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1;
          const isFixed   = style.position === 'fixed' || style.position === 'absolute';
          const zIndex     = parseInt(style.zIndex, 10);

          if (isVisible && isFixed && !isNaN(zIndex) && zIndex > 100 && coversPct > 0.15) {
            hasIntrusivePopup = true;
            break;
          }
        }
        if (hasIntrusivePopup) break;
      }

      // ── 5. Design Aesthetics & Vintage Layout Detection ──────

      // (a) Check for modern layout engines (Flexbox / Grid)
      let modernLayoutFoundInElements = false;
      const layoutCandidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'header, nav, main, footer, section, article, aside, [class*="container"], [class*="wrapper"], [class*="row"], [class*="grid"], [class*="flex"], body > div',
        ),
      ).filter((el) => {
        const id = el.id.toLowerCase();
        const cls = el.className.toLowerCase();
        return !id.includes('cmp') && !cls.includes('cmp') && !id.includes('cookie') && !cls.includes('cookie') && !id.includes('consent') && !cls.includes('consent') && !id.includes('overlay') && !cls.includes('overlay');
      }).slice(0, 35);

      for (const el of layoutCandidates) {
        const disp = window.getComputedStyle(el).display;
        if (disp === 'flex' || disp === 'inline-flex' || disp === 'grid' || disp === 'inline-grid') {
          modernLayoutFoundInElements = true;
          break;
        }
      }

      // Safely scan stylesheets for media queries and css variables
      let hasMediaQueries = false;

      try {
        const sheets = Array.from(document.styleSheets);
        for (const sheet of sheets) {
          try {
            // Ignore external cross-origin sheets that usually belong to CMPs or Ads if we want,
            // but for media queries it's okay to scan.
            const rules = Array.from(sheet.cssRules || []);
            for (const rule of rules) {
              if (rule instanceof CSSMediaRule) {
                const mediaText = (rule.media?.mediaText || '').toLowerCase();
                if (mediaText.includes('width') || mediaText.includes('screen') || mediaText.includes('orientation')) {
                  hasMediaQueries = true;
                }
              } else if (rule instanceof CSSStyleRule) {
                // Ignore -- checks here because CMPs inject CSS variables
              }
            }
          } catch (_) {
            // SecurityError when reading cross-origin stylesheet - safe to ignore
          }
        }
      } catch (_) {}

      const modernLayoutUsed = modernLayoutFoundInElements;

      // (b) Typography evaluation
      const bodyComputed = document.body ? window.getComputedStyle(document.body) : null;
      const bodyFont = (bodyComputed?.fontFamily || '').toLowerCase();
      const pEl = document.querySelector('p');
      const pFont = pEl ? window.getComputedStyle(pEl).fontFamily.toLowerCase() : bodyFont;

      const isSerifRegex = /times new roman|times|serif|georgia|garamond|palatino/i;
      const isModernSansRegex = /system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica|arial|inter|poppins|montserrat|lato|sans-serif/i;

      // Check for modern web fonts loaded via <link> or <style>
      const hasWebFontLinks = !!document.querySelector(
        'link[href*="fonts.googleapis.com"], link[href*="use.typekit.net"], link[href*="fonts.bunny.net"]',
      );

      const hasDefaultSerifFont =
        (isSerifRegex.test(bodyFont) || isSerifRegex.test(pFont)) &&
        !isModernSansRegex.test(bodyFont) &&
        !hasWebFontLinks;

      const modernTypographyUsed = hasWebFontLinks || (isModernSansRegex.test(bodyFont) && !hasDefaultSerifFont);

      // (c) Raw unstyled browser links detection (#0000ee default blue with standard underline)
      const sampleLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .filter((a) => {
          const text = a.textContent?.trim() || '';
          if (text.length === 0) return false;
          // Exclude links inside CMP/Cookie banners
          const closestOverlay = a.closest('[id*="cmp" i], [class*="cmp" i], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]');
          return !closestOverlay;
        })
        .slice(0, 15);

      let rawUnstyledLinkCount = 0;
      for (const a of sampleLinks) {
        const aStyle = window.getComputedStyle(a);
        const col = aStyle.color.replace(/\s+/g, '');
        // Browser default unstyled link is rgb(0,0,238) or visited rgb(85,26,139)
        const isDefaultBlue = col === 'rgb(0,0,238)' || col === '#0000ee' || col === 'rgb(85,26,139)';
        const hasUnderline = aStyle.textDecorationLine.includes('underline');
        const hasNoPaddingOrBg =
          (parseFloat(aStyle.paddingTop) || 0) === 0 &&
          (aStyle.backgroundColor === 'rgba(0, 0, 0, 0)' || aStyle.backgroundColor === 'transparent');
        if (isDefaultBlue && hasUnderline && hasNoPaddingOrBg) {
          rawUnstyledLinkCount++;
        }
      }

      const hasRawUnstyledLinks = sampleLinks.length >= 3 && (rawUnstyledLinkCount / sampleLinks.length) >= 0.6;

      // (d) Vintage HTML tags and legacy attributes
      const vintageSelectors = [
        'center',
        'font',
        'marquee',
        'blink',
        'table[cellpadding]',
        'table[cellspacing]',
        'table[border]',
        'body[bgcolor]',
        'table[bgcolor]',
        'td[bgcolor]',
        '[align="center"]',
        'body[text]',
        'body[link]',
        'frameset',
        'frame',
      ];
      const vintageElementsFound: string[] = [];
      for (const sel of vintageSelectors) {
        if (document.querySelector(sel)) {
          vintageElementsFound.push(sel);
        }
      }

      // (e) Modern CSS aesthetic polish features (border-radius, box-shadow, transitions, gradients)
      let aestheticFeaturesCount = 0;
      const polishCandidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [class*="btn"], [class*="card"], [class*="box"], [class*="nav"], header, footer, img, input, a',
        ),
      ).filter((el) => {
        const id = el.id.toLowerCase();
        const cls = el.className.toLowerCase();
        const closestOverlay = el.closest('[id*="cmp" i], [class*="cmp" i], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]');
        return !closestOverlay && !id.includes('cmp') && !cls.includes('cmp') && !id.includes('cookie') && !cls.includes('cookie');
      }).slice(0, 30);

      let foundRadius = false;
      let foundShadow = false;
      let foundTransition = false;
      let foundGradient = false;

      for (const el of polishCandidates) {
        const style = window.getComputedStyle(el);
        if (!foundRadius && parseFloat(style.borderRadius) > 2) {
          foundRadius = true;
          aestheticFeaturesCount++;
        }
        if (!foundShadow && style.boxShadow && style.boxShadow !== 'none') {
          foundShadow = true;
          aestheticFeaturesCount++;
        }
        if (!foundTransition && style.transition && style.transition !== 'none' && !style.transition.includes('0s')) {
          foundTransition = true;
          aestheticFeaturesCount++;
        }
        if (!foundGradient && (style.backgroundImage.includes('gradient') || style.background.includes('gradient'))) {
          foundGradient = true;
          aestheticFeaturesCount++;
        }
      }

      // (f) Fixed legacy width container check
      let hasFixedLegacyWidth = false;
      const topContainers = Array.from(
        document.querySelectorAll<HTMLElement>('body > div, body > table, #wrapper, #container, .container, .main, table'),
      ).slice(0, 10);
      for (const el of topContainers) {
        const style = window.getComputedStyle(el);
        const w = parseFloat(style.width);
        const inlineW = el.getAttribute('width') || el.style.width;
        if (w >= 600 && w <= 1020 && style.maxWidth === 'none' && inlineW && !inlineW.includes('%')) {
          hasFixedLegacyWidth = true;
          break;
        }
      }

      // (g) Calculate Vintage Score & Classification
      let vintageScore = 0;
      if (!modernLayoutUsed) vintageScore += 25;
      if (hasDefaultSerifFont) vintageScore += 20;
      if (hasRawUnstyledLinks) vintageScore += 15;
      if (aestheticFeaturesCount === 0) vintageScore += 20;
      else if (aestheticFeaturesCount <= 2) vintageScore += 10;
      if (vintageElementsFound.length > 0) vintageScore += Math.min(30, vintageElementsFound.length * 10);
      if (!hasMediaQueries) vintageScore += 15;
      if (hasFixedLegacyWidth) vintageScore += 15;
      if (!hasViewportMeta) vintageScore += 10;

      vintageScore = Math.min(100, Math.max(0, vintageScore));

      const isOutdatedOrVintage =
        vintageScore >= 45 ||
        (vintageElementsFound.length >= 2 && !modernLayoutUsed) ||
        (hasDefaultSerifFont && hasRawUnstyledLinks) ||
        (!modernLayoutUsed && aestheticFeaturesCount === 0 && !hasMediaQueries);

      const visualStyleScore = Math.max(0, Math.min(100, 100 - vintageScore + (aestheticFeaturesCount * 5)));

      const designAesthetics: DesignAestheticsMetrics = {
        isOutdatedOrVintage,
        vintageScore,
        modernLayoutUsed,
        modernTypographyUsed,
        hasDefaultSerifFont,
        hasRawUnstyledLinks,
        aestheticFeaturesCount,
        vintageElementsFound,
        hasMediaQueries,
        hasFixedLegacyWidth,
        visualStyleScore,
      };

      return {
        hasViewportMeta,
        viewportContent,
        hasHorizontalScroll,
        smallTapTargets: smallTapTargets.slice(0, 20), // cap report at 20
        hasIntrusivePopup,
        contentOverflowOnMobile,
        designAesthetics,
      };
    }, MIN_TAP_TARGET_PX);
  } catch (err) {
    logger.warn(`Mobile UX evaluation failed: ${(err as Error).message}`);
    return {
      hasViewportMeta: false,
      viewportContent: null,
      hasHorizontalScroll: false,
      smallTapTargets: [],
      hasIntrusivePopup: false,
      contentOverflowOnMobile: false,
      designAesthetics: {
        isOutdatedOrVintage: false,
        vintageScore: 0,
        modernLayoutUsed: true,
        modernTypographyUsed: true,
        hasDefaultSerifFont: false,
        hasRawUnstyledLinks: false,
        aestheticFeaturesCount: 5,
        vintageElementsFound: [],
        hasMediaQueries: true,
        hasFixedLegacyWidth: false,
        visualStyleScore: 75,
      },
    };
  }
}
