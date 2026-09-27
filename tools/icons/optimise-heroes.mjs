/**
 * Hero image optimiser.
 *
 * The source illustrations are 1536x1024 PNGs at ~2.5 MB each — ten megabytes of
 * header art in a bundle whose entire JavaScript is eight. On a handset the header
 * is never wider than about 460pt, so the extra pixels buy nothing and cost a slow
 * first paint on exactly the screen a user opens first.
 *
 * Resized to 2x the widest phone frame and re-encoded as WebP, which holds painted
 * artwork far better than PNG at the same weight. Originals are left untouched in
 * `assets/top-menu-images/` as the source of truth.
 *
 * Run: node tools/icons/optimise-heroes.mjs <source-dir> <output-dir>
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

/** 2x the 460pt web frame, which is also comfortably 3x a 320pt phone. */
const TARGET_WIDTH = 920;
const QUALITY = 82;

const [sourceDir, outputDir] = process.argv.slice(2);
if (!sourceDir || !outputDir) {
  console.error('Usage: node tools/icons/optimise-heroes.mjs <source-dir> <output-dir>');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

/**
 * Source name to the screen it heads.
 *
 * Named by purpose rather than by number: `hero-today.webp` survives someone
 * reordering the source files, `top-menu-1` does not.
 */
const NAMES = {
  'top-menu-1.png': 'hero-today',
  'top-menu-2.png': 'hero-feed',
  'top-menu-3.png': 'hero-battle',
  'top-menu-4.png': 'hero-friends',
};

const files = readdirSync(sourceDir).filter((file) => file.endsWith('.png'));
let totalBefore = 0;
let totalAfter = 0;

for (const file of files) {
  const name = NAMES[file];
  if (!name) {
    console.log(`  skipped ${file} (no mapping)`);
    continue;
  }

  const from = join(sourceDir, file);
  const to = join(outputDir, `${name}.webp`);

  await sharp(from).resize({ width: TARGET_WIDTH, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(to);

  const before = statSync(from).size;
  const after = statSync(to).size;
  totalBefore += before;
  totalAfter += after;

  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
  console.log(`  ${file} -> ${name}.webp   ${kb(before)} -> ${kb(after)}`);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`\ntotal ${mb(totalBefore)} -> ${mb(totalAfter)}`);
