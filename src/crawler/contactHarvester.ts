// ============================================================
// src/crawler/contactHarvester.ts
// Extract emails and phone numbers from HTML pages.
// Triggered for low-scoring sites (score < 50 or grade C/F).
// ============================================================

import { fetchPage } from './httpFetcher.js';
import { extractAllHrefs, findContactPageUrls } from './linkExtractor.js';
import { logger } from '../utils/logger.js';

// ─── Regexes ─────────────────────────────────────────────────

// Standard email regex — avoids image extensions and dummy addresses
const EMAIL_RE = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;

// Dummy/fake email patterns to exclude
const EMAIL_EXCLUSION_RE = /(@example\.|@test\.|@domain\.|\.png|\.jpg|\.gif|\.svg|noreply|no-reply|donotreply)/i;

// mailto: links
const MAILTO_RE = /mailto:([^"'?\s<>]+)/gi;

// Italian phone number patterns:
// +39 mobile (3xx) and fixed (0x), also international formats
const PHONE_RE = /(?:\+39[\s.-]?)?(?:0\d{1,3}[\s.-]?\d{3,8}|3\d{2}[\s.-]?\d{6,7})\b/g;

export const NO_EMAIL_FOUND = 'no email found';

export interface ContactInfo {
  emails: string[];
  primaryEmail: string;
  allEmailsStr: string;
  phones: string[];
  sourceUrls: string[];
}

/**
 * Sanitise and validate an extracted email address.
 */
function cleanEmail(raw: string): string | null {
  let email = raw
    .replace(/^[<("'{\s]+|[>)"'}\s,;.:]+$/g, '')
    .toLowerCase()
    .trim();

  try {
    email = decodeURIComponent(email);
  } catch {}
  email = email.replace(/&#64;/g, '@').replace(/&#x40;/gi, '@');

  if (!email.includes('@') || email.length < 6 || email.length > 100) return null;
  if (EMAIL_EXCLUSION_RE.test(email)) return null;

  const parts = email.split('@');
  if (parts.length !== 2 || !parts[1].includes('.') || parts[0].length === 0) return null;

  return email;
}

/**
 * Extract emails from a raw HTML string.
 */
export function extractEmails(html: string): string[] {
  const found = new Set<string>();

  // From mailto: attributes
  let match: RegExpExecArray | null;
  MAILTO_RE.lastIndex = 0;
  while ((match = MAILTO_RE.exec(html)) !== null) {
    const raw = match[1].split('?')[0];
    const cleaned = cleanEmail(raw);
    if (cleaned) found.add(cleaned);
  }

  // From raw text
  EMAIL_RE.lastIndex = 0;
  while ((match = EMAIL_RE.exec(html)) !== null) {
    const cleaned = cleanEmail(match[1]);
    if (cleaned) found.add(cleaned);
  }

  return Array.from(found).slice(0, 5); // cap at 5 per page
}

/**
 * Extract phone numbers from a raw HTML string.
 */
export function extractPhones(html: string): string[] {
  // Strip HTML tags first for cleaner phone matching
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  PHONE_RE.lastIndex = 0;
  while ((match = PHONE_RE.exec(text)) !== null) {
    const phone = match[0].trim().replace(/\s+/g, ' ');
    // Basic sanity: must be at least 8 chars
    if (phone.replace(/\D/g, '').length >= 8) {
      found.add(phone);
    }
  }

  return Array.from(found).slice(0, 3);
}

/**
 * Harvest contact information for a given domain.
 * 1. Fetches homepage and scans for emails/phones
 * 2. Detects contact-related internal pages
 * 3. Fetches up to 2 contact pages and scans them too
 */
export async function harvestContacts(
  rootUrl: string,
  homepageHtml: string,
): Promise<ContactInfo> {
  const allEmails = new Set<string>();
  const allPhones = new Set<string>();
  const sourceUrls: string[] = [rootUrl];

  // ── Scan homepage ────────────────────────────────────────────
  for (const e of extractEmails(homepageHtml)) allEmails.add(e);
  for (const p of extractPhones(homepageHtml)) allPhones.add(p);

  // ── Find & fetch contact pages if needed ─────────────────────
  const internalHrefs = extractAllHrefs(homepageHtml, rootUrl);
  const contactUrls = findContactPageUrls(internalHrefs).slice(0, 3);

  for (const url of contactUrls) {
    try {
      const result = await fetchPage(url, 6_000);
      if (result.ok && result.html) {
        sourceUrls.push(url);
        for (const e of extractEmails(result.html)) allEmails.add(e);
        for (const p of extractPhones(result.html)) allPhones.add(p);
      }
    } catch (err) {
      logger.debug(`Contact page fetch failed [${url}]: ${(err as Error).message}`);
    }
  }

  const emailList = Array.from(allEmails);
  const primaryEmail = emailList.length > 0 ? emailList[0] : NO_EMAIL_FOUND;
  const allEmailsStr = emailList.length > 0 ? emailList.join(', ') : NO_EMAIL_FOUND;

  return {
    emails: emailList,
    primaryEmail,
    allEmailsStr,
    phones: Array.from(allPhones),
    sourceUrls,
  };
}
