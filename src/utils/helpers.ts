// ============================================================
// src/utils/helpers.ts
// Shared utility functions
// ============================================================

import { URL } from 'url';

/**
 * Normalise a URL string — prepend https:// if no protocol present.
 */
export function normaliseUrl(raw: string): string {
  raw = raw.trim();
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = `https://${raw}`;
  }
  return raw;
}

/**
 * Convert bytes to megabytes rounded to 2 decimal places.
 */
export function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 100) / 100;
}

/**
 * Convert bytes to kilobytes rounded to 1 decimal place.
 */
export function bytesToKb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Round a number to at most `decimals` decimal places.
 */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Safely extract hostname from a URL string; returns the original on failure.
 */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Return true if a URL is relative or shares the same host as base.
 */
export function isSameOrigin(href: string, base: string): boolean {
  try {
    const target = new URL(href, base);
    const baseUrl = new URL(base);
    return target.hostname === baseUrl.hostname;
  } catch {
    return false;
  }
}

/**
 * Resolve a potentially relative href to an absolute URL.
 */
export function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * Sleep for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a string to `maxLen` characters with ellipsis.
 */
export function truncate(str: string, maxLen = 80): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

/**
 * Convert a metric value (ms) into a human-readable string.
 */
export function msToReadable(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${round(ms / 1000, 1)}s`;
}
