# EXC-132 first-month membership proof

Verified 2026-09-01 against the live Stripe configuration and locked Cloudflare
staging. No secret values are recorded here.

## Approved terms

- $8 for the first month.
- $19.99 per month beginning one UTC calendar month after checkout.
- Canceling stops future Stripe charges.
- The buyer keeps Yoga for BJJ course access after cancellation.

The internal `two_month` offer key and `two_month_trial_end` D1 column remain as
compatibility names. Their live meaning is the one-month first-price period.

## Stripe

The existing membership Product `prod_V9byHoYGBGpDpc` was retained and renamed
to `Yoga for BJJ Membership`. Because Stripe Prices are immutable, the approved
$19.99 monthly Price was created as `price_1UB58oIwpEtt4FIe6C6UqWKy`. The old
$20 Price is superseded and is no longer referenced by the funnel.

Checkout uses subscription mode with two server-owned line items: a one-time
$8 item and the $19.99 monthly Price. The recurring item receives a trial end
exactly one calendar month after checkout, with month-end clamping.

## Verification

- 49 automated tests passed, including the exact two-line-item Checkout shape
  and January 31 to February 28 month-end clamp.
- Secret scan passed.
- Locked-staging preflight passed.
- Wrangler staging dry run passed.
- Locked staging deployed at
  `https://yfbjj-funnel-stripe-staging.sebastian-brosche.workers.dev`.
- Staging Worker version: `22670084-1cec-43a4-9a8d-87cd23d3c8b3`.
- Browser QA passed at 375 px and 1024 px with the exact billing and
  cancellation copy, no horizontal overflow, and no console warnings or errors.

Checkout remains locked on staging while the remaining production launch gates
are completed.
