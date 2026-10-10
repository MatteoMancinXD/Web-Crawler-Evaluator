// ============================================================
// src/evaluators/performance.ts
// Evaluates Core Web Vitals, payload size, and Lighthouse score
// ============================================================

import { Page } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PerformanceMetrics } from '../types/index.js';
import { logger } from '../utils/logger.js';

const UNCOMPRESSED_IMAGE_THRESHOLD_BYTES = 200 * 1024; // 200 KB

/**
 * Collect Web Vitals using the PerformanceObserver API injected into the page.
 * Returns partial metrics — LCP/CLS require the page to have been observed.
 */
export async function collectWebVitals(page: Page): Promise<Pick<PerformanceMetrics, 'lcp' | 'cls' | 'inp' | 'ttfb'>> {
  try {
    const vitals = await page.evaluate(() => {
      return new Promise<{ lcp: number | null; cls: number | null; inp: number | null; ttfb: number | null }>((resolve) => {
        const result: { lcp: number | null; cls: number | null; inp: number | null; ttfb: number | null } = {
          lcp: null,
          cls: null,
          inp: null,
          ttfb: null,
        };

        // TTFB from Navigation Timing API
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
          const nav = navEntries[0] as unknown as { responseStart: number; requestStart: number };
          result.ttfb = Math.round(nav.responseStart - nav.requestStart);
        }

        let clsValue = 0;
        let pendingObservers = 3;
        const done = (): void => {
          if (--pendingObservers <= 0) {
            result.cls = Math.round(clsValue * 1000) / 1000;
            resolve(result);
          }
        };

        // LCP
        try {
          const lcpObs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) {
              result.lcp = Math.round((entries[entries.length - 1] as unknown as { startTime: number }).startTime);
            }
            lcpObs.disconnect();
            done();
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lcpObs as any).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {
          done();
        }

        // CLS
        try {
          const clsObs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const layoutShift = entry as unknown as { hadRecentInput?: boolean; value?: number };
              if (!layoutShift.hadRecentInput && layoutShift.value) {
                clsValue += layoutShift.value;
              }
            }
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (clsObs as any).observe({ type: 'layout-shift', buffered: true });
          // Give CLS a chance to accumulate then stop
          setTimeout(() => {
            clsObs.disconnect();
            done();
          }, 2000);
        } catch {
          done();
        }

        // INP (Interaction to Next Paint) — only available in Chrome 117+
        try {
          const inpObs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) {
              result.inp = Math.round((entries[entries.length - 1] as unknown as { duration: number }).duration);
            }
            inpObs.disconnect();
            done();
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (inpObs as any).observe({ type: 'event', durationThreshold: 16, buffered: true });
          // If no interactions, resolve after timeout
          setTimeout(() => {
            inpObs.disconnect();
            done();
          }, 1500);
        } catch {
          done();
        }
      });
    });
    return vitals;
  } catch (err) {
    logger.warn(`Web Vitals collection failed: ${(err as Error).message}`);
    return { lcp: null, cls: null, inp: null, ttfb: null };
  }
}

/**
 * Measure total payload and detect uncompressed images by intercepting
 * responses already captured in the network log.
 */
export async function collectPayloadMetrics(
  page: Page,
): Promise<Pick<PerformanceMetrics, 'totalPayloadBytes' | 'uncompressedImagesCount' | 'uncompressedImagesTotalBytes'>> {
  try {
    const resourceData = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as unknown as Array<{
        name: string; transferSize: number; encodedBodySize: number;
        decodedBodySize: number; initiatorType: string;
      }>;
      return entries.map((e) => ({
        name: e.name,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize,
        initiatorType: e.initiatorType,
      }));
    });

    let totalPayloadBytes = 0;
    let uncompressedImagesCount = 0;
    let uncompressedImagesTotalBytes = 0;

    for (const res of resourceData) {
      totalPayloadBytes += res.transferSize || 0;

      if (res.initiatorType === 'img' || /\.(png|jpe?g|gif|bmp|tiff)(\?.*)?$/i.test(res.name)) {
        const decodedSize = res.decodedBodySize || 0;
        if (decodedSize > UNCOMPRESSED_IMAGE_THRESHOLD_BYTES) {
          const ext = res.name.match(/\.(png|jpe?g|gif|bmp|tiff)/i)?.[1] ?? '';
          // Only flag PNG/JPEG that haven't been converted to WebP/AVIF
          if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff'].includes(ext.toLowerCase())) {
            uncompressedImagesCount++;
            uncompressedImagesTotalBytes += decodedSize;
          }
        }
      }
    }

    return { totalPayloadBytes, uncompressedImagesCount, uncompressedImagesTotalBytes };
  } catch (err) {
    logger.warn(`Payload metrics collection failed: ${(err as Error).message}`);
    return { totalPayloadBytes: null, uncompressedImagesCount: 0, uncompressedImagesTotalBytes: 0 };
  }
}

/**
 * Run Lighthouse programmatically against the target URL.
 * We spawn it in a child process to avoid CommonJS/ESM conflicts
 * and because Lighthouse manages its own Chrome connection.
 */
export async function runLighthouse(url: string): Promise<number | null> {
  const tmpOutput = path.join(os.tmpdir(), `lh-${Date.now()}.json`);
  try {
    // Use the Lighthouse CLI bundled with the installed package
    const lhBin = path.join(
      process.cwd(),
      'node_modules',
      'lighthouse',
      'cli',
      'index.js',
    );

    if (!fs.existsSync(lhBin)) {
      logger.warn('Lighthouse CLI not found — skipping Lighthouse score.');
      return null;
    }

    const cmd = [
      `node "${lhBin}"`,
      `"${url}"`,
      '--output=json',
      `--output-path="${tmpOutput}"`,
      '--only-categories=performance',
      '--chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"',
      '--quiet',
    ].join(' ');

    execSync(cmd, { timeout: 90_000, stdio: 'pipe' });

    if (!fs.existsSync(tmpOutput)) return null;
    const report = JSON.parse(fs.readFileSync(tmpOutput, 'utf-8'));
    const score: number = report?.categories?.performance?.score ?? null;
    return score !== null ? Math.round(score * 100) : null;
  } catch (err) {
    if (fs.existsSync(tmpOutput)) {
      try {
        const report = JSON.parse(fs.readFileSync(tmpOutput, 'utf-8'));
        const score: number = report?.categories?.performance?.score ?? null;
        if (score !== null) return Math.round(score * 100);
      } catch { /* ignore */ }
    }
    const fullMsg = (err as Error).message || '';
    const isEperm = fullMsg.includes('EPERM') || fullMsg.includes('destroyTmp');
    if (isEperm) {
      logger.debug(`Lighthouse Windows temp EPERM cleanup warning for ${url}: ${fullMsg}`);
      logger.warn(`Lighthouse skipped for ${url} (Windows Temp lock) — using native Core Web Vitals fallback`);
    } else {
      const summaryMsg = fullMsg.split('\n')[0].slice(0, 120);
      logger.debug(`Lighthouse run details [${url}]: ${fullMsg}`);
      logger.warn(`Lighthouse skipped for ${url} (${summaryMsg}) — using native Core Web Vitals fallback`);
    }
    return null;
  } finally {
    try { fs.unlinkSync(tmpOutput); } catch { /* ignore */ }
  }
}

/**
 * Full performance evaluation pipeline.
 */
export async function evaluatePerformance(
  page: Page,
  url: string,
  loadDurationMs: number,
): Promise<PerformanceMetrics> {
  const [vitals, payload, lighthousePerformanceScore] = await Promise.all([
    collectWebVitals(page),
    collectPayloadMetrics(page),
    runLighthouse(url),
  ]);

  return {
    lcp: vitals.lcp,
    cls: vitals.cls,
    inp: vitals.inp,
    ttfb: vitals.ttfb,
    totalLoadTime: loadDurationMs,
    totalPayloadBytes: payload.totalPayloadBytes,
    uncompressedImagesCount: payload.uncompressedImagesCount,
    uncompressedImagesTotalBytes: payload.uncompressedImagesTotalBytes,
    lighthousePerformanceScore,
  };
}
