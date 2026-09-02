# yfbjj-funnel

Cloudflare Worker behind `welcome.yogaforbjj.net`. The landing page for the $14
Guard Retention Bundle, plus lead capture. That is the whole job.

Checkout uses five verified Stripe Prices. The Worker captures
leads, creates guarded Stripe-hosted Checkout Sessions, verifies webhook
signatures, records orders in D1, and reports health.

Payment remains intentionally locked. A Checkout Session cannot be created
unless `PREVIEW_MODE` is the exact string `false`, the selected offer has its
Stripe Price and every required AutoCreator grant key, and the authenticated
fulfillment implementation, required Cloudflare Secrets, readiness flags, and
D1 schema sentinel all pass. The bundle slugs and authenticated AutoCreator
contract were verified by authenticated inspection on 2026-09-01. Live
fulfillment remains locked until the deployed staging revision passes grant,
read-back, retry, and revocation proof and both readiness flags are enabled.

## Routes

| Route                  | Method | State                                            |
|------------------------|--------|--------------------------------------------------|
| `/`                    | GET    | landing page                                      |
| `/offer`               | GET    | cookie-bound next step after prior payment and access are durable |
| `/thanks`              | GET    | reads D1 order and fulfillment state; pending copy never claims access and granted copy requires a durable grant |
| `/health`              | GET    | 200 when D1 is reachable and all 9 active tables exist; 503 otherwise |
| `/preview-checkout`    | GET    | stand-in for the cart while `PREVIEW_MODE` is on |
| `/api/lead`            | POST   | live - rate limited, validates email, inserts into `leads` with its variant |
| `/api/stats`           | GET    | per-variant counts, JSON. `Authorization: Bearer $STATS_SECRET` |
| `/api/checkout`        | POST   | creates Guard Checkout only; every other offer key is rejected |
| `/api/offer-checkout`  | POST   | accepts the sole D1-authorized next offer in a fresh hosted Checkout |
| `/api/offer-skip`      | POST   | records an explicit decline and advances the D1 state machine |
| `/api/customer-portal` | POST   | creates a portal only after retrieving and verifying a completed Checkout Session |
| `/api/stripe-webhook`  | POST   | verifies the raw signed body, then processes it through the D1 retry ledger |
| `/admin/editor`        | GET    | authenticated visual editor; drafts never affect public pages until explicit publish |
| `/api/admin/*`         | varies | no-store, same-origin and CSRF-protected editor session, draft, publish, history, and restore API |

## Visual content editor

Run migration `0008_content_editor.sql`, then set `ADMIN_PASSWORD` as a
Cloudflare Secret. It must be a unique, generated high-entropy value, not a
human-memorable or reused password. Sign in at `/admin/login` and open
`/admin/editor`.

The editor owns only validated presentation JSON for a fixed page registry.
It supports sections, rows, columns, safe content elements, responsive preview,
autosaved drafts, explicit publish, and version restore. A restore creates a new
draft revision and never changes the public page by itself. If D1 or published
content is missing, unavailable, malformed, or unsupported, the Worker serves
the compiled page already in source.

Commerce remains code-owned. The editor cannot store HTML, CSS, JavaScript,
links, routes, Stripe identifiers, offer actions, AutoCreator mappings, secrets,
preview flags, or deployment locks. Checkout, price, legal, offer-action, and
preview components have fixed behavior. Their limited copy fields may be
edited, but they cannot be deleted or duplicated. See
[`docs/EDITOR-GUIDE.md`](docs/EDITOR-GUIDE.md).

## Stripe staging

The production and staging D1 databases are provisioned and migrations `0001`
through `0009` are applied. Their non-secret resource IDs live in
`wrangler.toml`; verification evidence is in
[`docs/exc-128-d1-proof.md`](docs/exc-128-d1-proof.md).

Locked functional staging is deployed at
`https://yfbjj-funnel-stripe-staging.sebastian-brosche.workers.dev`. Deployment,
webhook, live AutoCreator grant, cleanup, and browser evidence are recorded in
[`docs/exc-130-staging-proof.md`](docs/exc-130-staging-proof.md).
The approved $8 first-month pricing change and locked-staging proof are recorded
in [`docs/exc-132-first-month-membership.md`](docs/exc-132-first-month-membership.md).
The live monthly cancellation proof confirmed that AutoCreator retains course
access after Stripe cancellation. That matches the approved policy: canceling
stops future charges while the buyer keeps course access.

The `staging` Wrangler environment has a separate Worker name, no custom
routes, a separate D1 binding, and `PREVIEW_MODE = "true"`. It is safe to put
on an unlisted `workers.dev` hostname while the checkout lock remains enabled.
The lock returns HTTP 423 with `{"ok":false,"error":"preview_locked"}` before
constructing a Stripe client, so no Checkout Session is created.

Five Price IDs are mapped in configuration. Do not create, edit, or duplicate
them without an approved offer change. The Certification price is the one-time $297 Price
`price_1UAvcCIwpEtt4FIeaPk7pUzB`. Each offer also requires every exact AutoCreator grant key in its mapping.
Confirmed names and UUIDs are not accepted as bundle slugs. The monthly
downsell Checkout contains a one-time $8 item and trials the $19.99/month
recurring item until exactly one UTC calendar month later. Month-end dates
clamp to the last valid day. The internal `two_month` key remains for database
compatibility only.

The authenticated AutoCreator bundle slugs, UUIDs, plan references, tool
contract, scopes, and remaining activation proof are recorded in
[`docs/autocreator-fulfillment-contract.md`](docs/autocreator-fulfillment-contract.md).

The live-mode staging webhook is registered but remains disabled while
fulfillment is locked:

    https://yfbjj-funnel-stripe-staging.sebastian-brosche.workers.dev/api/stripe-webhook

Minimum event types:

* `checkout.session.completed`
* `checkout.session.async_payment_succeeded`
* `checkout.session.async_payment_failed`
* `checkout.session.expired`

The real signing secret exists only in the staging Worker's Cloudflare secret
store. Do not deploy a fixture value. Tests generate signatures from a
test-only secret.
The authenticated AutoCreator client is implemented but not enabled.
`FULFILLMENT_IMPLEMENTED` and
`AUTOCREATOR_CLIENT_IMPLEMENTED` are independent runtime locks. Checkout also
requires `STRIPE_WEBHOOK_SECRET`, `AUTOCREATOR_API_KEY`, both explicit readiness
flags, and migration `0006`'s D1 sentinel. Signed events remain retryable while
those locks are closed.

The client uses the documented `{ "args": { ... } }` tool envelope and marks
D1 granted only after exact bundle or active-plan read-back. The post-purchase
sequence is server-owned: Guard, optional Head to Toes, optional Lifetime, then
the $8 first-month offer after a Lifetime decline, followed by the final optional Certification
offer. D1 derives each step from an opaque HttpOnly
flow-cookie hash. Every accept opens a new Stripe-hosted Checkout. Two-Month
persists one exact timestamp for the `$8 first month, then $19.99/month` terms shown
both before Checkout and to Stripe.

Paid events write through `entitlement_outbox`. A stable operation key guards
the documented idempotent AutoCreator grant tools; no undocumented HTTP
idempotency header is assumed. Fresh processing leases return HTTP 503, and
stale leases can be reclaimed. `checkout.session.completed` grants only for
`paid` or `no_payment_required`; delayed unpaid methods wait for
`checkout.session.async_payment_succeeded`, and async failure records a failed
order without granting.

## Design

Palette and type are measured off yogaforbjj.net, not invented:
accent `#dc2626`, grounds `#0a0a0a` / `#0e0e12`, translucent white for dim text,
`Arial, Helvetica, sans-serif`, headings uppercase at weight 900 with `-.04em`
tracking and `.92` leading, pill CTAs. Body copy runs 17px at weight 500 rather
than their 14px/600, because this page is read on a phone by someone who arrived
from an ad. That is the one deliberate deviation.

## Operator knobs

Everything an operator changes lives in `[vars]` in `wrangler.toml` and reaches
the pages through one JSON island (`<script id="page-config">`):

| Var | Meaning |
|-----|---------|
| `PREVIEW_MODE`            | Default **true**. Any value other than the exact string `false` routes every CTA to `/preview-checkout` and shows the preview banner. Unset means preview, so a missing var can never send paid traffic at a cart that is not ready. |
| `OFFER_DEADLINE`          | ISO 8601. Empty = the deadline bar is not rendered at all. |
| `BUNDLE_PRICE_CENTS`      | 1400 |
| `STRIPE_PRICE_*`          | The five verified Stripe Price IDs. |
| `STRIPE_PRODUCT_TWO_MONTH` | The verified existing product used for the one-time $8 item. |
| `AUTOCREATOR_*_BUNDLE_UUID` | Confirmed read-only bundle references. UUID is not used as a grant slug. |
| `AUTOCREATOR_*_BUNDLE_SLUG` | Exact authenticated bundle slug required by the AutoCreator grant tool. Certification requires all three level slugs. |
| `AUTOCREATOR_*_ENTITLEMENT_TARGET` | Exact authenticated lifetime or monthly plan Price ID used by the membership grant tool. |
| `STRIPE_WEBHOOK_READY` | Exact `true` only after the signed endpoint proof passes on the deployed revision. |
| `AUTOCREATOR_FULFILLMENT_READY` | Exact `true` only after authenticated grant, retry, and revocation proof passes. |

Prices render from these values, so one edit moves every surface.

## Rate limiting `/api/lead`

Unauthenticated POST that writes to D1, so two layers per client IP:

1. **5 per minute** - Workers Rate Limiting binding (`[[ratelimits]]`, plural,
   `LEAD_RATE_LIMIT`, in `wrangler.toml`). Wrangler 4.124 rejects the singular
   `[[ratelimit]]` with `Unexpected fields found in top-level field` and then
   silently omits the binding, leaving only the D1 layer. In-memory at the colo, no D1 write,
   no extra resource. `period` only accepts 10 or 60 seconds, which is why the
   hour window is not here.
2. **30 per hour** - fixed hourly window in the `rate_limits` D1 table
   (`0002_rate_limits.sql`). Only requests that cleared layer 1 reach it, so D1
   writes are capped at 5/min/IP.

Both keyed on SHA-256 of `CF-Connecting-IP`; raw IPs are never stored. Over
limit returns 429 with a `Retry-After` header. A limiter failure fails **open** -
the funnel stays up. Dead buckets are swept opportunistically on ~2% of first-hits.

This lives in the Worker rather than in a zone Rate Limiting rule because
`yogaforbjj.net` is on the Free plan: one rate limiting rule per zone, maximum
period 60 seconds. That cannot express the 30/hour window, and it would spend
the whole zone's single free rule on this one endpoint.

## Secrets

Stripe and webhook keys are Cloudflare Secrets, read off the `env` binding,
never in source, never in `wrangler.toml`, and never in the client bundle. Local
development values go in `.dev.vars` (gitignored); see
`.dev.vars.example`.

`ADMIN_PASSWORD` follows the same secret-only rule. Never put it in source,
Wrangler variables, editor JSON, screenshots, logs, or client code.

    npm run scan     # fails non-zero if a secret-shaped key reaches served output

## A/B test

Two variants of the same offer at `/`. A is the short page, B is the long-form
arc. The Worker decides before it renders, so there is no client redirect and no
flash of the wrong page.

Order of precedence:

1. `?v=a` / `?v=b` forces a variant, sets no cookie, and is never counted
2. the `yfbjj_v` cookie, so a returning visitor is stable for 180 days
3. crawlers get A, uncounted, so preview fetches do not skew the split
4. everyone else is flipped 50/50, cookied, and counted once

Attribution rides the whole way through: the variant is stored on the lead row
at capture, sent in Stripe Checkout metadata, and copied into `stripe_orders`
from the verified webhook. Without that last step the test measures leads, not
money.

Cost to know about: the landing page now sends `Cache-Control: private,
no-store` and `Vary: Cookie`, because its body depends on the cookie. It cannot
be edge cached while the test runs. That is a reason to end the test, not to
leave it running forever.

    curl -H "Authorization: Bearer $STATS_SECRET" https://welcome.yogaforbjj.net/api/stats

## Deploy gate

    npm run preflight

Refuses to deploy a half-configured page. Checks, all reported in one run:

1. all five verified Stripe Price IDs and the Two-Month Product ID are valid and unique
2. every offer's exact AutoCreator grant keys are set, including all three Certification levels
3. authenticated AutoCreator fulfillment is implemented and tested
4. authenticated AutoCreator client is implemented and tested
5. webhook and fulfillment readiness flags are exactly `"true"`
6. runtime code requires both Cloudflare Secrets and migration `0006`'s D1 sentinel
7. any configured `OFFER_DEADLINE` parses and is in the future; empty hides it
8. `PREVIEW_MODE` is exactly `"false"`
9. `database_id` is a real D1 uuid, not the placeholder
10. no unfilled `[[PLACEHOLDER]]` markers would render on a served page
11. both variants are complete pages (CTA, price block, lead form, all 8 collections)
12. the landing page posts to the guarded Checkout endpoint and sends variant metadata
13. every served image exists and the secrets scan passes

`npm run deploy` runs preflight first and stops on any failure.

## Setup

Both remote D1 databases are already provisioned. Do not recreate them. Apply
remote migrations only after reviewing the pending migration list.

    npm install
    npx wrangler login                      # or export CLOUDFLARE_API_TOKEN
    npm run db:migrate:local
    npm run db:migrate:remote
    npm run db:migrate:staging
    npm run dev                             # http://localhost:8787
    npm run scan && npm run deploy
