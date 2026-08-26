#!/usr/bin/env node
/**
 * Generates the responsive image set the pages actually serve.
 *
 * Originals live in src/images/_src/ and are gitignored: they are camera files,
 * up to 11 MB each. Only the derivatives below are committed, because those are
 * what ships to a phone on a cold ad click.
 *
 * Each source produces WebP and JPEG at 400, 800 and 1600 wide, plus a manifest
 * carrying the intrinsic dimensions so every <img> can declare width and height
 * and reserve its space before it loads. No layout shift, by construction.
 *
 * Run: npm run build:img
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'images', '_src');
// Served by Cloudflare's asset server, so it must live OUTSIDE src/:
// anything under the assets directory is uploaded, and the originals must not be.
const OUT = join(ROOT, 'public', 'img');
const EXPORTS = join(ROOT, 'src', 'images', 'exports');

const WIDTHS = [400, 800, 1600];
const WEBP_Q = 74;
const JPEG_Q = 72;

/**
 * slug -> source file. Slugs are what the pages reference, so renaming an
 * original does not silently break a page: this table is the contract.
 */
const IMAGES = {
  'guard-pass':      ['14 dollar guard bundle', 'DSC_0003 2.jpg'],
  'inverted':        ['14 dollar guard bundle', 'inverted 3.JPG'],
  'wall-happy-baby': ['14 dollar guard bundle', 'happy wall baby.jpg'],
  'straddle-fold':   ['14 dollar guard bundle', '263_19_yogaforbjj_ 314.jpg'],
  'side-angle':      ['Yoga for rocks ', 'sideangle.JPG'],
  'twist-chair-wide':['Yoga for rocks ', 'twist chair 851x315.JPG'],
  'compass-dark':    ['yoga for bjj membership', 'sebbg1.JPG'],
  'lunge-wide':      ['yoga for bjj membership', 'seb background kurs feb 2018 2.JPG'],
  'coaching':        ['yoga cert images', 'coach.jpg'],
};

/** 995x560 centre crop for the AutoCreator bundle image. Manual upload. */
const EXPORT_CROP = { slug: 'guard-pass', width: 995, height: 560, name: 'autocreator-bundle-995x560.jpg' };

const sips = (args) => execFileSync('sips', args, { stdio: 'pipe' }).toString();

function dimensions(file) {
  const out = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  return {
    w: Number(out.match(/pixelWidth:\s*(\d+)/)[1]),
    h: Number(out.match(/pixelHeight:\s*(\d+)/)[1]),
  };
}

const kb = (file) => Math.round(statSync(file).size / 1024);

mkdirSync(OUT, { recursive: true });
mkdirSync(EXPORTS, { recursive: true });

const manifest = {};
let totalBytes = 0;

for (const [slug, [folder, file]] of Object.entries(IMAGES)) {
  const source = join(SRC, folder, file);
  if (!existsSync(source)) {
    console.error(`  MISSING  ${slug}: ${source}`);
    process.exitCode = 1;
    continue;
  }

  const src = dimensions(source);
  const ratio = src.h / src.w;
  manifest[slug] = { intrinsic: src, ratio: Number(ratio.toFixed(4)), sizes: {} };
  const line = [];

  for (const width of WIDTHS) {
    // Never upscale: a 400px source does not become a 1600px file.
    const target = Math.min(width, src.w);
    const height = Math.round(target * ratio);
    const jpeg = join(OUT, `${slug}-${width}.jpg`);
    const webp = join(OUT, `${slug}-${width}.webp`);

    sips(['-Z', String(target), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_Q), source, '--out', jpeg]);
    execFileSync('cwebp', ['-q', String(WEBP_Q), '-quiet', '-m', '6', jpeg, '-o', webp], { stdio: 'pipe' });

    manifest[slug].sizes[width] = { w: target, h: height, jpeg: kb(jpeg), webp: kb(webp) };
    totalBytes += statSync(jpeg).size + statSync(webp).size;
    line.push(`${width}w ${kb(webp)}/${kb(jpeg)}KB`);
  }

  console.log(`  ${slug.padEnd(17)} ${String(src.w).padStart(4)}x${String(src.h).padEnd(4)}  ${line.join('  ')}`);
}

// ---- the manual-upload crop, centre-weighted
const cropSource = join(SRC, ...IMAGES[EXPORT_CROP.slug]);
const cropOut = join(EXPORTS, EXPORT_CROP.name);
// Fit the full frame to the target WIDTH first, then trim height. Resizing by
// longest edge instead zooms into the middle and throws the composition away.
sips(['--resampleWidth', String(EXPORT_CROP.width), cropSource, '--out', cropOut]);
sips(['-c', String(EXPORT_CROP.height), String(EXPORT_CROP.width), '-s', 'formatOptions', '86', cropOut]);
const cropDim = dimensions(cropOut);
console.log(`\n  export  ${EXPORT_CROP.name}  ${cropDim.w}x${cropDim.h}  ${kb(cropOut)}KB`);

writeFileSync(join(ROOT, 'src', 'images', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${Object.keys(manifest).length} images, ${WIDTHS.length} widths, both formats. On disk: ${Math.round(totalBytes / 1024)} KB total.`);
console.log('Manifest: src/images/manifest.json');
