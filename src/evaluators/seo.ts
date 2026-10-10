// ============================================================
// src/evaluators/seo.ts
// SEO & discoverability evaluation:
// title/meta, broken links, robots/sitemap, console errors
// ============================================================

import { Page } from 'playwright';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { SeoMetrics, BrokenLink, ConsoleError } from '../types/index.js';
import { isSameOrigin, resolveUrl } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

const BROKEN_LINK_TIMEOUT_MS = 8_000;
const MAX_LINKS_TO_CHECK      = 30;

/**
 * HEAD-request a URL. Returns the HTTP status code, or -1 on network error.
 */
function headRequest(url: string): Promise<number> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(-1), BROKEN_LINK_TIMEOUT_MS);
    try {
      const parsed = new URL(url);
      const lib    = parsed.protocol === 'https:' ? https : http;
      const req    = lib.request(
        url,
        { method: 'HEAD', timeout: BROKEN_LINK_TIMEOUT_MS },
        (res) => {
          clearTimeout(timer);
          resolve(res.statusCode ?? -1);
        },
      );
      req.on('error', () => { clearTimeout(timer); resolve(-1); });
      req.end();
    } catch {
      clearTimeout(timer);
      resolve(-1);
    }
  });
}

/**
 * Check whether the site has a robots.txt and sitemap.xml at the root.
 */
async function checkRobotsAndSitemap(baseUrl: string): Promise<{ hasRobotsTxt: boolean; hasSitemap: boolean }> {
  const origin = (() => {
    try { return new URL(baseUrl).origin; } catch { return baseUrl; }
  })();

  const [robotsStatus, sitemapStatus] = await Promise.all([
    headRequest(`${origin}/robots.txt`),
    headRequest(`${origin}/sitemap.xml`),
  ]);

  return {
    hasRobotsTxt: robotsStatus >= 200 && robotsStatus < 400,
    hasSitemap:   sitemapStatus >= 200 && sitemapStatus < 400,
  };
}

/**
 * Full SEO evaluation pipeline.
 */
export async function evaluateSeo(
  page: Page,
  finalUrl: string,
  consoleErrors: ConsoleError[],
): Promise<SeoMetrics> {
  // ── 1. DOM-level SEO checks ──────────────────────────────────
  const domData = await page.evaluate((maxLinks) => {
    // Title tags
    const titleEls = document.querySelectorAll('title');
    const titleTag  = titleEls[0]?.textContent?.trim() ?? null;
    const titleTagCount = titleEls.length;

    // Meta description
    const metaDescEls = document.querySelectorAll('meta[name="description"]');
    const metaDescription = (metaDescEls[0] as HTMLMetaElement)?.content?.trim() ?? null;
    const metaDescriptionCount = metaDescEls.length;

    // Canonical tag
    const canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const hasCanonicalTag = !!canonicalEl;

    // Internal links
    const anchorEls = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const links = anchorEls.map((a) => ({
      href: a.getAttribute('href') ?? '',
      text: a.textContent?.trim().slice(0, 60) ?? '',
    }));

    // Asset links (img src, script src, link href)
    const assetEls = [
      ...Array.from(document.querySelectorAll<HTMLImageElement>('img[src]')).map((e) => ({ url: e.src, tag: 'img' })),
      ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map((e) => ({ url: e.src, tag: 'script' })),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[href][rel="stylesheet"]')).map((e) => ({ url: e.href, tag: 'link' })),
    ];

    return {
      titleTag,
      titleTagCount,
      metaDescription,
      metaDescriptionCount,
      hasCanonicalTag,
      links,
      assetEls: assetEls.slice(0, maxLinks),
    };
  }, MAX_LINKS_TO_CHECK);

  // ── 2. Broken link & asset checking ─────────────────────────
  const internalLinks = domData.links
    .filter((l) => l.href && isSameOrigin(l.href, finalUrl) && !l.href.startsWith('#'))
    .map((l) => ({ ...l, url: resolveUrl(l.href, finalUrl) }))
    .filter((l, idx, arr) => arr.findIndex((x) => x.url === l.url) === idx) // dedupe
    .slice(0, MAX_LINKS_TO_CHECK);

  const brokenInternalLinks: BrokenLink[] = [];
  const brokenAssetLinks: BrokenLink[] = [];

  // Check internal links in parallel (up to 5 at a time)
  const CONCURRENCY = 50;
  const linkBatches: typeof internalLinks[] = [];
  for (let i = 0; i < internalLinks.length; i += CONCURRENCY) {
    linkBatches.push(internalLinks.slice(i, i + CONCURRENCY));
  }

  for (const batch of linkBatches) {
    const results = await Promise.all(
      batch.map(async (link) => {
        const status = await headRequest(link.url);
        return { ...link, status };
      }),
    );
    for (const r of results) {
      if (r.status >= 400 || r.status === -1) {
        brokenInternalLinks.push({ url: r.url, statusCode: r.status, linkText: r.text });
      }
    }
  }

  // Check asset links
  const assetBatches: typeof domData.assetEls[] = [];
  for (let i = 0; i < domData.assetEls.length; i += CONCURRENCY) {
    assetBatches.push(domData.assetEls.slice(i, i + CONCURRENCY));
  }

  for (const batch of assetBatches) {
    const results = await Promise.all(
      batch.map(async (asset) => {
        if (!asset.url || !asset.url.startsWith('http')) return null;
        const status = await headRequest(asset.url);
        return { ...asset, status };
      }),
    );
    for (const r of results) {
      if (r && (r.status >= 400 || r.status === -1)) {
        brokenAssetLinks.push({ url: r.url, statusCode: r.status, linkText: r.tag });
      }
    }
  }

  // ── 3. Robots.txt / sitemap ──────────────────────────────────
  const { hasRobotsTxt, hasSitemap } = await checkRobotsAndSitemap(finalUrl);

  return {
    titleTag: domData.titleTag,
    titleTagCount: domData.titleTagCount,
    metaDescription: domData.metaDescription,
    metaDescriptionCount: domData.metaDescriptionCount,
    brokenInternalLinks,
    brokenAssetLinks,
    consoleErrors,
    hasCanonicalTag: domData.hasCanonicalTag,
    hasRobotsTxt,
    hasSitemap,
  };
}
