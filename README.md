# yfbjj-funnel

Cloudflare Worker behind `welcome.yogaforbjj.net`. Landing page + funnel data layer
for the $14 course bundle and the $360 one-click lifetime upsell.

Skeleton pass: pages, `/api/lead`, `/health`, and Stripe webhook signature
verification + idempotency are real. Checkout and upsell are 501 stubs.

## Routes

| Route                  | Method | State                                            |
|------------------------|--------|--------------------------------------------------|
| `/`                    | GET    | landing page (placeholder copy)                   |
| `/upsell`              | GET    | placeholder upsell page                           |
| `/thanks`              | GET    | placeholder thank-you page                        |
| `/health`              | GET    | 200 when D1 is reachable and all 3 tables exist; 503 otherwise |
| `/api/lead`            | POST   | live - rate limited, validates email, inserts into `leads` |
| `/api/checkout`        | POST   | 501 stub                                          |
| `/api/upsell`          | POST   | 501 stub                                          |
| `/api/stripe-webhook`  | POST   | signature verified (400 on failure), then idempotency-claimed, then handled |

## Rate limiting `/api/lead`

Unauthenticated POST that writes to D1, so two layers per client IP:

1. **5 per minute** - Workers Rate Limiting binding (`[[ratelimits]]` in
   `wrangler.toml`). In-memory at the colo, no D1 write, no extra resource.
   `period` only accepts 10 or 60 seconds, which is why the hour window is not here.
2. **30 per hour** - fixed hourly window in the `rate_limits` D1 table. Only
   requests that cleared layer 1 reach it, so D1 writes are capped at 5/min/IP.

Both keyed on SHA-256 of the IP; raw IPs are never stored. Over limit returns
429 with a `Retry-After` header. A limiter failure fails **open** - the funnel
stays up. Dead buckets are swept opportunistically on ~2% of first-hits.

## Secrets

Never in source, never in `wrangler.toml`, never in the client bundle.


    npx wrangler secret put STRIPE_SECRET_KEY
    npx wrangler secret put STRIPE_WEBHOOK_SECRET

Only `STRIPE_PUBLISHABLE_KEY` (a `pk_` value) belongs in `[vars]` in
`wrangler.toml` - it is injected into the page server-side.

Local dev: copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill it.

    npm run scan     # fails non-zero if a secret-shaped key reaches served output

## Setup

    npm install
    npx wrangler login                      # or export CLOUDFLARE_API_TOKEN
    npx wrangler d1 create yfbjj_funnel     # paste database_id into wrangler.toml
    npm run db:migrate:local
    npm run db:migrate:remote
    npm run dev                             # http://localhost:8787
    npm run scan && npm run deploy
