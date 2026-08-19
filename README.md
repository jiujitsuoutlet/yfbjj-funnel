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
| `/api/lead`            | POST   | live - validates email, inserts into `leads`      |
| `/api/checkout`        | POST   | 501 stub                                          |
| `/api/upsell`          | POST   | 501 stub                                          |
| `/api/stripe-webhook`  | POST   | signature verified (400 on failure), then idempotency-claimed, then handled |

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
