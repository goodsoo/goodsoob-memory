#!/usr/bin/env node
/**
 * Canonical app-icon generator — managed by goodsoob-design-system.
 *
 * DO NOT EDIT in consumer repos. Edits belong in
 * goodsoob-design-system/scripts/gen-icons.mjs and propagate via
 * `node scripts/sync.mjs <consumer>`.
 *
 * Reads the app's brand SVG and emits the standard app-icon set beside it —
 * white (rounded) background + centered logo:
 *   icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png
 *
 * The browser-tab favicon stays the SVG itself (crisp, scalable) — no PNG
 * needed there; only PWA/iOS/notification surfaces require raster.
 *
 * Run: node scripts/gen-icons.mjs   (requires sharp)
 */
import sharp from "sharp";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Brand SVG lives beside the app's public assets; probe the common layouts so
// this one script works across repos (public/, web/public/, or repo root).
const CANDIDATES = [
  "public/favicon.svg", "public/icon.svg",
  "web/public/favicon.svg", "web/public/icon.svg",
  "favicon.svg", "icon.svg",
];
const rel = CANDIDATES.find((p) => existsSync(join(root, p)));
if (!rel) {
  console.error("gen-icons: no brand SVG found (looked for: " + CANDIDATES.join(", ") + ")");
  process.exit(1);
}
const srcPath = join(root, rel);
const outDir = dirname(srcPath);
const svg = readFileSync(srcPath);

// Render once large (density lifts small viewBoxes to crisp raster), trim the
// transparent margin → reused at a consistent size across every icon.
const tight = await sharp(svg, { density: 384 })
  .resize(1024, 1024, { fit: "contain", background: "#00000000" })
  .png()
  .trim()
  .toBuffer({ resolveWithObject: true });

function roundedBg(size, radius) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`,
  );
}

// white (rounded) bg + centered dark logo. fill = logo's share of the longer edge.
async function makeIcon(size, radiusPct, fill) {
  const bg = await sharp(roundedBg(size, Math.round(size * radiusPct))).png().toBuffer();
  const target = Math.round(size * fill);
  const logo = await sharp(tight.data)
    .resize(target, target, { fit: "inside", background: "#00000000" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((size - logo.info.width) / 2);
  const top = Math.round((size - logo.info.height) / 2);
  return sharp(bg).composite([{ input: logo.data, top, left }]).png().toBuffer();
}

const targets = [
  { size: 192, file: "icon-192.png", radiusPct: 0.22, fill: 0.62 },
  { size: 512, file: "icon-512.png", radiusPct: 0.22, fill: 0.62 },
  // maskable: the platform masks it, so full-bleed white square + logo in the safe zone.
  { size: 512, file: "icon-512-maskable.png", radiusPct: 0, fill: 0.5 },
  { size: 180, file: "apple-touch-icon.png", radiusPct: 0.22, fill: 0.62 },
];

for (const t of targets) {
  const out = await makeIcon(t.size, t.radiusPct, t.fill);
  writeFileSync(join(outDir, t.file), out);
  console.log(`gen-icons: wrote ${join(dirname(rel), t.file).replace(/\\/g, "/")}`);
}
console.log(`gen-icons: source ${rel}`);
