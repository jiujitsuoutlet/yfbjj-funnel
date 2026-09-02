# EXC-132 first-month membership proof

Verified 2026-09-01 against the live Stripe configuration and locked Cloudflare
staging. No secret values are recorded here.

## Approved terms

- $8 for the first month.
- $19.99 per month beginning 30 days after completed checkout.
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
$8 item and the $19.99 monthly Price. Stripe starts a 30-day first period when
Checkout completes. An open Checkout Session cannot shorten the promised time.

## Verification

- 49 automated tests passed, including the exact two-line-item Checkout shape
  and completion-anchored 30-day first period.
- Secret scan passed.
- Locked-staging preflight passed.
- Wrangler staging dry run passed.
- Locked staging deployed at
  `https://yfbjj-funnel-stripe-staging.sebastian-brosche.workers.dev`.
- Staging Worker version: `0d74f44c-cdc2-4492-a2ec-4e30a098ce21`.
- Browser QA passed at 375 px and 1024 px with the exact billing and
  cancellation copy, no horizontal overflow, and no console warnings or errors.

Checkout remains locked on staging while the remaining production launch gates
are completed.
