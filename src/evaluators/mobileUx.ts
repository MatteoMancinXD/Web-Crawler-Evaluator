// ============================================================
// src/evaluators/mobileUx.ts
// Mobile responsiveness & UX failure detection
// ============================================================

import { Page } from 'playwright';
import { MobileUxMetrics, TapTargetViolation } from '../types/index.js';
import { logger } from '../utils/logger.js';

const MIN_TAP_TARGET_PX = 48;

/**
 * Evaluate mobile UX metrics & visual design aesthetics:
 * - Viewport meta tag
 * - Horizontal scroll / content overflow
 * - Tap target sizes
 * - Intrusive popup/overlay detection
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

      return {
        hasViewportMeta,
        viewportContent,
        hasHorizontalScroll,
        smallTapTargets: smallTapTargets.slice(0, 20), // cap report at 20
        hasIntrusivePopup,
        contentOverflowOnMobile,
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
    };
  }
}
