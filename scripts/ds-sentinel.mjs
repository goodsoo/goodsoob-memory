/**
 * ds-sentinel.mjs — shared sentinel / fingerprint utilities
 *
 * Used by both sync.mjs (write fingerprints) and ds-guard.mjs (verify them).
 * Zero runtime deps — node built-ins only.
 */
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Comment wrappers — wrap(name, body) → sentinel block string
// ---------------------------------------------------------------------------
export const COMMENT_WRAPPERS = {
  css: (name, body) =>
    `/* DESIGN-SYSTEM:${name} START — managed by goodsoob-design-system, do not edit */\n${body.trimEnd()}\n/* DESIGN-SYSTEM:${name} END */`,
  js: (name, body) =>
    `/* DESIGN-SYSTEM:${name} START — managed by goodsoob-design-system, do not edit */\n${body.trimEnd()}\n/* DESIGN-SYSTEM:${name} END */`,
  md: (name, body) =>
    `<!-- DESIGN-SYSTEM:${name} START — managed by goodsoob-design-system, do not edit -->\n${body.trimEnd()}\n<!-- DESIGN-SYSTEM:${name} END -->`,
};

// ---------------------------------------------------------------------------
// Sentinel patterns — SENTINEL_PATTERNS[comment](name) → { start, end }
// ---------------------------------------------------------------------------
export const SENTINEL_PATTERNS = {
  css: (name) => ({
    start: new RegExp(`/\\* DESIGN-SYSTEM:${name} START[\\s\\S]*?\\*/`),
    end: new RegExp(`/\\* DESIGN-SYSTEM:${name} END \\*/`),
  }),
  js: (name) => ({
    start: new RegExp(`/\\* DESIGN-SYSTEM:${name} START[\\s\\S]*?\\*/`),
    end: new RegExp(`/\\* DESIGN-SYSTEM:${name} END \\*/`),
  }),
  md: (name) => ({
    start: new RegExp(`<!-- DESIGN-SYSTEM:${name} START[\\s\\S]*?-->`),
    end: new RegExp(`<!-- DESIGN-SYSTEM:${name} END -->`),
  }),
};

// ---------------------------------------------------------------------------
// hashContent — sha256 hex of content (normalises \r\n → \n first)
// ---------------------------------------------------------------------------
export function hashContent(str) {
  const normalised = str.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

// ---------------------------------------------------------------------------
// extractBlock — pull a sentinel block (START…END inclusive) from content.
// Returns the matched string, or null if not found.
// comment = 'css' | 'js' | 'md'
// ---------------------------------------------------------------------------
export function extractBlock(content, name, comment) {
  const patterns = SENTINEL_PATTERNS[comment]?.(name);
  if (!patterns) return null;

  const startMatch = content.match(patterns.start);
  const endMatch = content.match(patterns.end);
  if (!startMatch || !endMatch) return null;

  const startIdx = startMatch.index;
  const endIdx = endMatch.index + endMatch[0].length;
  if (endIdx <= startIdx) return null;

  return content.slice(startIdx, endIdx);
}
