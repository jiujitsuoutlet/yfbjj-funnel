# AGENTS.md

Read this before touching anything in this repo. It has zero prerequisites:
if you're an agent that just opened this directory, this is what you need.

## What this is

A Cloudflare Worker serving `welcome.yogaforbjj.net` — the landing page for
Yoga for BJJ's $14 Guard Retention Bundle, plus lead capture. That is the
whole job. This is a **live client** (Yoga for BJJ / Sebastian), not a demo.

Checkout is **ThriveCart** (`learnbjjfast.thrivecart.com`), and so is
everything after checkout — one-click upsells require the payment session to
stay on ThriveCart, so the whole post-purchase chain lives there, not here.
This repo builds those pages as standalone HTML for ThriveCart's page
builder (`src/thrivecart/`); it does not serve or route them.

Two A/B variants of the landing page (`landing-a.html` short, `landing-b.html`
long-form), decided server-side before render — no client redirect, no flash.

**Offer ladder** (ThriveCart owns these prices; treat this list as reference,
not source of truth — see "Which prices live where" below):
- Front: Guard Retention Bundle, $14
- Upsell 1: Head to Toes, $29 (was $59.99)
- Upsell 2: Lifetime access, $247 (was $297 — the site's own price)
- Downsell 2: 2-month trial, $8
- Upsell 3: Certification (3 levels), $397 (was $891 separately)

Full detail, routes, and operator knobs: [README.md](README.md). This file is
the rules; the README is the reference.

## Hard rules

**Preview mode defaults ON.** `PREVIEW_MODE` in `wrangler.toml` is treated as
true unless it is the exact string `"false"`. Unset, misspelled, or anything
else routes every CTA to `/preview-checkout`. Reason: a missing variable must
never be able to send paid ad traffic at a cart link that isn't wired yet.
Never "fix" a broken CTA by relaxing this check.

**Never bypass preflight.** `npm run deploy` runs `npm run preflight` first
and stops on any failure — that chain is load-bearing, don't break it or run
`wrangler deploy` directly. Preflight is the deploy gate, not a lint
suggestion: cart URL set, deadline set and future, preview off, real D1 id, no
unfilled placeholders, both variants complete, variant survives onto the cart
URL, ThriveCart pages current, secrets scan clean.

**Never deploy without explicit instruction.** Building, editing, and running
`npm run preflight` locally are fine. `wrangler deploy` (or anything that
runs it) needs the operator to say so, in this conversation, for this change.

**Never touch the client's Cloudflare/ThriveCart account beyond what's asked.**
No new routes, DNS, secrets, or ThriveCart products without being asked. If a
command 403s, that's not a puzzle to route around — stop and name the exact
missing permission (e.g. "this token can deploy Workers but not create D1
databases") rather than finding a workaround.

**No secrets in source, `wrangler.toml`, or the client bundle.** The Worker
currently needs none — ThriveCart owns payment. If that changes: Cloudflare
Secrets via `wrangler secret put`, read off `env`, local dev values in
`.dev.vars` (gitignored, see `.dev.vars.example`). Run `npm run scan` before
any deploy; it fails non-zero on a secret-shaped key in served output. See
"Known traps" below for why the scan pattern is anchored the way it is.

**Never invent a fact.** No price, claim, testimonial, date, guarantee, or
personal detail about a real person that wasn't given to you. If a fact is
missing, write a marked `[[PLACEHOLDER]]` and say out loud what's missing —
`npm run preflight` will catch an unfilled one before it ships. This
especially includes upsell/downsell prices: they live in ThriveCart only
(see below), never invent or duplicate one here.

**Which prices live where.** `BUNDLE_PRICE_CENTS` in `wrangler.toml` is the
only price this repo owns. Everything past the $14 front offer is ThriveCart's
number, deliberately absent from source — a second copy drifts (lifetime is
already $247 here vs $297 on the main site; that gap is intentional, not a
bug to reconcile).

## Verification discipline

**Verify in a real browser, not curl.** A JS syntax error in the inlined
per-page script has already shipped past a clean `curl` and a successful
`wrangler` bundle build in this repo's history (a `.replace()` call whose
replacement string contained `$'`-pattern characters silently mangled the
output). curl and the bundler both looked healthy while every page was
dead. Load the page, check the console, and `node --check` the extracted
inline script if you touch the page-config templating.

**Prove every gate in both directions.** A scan that has never failed is
decoration, not a scan. When you touch `scripts/scan-secrets.sh` or the
preflight checks, plant a fake failure, watch it catch, remove the fake, and
confirm it goes green again. A test that passes against the wrong fixture
(e.g. a seeded row keyed differently than the code actually reads) is worse
than no test — it's a false green.

**Before calling anything done:** both variants render at 375px and 1024px
with no console errors and no horizontal overflow; the `yfbjj_v` cookie
sticks across reloads and `?v=` forces without permanently overwriting it;
`npm run scan` and `npm run preflight` both ran clean, output pasted not
summarized; and you've said plainly which parts (usually: ThriveCart-side
behavior) you have not actually verified rather than implying they're proven.

## Voice

Ellipses for pacing, never em dashes — anywhere, including code comments and
commit messages.

Client-facing copy is Sebastian's voice: short declarative sentences,
negate-then-assert ("This isn't a stretching routine. It's guard retention
you can feel in your hips by week two."), no hype, no outcome guarantees. If
you're not confident a line is his voice, flag it rather than guessing.

## Brand, measured not guessed

Palette and type are measured off `yogaforbjj.net`, not invented: accent
`#dc2626`, grounds `#0a0a0a` / `#0e0e12`, translucent white for dim text,
`Arial, Helvetica, sans-serif`, headings uppercase at weight 900 with
`-.04em` tracking and `.92` line-height, pill CTAs. Body copy runs 17px/500
rather than the site's 14px/600 — deliberate, because this page is read on a
phone from an ad, not their desktop nav. That's the one sanctioned deviation;
don't add others without measuring and flagging them the same way (see the
`brand-fidelity-recon` skill).

The accent red on black measures near 3.3:1 contrast — fine for large display
type, a failure for body copy. Keep the accent in rules, badges, and large
headings; keep small text on the neutral ramp.

## Known traps

- **`[[ratelimits]]` is plural** in `wrangler.toml`. The singular
  `[[ratelimit]]` gets silently dropped by Wrangler (rejected with
  `Unexpected fields found in top-level field`, then omitted) — the Worker
  still deploys, just missing the burst limiter. Grep dev output for
  `Unexpected fields` after any change to that file.
- **`sizes="100vw"` on responsive images includes scrollbar width**, so it
  can request a slightly-too-large image or, at certain widths, cause a
  fractional overflow. Check actual rendered width at the breakpoints you
  touch rather than trusting the attribute.
- **ThriveCart pages need `ASSET_BASE_URL`.** They're hosted on ThriveCart's
  domain, not served by this Worker, so relative image paths (`/img/...`)
  break there. `scripts/build-thrivecart.mjs` rewrites them to an absolute
  origin from `[vars]` — never hand-edit a built `src/thrivecart/*.html`
  file; edit its source in `src/thrivecart/_src/` and rebuild.
- **Stripe's minimum charge is $0.50.** Not currently reachable (Stripe is
  parked, see below) but binding if it's ever un-shelved — don't wire a
  price under that.
- **Rate-limit test fixtures must key on the same identity the code reads.**
  Dev's `CF-Connecting-IP` is IPv6 loopback; a fixture seeded on
  `sha256("unknown")` will pass without the mechanism ever running.

## Parked code

Stripe checkout/webhook and the old `/upsell` page are parked in
`src/deferred/`, not deleted — each with a README on why, what stayed behind
(schema, mostly), and what would justify bringing it back. Read
`src/deferred/README.md` before reintroducing anything that looks similar;
don't rebuild what's already sitting there.

## Commands

```bash
npm run scan        # secrets scan — fails non-zero on a secret-shaped key in served output
npm run preflight    # full deploy gate, see "Hard rules" above
npm run build:tc     # rebuild src/thrivecart/*.html from _src/ + current [vars]
wrangler dev         # local dev server, http://localhost:8787
```

`npm run deploy` chains `preflight && wrangler deploy` — see "Never bypass
preflight" and "Never deploy without explicit instruction" above.
