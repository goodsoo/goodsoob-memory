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

function roundedBg(size, radius) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`,
  );
}

// white (rounded) bg + logo rendered AT ITS SVG viewBox scale — no trim, no
// re-normalization. 브랜드 SVG 작성자가 viewBox 안에 설계한 크기·여백을 그대로 존중해,
// 4앱 로고가 서로 비율이 맞게 나온다. (구 trim+긴변정규화는 종횡비 다른 로고를 불균등하게 만듦.)
async function makeIcon(size, radiusPct) {
  const bg = await sharp(roundedBg(size, Math.round(size * radiusPct))).png().toBuffer();
  const logo = await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
  return sharp(bg).composite([{ input: logo, top: 0, left: 0 }]).png().toBuffer();
}

const targets = [
  { size: 192, file: "icon-192.png", radiusPct: 0.22 },
  { size: 512, file: "icon-512.png", radiusPct: 0.22 },
  // maskable: full-bleed white square (플랫폼이 마스킹). viewBox 여백이 safe zone 역할.
  { size: 512, file: "icon-512-maskable.png", radiusPct: 0 },
  { size: 180, file: "apple-touch-icon.png", radiusPct: 0.22 },
];

for (const t of targets) {
  const out = await makeIcon(t.size, t.radiusPct);
  writeFileSync(join(outDir, t.file), out);
  console.log(`gen-icons: wrote ${join(dirname(rel), t.file).replace(/\\/g, "/")}`);
}
console.log(`gen-icons: source ${rel}`);
