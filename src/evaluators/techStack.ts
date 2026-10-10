// ============================================================
// src/evaluators/techStack.ts
// Tech-stack modernity, security, and legacy pattern detection
// ============================================================

import { Page } from 'playwright';
import https from 'https';
import tls from 'tls';
import { URL } from 'url';
import { TechStackMetrics, LegacyFramework } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ─── Legacy pattern definitions ──────────────────────────────

interface FrameworkDetector {
  name: string;
  detect: string;       // substring to search in page source
  versionRegex?: RegExp;
  maxVersion?: string;  // flag if version < maxVersion
  severity: LegacyFramework['severity'];
  reason: string;
}

const FRAMEWORK_DETECTORS: FrameworkDetector[] = [
  {
    name: 'jQuery',
    detect: 'jquery',
    versionRegex: /jquery[.-](\d+\.\d+(?:\.\d+)?)/i,
    maxVersion: '3.0.0',
    severity: 'warning',
    reason: 'jQuery < 3.0 has known security vulnerabilities and performance issues.',
  },
  {
    name: 'Bootstrap 3',
    detect: 'bootstrap.min.css',
    versionRegex: /bootstrap[.-](\d+\.\d+)/i,
    severity: 'warning',
    reason: 'Bootstrap 3 is end-of-life. Upgrade to Bootstrap 5 for modern CSS and fewer dependencies.',
  },
  {
    name: 'Angular.js (1.x)',
    detect: 'angular.min.js',
    versionRegex: /angular[.-](\d+\.\d+)/i,
    severity: 'critical',
    reason: 'AngularJS 1.x reached end-of-life in December 2021. No security patches.',
  },
  {
    name: 'Prototype.js',
    detect: 'prototype.js',
    severity: 'critical',
    reason: 'Prototype.js is abandoned and conflicts with modern APIs.',
  },
  {
    name: 'MooTools',
    detect: 'mootools',
    severity: 'warning',
    reason: 'MooTools is no longer maintained. Modern alternatives are lighter and more capable.',
  },
  {
    name: 'Ext.js 3.x',
    detect: 'ext-all.js',
    severity: 'warning',
    reason: 'Old Ext.js version detected. Consider migrating to a modern framework.',
  },
];

// HTML5 semantic landmarks required for modern accessible pages
const REQUIRED_LANDMARKS = ['header', 'main', 'nav', 'footer'];

// Obsolete tags that indicate legacy HTML
const OBSOLETE_TAGS = ['font', 'center', 'marquee', 'blink', 'basefont', 'big', 'strike', 'tt'];

/**
 * Compare two semver strings. Returns true if a < b.
 */
function semverLt(a: string, b: string): boolean {
  const parse = (v: string): number[] => v.split('.').map((n) => parseInt(n, 10) || 0);
  const [aParts, bParts] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal < bVal) return true;
    if (aVal > bVal) return false;
  }
  return false;
}

/**
 * Check SSL certificate validity for an HTTPS URL.
 */
async function checkSsl(url: string): Promise<{ valid: boolean; error: string | null }> {
  return new Promise((resolve) => {
    try {
      const { hostname, port } = new URL(url);
      const socket = tls.connect(
        { host: hostname, port: parseInt(port || '443', 10), servername: hostname },
        () => {
          const cert = socket.getPeerCertificate();
          socket.destroy();
          if (!cert || !cert.valid_to) {
            resolve({ valid: false, error: 'No certificate found' });
            return;
          }
          const expiry = new Date(cert.valid_to);
          if (expiry < new Date()) {
            resolve({ valid: false, error: `Certificate expired on ${expiry.toISOString()}` });
          } else {
            resolve({ valid: true, error: null });
          }
        },
      );
      socket.on('error', (err) => resolve({ valid: false, error: err.message }));
      socket.setTimeout(8000, () => { socket.destroy(); resolve({ valid: false, error: 'SSL timeout' }); });
    } catch (err) {
      resolve({ valid: false, error: (err as Error).message });
    }
  });
}

/**
 * Full tech-stack evaluation.
 */
export async function evaluateTechStack(page: Page, finalUrl: string): Promise<TechStackMetrics> {
  // ── 1. Security checks ──────────────────────────────────────
  const isHttps = finalUrl.startsWith('https://');
  let sslValid = false;
  let sslError: string | null = 'Not HTTPS';

  if (isHttps) {
    const sslResult = await checkSsl(finalUrl);
    sslValid  = sslResult.valid;
    sslError  = sslResult.error;
  }

  // ── 2. DOM-level analysis ───────────────────────────────────
  const domData = await page.evaluate(
    ({ obsoleteTags, requiredLandmarks, detectors }) => {
      const html = document.documentElement.outerHTML;
      const htmlLower = html.toLowerCase();

      // Obsolete tags
      const foundObsolete: string[] = [];
      for (const tag of obsoleteTags) {
        if (document.querySelector(tag)) {
          foundObsolete.push(`<${tag}>`);
        }
      }

      // Table-based layout: <table> as a direct child of body used for layout
      const tables = Array.from(document.querySelectorAll('body > table, body table'));
      const hasTableLayout = tables.some((t) => {
        const width = (t as HTMLElement).getAttribute('width');
        const style = (t as HTMLElement).getAttribute('style') ?? '';
        return width === '100%' || style.includes('width: 100%') || (t as HTMLElement).getAttribute('cellpadding') !== null;
      });

      // Frameset
      const hasFrameset = !!document.querySelector('frameset') || htmlLower.includes('<frameset');

      // Flash objects
      const hasFlashObjects = !!document.querySelector('object[type="application/x-shockwave-flash"], embed[type="application/x-shockwave-flash"]');

      // HTML5 landmarks
      const missingLandmarks: string[] = [];
      for (const tag of requiredLandmarks) {
        if (!document.querySelector(tag)) {
          missingLandmarks.push(`<${tag}>`);
        }
      }
      const hasHtml5Landmarks = missingLandmarks.length === 0;

      // Inline CSS for layout detection (style attributes containing layout props)
      const layoutInlineProps = ['width:', 'height:', 'margin:', 'padding:', 'float:', 'position:'];
      const inlineStyleEls = Array.from(document.querySelectorAll('[style]'));
      const hasInlineCssLayout = inlineStyleEls.slice(0, 200).filter((el) => {
        const style = el.getAttribute('style') ?? '';
        return layoutInlineProps.some((p) => style.includes(p));
      }).length > 15; // more than 15 elements using inline layout = flag

      // Mixed content (check if page is HTTPS but loads HTTP resources)
      const allSrcs = [
        ...Array.from(document.querySelectorAll('[src]')).map((e) => e.getAttribute('src') ?? ''),
        ...Array.from(document.querySelectorAll('[href]')).map((e) => e.getAttribute('href') ?? ''),
      ];
      const hasMixedContent = window.location.protocol === 'https:' &&
        allSrcs.some((src) => src.startsWith('http://'));

      // Framework detection via script/link tags and globals
      const detectedLegacyFrameworks: Array<{ name: string; version: string | null; severity: string; reason: string }> = [];
      for (const detector of detectors) {
        if (htmlLower.includes(detector.detect)) {
          let version: string | null = null;
          if (detector.versionRegex) {
            const match = html.match(new RegExp(detector.versionRegex));
            version = match?.[1] ?? null;
          }
          // If maxVersion defined, only flag if version is older
          if (detector.maxVersion && version) {
            const [maj, min, pat] = version.split('.').map(Number);
            const [mMaj, mMin, mPat] = detector.maxVersion.split('.').map(Number);
            const isOld =
              maj < mMaj || (maj === mMaj && (min ?? 0) < mMin) || (maj === mMaj && (min ?? 0) === mMin && (pat ?? 0) < (mPat ?? 0));
            if (!isOld) continue;
          }
          detectedLegacyFrameworks.push({
            name: detector.name,
            version,
            severity: detector.severity,
            reason: detector.reason,
          });
        }
      }

      return {
        detectedLegacyFrameworks,
        hasTableLayout,
        hasFrameset,
        hasFlashObjects,
        hasObsoleteTags: foundObsolete,
        hasHtml5Landmarks,
        missingLandmarks,
        hasInlineCssLayout,
        hasMixedContent,
      };
    },
    {
      obsoleteTags: OBSOLETE_TAGS,
      requiredLandmarks: REQUIRED_LANDMARKS,
      detectors: FRAMEWORK_DETECTORS.map((d) => ({
        name: d.name,
        detect: d.detect,
        versionRegex: d.versionRegex?.source ?? null,
        maxVersion: d.maxVersion ?? null,
        severity: d.severity,
        reason: d.reason,
      })),
    },
  );

  return {
    isHttps,
    hasMixedContent: domData.hasMixedContent,
    sslValid,
    sslError,
    detectedLegacyFrameworks: domData.detectedLegacyFrameworks as LegacyFramework[],
    hasTableLayout: domData.hasTableLayout,
    hasFrameset: domData.hasFrameset,
    hasFlashObjects: domData.hasFlashObjects,
    hasObsoleteTags: domData.hasObsoleteTags,
    hasHtml5Landmarks: domData.hasHtml5Landmarks,
    missingLandmarks: domData.missingLandmarks,
    hasInlineCssLayout: domData.hasInlineCssLayout,
  };
}
