# yfbjj-funnel

Cloudflare Worker behind `welcome.yogaforbjj.net`. Landing page + funnel data layer
for the $14 course bundle and the $360 one-click lifetime upsell.

Checkout runs on **ThriveCart** (`learnbjjfast.thrivecart.com`), not here. This
Worker serves the pages, captures leads into D1 before the cart handoff, and
reports health. The Stripe checkout/upsell/webhook layer is parked in
`src/deferred/` - see the README there.

## Routes

| Route                  | Method | State                                            |
|------------------------|--------|--------------------------------------------------|
| `/`                    | GET    | landing page (placeholder copy)                   |
| `/upsell`              | GET    | placeholder upsell page                           |
| `/thanks`              | GET    | placeholder thank-you page                        |
| `/health`              | GET    | 200 when D1 is reachable and all 3 tables exist; 503 otherwise |
| `/preview-checkout`    | GET    | stand-in for the cart while `PREVIEW_MODE` is on |
| `/api/lead`            | POST   | live - rate limited, validates email, inserts into `leads` |

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
| `THRIVECART_LIFETIME_URL` | $297 lifetime cart link. Empty = upsell CTAs render disabled. |
| `OFFER_DEADLINE`          | ISO 8601. Empty = the deadline bar is not rendered at all. |
| `BUNDLE_PRICE_CENTS`      | 1400 |
| `LIFETIME_PRICE_CENTS`    | 29700 |
| `YEARLY_PRICE_CENTS`      | 9700 |

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

## Deploy gate

    npm run preflight

Refuses to deploy a half-configured page. Checks, all reported in one run:

1. `THRIVECART_BUNDLE_URL` is set and is an https URL
2. `OFFER_DEADLINE` is set, parses, and is in the future
3. `PREVIEW_MODE` is exactly `"false"`
4. `database_id` is a real D1 uuid, not the placeholder
5. the secrets scan passes

`npm run deploy` runs preflight first and stops on any failure.

## Setup

    npm install
    npx wrangler login                      # or export CLOUDFLARE_API_TOKEN
    npx wrangler d1 create yfbjj_funnel     # paste database_id into wrangler.toml
    npm run db:migrate:local
    npm run db:migrate:remote
    npm run dev                             # http://localhost:8787
    npm run scan && npm run deploy
