# Parked: Stripe checkout, upsell, and webhook

Parked 2026-08-19. Nothing in this directory is imported by the Worker.

## Why

Checkout runs on ThriveCart (`learnbjjfast.thrivecart.com`), which already owns
SKUs, coupons, one-click upsells, VAT, and fulfilment. Building Stripe checkout
alongside it would duplicate a working system and split the order record across
two payment processors.

## What is here

`stripe-checkout.js` - the checkout stub, the upsell stub, and the webhook
handler, lifted out verbatim. The webhook is the part worth keeping: it does
signature verification with `constructEventAsync` and Stripe's SubtleCrypto
provider (the synchronous `constructEvent` assumes Node crypto and is wrong on
Workers), returns 400 before touching D1, then claims the event id in
`webhook_events` with `INSERT OR IGNORE` so a replayed delivery exits before any
handler side effect. All four paths were proven locally: missing header 400, bad
signature 400, valid signature 200, replay 200 with `duplicate: true`.

The `stripe` package has been uninstalled, so the `import Stripe from 'stripe'`
at the top of that file does not currently resolve. It is not bundled - esbuild
only follows imports reachable from `src/worker.js` - so the build is unaffected.

## What stayed behind

- `orders` and `webhook_events` in `migrations/0001_init.sql`. Kept on purpose:
  empty tables cost nothing and un-shelving is easier with the schema in place.
- Nothing else. `/api/lead`, `leads`, `rate_limits`, and both rate-limit layers
  are live and untouched.

## What would bring it back

Any of: ThriveCart cannot express an offer we need; we want the order record in
our own system rather than reading ThriveCart's; we start selling something
ThriveCart does not handle (subscriptions billed our way, in-app purchases).

## How to un-shelve

1. `npm i stripe`
2. Import the handlers into `src/worker.js`.
3. Re-add the routes: `POST /api/checkout`, `POST /api/upsell`,
   `POST /api/stripe-webhook`, and add them to the `known` array so a wrong
   method returns 405 rather than 404.
4. `wrangler secret put STRIPE_SECRET_KEY` and
   `wrangler secret put STRIPE_WEBHOOK_SECRET`. Never in `wrangler.toml`.
5. Add the publishable key back to `[vars]` only if a page needs Stripe.js, and
   extend the CSP in `src/worker.js` with `https://js.stripe.com`.
6. `npm run scan` before deploying.
