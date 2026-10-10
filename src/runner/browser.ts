// ============================================================
// src/runner/browser.ts
// Manages Playwright browser lifecycle with proper cleanup.
// ============================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../utils/logger.js';

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT  = { width: 390, height: 844 };

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

let sharedBrowser: Browser | null = null;

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-webgl',
        '--disable-software-rasterizer',
        '--disable-web-security',
        '--ignore-certificate-errors',
      ],
    });
  }
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch (e) {}
    sharedBrowser = null;
  }
}

/**
 * Launch a fresh Chromium browser session (Context) on the shared browser.
 * @param mobile   - emulate mobile viewport / UA if true
 * @param ignoreSSL - bypass SSL certificate errors (for auditing HTTP-only or broken-SSL sites)
 */
export async function createSession(
  mobile = false,
  ignoreSSL = true,
): Promise<BrowserSession> {
  const browser = await getSharedBrowser();

  const viewport  = mobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
  const userAgent = mobile ? MOBILE_UA : DESKTOP_UA;

  const context = await browser.newContext({
    viewport,
    userAgent,
    ignoreHTTPSErrors: ignoreSSL,
    // Capture console messages and network failures
    serviceWorkers: 'block',
  });

  // Block heavy third-party analytics/ads/compliance scripts to isolate first-party perf
  await context.route(
    /\.(doubleclick|googletagmanager|facebook\.net|hotjar|intercom|iubenda|cookiebot|onetrust|trustarc|usercentrics|quantcast|didomi)\./,
    (route) => route.abort(),
  );

  const page = await context.newPage();

  const close = async (): Promise<void> => {
    try {
      await page.close();
      await context.close();
      // DO NOT close the shared browser here
    } catch (err) {
      logger.warn(`Error closing browser session: ${(err as Error).message}`);
    }
  };

  return { browser, context, page, close };
}

/**
 * Navigate to a URL and wait until page is loaded.
 * Returns the final URL (after redirects) and load duration.
 */
export async function navigateTo(
  page: Page,
  url: string,
  timeoutMs = 30_000,
): Promise<{ finalUrl: string; loadDurationMs: number; statusCode: number | null }> {
  const start = Date.now();

  // Wait for 'load' (DOM, stylesheets, images loaded)
  // Avoid unconditional 30s networkidle hang on sites with continuous analytics/trackers
  const response = await page.goto(url, {
    waitUntil: 'load',
    timeout: timeoutMs,
  });

  // Brief grace period (up to 3s) for SPA dynamic rendering to settle
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {
    // Optional grace period — ignore timeout
  });

  const loadDurationMs = Date.now() - start;
  const finalUrl = response?.url() ?? url;
  const statusCode = response ? response.status() : null;

  return { finalUrl, loadDurationMs, statusCode };
}

