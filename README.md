# Web Quality & UX Audit Engine

A modular, headless-browser-powered website audit tool that scores sites **0–100** on Performance, Mobile/UX, Accessibility, and Tech Modernity — then produces actionable JSON and CSV reports.

---

## Features

| Category | What's Measured |
|---|---|
| **Performance** | LCP, CLS, INP, TTFB, total load time, payload size, uncompressed images |
| **Mobile / UX & Aesthetics** | Viewport meta, horizontal overflow, tap-target sizes (< 48px), intrusive popups, **90s/vintage aesthetics detection** (CSS Flexbox/Grid usage, raw serif fonts, unstyled default blue links, obsolete vintage tags like `<center>`/`<font>`/`cellpadding`, lack of modern CSS depth) |
| **Accessibility** | Missing alt attributes, colour contrast, unlabelled form inputs, lang attribute, axe-core WCAG scan |
| **Tech & SEO** | HTTPS/SSL validity, mixed content, legacy frameworks (jQuery < 3, AngularJS 1.x …), obsolete HTML tags, missing title/meta, broken links, console errors |
| **Domain Crawler** | Autonomous BFS crawler for web domains with strict filters against government, PA, and mega-platforms |
| **Lead Harvester** | Extracts email contacts (or `"no email found"`) and phones for targeted outreach |

---

## Prerequisites

- **Node.js ≥ 18** (LTS recommended)
- **npm ≥ 9**
- Chromium is downloaded automatically on `npm install`

---

## Installation

```bash
git clone <repo>
cd web-quality-audit-engine
npm install          # downloads deps + installs Chromium via Playwright
npm run build        # compiles TypeScript → dist/
```

> **Windows note:** if `postinstall` fails for Chromium, run manually:
> ```
> npx playwright install chromium
> ```

---

## Usage

### Single URL

```bash
# Quick scan — rich console output + JSON report
npx ts-node src/cli.ts scan --url https://example.com

# With compiled build
node dist/cli.js scan --url https://example.com

# Export both JSON and CSV, custom output folder
node dist/cli.js scan --url https://example.com --json --csv --output ./my-reports

# Set a longer timeout (60s)
node dist/cli.js scan --url https://slow-site.com --timeout 60000
```

### Batch Scan

```bash
# Audit a list of URLs from a file
node dist/cli.js batch --list urls.txt --csv --output ./reports

# Comma-separated URLs directly
node dist/cli.js batch --url "https://site-a.com,https://site-b.com,https://site-c.com"

# Control concurrency (default 3, max 5)
node dist/cli.js batch --list urls.txt --concurrency 5 --json --csv

# Write one JSON file per site
node dist/cli.js batch --list urls.txt --json-per-site
```

### urls.txt format

```
# One URL per line. Lines starting with # are ignored.
https://example.com
https://another-site.org
http://legacy-site.com
```

### Domain Discovery Crawler

An autonomous background crawler that starts from seed URLs, discovers new domains (.it, .com, .eu, .net, etc.) via outbound links, scrapes contact details for **every** analyzed site, automatically excludes public administration, government, regions, and mega-platforms, and feeds candidate domains into the audit engine to identify high-potential leads.

#### Quick Start Commands (PowerShell / CMD / Bash)

> **💡 Windows PowerShell Tip:** Use `node dist/crawlCli.js` or `npm.cmd` directly to bypass PowerShell's default `.ps1` execution policy.

```bash
# 1. Direct Node command (Recommended for Windows PowerShell & CMD — fastest & no policy errors):
node dist/crawlCli.js --seeds https://www.edutecnica.it --max-domains 20

# 2. Run with default seeds (Corriere / Repubblica):
node dist/crawlCli.js

# 3. Specify custom seeds and a duration limit:
node dist/crawlCli.js --seeds https://www.paginegialle.it,https://www.tuttitalia.it --max-domains 50 --duration 1h

# 4. Using npm on Windows (use npm.cmd in PowerShell):
npm.cmd run crawl -- --seeds https://www.edutecnica.it --max-domains 20

# 5. View all available crawler CLI flags:
node dist/crawlCli.js --help
```

#### Crawler Command-Line Options

| Option | Default | Description |
|---|---|---|
| `--seeds <urls>` | (none if DB exists) | Comma-separated initial URLs to seed the queue |
| `--resume` | - | Resume crawling directly from the existing queue without adding new seeds |
| `--fresh` | - | Wipe existing database (`data/crawler.db`) and start completely fresh |
| `--clear-queue` | - | Clear the existing crawling queue before starting (keeps visited sites) |
| `--max-domains <n>` | `0` (unlimited) | Maximum number of domains to fully audit before stopping. Set `0` for unlimited |
| `--duration <time>` | `0` (unlimited) | Run duration limit (e.g. `2h`, `30m`, `90s`). Set `0` for unlimited |
| `--concurrency <n>` | `3` | Concurrent headless browser sessions (1+) |
| `--lead-threshold <score>` | `50` | Score threshold below which a site is flagged as an outreach lead |
| `--delay <ms>` | `750` | Politeness delay between requests to the same origin |
| `--output <dir>` | `./reports` | Output directory for individual JSON reports (1 per visited site) |
| `--db <path>` | `./data/crawler.db` | Persistent SQLite database file storing queue and visited sites |
| `--timeout <ms>` | `35000` | Per-site audit timeout in milliseconds |

#### Contact Email Harvesting (`no email found` Fallback)

For **every website analyzed**:
1. The engine scans the homepage for `mailto:` links and text regex email patterns.
2. It detects internal contact pages (`/contatti`, `/chi-siamo`, `/about`, `/info`) and scrapes them.
3. If an email address is found, it is recorded. If no email is found, it is explicitly recorded as **`"no email found"`** (never left blank).
4. Reachable sites are saved directly into the SQLite database with their score, grade, and contact details.

#### Unreachable Websites Policy
Websites that cannot be reached (e.g. DNS failure, connection timeout, SSL errors, or anti-crawler policies like Cloudflare bot challenges and HTTP 403/429/503 responses) are **NOT added to the database**. They are skipped to prevent false records from polluting the dataset.

#### Stopping the Crawler

- **Manual Stop:** Press `Ctrl + C` in CMD or PowerShell at any time. The engine catches the `SIGINT` signal, finishes in-flight audits, flushes the SQLite database, writes the final summaries, and cleanly exits.
- **Automatic Stop:** The crawler automatically terminates when `--max-domains` is reached or `--duration` expires.

---

## Output

### 1. JSON Report (1 file per visited website)

Saved as `<outputDir>/<domain>.json` directly containing the audit object:

```jsonc
{
  "url": "https://example.com",
  "finalUrl": "https://www.example.com/",
  "scanTimestamp": "2026-09-28T09:00:00.000Z",
  "scanDurationMs": 12450,
  "contact": {
    "email": "info@example.com", // or "no email found"
    "phones": ["+39 02 1234567"],
    "contactPageUrl": "https://example.com/contatti"
  },
  "scoring": {
    "overallScore": 62,
    "categoryScores": {
      "performance":   55,
      "mobileUx":      80,
      "accessibility": 60,
      "techAndSeo":    65
    },
    "grade": "C",
    "isHighPriorityTarget": false
  },
  "critical_issues": [ ... ],
  "quick_wins": [ ... ],
  "metrics": { "performance": {…}, "mobileUx": {…}, "techStack": {…}, ... }
}
```

### 2. SQLite Database (`data/crawler.db`)

Each visited and reachable site has **a single line in the database reporting minimum information**:

#### Table: `visited_sites`

| Column | Type | Description |
|---|---|---|
| `domain` | `TEXT PRIMARY KEY` | Website domain name |
| `url` | `TEXT` | Final audited URL |
| `score` | `INTEGER` | Overall score (0–100) |
| `grade` | `TEXT` | Quality grade (A, B, C, F) |
| `contact_email` | `TEXT` | Harvested email or `"no email found"` |
| `contact_phone` | `TEXT` | Harvested phone number (or NULL) |
| `visited_at` | `TEXT` | ISO 8601 visit timestamp |

| url | finalUrl | contactEmail | overallScore | grade | isHighPriorityTarget | lcp | cls | ttfb | axeViolations | brokenLinksCount | ... |
|---|---|---|---|---|---|---|---|---|---|---|---|

---

## Scoring Rationale

### Weights

| Category | Weight | Rationale |
|---|---|---|
| **Mobile / UX & Aesthetics** | 40% | Dominant conversion & trust factor. Evaluates mobile responsiveness AND visual design modernity (Flexbox/Grid, typography, unstyled links, modern CSS polish). |
| **Performance** | 20% | Core Web Vitals & speed. Prevents lightweight 90s-era static text from masking obsolete visual design. |
| **Accessibility** | 20% | WCAG compliance, legal risk (ADA/CVAA), and inclusive design |
| **Tech & SEO** | 20% | Security, technical debt, and search visibility |

### ⚡ Vintage 90s Design Hard Cap
Websites with 1990s/early-2000s graphics previously scored 60+ because they are lightweight and load fast. The engine now features an intelligent **Vintage Design Hard Cap**:
If a site is flagged with obsolete design hallmarks (no modern CSS layout engine, raw Times New Roman body text, unstyled `#0000ee` blue hyperlinks, obsolete HTML elements like `<center>`, `<font>`, `cellpadding`, lack of CSS depth like border-radius/shadows), its overall score is automatically **capped at a maximum of 42/100 (Grade F)**.
This guarantees that visually obsolete sites are always classified as **High-Priority Leads** in `reports/leads_review.csv`.

### Grade Scale

| Grade | Score | Classification |
|---|---|---|
| **A** | 80–100 | Modern / Healthy |
| **B** | 65–79  | Acceptable |
| **C** | 50–64  | Needs Work |
| **F** | 0–49   | Severely Outdated / Poor UX / Vintage Design |

Sites scoring **below 50** are automatically flagged as **High-Priority Outreach Targets**.

### Metric Thresholds (Google / WCAG standards)

| Metric | Good | Poor |
|---|---|---|
| LCP | ≤ 2.5s | > 4.0s |
| CLS | ≤ 0.1 | > 0.25 |
| INP | ≤ 200ms | > 500ms |
| TTFB | ≤ 800ms | > 1800ms |
| Page payload | ≤ 1 MB | > 5 MB |

## Starting & Stopping RizzoFlow (AI Engine)

The scanner uses **RizzoFlow**, a local AI model, to intelligently classify non-websites and judge 1990s vintage design aesthetics.

### To Start the AI Server
Open a **new, separate PowerShell/CMD window** so it runs in the background, then run:
```bash
cd d:\MATTEO\rizzo-flow
uv run rizzo serve --device vulkan
```
*(Leave this window open as long as you want to run scans).*

### To Stop the AI Server
Simply go to the terminal window where RizzoFlow is running and press `Ctrl + C`.

If RizzoFlow is **not running**, the scanner won't crash—it will just gracefully fall back to its internal algorithmic heuristics!

---

## Architecture

```
src/
├── cli.ts                    # Commander.js CLI entry point (single & batch scan)
├── crawlCli.ts               # Autonomous Italian domain crawler CLI entry point
├── index.ts                  # Public API barrel
├── types/
│   └── index.ts              # All TypeScript interfaces & types
├── utils/
│   ├── logger.ts             # Winston structured logger
│   └── helpers.ts            # URL normalisation, unit conversion, etc.
├── crawler/
│   ├── engine.ts             # 2-stage BFS discovery + audit coordinator
│   ├── db.ts                 # Persistent SQLite database (sql.js)
│   ├── domainFilter.ts       # .it TLD matching and mega-platform blacklist
│   ├── linkExtractor.ts      # Regex-based HTML link extractor
│   ├── httpFetcher.ts        # Fast lightweight HTTP fetcher (Stage 1)
│   ├── contactHarvester.ts   # Email/phone scraper with "no email found" fallback
│   └── reporter.ts           # Terminal dashboard & CSV/JSON exporter
├── runner/
│   ├── browser.ts            # Playwright browser/session lifecycle
│   ├── auditor.ts            # Single-URL audit orchestrator (with contact harvesting)
│   └── batchRunner.ts        # Concurrent batch with p-limit
├── evaluators/
│   ├── performance.ts        # Web Vitals, payload, Lighthouse
│   ├── mobileUx.ts           # Viewport, overflow, tap targets, popups
│   ├── techStack.ts          # SSL, legacy frameworks, HTML modernity
│   ├── accessibility.ts      # axe-core + DOM-based a11y checks
│   └── seo.ts                # Title/meta, broken links, robots.txt
├── scoring/
│   └── engine.ts             # Weighted scoring, grading, issues, quick wins
└── reporters/
    ├── consoleReporter.ts    # Rich terminal output (chalk)
    ├── jsonReporter.ts       # JSON file writer
    └── csvReporter.ts        # Flat CSV via fast-csv
```

### Concurrency Model

```
CLI batch command
      │
      ▼
  runBatch()  ─── p-limit(concurrency=3) ──►  auditUrl(url1)
                                           ──►  auditUrl(url2)
                                           ──►  auditUrl(url3)
                                                 │ each spawns:
                                                 ├─ Desktop Playwright session
                                                 │   ├─ evaluatePerformance (+ Lighthouse child proc)
                                                 │   ├─ evaluateTechStack
                                                 │   ├─ evaluateAccessibility (axe-core)
                                                 │   └─ evaluateSeo (link checker)
                                                 └─ Mobile Playwright session
                                                     └─ evaluateMobileUx
```

---

## Programmatic API

```typescript
import { auditUrl, runBatch, writeCsv, writeJson } from 'web-quality-audit-engine';

// Single URL
const report = await auditUrl({ url: 'https://example.com', timeoutMs: 30000 });
console.log(report.scoring.overallScore); // e.g. 72

// Batch
const { reports, summary } = await runBatch({
  urls: ['https://site-a.com', 'https://site-b.com'],
  concurrency: 3,
  onProgress: (done, total, report) => console.log(`${done}/${total}`),
});

await writeCsv(reports, './output/report.csv');
writeJson(reports, './output/report.json');
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |

---

## Troubleshooting

**Chromium not found**
```bash
npx playwright install chromium --with-deps
```

**"Navigation timeout" on slow sites**
```bash
node dist/cli.js scan --url https://slow-site.com --timeout 60000
```

**Lighthouse not scoring** — Lighthouse runs as a separate child process. Ensure `node_modules/lighthouse/cli/index.js` exists after `npm install`.

**SSL errors being swallowed** — SSL is checked via a raw TLS socket separately from Playwright (which bypasses errors). Both results appear in the report.

**PowerShell: "L'esecuzione di script è disabilitata nel sistema in uso" (PSSecurityException)**
Windows PowerShell blocks `.ps1` scripts by default. You have two easy solutions (no Admin required):
1. **Option 1 (Recommended):** Run with `node` or `npm.cmd` directly:
   ```powershell
   node dist/crawlCli.js --seeds https://www.example.com
   npm.cmd run crawl -- --seeds https://www.example.com
   ```
2. **Option 2:** Enable script execution for your user profile in PowerShell:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

---

## License

MIT
