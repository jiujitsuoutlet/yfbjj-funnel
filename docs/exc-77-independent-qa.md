# EXC-77 independent staging QA

Date: 2026-08-29 UTC

Result: **FAIL**. Do not mark EXC-77 Done yet. The review deployment is visually
ready, but the mandated direct-checkout lock response is absent. The review link
must remain described as a visual preview, not a functioning checkout.

## Fail-closed rule

`PREVIEW_MODE` defaults on. Only the exact string `"false"` disables preview.
Unset, misspelled, or any other value sends every CTA to `/preview-checkout`.
This prevents a missing variable from sending paid traffic to an unwired cart.

## Durable revision and configuration evidence

Read-only `wrangler deployments list` and `wrangler versions view` reported the
active 100% deployment as Cloudflare version
`6e7574b4-f08a-4ee8-9042-b52815f85923`, created at
`2026-08-29T04:02:32.137Z`. Its deployment message records source revision
`63155286f202d85e104a1d7cf8c66c4813c57cf9`.

The version has only these bindings:

- `ASSET_BASE_URL=""`
- `BUNDLE_PRICE_CENTS="1400"`
- `OFFER_DEADLINE=""`
- `PREVIEW_MODE="true"`
- `PREVIEW_NO_D1="true"`
- `THRIVECART_BUNDLE_URL=""`
- `VSL_EMBED_URL=""`

The version view showed no D1 binding or payment secret. The deployment list
showed this version at 100%. The execution-record commit reviewed after that
source revision is `e93ede693b5f2e7cfa1ae122b19726ca36d46fbc`.

## Browser matrix

Playwright Chromium loaded the deployed URL in a real browser, scrolled each
page through its full height, checked console and page exceptions, broken
images, and horizontal overflow, and captured a full-page screenshot for every
cell. Passive page loads produced no console or page errors.

| Page | 375 | 768 | 1024 | 1440 |
| --- | --- | --- | --- | --- |
| Landing A, `/?v=a` | PASS | PASS | PASS | PASS |
| Landing B, `/?v=b` | PASS | PASS | PASS | PASS |
| `/thanks` | PASS | PASS | PASS | PASS |
| `/preview-checkout` | PASS | PASS | PASS | PASS |

The 16 screenshots are in `artifacts/exc-77/`. Visual inspection found no
clipping, text collisions, broken assets, or unintended horizontal scrolling.
PR #3's before and after images were also reviewed. The after set moves the
complete offer and price card into the first-screen composition while retaining
the responsive hierarchy shown by the new matrix.

## Navigation, attribution, and cookie checks

- Forced `?v=a` and `?v=b` rendered their requested server-side variants.
- An ordinary visit assigned a `yfbjj_v` cookie. In the recorded run it assigned
  B, forcing A left the cookie at B, and the next ordinary reload rendered B.
- The assignment cookie was `Secure`, `HttpOnly`, `SameSite=Lax`, and configured
  for the repository's 180-day lifetime.
- All three anchor CTAs in each landing variant resolved to
  `/preview-checkout`.
- Each hero form called `/api/lead`, received the intentional fail-closed 503,
  and still navigated to `/preview-checkout`.
- `/preview-checkout` returned 200 and its back link returned to `/`.
- `/thanks` returned 200.
- The browser made no request to an external origin. Test UTM and click-id query
  values did not reach an external system because preview mode intercepted the
  handoff. Variant passthrough into a real ThriveCart URL therefore remains
  unverified.

Submitting each lead form caused Chromium to log the expected 503 resource
failure from `/api/lead`. There were no JavaScript exceptions. The passive
16-cell visual matrix had no console errors.

## Endpoint and mutation checks

| Check | Observed | Result |
| --- | --- | --- |
| `GET /health` | 503, `d1: intentionally_unbound`, `preview: true` | PASS |
| `GET /api/stats` | 503, `error: preview_state_disabled` | PASS |
| `POST /api/lead` | 503, `error: preview_state_disabled` | PASS |
| `POST /api/checkout` | 404, `error: not_found` | **FAIL** |
| Every rendered anchor CTA | `/preview-checkout` | PASS |
| Hero form destination after 503 | `/preview-checkout` | PASS |
| External browser requests | none | PASS |

The required direct-checkout behavior is HTTP 423 with
`error: preview_locked`. The deployed revision instead has no active checkout
route and returns HTTP 404 `not_found`. This is fail-closed in effect, but it
does not satisfy the issue's explicit contract. Reproduce with:

```bash
curl -i -X POST \
  https://yfbjj-funnel-visual-staging.sebastian-brosche.workers.dev/api/checkout
```

This QA session performed no Cloudflare, DNS, D1, Stripe, AutoCreator,
ThriveCart, customer, Checkout Session, charge, subscription, refund, or
entitlement write. The tested stateful endpoints returned 503 before storage
access, browser traffic stayed on the staging origin, and the Cloudflare checks
were read-only deployment and version inspection. This confirms the QA session
caused no listed mutation. It does not independently audit every provider's
historical account event log.

## Repository checks

- `npm run build:tc`: PASS, four pages rebuilt with expected unset asset and VSL
  notes and no tracked diff.
- `npm run scan`: PASS. The source scan found no served key-shaped secret. The
  Worker bundle substep could not run under the environment's Node 20 runtime,
  so the script explicitly fell back to its source-tree scan.
- `npm run preflight`: EXPECTED FAIL with five production activation blockers:
  missing ThriveCart URL, deadline, exact preview-off setting, real D1 ID, and
  18 intentionally unfilled copy or builder placeholders.
- `node --check src/pages/_page.js`: PASS.
- `git diff --check`: PASS.

## Required remediation and disposition

Remediation is required before EXC-77 can be Done: either implement and stage
the specified `POST /api/checkout` 423 `preview_locked` response, or amend the
acceptance criterion to recognize the deliberately parked checkout route's 404
as the approved lock contract. Until then, leave EXC-77 non-Done.

After that contract is resolved, the link is safe for Sebastian to review as a
visual preview. It is not a functioning checkout.

## Explicitly not verified

- Production checkout.
- Webhook processing.
- Fulfillment.
- Email delivery.
- A real-card journey.
