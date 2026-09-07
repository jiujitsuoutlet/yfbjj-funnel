# One-click OTO production launch proof

Date: 2026-09-06 America/Chicago, 2026-09-07 UTC

## Production identity

- Domain: `https://welcome.yogaforbjj.net/`
- Cloudflare Worker: `yfbjj-funnel`
- Active Worker version: `46d3882f-cb47-42a5-8e63-5bf8505d56e9`
- Git merge commit: `bb65d3c4122aa9459bcd9cbf9c861bcf0699073f`
- Cloudflare D1 database: `yfbjj_funnel`
- GitHub pull request: `https://github.com/jiujitsuoutlet/yfbjj-funnel/pull/24`

## Deployment result

The production preflight passed before upload. Cloudflare uploaded the Worker and
activated the new version at 100% traffic. Wrangler then reported a zone route-read
permission error while inspecting the already-existing custom-domain route. A direct
deployment listing confirmed the new version was active, and the production domain
served the new one-click transition and pending-state retry code.

The post-deployment health response was HTTP 200 with D1 connected, schema status
`ok`, and all 12 expected tables present.

## No-payment Stripe proof

The live production checkout endpoint created Stripe Checkout Session
`cs_live_a1VyMGCQMVm6wO1E8qNfxDREQ4Br6S7jTPAuPiiZpsawDyXtCSLqATK8mR`.

Verified provider state:

- offer: `bundle`
- mode: `payment`
- amount: $14.00 USD
- status before cleanup: `open`
- payment status: `unpaid`
- success route: `https://welcome.yogaforbjj.net/offer?session_id={CHECKOUT_SESSION_ID}`
- server-owned Price: `price_1U9IkNIwpEtt4FIedvXFb9tC`
- signed flow hash present
- no card entered
- no payment created
- no money moved

Cleanup completed. The Stripe Checkout Session was expired. Its exact failed,
unfulfilled D1 order and checkout-flow rows were removed, and a follow-up query
returned zero matching rows. Production health remained green after cleanup.

## Verification

- Automated suite: 74 passed, 0 failed
- Deployable secret scan: passed
- Production preflight: passed
- Cloudflare bundle dry run: passed
- Live browser: public landing page loaded with the complete hero and offer content
- Triple-check pass 1: 12 pages at 375px, 768px, and 1440px, 36 clean checks
- Triple-check pass 2: 12 pages at 375px, 768px, and 1440px, 36 clean checks
- Triple-check pass 3: 12 pages at 375px, 768px, and 1440px, 36 clean checks

The three final passes were consecutive and clean. No pass found clipping,
horizontal overflow, broken images, blank actions, side-by-side offer rows, known
copy mistakes, missing price/action content, or browser errors.

## Remaining proof boundary

The no-payment proof demonstrates production routing, Stripe Session creation,
configured offer/amount, webhook receipt for expiration, D1 state handling, and
cleanup. It does not demonstrate an actual saved-card OTO charge because the operator
declined a real-money test. Saved-card creation, one-time OTO billing, monthly billing,
bank-authentication fallback, AutoCreator fulfillment recovery, and no-double-charge
replay are covered by the passing automated suite. The next genuine customer or an
explicitly authorized paid proof will provide the first provider-side confirmation of
the complete one-click charge path.
