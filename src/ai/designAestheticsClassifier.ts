// ============================================================
// src/ai/designAestheticsClassifier.ts
// Uses RizzoFlow to judge whether a website's visual design is
// modern or belongs to the 1990s/early-2000s era.
//
// The algorithmic signals gathered by mobileUx.ts (vintageScore,
// modernLayoutUsed, etc.) are passed as structured state to
// RizzoFlow, which then makes a holistic judgment with a
// calibrated probability.
//
// Falls back to the pure algorithmic result if RizzoFlow is
// unavailable.
// ============================================================

import { callRizzoFlow, noulIsYes, noulConfidence, NoulAnswer, ChoiceAnswer } from './rizzoFlowClient.js';
import { LegacyDesignMetrics } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ─── Output type ─────────────────────────────────────────────

export interface DesignEpochDecision {
  /** Overridden isOutdatedOrVintage value (consensus between heuristics + LLM) */
  isOutdatedOrVintage: boolean;
  /** Final vintage score 0–100 after LLM adjustment */
  vintageScore: number;
  /** LLM's classification of the design era */
  designEra: 'modern' | 'dated_2000s' | 'vintage_90s' | 'undetermined';
  /** Probability of the winning classification, 0–1 */
  confidence: number;
  /** Source of the decision */
  source: 'rizzo-flow' | 'algorithmic-fallback';
  /** Human-readable explanation */
  reason: string;
  /** Raw RizzoFlow latency in ms (if used) */
  rizzoLatencyMs?: number;
}

// ─── Main classifier ──────────────────────────────────────────

/**
 * Enrich the algorithmic DesignAestheticsMetrics with an LLM judgment
 * from RizzoFlow.
 *
 * Two questions are asked in one call:
 *  - design_era: which era does the design belong to?
 *  - is_vintage: yes/no binary
 *
 * The LLM result overrides `isOutdatedOrVintage` and adjusts the
 * `vintageScore` when confidence is high.
 */
export async function classifyDesignAesthetics(
  url: string,
  algorithmic: LegacyDesignMetrics,
): Promise<DesignEpochDecision> {

  // Build a rich state for the LLM, using all algorithmic signals
  const state = [
    `Website URL: ${url}`,
    '',
    'Algorithmic design signals collected by the audit engine:',
    `  Total DOM Nodes: ${algorithmic.domNodeCount}`,
    `  Maximum Navigation Links: ${algorithmic.navLinkCount} (MegaMenu: ${algorithmic.hasMegaMenu})`,
    `  Uses Flexbox or Grid layout: ${algorithmic.layout.usesFlexOrGrid}`,
    `  Uses legacy float/clear: ${algorithmic.layout.usesLegacyFloatClear}`,
    `  Fixed legacy-width container (≤ 1024px hardcoded): ${algorithmic.layout.hasFixedLegacyWidth}`,
    `  Has Sharp Borders (no radius): ${algorithmic.layout.hasSharpBorders}`,
    `  Body text size: ${Math.round(algorithmic.typography.bodyFontSizePx)}px`,
    `  Body line-height: ${algorithmic.typography.bodyLineHeight.toFixed(2)}`,
    `  Uses legacy web-safe fonts: ${algorithmic.typography.isLegacyWebSafeFont}`,
    `  Copyright Year: ${algorithmic.legacyTech.copyrightYear || 'Unknown'}`,
    `  Has Obsolete HTML Tags (<center>, <font>): ${algorithmic.legacyTech.hasObsoleteHtmlTags}`,
    `  Has Legacy CSS Frameworks (Bootstrap 2/3): ${algorithmic.legacyTech.hasLegacyCssFrameworks}`,
    '',
    'Use all of the above signals together to form a holistic judgment about the design era of this website.',
  ].join('\n');

  const rizzoResult = await callRizzoFlow(state, {
    design_era: {
      type: 'choice',
      instructions:
        'Based on all the signals above, which design era does this website most likely belong to? ' +
        '"modern" means post-2015 responsive design with contemporary CSS; ' +
        '"dated_2000s" means early-2000s style (tables, basic CSS, no Flexbox/Grid); ' +
        '"vintage_90s" means 1990s/early-web era (framesets, font tags, bgcolor, no CSS).',
      criteria: {
        modern:      'Post-2015 responsive design with contemporary CSS (Flexbox/Grid, modern fonts, etc.)',
        dated_2000s: 'Early-2000s style: tables, basic CSS, no Flexbox or Grid',
        vintage_90s: '1990s/early-web era: framesets, font tags, bgcolor attributes, no CSS',
      },
    },
    is_vintage: {
      type: 'noul',
      instructions:
        'Does this website have an outdated or vintage design that would make a visitor notice it looks old-fashioned? ' +
        'Answer YES if the design appears to be from before 2010, or if it lacks modern CSS conventions. ' +
        'Answer NO if the design looks contemporary and professional.',
    },
  });

  // ── Fallback ──────────────────────────────────────────────────
  if (rizzoResult === null) {
    logger.debug('[DesignClassifier] RizzoFlow unavailable — returning algorithmic result as-is.');
    return {
      isOutdatedOrVintage: algorithmic.legacyTech.hasObsoleteHtmlTags || algorithmic.layout.hasFixedLegacyWidth,
      vintageScore:        50,
      designEra:           'undetermined',
      confidence:  0.65,
      source:      'algorithmic-fallback',
      reason:      `RizzoFlow unavailable; using heuristic-only classification.`,
    };
  }

  // ── Parse RizzoFlow output ───────────────────────────────────
  const eraAnswer     = rizzoResult.answers['design_era']   as ChoiceAnswer | undefined;
  const vintageAnswer = rizzoResult.answers['is_vintage']   as NoulAnswer   | undefined;

  if (!eraAnswer || !vintageAnswer || eraAnswer.type !== 'choice' || vintageAnswer.type !== 'noul') {
    logger.warn('[DesignClassifier] Incomplete RizzoFlow response — using algorithmic fallback.');
    return {
      isOutdatedOrVintage: algorithmic.legacyTech.hasObsoleteHtmlTags || algorithmic.layout.hasFixedLegacyWidth,
      vintageScore:        50,
      designEra:           'undetermined',
      confidence:          0.5,
      source:              'algorithmic-fallback',
      reason:              'RizzoFlow returned an incomplete response.',
    };
  }

  const era          = eraAnswer.choice as DesignEpochDecision['designEra'];
  const eraProb      = eraAnswer.probabilities[era] ?? 0.5;
  const isVintageYes = noulIsYes(vintageAnswer);
  const vintageProb  = noulConfidence(vintageAnswer);  // 0=coin-flip, 1=certain
  const latencyMs    = Object.values(rizzoResult.x_rizzo?.timing ?? {}).find(v => typeof v === 'number');

  // ── Consensus override logic ───────────────────────────────────
  // We take the LLM decision when its confidence is >= 0.55.
  // Below that threshold we keep the algorithmic heuristic.
  const llmIsVintage = isVintageYes;
  const llmConfident = vintageProb >= 0.55;

  // Fallback defaults if heuristic fails
  const algoVintage = algorithmic.legacyTech.hasObsoleteHtmlTags || algorithmic.layout.hasFixedLegacyWidth;

  const finalIsVintage = llmConfident ? llmIsVintage : algoVintage;

  let finalVintageScore = 50;
  if (llmConfident) {
    finalVintageScore = llmIsVintage
      ? Math.min(100, 50 + Math.round(vintageProb * 50))
      : Math.max(0,   50 - Math.round(vintageProb * 50));
  }

  const confidence = (eraProb + vintageProb) / 2;

  logger.info(
    `[RizzoFlow] Design classification: ${era} / vintage=${isVintageYes} ` +
    `(confidence=${(confidence * 100).toFixed(1)}%, latency=${latencyMs ?? '?'}ms) ` +
    `[algorithmic was: ${algoVintage ? 'VINTAGE' : 'MODERN'}]`,
  );

  return {
    isOutdatedOrVintage: finalIsVintage,
    vintageScore:        finalVintageScore,
    designEra:           era,
    confidence,
    source:              'rizzo-flow',
    reason: [
      `RizzoFlow classified design era as "${era}" (${(eraProb * 100).toFixed(1)}% confidence).`,
      `Vintage judgment: ${isVintageYes ? 'YES' : 'NO'} (${(vintageProb * 100).toFixed(1)}% confidence).`,
      llmConfident && isVintageYes !== algoVintage
        ? `Note: LLM overrode the algorithmic heuristic.`
        : 'LLM confirmed the algorithmic heuristic.',
    ].join(' '),
    rizzoLatencyMs: latencyMs,
  };
}
