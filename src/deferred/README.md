# Parked

Nothing in this directory is imported by the Worker. The protected Stripe
reconstruction now lives in `src/stripe.js`; this is the retired prototype and
must not be restored alongside it.

Two things are parked here: the Stripe payment layer, and the `/upsell` page.

---

# Parked: the /upsell page

Parked 2026-08-25. File: `upsell.html`.

## Why

One-click upsells require the payment session to stay on ThriveCart. Sending a
buyer back to this Worker after purchase would force a second card entry, which
is the single most expensive thing you can do to a post-purchase flow. The whole
post-purchase chain therefore lives in ThriveCart's native funnel, and this
Worker's job ends at the handoff.

The page itself was built and verified: hero, stat band, two plan cards, the
break-even arithmetic, and a clean decline link. It is kept because the writing
and layout are reusable if the chain ever moves back.

## What it would take to bring back

A reason the chain should leave ThriveCart, which today there is not one. If it
does: restore the import and the `/upsell` route in `src/worker.js`, add the
page back to the `PAGES` list in `scripts/preflight.mjs`, and re-add whatever
price and cart variables it needs to `[vars]`.

## One warning if you do

The page hardcoded `$297` lifetime and `$97` yearly as fallback text, and read
the real figures from `LIFETIME_PRICE_CENTS` and `YEARLY_PRICE_CENTS`. Those
variables are gone on purpose: prices now live in ThriveCart only. Lifetime is
$247 in the funnel and $297 on the main site, which is exactly the kind of drift
a second copy causes. Do not reintroduce prices to this repo without deciding
which system owns them.

---

# Historical Stripe checkout and webhook stub

Parked 2026-08-19 and superseded by `src/stripe.js` in August 2026.

## Why

This was the pre-recovery implementation. It remains only to preserve history.
Do not import it, patch it, or use its table names as the active contract.

## What is here

`stripe-checkout.js` - the checkout stub, the upsell stub, and the webhook
handler, lifted out verbatim. The webhook is the part worth keeping: it does
signature verification with `constructEventAsync` and Stripe's SubtleCrypto
provider (the synchronous `constructEvent` assumes Node crypto and is wrong on
Workers), returns 400 before touching D1, then claims the event id in
`webhook_events` with `INSERT OR IGNORE` so a replayed delivery exits before any
handler side effect. All four paths were proven locally: missing header 400, bad
signature 400, valid signature 200, replay 200 with `duplicate: true`.

The active implementation uses the installed `stripe` package and Workers-safe
asynchronous signature verification.

## What stayed behind

- `orders` and `webhook_events` in `migrations/0001_init.sql`. Kept on purpose:
  empty tables cost nothing and un-shelving is easier with the schema in place.
- Nothing else. `/api/lead`, `leads`, `rate_limits`, and both rate-limit layers
  are live and untouched.

## Do not un-shelve

`src/stripe.js`, migrations `0004` and `0005`, and the guarded routes in
`src/worker.js` are the source of truth now.
