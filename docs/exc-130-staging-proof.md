# EXC-130 locked staging and fulfillment proof

Verified 2026-09-01 against Sebastian's live Cloudflare, Stripe, and AutoCreator
accounts. No secret values are recorded here.

## Locked staging

- Worker: `yfbjj-funnel-stripe-staging`
- URL: `https://yfbjj-funnel-stripe-staging.sebastian-brosche.workers.dev`
- Version: `89ca3677-c143-4c8a-b22a-6e6e83546b2f`
- D1: `yfbjj_funnel_staging`
- Health: HTTP 200, nine expected tables, schema OK
- Checkout while locked: HTTP 423 `preview_locked`
- Secrets stored in Cloudflare: Stripe restricted key, Stripe signing secret,
  AutoCreator bearer, editor password, and stats bearer

The locked-staging preflight passed before deployment. Preview and both
readiness flags remained locked, and `FULFILLMENT_IMPLEMENTED` remained false.

## Stripe webhook

- Endpoint: `we_1UAyGsIwpEtt4FIefPa7LIS1`
- URL: the staging Worker `/api/stripe-webhook` route
- State: configured but disabled while staging is fulfillment-locked
- Events: Checkout completed, async success, async failure, and expired

The restricted key authenticated to account `acct_1S3WL0IwpEtt4FIe` and proved
webhook create and update permission. The signing secret was written directly
to the staging Worker secret store. Independent review caught that an enabled
account-wide endpoint would retry while the receiver was intentionally locked,
so the endpoint was disabled and narrowed before any production launch.

## AutoCreator live proof

Reserved `example.com` QA members were used so no customer was contacted.

- Guard bundle grant and exact effective-access read-back passed.
- Head to Toes grant and exact effective-access read-back passed.
- Certification granted all three levels and exact read-back proved all three.
- Lifetime membership grant, exact plan read-back, and effective-access check
  passed.
- Monthly membership grant, exact plan read-back, and effective-access check
  passed.
- Five bundle entitlements were soft-revoked and QA members were soft-deleted.
- These AutoCreator plan checks recorded access only. They charged no card and
  created no Stripe subscription.

The first proof failed closed because AutoCreator rejects its documented
`stripe_purchase` source value. The deployed client now uses the accepted tool
default and preserves the Stripe session ID in notes and durable ledgers.

## Browser QA

The deployed Worker was loaded in a real browser at 375 px and 1024 px.
Variants A and B rendered their distinct headlines, the A assignment persisted
after returning to the bare URL, the $14 CTA and lead form were present, no
horizontal overflow occurred, and the browser console had no warnings or
errors.

## Remaining live gate

Monthly cancellation behavior is not yet journey-verified. The Worker records
invoice and subscription events, but AutoCreator exposes no symmetric local
paid-plan revoke tool. A safe proof requires creating a live-mode Stripe trial
subscription with no payment method, canceling it immediately, and checking
that AutoCreator's native Stripe synchronization removes access. Production
preview and fulfillment readiness remain locked until that proof passes.
