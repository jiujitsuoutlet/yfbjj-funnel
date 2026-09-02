# AGENTS.md

Read this before touching anything in this repo. It has zero prerequisites:
if you're an agent that just opened this directory, this is what you need.

## What this is

A Cloudflare Worker serving `welcome.yogaforbjj.net`, the landing page for
Yoga for BJJ's anniversary offer, lead capture, guarded Stripe Checkout, and
the signed Stripe webhook ledger. This is a **live client** (Yoga for BJJ /
Sebastian), not a demo.

Stripe is the payment system. The previous ThriveCart pages remain in
`src/thrivecart/` as retired reference artifacts only. They are not served,
they are not part of production preflight, and no ThriveCart URL is required.

Two A/B variants of the landing page (`landing-a.html` short, `landing-b.html`
long-form), decided server-side before render — no client redirect, no flash.

**Offer ladder** (Stripe Price IDs in `wrangler.toml` are authoritative):
- Front: Guard Retention Bundle, $14
- Upsell 1: Head to Toes, $29 (was $59.99)
- Upsell 2: Lifetime access, $247 (was $297 — the site's own price)
- Downsell 2: $8 first month, then $19.99/month until canceled
- Final OTO: Yoga for BJJ Certification, $297

**Authenticated AutoCreator mappings** (verified 2026-09-01): Guard uses
`14-guard-retention-bundle` (`f0b327de-4093-4873-9f47-3113ad50ead0`), Head to
Toes uses `yoga-for-rocks-head-to-toes`
(`3c3947f7-cb93-4d40-a8c9-1806b6ed7060`), and Certification grants all three
level bundles: `level-1-instructors-course`
(`231686c4-5ba9-4053-90dd-7411f608676b`),
`level-2-instructor-course` (`b5bee770-e110-4c5b-abfd-ed43d6a09749`), and
`level-3-instructors-course` (`3801c1a9-8405-48b0-93ea-fffcbfdc00c8`). Lifetime
uses `price_1TdIGeARWKYPSBdfrFBG6rhT`; monthly uses
`price_1TdIGdARWKYPSBdfNJFlXdwy`. These are code-owned mappings, not editor
content.

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
suggestion: all verified Stripe Price IDs set, every exact AutoCreator grant
key set, fulfillment implemented, any configured deadline valid and future, preview
off, real D1 id, no unfilled served-page placeholders, both variants complete,
variant survives into Checkout metadata, images present, secrets scan clean.

**Never deploy without explicit instruction.** Building, editing, and running
`npm run preflight` locally are fine. `wrangler deploy` (or anything that
runs it) needs the operator to say so, in this conversation, for this change.

**Locked staging has its own gate.** `npm run deploy:staging:locked` chains the
locked-staging preflight and staging deploy. It requires preview and both
readiness flags to remain locked. Use it only for the initial isolated staging
revision, never for production or for opening checkout.

**Never touch the client's Cloudflare, Stripe, or AutoCreator account beyond what's asked.**
No new routes, DNS, secrets, Stripe objects, or AutoCreator objects without being asked. If a
command 403s, that's not a puzzle to route around — stop and name the exact
missing permission (e.g. "this token can deploy Workers but not create D1
databases") rather than finding a workaround.

**No secrets in source, `wrangler.toml`, or the client bundle.** Stripe and
webhook keys are Cloudflare Secrets via `wrangler secret put`, read off `env`.
Local development values belong in
`.dev.vars` (gitignored, see `.dev.vars.example`). Run `npm run scan` before
any deploy; it fails non-zero on a secret-shaped key in served output. See
"Known traps" below for why the scan pattern is anchored the way it is.

**Never invent a fact.** No price, claim, testimonial, date, guarantee, or
personal detail about a real person that wasn't given to you. If a fact is
missing, write a marked `[[PLACEHOLDER]]` and say out loud what's missing —
`npm run preflight` will catch an unfilled one before it ships. This
especially includes AutoCreator grant keys. Use only the authenticated mappings
recorded above and in `docs/autocreator-fulfillment-contract.md`.

**Which prices live where.** The five verified Stripe Price IDs in
`wrangler.toml` own billing. `BUNDLE_PRICE_CENTS` is display-only for the landing
page. The Certification product and price were created for EXC-127. Never create
or duplicate Stripe Products or Prices as a shortcut.

**Cancellation policy for the monthly downsell.** Canceling stops future Stripe
charges. Per the approved business rule, the buyer keeps Yoga for BJJ course
access after cancellation. Do not delete the AutoCreator member or revoke their
one-time bundle entitlements.

**Payment must never outrun access.** `src/stripe.js` keeps Checkout blocked
while either implementation constant is false, a required secret is absent, a
readiness flag is not the exact string `true`, the D1 readiness sentinel is
missing, or any offer lacks a required AutoCreator grant key. Do not flip the
fulfillment lock or readiness flags until grant, read-back, retry, and
revocation behavior pass against the deployed staging revision.

**Webhook work is leased and idempotent.** Fresh `processing` events return a
retryable error. Stale event and entitlement leases may be reclaimed. Every
AutoCreator call must remain behind the stable D1 outbox operation key. Do not
invent an HTTP idempotency header; the two confirmed grant tools are themselves
idempotent. Durable `granted` state must be written before `/thanks` claims access.

**The post-purchase sequence is server-owned.** Initial Checkout accepts Guard
only. Child offers come from D1, never from browser-supplied offer data. Every
mutation requires the opaque HttpOnly flow cookie, same Origin, the matching
paid Stripe Session, and durable AutoCreator read-back. Each accept opens a
fresh Stripe-hosted Checkout. A Stripe cancel is not a decline.

**AutoCreator success requires read-back.** HTTP 200 with `ok:false`, a wrong
tool name, invalid JSON, or a write without exact bundle/plan read-back is
failure. Never mark D1 granted from the write response alone.

**The visual editor owns presentation only.** `/admin/editor` may publish only
strict versioned JSON for the fixed page registry. It must never persist raw
HTML, CSS, JavaScript, arbitrary links, routes, Stripe identifiers, offer
actions, AutoCreator mappings, secrets, `PREVIEW_MODE`, webhook behavior, or
deployment locks. Functional checkout, price, legal, offer-action, and preview
components keep code-owned behavior and page-specific cardinality. Public
rendering must fall back to the compiled page on every editor storage or schema
failure. Drafts are private. Restore creates a new draft and never publishes.

**Admin access is secret-only and fail-closed.** `ADMIN_PASSWORD` must be a
unique generated high-entropy Cloudflare Secret, never a human-memorable or
reused password. Admin sessions require D1, opaque hashed session tokens,
strict host cookies, exact same-origin checks, CSRF, bounded JSON bodies, and
rate-limited login. Editor failures must never weaken checkout health or block
the compiled public fallback.

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
summarized; and you've said plainly which parts of Stripe, D1, and AutoCreator
behavior you have not actually verified rather than implying they're proven.

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
- **Retired ThriveCart pages are references only.** Do not reconnect them or
  add their placeholders back to production preflight without a new approved
  architecture decision.
- **Stripe's minimum charge is $0.50.** Not currently reachable (Stripe is
  parked, see below) but binding if it's ever un-shelved — don't wire a
  price under that.
- **Rate-limit test fixtures must key on the same identity the code reads.**
  Dev's `CF-Connecting-IP` is IPv6 loopback; a fixture seeded on
  `sha256("unknown")` will pass without the mechanism ever running.

## Parked code

The old `/upsell` page and the pre-recovery Stripe stub are parked in
`src/deferred/`. The active Stripe implementation is `src/stripe.js`. Do not
import the deferred copy.

## Commands

```bash
npm run scan        # secrets scan — fails non-zero on a secret-shaped key in served output
npm run preflight    # full deploy gate, see "Hard rules" above
wrangler dev         # local dev server, http://localhost:8787
```

`npm run deploy` chains `preflight && wrangler deploy` — see "Never bypass
preflight" and "Never deploy without explicit instruction" above.
