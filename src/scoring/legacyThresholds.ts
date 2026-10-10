// ============================================================
// src/scoring/legacyThresholds.ts
// Configurable thresholds for Outdated & Cluttered Website Detection
// ============================================================

export const LEGACY_THRESHOLDS = {
  // Information Overload & Density
  MAX_DOM_NODES: 1500, // Pages above this are considered cluttered
  HIGH_DENSITY_DOM_NODES: 3000,
  LINK_TO_TEXT_RATIO_WARN: 0.3, // If 30% of visible text is links, it's a link farm or legacy directory

  // Confusing & Bloated Navigation
  MAX_NAV_LINKS: 15,
  MEGA_NAV_LINKS: 30, // 30+ links in nav is considered a bloated mega-menu

  // Poor Typography
  MIN_BODY_FONT_PX: 14,
  MIN_LINE_HEIGHT: 1.3,

  // Boxy & Rigid Layouts
  MAX_LEGACY_WIDTH_PX: 1024,
  MIN_LEGACY_WIDTH_PX: 800,

  // Outdated Copyright Year
  MAX_ACCEPTABLE_COPYRIGHT_YEAR: new Date().getFullYear() - 3, // e.g. anything older than 2023 is flagged (if year is 2026)

  // Weights for the Ugliness/Legacy Score Breakdown (Out of 100)
  WEIGHTS: {
    INFORMATION_DENSITY: 15,
    NAVIGATION_BLOAT: 20,
    RIGID_LAYOUT: 25,
    TYPOGRAPHY: 15,
    MOBILE_UNFRIENDLINESS: 15,
    LEGACY_FOOTPRINT: 10,
  }
};
