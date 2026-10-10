// ============================================================
// src/crawler/linkExtractor.ts
// Parse raw HTML and extract domain root URLs.
// Pure regex-based extraction — no DOM parser needed for Stage 1.
// ============================================================

import { normaliseToDomainRoot, extractHostname } from './domainFilter.js';

// Match href="..." or href='...' patterns, allowing query parameters and paths
const HREF_RE = /href\s*=\s*["']([^"'\s>]{3,2048})["']/gi;

// Match raw http/https URLs anywhere in HTML (data attributes, onclick, scripts, JSON-LD)
const RAW_URL_RE = /\bhttps?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?::\d+)?(?:\/[^\s"'<>]*)?/gi;

/**
 * Extract all unique domain root URLs referenced in HTML.
 * Inspects:
 *   1. Standard <a href="..."> links
 *   2. Embedded redirects (e.g. /jump?url=https://target.com)
 *   3. Raw URLs (data-url, onclick, JS variables, JSON-LD)
 */
export function extractDomains(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  // 1. From href attributes
  HREF_RE.lastIndex = 0;
  while ((match = HREF_RE.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href) continue;

    const rootUrl = normaliseToDomainRoot(href, baseUrl);
    if (rootUrl) {
      found.add(rootUrl);
    }

    // Check for embedded redirects (e.g. /redirect.php?url=http%3A%2F%2Fdomain.com)
    if (href.includes('://') || href.includes('%3A%2F%2F')) {
      const embedded = href.match(/(https?(?::|%3A)(?:\/\/|%2F%2F)[^&"'\s]+)/i);
      if (embedded) {
        try {
          const decoded = decodeURIComponent(embedded[1]);
          const decodedRoot = normaliseToDomainRoot(decoded);
          if (decodedRoot) found.add(decodedRoot);
        } catch {}
      }
    }
  }

  // 2. From raw URLs anywhere in the page (data attributes, scripts, etc.)
  RAW_URL_RE.lastIndex = 0;
  while ((match = RAW_URL_RE.exec(html)) !== null) {
    const rootUrl = normaliseToDomainRoot(match[0]);
    if (rootUrl) {
      found.add(rootUrl);
    }
  }

  return Array.from(found);
}

// Backward-compatible alias
export const extractItDomains = extractDomains;

/**
 * Detect subpages likely to contain directories, link lists, or partner lists.
 */
export function findDirectoryPageUrls(hrefs: string[]): string[] {
  const DIR_RE = /(directory|links|partner|aziende|portale|siti|risorse|imprese|guida|elenco|vetrina|clienti|network)/i;
  return hrefs.filter((href) => {
    try {
      const u = new URL(href);
      return DIR_RE.test(u.pathname + u.search);
    } catch {
      return false;
    }
  });
}

/**
 * Extract all hrefs from a page — used for contact page detection.
 * Returns only same-origin relative or absolute hrefs.
 */
export function extractAllHrefs(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  let baseHostname: string;

  try {
    baseHostname = new URL(baseUrl).hostname;
  } catch {
    return [];
  }

  HREF_RE.lastIndex = 0;
  while ((match = HREF_RE.exec(html)) !== null) {
    const href = match[1].trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === baseHostname) {
        found.add(resolved.href);
      }
    } catch {
      // ignore unparseable hrefs
    }
  }

  // Also look for absolute URLs anywhere (e.g. JSON-LD scripts)
  RAW_URL_RE.lastIndex = 0;
  while ((match = RAW_URL_RE.exec(html)) !== null) {
    const rawUrl = match[0].trim();
    try {
      const resolved = new URL(rawUrl);
      if (resolved.hostname === baseHostname) {
        found.add(resolved.href);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(found);
}

/**
 * Detect contact-related pages from a list of internal hrefs.
 * Returns URLs whose path matches typical contact/about patterns.
 */
export function findContactPageUrls(hrefs: string[]): string[] {
  // Use word boundaries \b for info to avoid matching informatica, etc.
  const CONTACT_RE = /\/(contatt|chi-siamo|about|info(rmazioni)?\b|contact|scrivici|supporto|helpdesk|assistenza)/i;
  return hrefs.filter((href) => {
    try {
      return CONTACT_RE.test(new URL(href).pathname);
    } catch {
      return false;
    }
  });
}
