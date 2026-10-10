// ============================================================
// src/types/index.ts
// Central type definitions for the audit engine
// ============================================================

// ─── AI Decision types (RizzoFlow) ───────────────────────────

export interface WebsiteClassification {
  /** true = proper human-facing website, false = web service / API / non-site */
  isProperWebsite: boolean;
  /** Confidence of the classification, 0–1 */
  confidence: number;
  /** Source of the decision */
  source: 'rizzo-flow' | 'algorithmic-fallback';
  /** Human-readable reason */
  reason: string;
  /** Raw RizzoFlow latency in ms (if used) */
  rizzoLatencyMs?: number;
}

export interface DesignEpochDecision {
  /** Overridden isOutdatedOrVintage value (consensus between heuristics + LLM) */
  isOutdatedOrVintage: boolean;
  /** Final vintage score 0–100 after LLM adjustment */
  vintageScore: number;
  /** LLM's classification of the design era */
  designEra: 'modern' | 'dated_2000s' | 'vintage_90s' | 'undetermined';
  /** Probability of the winning classification, 0–1 */
  confidence: number;
  /** Source of the decision */
  source: 'rizzo-flow' | 'algorithmic-fallback';
  /** Human-readable explanation */
  reason: string;
  /** Raw RizzoFlow latency in ms (if used) */
  rizzoLatencyMs?: number;
}

export interface AuditOptions {
  url: string;
  timeoutMs?: number;
  mobileViewport?: boolean;
  userAgent?: string;
}

// ─── Raw Metric Containers ────────────────────────────────────

export interface PerformanceMetrics {
  /** Largest Contentful Paint in milliseconds */
  lcp: number | null;
  /** Cumulative Layout Shift score */
  cls: number | null;
  /** Interaction to Next Paint in milliseconds */
  inp: number | null;
  /** Time to First Byte in milliseconds */
  ttfb: number | null;
  /** Total page load time in milliseconds */
  totalLoadTime: number | null;
  /** Total transfer size in bytes */
  totalPayloadBytes: number | null;
  /** Number of uncompressed image assets (PNG/JPEG over threshold) */
  uncompressedImagesCount: number;
  /** Sum of uncompressed image sizes in bytes */
  uncompressedImagesTotalBytes: number;
  /** Lighthouse performance score (0–1) */
  lighthousePerformanceScore: number | null;
}

export interface DesignAestheticsMetrics {
  /** True if the website exhibits strong 1990s/early-2000s design hallmarks */
  isOutdatedOrVintage: boolean;
  /** Estimated vintage index from 0 to 100 (higher = more dated) */
  vintageScore: number;
  /** Whether modern layout engines (CSS Flexbox or CSS Grid) are detected */
  modernLayoutUsed: boolean;
  /** Whether modern web fonts or a modern sans-serif system stack is used */
  modernTypographyUsed: boolean;
  /** Whether primary body font is default browser serif (Times New Roman / raw serif) */
  hasDefaultSerifFont: boolean;
  /** Whether links use raw default browser blue (#0000ee) with standard underline */
  hasRawUnstyledLinks: boolean;
  /** Number of modern CSS styling depth features (border-radius, box-shadow, transitions, gradients, css variables) */
  aestheticFeaturesCount: number;
  /** List of legacy/vintage HTML elements or attributes found (e.g. <center>, <font>, cellpadding, bgcolor) */
  vintageElementsFound: string[];
  /** Whether responsive @media queries are present in stylesheets */
  hasMediaQueries: boolean;
  /** Whether page uses hardcoded legacy fixed-width containers (<= 980px) */
  hasFixedLegacyWidth: boolean;
  /** Visual polish score from 0 to 100 (higher = more polished and modern) */
  visualStyleScore: number;
}

export interface MobileUxMetrics {
  hasViewportMeta: boolean;
  viewportContent: string | null;
  hasHorizontalScroll: boolean;
  smallTapTargets: TapTargetViolation[];
  hasIntrusivePopup: boolean;
  contentOverflowOnMobile: boolean;
  designAesthetics: DesignAestheticsMetrics;
}

export interface TapTargetViolation {
  selector: string;
  width: number;
  height: number;
  label: string;
}

export interface TechStackMetrics {
  isHttps: boolean;
  hasMixedContent: boolean;
  sslValid: boolean;
  sslError: string | null;
  detectedLegacyFrameworks: LegacyFramework[];
  hasTableLayout: boolean;
  hasFrameset: boolean;
  hasFlashObjects: boolean;
  hasObsoleteTags: string[];
  hasHtml5Landmarks: boolean;
  missingLandmarks: string[];
  hasInlineCssLayout: boolean;
}

export interface LegacyFramework {
  name: string;
  version: string | null;
  severity: 'critical' | 'warning' | 'info';
  reason: string;
}

export interface AccessibilityMetrics {
  imagesWithoutAlt: number;
  imagesWithEmptyAlt: number;
  colorContrastViolations: number;
  formInputsWithoutLabel: number;
  missingLangAttribute: boolean;
  axeViolations: AxeViolation[];
  axeTotalViolationCount: number;
}

export interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  description: string;
  nodeCount: number;
}

export interface SeoMetrics {
  titleTag: string | null;
  titleTagCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  brokenInternalLinks: BrokenLink[];
  brokenAssetLinks: BrokenLink[];
  consoleErrors: ConsoleError[];
  hasCanonicalTag: boolean;
  hasRobotsTxt: boolean;
  hasSitemap: boolean;
}

export interface BrokenLink {
  url: string;
  statusCode: number;
  linkText: string;
}

export interface ConsoleError {
  type: 'error' | 'warning';
  message: string;
  url?: string;
}

// ─── Scoring ─────────────────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'F';

export interface CategoryScores {
  performance: number;    // 0–100
  mobileUx: number;       // 0–100
  accessibility: number;  // 0–100
  techAndSeo: number;     // 0–100
}

export interface ScoringResult {
  overallScore: number;           // 0–100 composite
  categoryScores: CategoryScores;
  grade: Grade;
  isHighPriorityTarget: boolean;  // true if score < 50
}

// ─── Report ──────────────────────────────────────────────────

export interface Issue {
  category: keyof CategoryScores;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  businessImpact: string;
  metric?: string | number | null;
}

export interface QuickWin {
  category: keyof CategoryScores;
  effort: 'low' | 'medium';
  title: string;
  action: string;
  estimatedImpact: string;
}

export interface ContactDetails {
  email: string;
  phones: string[];
  contactPageUrl: string | null;
}

export interface AuditReport {
  // Metadata
  url: string;
  finalUrl: string;
  scanTimestamp: string;
  scanDurationMs: number;
  userAgent: string;

  // Contact details
  contact: ContactDetails;

  // Raw metrics
  metrics: {
    performance: PerformanceMetrics;
    mobileUx: MobileUxMetrics;
    techStack: TechStackMetrics;
    accessibility: AccessibilityMetrics;
    seo: SeoMetrics;
  };

  // Scoring
  scoring: ScoringResult;

  // Actionable output
  critical_issues: Issue[];
  quick_wins: QuickWin[];

  // Error tracking
  errors: string[];

  // Unreachable flag (true if blocked by anti-crawler policies or navigation failed)
  isUnreachable?: boolean;

  // Discovered domains from rendered DOM (optional)
  discoveredItDomains?: string[];

  // ─── AI Decisions (RizzoFlow) ────────────────────────────────
  aiDecisions?: {
    /** Whether this URL was classified as a proper website or an API/web-service */
    websiteClassification: WebsiteClassification;
    /** Whether the visual design is modern or vintage */
    designEpoch: DesignEpochDecision;
  };
}

// ─── Visited Site Database Row (Minimum Information) ─────────

export interface VisitedSiteRow {
  domain: string;
  url: string;
  score: number;
  grade: string;
  contact_email: string;
  contact_phone: string | null;
  visited_at: string;
}

// ─── CSV row (flat projection) ────────────────────────────────

export interface AuditCsvRow {
  url: string;
  finalUrl: string;
  scanTimestamp: string;
  contactEmail: string;
  contactPhone: string;
  overallScore: number;
  grade: Grade;
  isHighPriorityTarget: boolean;
  performanceScore: number;
  mobileUxScore: number;
  accessibilityScore: number;
  techAndSeoScore: number;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
  totalLoadTime: number | null;
  totalPayloadKb: number | null;
  uncompressedImagesMb: number;
  hasViewportMeta: boolean;
  hasHorizontalScroll: boolean;
  smallTapTargetsCount: number;
  isOutdatedOrVintage: boolean;
  visualStyleScore: number;
  vintageElements: string;
  isHttps: boolean;
  sslValid: boolean;
  hasMixedContent: boolean;
  legacyFrameworks: string;
  axeViolations: number;
  imagesWithoutAlt: number;
  colorContrastViolations: number;
  titleTag: string;
  metaDescription: string;
  brokenLinksCount: number;
  consoleErrorsCount: number;
  criticalIssueCount: number;
  quickWinCount: number;
  errors: string;
}
