// ============================================================
// src/crawler/httpFetcher.ts
// Stage-1 lightweight HTTP fetcher — no headless browser.
// Uses Node.js built-in fetch (Node 18+) with:
//   - Realistic desktop User-Agent
//   - Short timeout (7s)
//   - Redirect following
//   - Graceful error handling
// ============================================================

import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 7_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface FetchResult {
  ok: boolean;
  url: string;        // final URL after redirects
  statusCode: number;
  html: string;
  error?: string;
  durationMs: number;
}

/**
 * Lightweight HTTP GET with a hard timeout.
 * Follows redirects, returns raw HTML text.
 */
export async function fetchPage(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchResult> {
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const html = await response.text();
    clearTimeout(timer);

    return {
      ok: response.ok,
      url: response.url,
      statusCode: response.status,
      html,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    clearTimeout(timer);
    const error = (err as Error).message;
    logger.debug(`fetchPage failed [${url}]: ${error}`);
    return {
      ok: false,
      url,
      statusCode: -1,
      html: '',
      error,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Attempt to fetch a URL, automatically trying HTTPS first then HTTP on failure.
 */
export async function fetchWithFallback(urlOrDomain: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchResult> {
  let target = urlOrDomain.trim();
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    target = `https://${target}/`;
  }

  const result = await fetchPage(target, timeoutMs);
  if (result.ok || result.statusCode > 0) return result;

  // Fallback to HTTP if HTTPS failed
  if (target.startsWith('https://')) {
    const httpUrl = target.replace(/^https:\/\//i, 'http://');
    logger.debug(`HTTPS failed for ${target}, trying HTTP`);
    return fetchPage(httpUrl, timeoutMs);
  }

  return result;
}
