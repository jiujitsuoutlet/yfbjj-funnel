# EXC-130 activation and launch proof

Verified on 2026-09-01 against Sebastian's live Stripe, Cloudflare, and
AutoCreator accounts. No secret values are recorded here.

## Functional staging

- Worker: `yfbjj-funnel-stripe-staging`
- Final proof revision: `9d7566c0-d509-4d14-b17e-b6c1d8515367`
- Stripe webhook: `we_1UAyGsIwpEtt4FIefPa7LIS1`
- Webhook state: enabled with only the four supported Checkout events
- Ordinary staging checkout without the proof secret: HTTP 403
- Unsigned staging webhook: HTTP 400
- Automated checks: 51 passed, 0 failed
- Secret scan, functional-staging preflight, and production preflight: passed

Functional staging used a temporary, header-protected, 100-percent discount.
It created live Stripe objects but charged no card and collected no money. The
proof discount and no-card collection behavior are available only when the
staging QA proof mode and secret are both present. Production preflight rejects
QA proof mode.

## Full one-time offer path

The isolated buyer `yfbjj-full-path-a-20260901@example.com` completed:

1. Guard Retention
2. Head to Toes
3. Lifetime
4. Certification

Every Checkout Session completed with `payment_status=paid` and amount due
zero. D1 recorded every order as paid, every outbox operation succeeded on its
first attempt, and AutoCreator exact read-back passed. Certification granted
all three level bundles. The server-owned flow finished with `status=complete`.

## Monthly branch

The isolated buyer `yfbjj-monthly-path-20260901@example.com` completed Guard,
declined Head to Toes and Lifetime, then accepted Monthly. Stripe displayed the
real terms: 30 days free for the protected proof, then $19.99 per month. The
temporary coupon reduced the normal $8 first payment to zero.

Checkout created trialing subscription `sub_1UB613IwpEtt4FIeApiWNgqf`. D1
recorded the Monthly order as paid and fulfillment as granted. The stable
outbox operation succeeded once. AutoCreator read-back proved the exact Full
monthly plan and effective access.

The Stripe subscription was canceled immediately and is now canceled. No card
was stored and no future charge can occur. AutoCreator still reports active
course access, which proves the approved retention policy.

## Defects found and closed

The first Guard proof failed closed after AutoCreator created the member and
bundle entitlement. AutoCreator's `members.checkAccess` tool reports plan
access only and returns `no_subscription` for a valid bundle-only buyer. Bundle
fulfillment now uses the exact active bundle entitlement as its authoritative
read-back. Tests cover that contract.

An expired child Checkout reopened its offer but reused the prior Stripe
idempotency key. Child Checkout attempts now include the D1 flow version, and
expiration increments that version. A replacement session can be created
without weakening replay protection.

## Production activation

Production uses the same code without `QA_PROOF_MODE`, `QA_PROOF_SECRET`, or a
coupon. Buyers see and pay the real configured prices. The campaign deadline
remains intentionally unset, so its block stays hidden.
