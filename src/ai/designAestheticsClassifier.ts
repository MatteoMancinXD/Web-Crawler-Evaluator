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
import { DesignAestheticsMetrics } from '../types/index.js';
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
  algorithmic: DesignAestheticsMetrics,
): Promise<DesignEpochDecision> {

  // Build a rich state for the LLM, using all algorithmic signals
  const vintageItems = algorithmic.vintageElementsFound.length > 0
    ? algorithmic.vintageElementsFound.join(', ')
    : 'none';

  const state = [
    `Website URL: ${url}`,
    '',
    'Algorithmic design signals collected by the audit engine:',
    `  Vintage HTML elements found: ${vintageItems}`,
    `  Uses CSS Flexbox or Grid layout: ${algorithmic.modernLayoutUsed}`,
    `  Has responsive @media queries: ${algorithmic.hasMediaQueries}`,
    `  Uses modern web fonts or modern sans-serif stack: ${algorithmic.modernTypographyUsed}`,
    `  Body text set in default browser serif (Times New Roman / raw serif): ${algorithmic.hasDefaultSerifFont}`,
    `  Links are unstyled browser-default blue (#0000ee) with underline: ${algorithmic.hasRawUnstyledLinks}`,
    `  Modern CSS polish features found (border-radius, box-shadow, transitions, gradients): ${algorithmic.aestheticFeaturesCount} out of 4`,
    `  Fixed legacy-width container (≤ 1020px hardcoded): ${algorithmic.hasFixedLegacyWidth}`,
    `  Algorithmic vintage score (0 = modern, 100 = fully vintage): ${algorithmic.vintageScore}`,
    `  Algorithmic classification: ${algorithmic.isOutdatedOrVintage ? 'OUTDATED / VINTAGE' : 'MODERN'}`,
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
      isOutdatedOrVintage: algorithmic.isOutdatedOrVintage,
      vintageScore:        algorithmic.vintageScore,
      designEra:           algorithmic.isOutdatedOrVintage
        ? (algorithmic.vintageScore >= 70 ? 'vintage_90s' : 'dated_2000s')
        : 'modern',
      confidence:  0.65,
      source:      'algorithmic-fallback',
      reason:      `Algorithmic vintage score: ${algorithmic.vintageScore}/100. ` +
                   `RizzoFlow unavailable; using heuristic-only classification.`,
    };
  }

  // ── Parse RizzoFlow output ───────────────────────────────────
  const eraAnswer     = rizzoResult.answers['design_era']   as ChoiceAnswer | undefined;
  const vintageAnswer = rizzoResult.answers['is_vintage']   as NoulAnswer   | undefined;

  if (!eraAnswer || !vintageAnswer || eraAnswer.type !== 'choice' || vintageAnswer.type !== 'noul') {
    logger.warn('[DesignClassifier] Incomplete RizzoFlow response — using algorithmic fallback.');
    return {
      isOutdatedOrVintage: algorithmic.isOutdatedOrVintage,
      vintageScore:        algorithmic.vintageScore,
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

  const finalIsVintage = llmConfident ? llmIsVintage : algorithmic.isOutdatedOrVintage;

  // Blend vintage score: if LLM agrees with algorithmic, keep it.
  // If they disagree, push the score toward the LLM's belief.
  let finalVintageScore = algorithmic.vintageScore;
  if (llmConfident && llmIsVintage !== algorithmic.isOutdatedOrVintage) {
    // Disagreement — nudge score toward LLM direction
    finalVintageScore = llmIsVintage
      ? Math.min(100, algorithmic.vintageScore + Math.round(vintageProb * 30))
      : Math.max(0,   algorithmic.vintageScore - Math.round(vintageProb * 30));
  }

  const confidence = (eraProb + vintageProb) / 2;

  logger.info(
    `[RizzoFlow] Design classification: ${era} / vintage=${isVintageYes} ` +
    `(confidence=${(confidence * 100).toFixed(1)}%, latency=${latencyMs ?? '?'}ms) ` +
    `[algorithmic was: ${algorithmic.isOutdatedOrVintage ? 'VINTAGE' : 'MODERN'}, score=${algorithmic.vintageScore}]`,
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
      llmConfident && isVintageYes !== algorithmic.isOutdatedOrVintage
        ? `Note: LLM overrode the algorithmic heuristic (was "${algorithmic.isOutdatedOrVintage ? 'vintage' : 'modern'}").`
        : 'LLM confirmed the algorithmic heuristic.',
    ].join(' '),
    rizzoLatencyMs: latencyMs,
  };
}
