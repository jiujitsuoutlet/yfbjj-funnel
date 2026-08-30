# EXC-109 independent QA evidence

## Verdict

PASS for the exact visual staging target. The remote PR #3 head, remote `work` branch, and detached source revision were all `ecbe24c72ca248cf9d689db26a010a8a5d3e65e4`. Cloudflare reports version `d64d9b5f-3147-4798-8a2d-d098dcf44f3d` at 100 percent with deployment annotation `EXC-106 pushed revision ecbe24c72ca248cf9d689db26a010a8a5d3e65e4`.

This evidence was produced from a fresh authenticated clone in a new empty directory. No competing QA, Playwright, or Wrangler process for this scope was present before the run. Application code, PR #3, Worker configuration, production, DNS, D1, Stripe, ThriveCart, secrets, and customer or payment state were not modified.

## Browser matrix

All cells passed. Each full-page PNG is stored in `screenshots/`. Vertical scrolling was present and accepted in every cell.

| Variant | 375x667 | 375x812 | 768x1024 | 1024x768 | 1440x900 |
| --- | --- | --- | --- | --- | --- |
| A | PASS | PASS | PASS | PASS | PASS |
| B | PASS | PASS | PASS | PASS | PASS |

For every cell, the automated browser evidence confirms:

* HTTP 200 and the forced variant requested.
* All nine required sentences appear exactly once. The first seven are in the value bullet list, followed by the transition and highlighted bonus.
* Required copy is 16px or larger.
* The $14 price, CTA, email form, offer summary, preview notice, and legal or support navigation exist and are visible.
* No horizontal overflow, broken image, failed request, console error, page error, or missing required element.
* Vertical scrolling occurs as intentionally accepted.

A manual review of the full-page screenshots found no clipping, overlap, or layout collapse.

## Functional and safety checks

All checks passed:

* A naturally assigned variant persisted across reload through `yfbjj_v`.
* `?v=` forced the other variant without replacing the persistent natural variant cookie.
* `utm_source`, `utm_medium`, and `gclid` survived CTA handoff to `/preview-checkout`.
* The CTA interaction emitted no POST request.
* Terms and Privacy loaded successfully in Chromium. Support is a valid `mailto:` destination. No email was sent.
* Direct `POST /api/checkout` returned HTTP 423 with `preview_locked`.
* `POST /api/lead` and `GET /api/stats` returned HTTP 503 with `preview_state_disabled`.
* `GET /health` returned HTTP 503 with `d1: intentionally_unbound` and `preview: true`.
* All 18 browser, destination, functional, and backend result records passed.

## Command checks

* `npm test` passed 3 of 3 tests under Node 22.23.2.
* `npm run scan` passed after building and scanning the Worker bundle.
* `npm run preflight` was run and correctly failed on the staging checkout, deadline, preview mode, D1, and ThriveCart placeholder gates. This is expected for the intentionally locked visual-staging revision, but it means this exact source configuration is not deploy-ready. No attempt was made to change configuration or deploy.

## Evidence inventory

* `revision-evidence.txt`: origin, remote PR head, remote branch head, detached HEAD, and GitHub PR metadata.
* `deployment-evidence.json`: Cloudflare deployment history identifying the required version and source revision.
* `browser-results.json`: machine-readable results for 10 viewport cells and 8 functional, destination, and backend checks.
* `browser-output.txt`: full browser runner output.
* `screenshots/`: ten full-page screenshots.
* `test-output.txt`, `scan-output.txt`, and `preflight-output.txt`: exact command output.
* `run-browser-qa.mjs`: reproducible Playwright runner.

## Untested behavior

Production checkout, real ThriveCart handoff, external form writes, D1 persistence, purchases, customers, subscriptions, payments, refunds, fulfillment, entitlements, webhooks, Stripe, DNS changes, and ThriveCart-side post-purchase behavior were intentionally not exercised. No claim is made about those behaviors.
