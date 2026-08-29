# yfbjj-funnel

Cloudflare Worker behind `welcome.yogaforbjj.net`. The landing page for the $14
Guard Retention Bundle, plus lead capture. That is the whole job.

Checkout runs on **ThriveCart** (`learnbjjfast.thrivecart.com`), and so does
everything after it. One-click upsells require the payment session to stay on
ThriveCart, so the entire post-purchase chain is theirs. This Worker serves the
landing page, captures leads into D1 before the handoff, and reports health.

Upsell prices are deliberately absent from this repo. They live in ThriveCart
only, because two copies drift: lifetime is $247 in the funnel and $297 on the
main site.

Stripe staging is wired behind the same fail-closed preview lock. Production
still uses ThriveCart. The Stripe endpoints cannot create a Checkout Session
unless `PREVIEW_MODE` is the exact string `false`.

## Routes

| Route                  | Method | State                                            |
|------------------------|--------|--------------------------------------------------|
| `/`                    | GET    | landing page                                      |
| `/thanks`              | GET    | fallback confirmation only, nothing is sold there  |
| `/health`              | GET    | 200 when D1 is reachable and all 3 tables exist; 503 otherwise |
| `/preview-checkout`    | GET    | stand-in for the cart while `PREVIEW_MODE` is on |
| `/api/lead`            | POST   | live - rate limited, validates email, inserts into `leads` with its variant |
| `/api/stats`           | GET    | per-variant counts, JSON. `Authorization: Bearer $STATS_SECRET` |
| `/api/checkout`        | POST   | creates one of four Stripe-hosted Checkout Sessions only when preview is explicitly off |
| `/api/customer-portal` | POST   | creates a portal only after retrieving and verifying a completed Checkout Session |
| `/api/stripe-webhook`  | POST   | verifies the raw signed body, then processes it through the D1 retry ledger |

## Stripe staging

The `staging` Wrangler environment has a separate Worker name, no custom
routes, a separate D1 binding, and `PREVIEW_MODE = "true"`. It is safe to put
on an unlisted `workers.dev` hostname after replacing the staging D1 placeholder.
The lock returns HTTP 423 with `{"ok":false,"error":"preview_locked"}` before
constructing a Stripe client, so no Checkout Session is created.

Four existing Price IDs are mapped in configuration. Do not create, edit, or
duplicate them. The Two-Month Checkout contains the one-time $8 item and trials
the existing $20/month recurring item until exactly two UTC calendar months
later. Month-end dates clamp to the last valid day.

Webhook registration is deliberately not part of staging setup. Once a stable
destination is approved, register exactly:

    https://<staging-worker-host>/api/stripe-webhook

Minimum event types:

* `checkout.session.completed`
* `checkout.session.async_payment_succeeded`

The real signing secret exists only after that destination is registered. Do
not deploy a fixture value. Tests generate signatures from a test-only secret.
The explicit AutoCreator mapping currently maps the Guard Retention Price to
`Guard Retention`, but there are intentionally no entitlement writes.

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
| `THRIVECART_BUNDLE_URL`   | $14 bundle cart link. Empty = CTA scrolls to the email form instead of dead-linking. |
| `OFFER_DEADLINE`          | ISO 8601. Empty = the deadline bar is not rendered at all. |
| `BUNDLE_PRICE_CENTS`      | 1400 |

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

The Worker currently needs **no secrets** - ThriveCart owns payment. The rule
still stands for anything added later: secrets go in Cloudflare Secrets, read
off the `env` binding, never in source, never in `wrangler.toml`, never in the
client bundle. Local dev values go in `.dev.vars` (gitignored); see
`.dev.vars.example`.

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
at capture, appended to the ThriveCart URL as `passthrough[variant]` plus
`utm_content`, and has a column waiting on `orders` for when the webhook is
wired. Without that last step the test measures clicks, not money.

Cost to know about: the landing page now sends `Cache-Control: private,
no-store` and `Vary: Cookie`, because its body depends on the cookie. It cannot
be edge cached while the test runs. That is a reason to end the test, not to
leave it running forever.

    curl -H "Authorization: Bearer $STATS_SECRET" https://welcome.yogaforbjj.net/api/stats

## Deploy gate

    npm run preflight

Refuses to deploy a half-configured page. Checks, all reported in one run:

1. `THRIVECART_BUNDLE_URL` is set and is an https URL
2. `OFFER_DEADLINE` is set, parses, and is in the future
3. `PREVIEW_MODE` is exactly `"false"`
4. `database_id` is a real D1 uuid, not the placeholder
5. no unfilled `[[PLACEHOLDER]]` markers would render on a live page
6. both variants are complete pages (CTA, price block, lead form, all 8 collections)
7. the variant parameter survives onto the outbound cart URL
8. the ThriveCart pages are built and current
9. the secrets scan passes

`npm run deploy` runs preflight first and stops on any failure.

## Setup

    npm install
    npx wrangler login                      # or export CLOUDFLARE_API_TOKEN
    npx wrangler d1 create yfbjj_funnel     # paste database_id into wrangler.toml
    npm run db:migrate:local
    npm run db:migrate:remote
    npm run dev                             # http://localhost:8787
    npm run scan && npm run deploy
