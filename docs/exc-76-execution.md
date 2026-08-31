# EXC-76 execution record

Executed on 2026-08-29 against Git revision
`63155286f202d85e104a1d7cf8c66c4813c57cf9`.

## Review deployment

- URL: `https://yfbjj-funnel-visual-staging.sebastian-brosche.workers.dev`
- Worker: `yfbjj-funnel-visual-staging`
- Cloudflare version: `6e7574b4-f08a-4ee8-9042-b52815f85923`
- Deployment message records revision
  `63155286f202d85e104a1d7cf8c66c4813c57cf9`.
- `PREVIEW_MODE` is `"true"`.
- `PREVIEW_NO_D1` is `"true"`.
- No D1 binding, production route, custom domain, or payment secret is attached.

Browser verification covered both landing variants, `/thanks`, and
`/preview-checkout` at 375, 768, 1024, and 1440 pixels. All 16 combinations
loaded without page or script errors, broken images, or horizontal overflow.
The assignment cookie persisted across reloads. A forced `?v=` rendered the
requested variant without replacing the assignment cookie. Every cart CTA
resolved to `/preview-checkout`.

Stateful routes fail closed. `/health`, `/api/lead`, and `/api/stats` each
returned HTTP 503. No lead, customer, Checkout Session, charge, subscription,
refund, or entitlement was created.

## Verified external inventory

The Cloudflare token controls the active `yogaforbjj.net` zone in the same
account configured by this repository. No DNS record currently exists for
`welcome.yogaforbjj.net`, so no unrelated record was overwritten.

Read-only Stripe inspection found the existing live objects below. They were
not changed or duplicated.

| Offer | Product | Price |
| --- | --- | --- |
| Guard Retention Bundle | `prod_V9byhVHYqHCNRI` | `price_1U9IkNIwpEtt4FIedvXFb9tC` |
| Head to Toes | `prod_V9byVgpmkfyP1n` | `price_1U9IkOIwpEtt4FIeqq3edSnR` |
| Lifetime Access | `prod_V9byHjUccoS6PN` | `price_1U9IkPIwpEtt4FIeD0mbQvCK` |
| Two-Month Access | `prod_V9byHoYGBGpDpc` | `price_1U9IkQIwpEtt4FIenOTDpw8e` |

## Activation blockers

Production remains intentionally unmodified and checkout remains locked. The
repository deploy gate reports these authoritative inputs as missing:

1. The real ThriveCart URL for the $14 bundle.
2. The offer deadline.
3. A real D1 database binding.
4. Terms URL, Privacy URL, and support email.
5. Sebastian's optional long-form anecdote, or approval to remove that block.
6. Head to Toes scope and certification level details.
7. The ThriveCart asset origin and builder-owned accept and decline links.
8. An authoritative fulfillment mapping. The inspected Stripe inventory has
   no matching certification product among the four anniversary objects.

These are not safe to infer from credentials or product names. They must be
supplied or approved by the client before `PREVIEW_MODE` can become the exact
string `"false"` and before production preflight can pass.

## Rollback

The review deployment can be rolled back by restoring Cloudflare Worker
version `83069840-b06c-408c-a5d3-494e6fb32b48`. Production needs no rollback
because its Worker, route, DNS, D1, and payment configuration were not changed.

Independent QA in EXC-67 is still required against the exact deployed version.
This execution record is not a self-approval.
