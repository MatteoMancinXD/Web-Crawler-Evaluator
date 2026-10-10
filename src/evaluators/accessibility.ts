// ============================================================
// src/evaluators/accessibility.ts
// Accessibility (a11y) evaluation using DOM inspection + axe-core
// ============================================================

import { Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { AccessibilityMetrics, AxeViolation } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Run full accessibility evaluation:
 * 1. Quick DOM-based checks (alt attributes, lang tag, form labels)
 * 2. axe-core automated WCAG scan
 */
export async function evaluateAccessibility(page: Page): Promise<AccessibilityMetrics> {
  // ── 1. DOM-based checks ──────────────────────────────────────
  const domChecks = await page.evaluate(() => {
    // Images without alt or with empty alt
    const allImages = Array.from(document.querySelectorAll('img'));
    const imagesWithoutAlt = allImages.filter((img) => !img.hasAttribute('alt')).length;
    const imagesWithEmptyAlt = allImages.filter((img) => img.getAttribute('alt') === '').length;

    // Missing lang attribute on <html>
    const missingLangAttribute = !document.documentElement.hasAttribute('lang') ||
      document.documentElement.getAttribute('lang')?.trim() === '';

    // Form inputs without associated labels
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'));
    let formInputsWithoutLabel = 0;
    for (const input of inputs) {
      const id = input.getAttribute('id');
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledBy = input.getAttribute('aria-labelledby');
      const title = input.getAttribute('title');
      const hasExplicitLabel = id ? !!document.querySelector(`label[for="${id}"]`) : false;
      const hasWrappingLabel = !!input.closest('label');

      if (!hasExplicitLabel && !hasWrappingLabel && !ariaLabel && !ariaLabelledBy && !title) {
        formInputsWithoutLabel++;
      }
    }

    // Basic colour contrast violations — detect very light text on white or very dark text on black
    // (Full contrast check done by axe-core)
    const textEls = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, label')).slice(0, 100);
    let colorContrastViolations = 0;
    for (const el of textEls) {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bg    = style.backgroundColor;
      // Quick heuristic: rgba(0,0,0,0) background (transparent) or white on white
      if (color === bg && color !== 'rgba(0, 0, 0, 0)') {
        colorContrastViolations++;
      }
    }

    return {
      imagesWithoutAlt,
      imagesWithEmptyAlt,
      missingLangAttribute,
      formInputsWithoutLabel,
      colorContrastViolations,
    };
  });

  // ── 2. axe-core automated WCAG scan ─────────────────────────
  let axeViolations: AxeViolation[] = [];
  let axeTotalViolationCount = 0;
  let colorContrastViolationsAxe = domChecks.colorContrastViolations;

  try {
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
      .analyze();

    axeTotalViolationCount = axeResults.violations.reduce(
      (sum, v) => sum + v.nodes.length,
      0,
    );

    // Extract colour contrast violations from axe results
    const contrastViolation = axeResults.violations.find((v) => v.id === 'color-contrast');
    if (contrastViolation) {
      colorContrastViolationsAxe = contrastViolation.nodes.length;
    }

    axeViolations = axeResults.violations.map((v) => ({
      id: v.id,
      impact: (v.impact as AxeViolation['impact']) ?? null,
      description: v.description,
      nodeCount: v.nodes.length,
    }));
  } catch (err) {
    logger.warn(`axe-core scan failed: ${(err as Error).message}`);
  }

  return {
    imagesWithoutAlt: domChecks.imagesWithoutAlt,
    imagesWithEmptyAlt: domChecks.imagesWithEmptyAlt,
    colorContrastViolations: colorContrastViolationsAxe,
    formInputsWithoutLabel: domChecks.formInputsWithoutLabel,
    missingLangAttribute: domChecks.missingLangAttribute,
    axeViolations,
    axeTotalViolationCount,
  };
}
