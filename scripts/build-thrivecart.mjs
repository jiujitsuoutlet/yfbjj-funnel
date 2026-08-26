#!/usr/bin/env node
/**
 * Builds the paste-ready ThriveCart pages.
 *
 * These pages live inside ThriveCart's builder, not on this Worker, so they
 * cannot use the Worker's render-time injection. They are generated instead:
 * one design system in src/pages/_base.css, inlined into each page here, so
 * the funnel and the cart cannot drift apart.
 *
 * Run: npm run build:tc
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'thrivecart', '_src');
const OUT = join(ROOT, 'src', 'thrivecart');

const css = readFileSync(join(ROOT, 'src', 'pages', '_base.css'), 'utf8');

/**
 * These pages are hosted by ThriveCart, so every image needs an ABSOLUTE URL
 * back to this Worker's domain. Read it from [vars] rather than hardcoding it.
 * Empty leaves a marked placeholder, which preflight then refuses to ship.
 */
const config = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const match = config.match(/^ASSET_BASE_URL\s*=\s*"([^"]*)"/m);
const assetBase = (match && match[1].trim()) || '[[ASSET_BASE_URL]]';
if (assetBase.startsWith('[[')) {
  console.log('  note: ASSET_BASE_URL is unset, so image URLs stay as placeholders');
}

/**
 * The video slot.
 *
 * With no embed URL the whole VSL block is REMOVED rather than left as an empty
 * frame, so the page reads as finished on its own and the hero photograph keeps
 * carrying it. That also holds the promise of no external requests: nothing is
 * requested off this origin until there is a video to request.
 *
 * With a URL, a Bunny Stream iframe replaces the placeholder. autoplay stays
 * off deliberately... a video that starts talking at someone who just paid is a
 * good way to get a refund request.
 */
const vslMatch = config.match(/^VSL_EMBED_URL\s*=\s*"([^"]*)"/m);
const vslUrl = (vslMatch && vslMatch[1].trim()) || '';

/**
 * The single definition of what a built cart page looks like. preflight imports
 * this rather than re-implementing it: the staleness check drifted from the
 * generator twice, once per substitution added, and each time reported every
 * page stale forever. A check that cannot pass is not a check.
 */
export function renderCartPage(template, opts) {
  return applyVsl(template, opts.vslUrl)
    .replace(/\{\{BASE_CSS\}\}/g, () => opts.css)
    .replace(/\{\{ASSET_BASE\}\}/g, () => opts.assetBase);
}

export function applyVsl(html, vslUrl) {
  if (!vslUrl) {
    return html.replace(/[ \t]*<!-- VSL:START -->[\s\S]*?<!-- VSL:END -->\n?/g, '');
  }
  let src = vslUrl;
  // Force autoplay off even if the pasted URL says otherwise.
  src += (src.includes('?') ? '&' : '?') + 'autoplay=false&preload=false';
  const iframe =
    `<iframe src="${src}" title="Instructor certification" loading="lazy"\n` +
    `              allow="encrypted-media; picture-in-picture; fullscreen"\n` +
    `              allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return html
    .replace(/\[\[VSL_EMBED\]\]/g, () => iframe)
    .replace(/[ \t]*<!-- VSL:(START|END) -->\n?/g, '');
}

mkdirSync(OUT, { recursive: true });

// Only build when run directly. preflight imports renderCartPage from this
// file, and an import that rebuilds pages would let the gate quietly repair the
// staleness it is supposed to report.
const runDirectly = process.argv[1] && process.argv[1].endsWith('build-thrivecart.mjs');
if (!runDirectly) {
  // exported helpers only
} else {

const pages = readdirSync(SRC).filter((f) => f.endsWith('.html'));
if (!pages.length) {
  console.error('no page sources found in src/thrivecart/_src');
  process.exit(1);
}

for (const page of pages) {
  const template = readFileSync(join(SRC, page), 'utf8');
  // Replacer FUNCTION, never a string: $$, $&, $` and $' in the CSS would
  // otherwise be treated as replacement patterns and silently mangle output.
  const html = renderCartPage(template, { css, assetBase, vslUrl });
  const target = join(OUT, basename(page));
  writeFileSync(target, html);
  console.log(`  built  src/thrivecart/${basename(page)}  ${(html.length / 1024).toFixed(1)} KB`);
}
console.log(`${pages.length} page(s) built. Paste each file into ThriveCart as raw HTML.`);
console.log(vslUrl
  ? `  video: embedded from ${vslUrl}`
  : '  video: VSL_EMBED_URL unset, so the slot is omitted and the hero photo carries the page');

}
