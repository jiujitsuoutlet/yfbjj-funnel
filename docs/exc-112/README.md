# EXC-112 independent zero-scroll QA evidence

## Verdict

**PASS.** The exact visual-staging revision passed the requested read-only QA gate. EXC-111 is eligible for Done. This evidence branch and its pull request are evidence only and must not be merged.

## Identity verified independently

QA began with a fresh clone of `https://github.com/jiujitsuoutlet/yfbjj-funnel.git`. GitHub PR #3 was open and its head was exactly `20afebd527e49775ad8288298bb9023891424d00`. The raw transcript is in `revision-verification.txt`.

Cloudflare Worker `yfbjj-funnel-visual-staging` version `f8a8fc0e-8801-4474-b0db-4d32965fb07b` reported the annotation `EXC-111 git 20afebd527e49775ad8288298bb9023891424d00`. Its deployed bindings reported `PREVIEW_MODE = true` and `PREVIEW_NO_D1 = true`, and the binding list contained no D1 binding. The complete read-only Wrangler response is in `deployment-version.json`.

## Browser matrix

Fresh Chromium 140 loaded the deployed preview for both forced variants. The audit captured a screenshot and machine-readable geometry for every combination.

| Variant | Viewport | Document scroll size | Body scroll size | Console, page, request, image errors | Result |
| --- | --- | --- | --- | --- | --- |
| A | 375 x 667 | 375 x 667 | 375 x 667 | None | Pass |
| A | 375 x 812 | 375 x 812 | 375 x 812 | None | Pass |
| A | 768 x 1024 | 768 x 1024 | 768 x 1024 | None | Pass |
| A | 1024 x 768 | 1024 x 768 | 1024 x 768 | None | Pass |
| A | 1440 x 900 | 1440 x 900 | 1440 x 900 | None | Pass |
| B | 375 x 667 | 375 x 667 | 375 x 667 | None | Pass |
| B | 375 x 812 | 375 x 812 | 375 x 812 | None | Pass |
| B | 768 x 1024 | 768 x 1024 | 768 x 1024 | None | Pass |
| B | 1024 x 768 | 1024 x 768 | 1024 x 768 | None | Pass |
| B | 1440 x 900 | 1440 x 900 | 1440 x 900 | None | Pass |

For every row, document and body scroll width and height equaled the viewport. The audit checked the headline, all nine exact approved lines, price, email field, CTA, preview notice, and legal/support navigation for existence, visibility, and viewport containment. It also checked each approved line for clipping, truncation, visibility, viewport containment, and center-point overlap. Images had positive natural width, no image was broken, required requests did not fail, and no HTTP error response occurred. Manual review of the screenshots found the backgrounds loaded and the layout visually coherent.

The exact screenshots are under `screenshots/`. Full geometry, text, image, console, network, and outcome records are in `browser-results.json`; the reproducible runner is `run-browser-qa.mjs`, and its complete stdout is `browser-output.txt`.

## Functional and safety results

* Variant A headline was `Keep your guard. Get your hips back.` Variant B headline was `Your guard isn't the problem. Your hips are.`
* Forced `?v=a` and `?v=b` each rendered the requested variant.
* A natural assignment cookie persisted across reload, a forced opposite variant did not overwrite it, and the next unforced navigation returned to the cookie variant.
* `utm_source`, `utm_medium`, and `gclid` survived the CTA handoff to `/preview-checkout`; the handoff also identified variant A.
* Submitting the preview form produced no POST request, external form write, or payment activity.
* Direct `POST /api/checkout` returned HTTP 423 with `preview_locked`.
* The stateful lead and stats endpoints returned HTTP 503 with `preview_state_disabled`; health returned HTTP 503 and identified D1 as `intentionally_unbound`.
* Terms and Privacy each loaded their exact rendered destination with HTTP 200 in Chromium. Support was a visible, named `mailto:` link with a syntactically valid address.
* `npm test` passed all three local fail-closed and handoff tests. `npm run scan` built and scanned the Worker bundle and found no secret-shaped key.
* Production preflight correctly exited 1. This is the expected safety result for this visual staging target: preview is still on, D1 remains a placeholder, and production-owned inputs are deliberately unset. Its exact output is retained rather than described as a clean production gate.

## Boundaries

This was read-only QA. No implementation file changed. No Worker was uploaded or deployed. No production route, DNS, D1, Stripe, ThriveCart, payment, customer, subscription, refund, fulfillment, entitlement, or secret was changed or exercised. ThriveCart-side checkout and post-purchase behavior were not verified because this target is intentionally fail-closed before those systems.
