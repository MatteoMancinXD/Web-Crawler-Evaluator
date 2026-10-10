// ============================================================
// src/crawler/db.ts
// Persistent SQLite storage using sql.js (pure JS, no native deps).
// Stores visited websites reporting minimum information:
// domain, url, score, grade, contact_email, contact_phone, visited_at.
// Unreachable websites are NEVER saved to the database.
// ============================================================

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { VisitedSiteRow } from '../types/index.js';

export { VisitedSiteRow };

// ─── Schema ──────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS visited_sites (
  domain          TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  score           INTEGER NOT NULL,
  grade           TEXT NOT NULL,
  contact_email   TEXT NOT NULL DEFAULT 'no email found',
  contact_phone   TEXT,
  visited_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  root_url  TEXT NOT NULL UNIQUE,
  added_at  TEXT NOT NULL
);
`;

// ─── CrawlerDb class ─────────────────────────────────────────

export class CrawlerDb {
  private db!: Database;
  private dbPath: string;
  private flushTimer?: NodeJS.Timeout;
  private SQL!: SqlJsStatic;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
  }

  async init(): Promise<void> {
    this.SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fileBuffer);
      logger.info(`Loaded existing crawler DB: ${this.dbPath}`);
    } else {
      this.db = new this.SQL.Database();
      logger.info(`Created new crawler DB: ${this.dbPath}`);
    }

    this.db.run(SCHEMA);

    // Schema migration: Migrate legacy 'domains' table if present (only genuine audited sites)
    try {
      this.db.run(`
        INSERT OR IGNORE INTO visited_sites (domain, url, score, grade, contact_email, contact_phone, visited_at)
        SELECT hostname, root_url, overall_score, grade,
               COALESCE(contact_email, 'no email found'), contact_phone, COALESCE(audited_at, discovered_at)
        FROM domains
        WHERE status = 'audited' AND overall_score > 0 AND (error_msg IS NULL OR error_msg = '');
      `);
      this.db.run(`DROP TABLE IF EXISTS domains;`);
      this.db.run(`DROP TABLE IF EXISTS leads;`);
    } catch {}

    this.flush(); // initial save

    // Auto-flush every 30s
    this.flushTimer = setInterval(() => this.flush(), 30_000);
  }

  flush(): void {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err) {
      logger.warn(`DB flush failed: ${(err as Error).message}`);
    }
  }

  close(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
    this.db.close();
  }

  // ── Visited sites management ────────────────────────────────

  hasVisited(domain: string): boolean {
    const result = this.db.exec(
      `SELECT 1 FROM visited_sites WHERE domain = ? LIMIT 1`,
      [domain],
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  saveVisitedSite(site: VisitedSiteRow): void {
    const email = site.contact_email && site.contact_email.trim() !== ''
      ? site.contact_email.trim()
      : 'no email found';

    this.db.run(
      `INSERT OR REPLACE INTO visited_sites
        (domain, url, score, grade, contact_email, contact_phone, visited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        site.domain,
        site.url,
        site.score,
        site.grade,
        email,
        site.contact_phone ?? null,
        site.visited_at,
      ],
    );
  }

  getAllVisitedSites(): VisitedSiteRow[] {
    const result = this.db.exec(
      `SELECT domain, url, score, grade, contact_email, contact_phone, visited_at
       FROM visited_sites ORDER BY score ASC`,
    );
    if (!result.length) return [];
    const cols = result[0].columns;
    return result[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      if (!obj['contact_email'] || String(obj['contact_email']).trim() === '') {
        obj['contact_email'] = 'no email found';
      }
      return obj as unknown as VisitedSiteRow;
    });
  }

  countVisited(): number {
    const result = this.db.exec(`SELECT COUNT(*) FROM visited_sites`);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  countLeads(threshold = 50): number {
    const result = this.db.exec(
      `SELECT COUNT(*) FROM visited_sites WHERE score < ?`,
      [threshold],
    );
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  // ── Queue management ────────────────────────────────────────

  enqueue(rootUrl: string): void {
    this.db.run(
      `INSERT OR IGNORE INTO queue (root_url, added_at) VALUES (?, ?)`,
      [rootUrl, new Date().toISOString()],
    );
  }

  dequeue(): string | null {
    const result = this.db.exec(
      `SELECT id, root_url FROM queue ORDER BY id ASC LIMIT 1`,
    );
    if (!result.length || !result[0].values.length) return null;
    const [id, rootUrl] = result[0].values[0] as [number, string];
    this.db.run(`DELETE FROM queue WHERE id = ?`, [id]);
    return rootUrl;
  }

  queueLength(): number {
    const result = this.db.exec(`SELECT COUNT(*) FROM queue`);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  clearQueue(): void {
    this.db.run(`DELETE FROM queue`);
    this.flush();
  }

  getAllQueuedUrls(): string[] {
    const result = this.db.exec(`SELECT root_url FROM queue`);
    if (!result.length) return [];
    return result[0].values.map((row) => row[0] as string);
  }
}
