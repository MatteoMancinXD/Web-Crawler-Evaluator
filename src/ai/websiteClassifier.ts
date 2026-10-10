// ============================================================
// src/ai/websiteClassifier.ts
// Uses RizzoFlow to decide whether a URL is a proper human-facing
// website worth auditing vs. an API, web service, CDN endpoint,
// redirect stub, or similar non-site target.
//
// Falls back to a fast algorithmic heuristic if RizzoFlow is
// unavailable (ECONNREFUSED) or returns null.
// ============================================================

import { callRizzoFlow, noulIsYes, noulConfidence, NoulAnswer, ChoiceAnswer } from './rizzoFlowClient.js';
import { logger } from '../utils/logger.js';

// ─── Output type ─────────────────────────────────────────────

export interface WebsiteClassification {
  /** true = proper human-facing website, false = web service / API / non-site */
  isProperWebsite: boolean;
  /** Confidence of the classification, 0–1 */
  confidence: number;
  /** Source of the decision */
  source: 'rizzo-flow' | 'algorithmic-fallback';
  /** Human-readable reason */
  reason: string;
  /** Raw RizzoFlow latency in ms (if used) */
  rizzoLatencyMs?: number;
}

// ─── Algorithmic fallback ─────────────────────────────────────

/**
 * Quick heuristic classification based on HTTP response headers and
 * the page's HTML content — used when RizzoFlow is unavailable.
 */
function algorithmicClassify(
  pageContent: string,
  contentType: string,
  finalUrl: string,
  hasBodyText = false,
  hasNavElements = false,
): WebsiteClassification {
  const lowerContent = pageContent.slice(0, 16_000).toLowerCase();
  const lowerCt = contentType.toLowerCase();

  // Definite non-sites
  if (
    lowerCt.includes('application/json') ||
    lowerCt.includes('application/xml') ||
    lowerCt.includes('text/xml') ||
    lowerCt.includes('text/plain')
  ) {
    return {
      isProperWebsite: false,
      confidence: 0.95,
      source: 'algorithmic-fallback',
      reason: `Content-Type "${contentType}" indicates a data/API endpoint, not a browsable website.`,
    };
  }

  // API path patterns
  const apiPatterns = ['/api/', '/v1/', '/v2/', '/graphql', '/rest/', '/swagger', '/openapi'];
  if (apiPatterns.some((p) => finalUrl.includes(p))) {
    return {
      isProperWebsite: false,
      confidence: 0.85,
      source: 'algorithmic-fallback',
      reason: `URL path "${finalUrl}" matches common API endpoint patterns.`,
    };
  }

  // Very thin HTML (< 300 chars of body text) with no visible text → likely stub
  const bodyTextMatch = lowerContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = bodyTextMatch ? bodyTextMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  if (!hasBodyText && bodyText.length < 300 && !hasNavElements && !lowerContent.includes('<nav') && !lowerContent.includes('<header')) {
    return {
      isProperWebsite: false,
      confidence: 0.70,
      source: 'algorithmic-fallback',
      reason: 'Page body has very little human-readable content — likely a redirect stub or service endpoint.',
    };
  }

  // Has standard site landmarks or visible content → proper website
  const hasSiteMarkers =
    hasNavElements ||
    hasBodyText ||
    lowerContent.includes('<nav') ||
    lowerContent.includes('<header') ||
    lowerContent.includes('<footer') ||
    lowerContent.includes('<main') ||
    lowerContent.includes('menu') ||
    lowerContent.includes('<table') ||
    lowerContent.includes('<article');

  return {
    isProperWebsite: hasSiteMarkers,
    confidence: hasSiteMarkers ? 0.75 : 0.65,
    source: 'algorithmic-fallback',
    reason: hasSiteMarkers
      ? 'Page contains semantic HTML landmarks or visible content typical of a human-facing website.'
      : 'Page lacks standard navigational landmarks; may be a web service.',
  };
}

// ─── Main classifier ──────────────────────────────────────────

/**
 * Classify a URL as a proper website or a web service / API.
 *
 * Sends a focused state summary to RizzoFlow and asks two questions:
 *  - is_proper_website: yes/no with probability
 *  - site_type: a choice among website, api, redirect, cdn, other
 *
 * Falls back to the algorithmic heuristic when RizzoFlow is unavailable.
 */
export async function classifyWebsite(params: {
  finalUrl: string;
  pageTitle: string;
  contentType: string;
  pageContent: string;     // first ~4 KB of raw HTML (or text)
  httpStatusCode: number;
  hasHtmlBody: boolean;
  hasNavElements: boolean;
  hasBodyText: boolean;
}): Promise<WebsiteClassification> {
  const {
    finalUrl, pageTitle, contentType, pageContent,
    httpStatusCode, hasHtmlBody, hasNavElements, hasBodyText,
  } = params;

  // Build a compact state string for the LLM
  const state = [
    `URL: ${finalUrl}`,
    `HTTP Status: ${httpStatusCode}`,
    `Content-Type: ${contentType}`,
    `Page title: ${pageTitle || '(none)'}`,
    `Has HTML body: ${hasHtmlBody}`,
    `Has navigation elements (nav, menu, header): ${hasNavElements}`,
    `Has visible body text: ${hasBodyText}`,
    `HTML snippet (first 800 chars):`,
    pageContent.slice(0, 800).replace(/\s+/g, ' '),
  ].join('\n');

  const rizzoResult = await callRizzoFlow(state, {
    is_proper_website: {
      type: 'noul',
      instructions:
        'Is this URL a proper human-facing website that a web quality auditor should scan? ' +
        'Answer YES if it has navigable pages, real content, menus, or human-readable text. ' +
        'Answer NO if it is a JSON/XML API, a redirect stub, a CDN endpoint, a raw data service, ' +
        'or any other non-human-facing web resource.',
    },
    site_type: {
      type: 'choice',
      instructions:
        'What is the primary nature of this URL? Choose the most accurate category.',
      criteria: {
        website:            'A proper human-facing website with pages and content',
        api_or_web_service: 'A JSON/XML API, REST/GraphQL endpoint, or machine-facing service',
        redirect_or_stub:   'A redirect, stub, or parked domain with no real content',
        cdn_or_static_asset:'A CDN, static file host, or asset endpoint',
        other_non_site:     'Any other non-human-facing web resource',
      },
    },
  });

  if (rizzoResult === null) {
    logger.debug('[WebsiteClassifier] RizzoFlow unavailable — using algorithmic fallback.');
    return algorithmicClassify(pageContent, contentType, finalUrl, hasBodyText, hasNavElements);
  }

  const isWebsiteAnswer = rizzoResult.answers['is_proper_website'] as NoulAnswer | undefined;
  const siteTypeAnswer  = rizzoResult.answers['site_type']         as ChoiceAnswer | undefined;

  if (!isWebsiteAnswer || isWebsiteAnswer.type !== 'noul') {
    logger.warn('[WebsiteClassifier] RizzoFlow returned no "is_proper_website" answer — falling back.');
    return algorithmicClassify(pageContent, contentType, finalUrl, hasBodyText, hasNavElements);
  }

  const isYes      = noulIsYes(isWebsiteAnswer);
  const confidence = noulConfidence(isWebsiteAnswer);
  const siteType   = siteTypeAnswer?.choice ?? 'unknown';
  const latencyMs  = Object.values(rizzoResult.x_rizzo?.timing ?? {}).find(v => typeof v === 'number');

  logger.info(
    `[RizzoFlow] Website classification: ${isYes ? 'WEBSITE' : 'NON-WEBSITE'} ` +
    `(type=${siteType}, confidence=${(confidence * 100).toFixed(1)}%, latency=${latencyMs ?? '?'}ms)`,
  );

  return {
    isProperWebsite: isYes,
    confidence,
    source: 'rizzo-flow',
    reason: `RizzoFlow classified as "${siteType}" with ${(confidence * 100).toFixed(1)}% confidence.`,
    rizzoLatencyMs: latencyMs,
  };
}
