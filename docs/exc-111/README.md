# EXC-111 zero-scroll recovery evidence

## Scope

This recovery started from the verified PR #3 head at
`ecbe24c72ca248cf9d689db26a010a8a5d3e65e4`. It changes only the responsive
viewport and typography rules for the two landing variants, plus this evidence.
The nine approved offer lines, distinct headlines, price, form, legal links,
attribution handoff, variant behavior, and preview locks remain in place.

## Browser matrix

Real Chromium loaded both forced variants at every required viewport. Each row
had HTTP 200, no console or page errors, no failed requests, no broken images,
and no horizontal or vertical document or body scrolling.

| Variant | Viewport | Document | Body | Result |
| --- | --- | --- | --- | --- |
| A | 375 x 667 | 375 x 667 | 375 x 667 | Pass |
| A | 375 x 812 | 375 x 812 | 375 x 812 | Pass |
| A | 768 x 1024 | 768 x 1024 | 768 x 1024 | Pass |
| A | 1024 x 768 | 1024 x 768 | 1024 x 768 | Pass |
| A | 1440 x 900 | 1440 x 900 | 1440 x 900 | Pass |
| B | 375 x 667 | 375 x 667 | 375 x 667 | Pass |
| B | 375 x 812 | 375 x 812 | 375 x 812 | Pass |
| B | 768 x 1024 | 768 x 1024 | 768 x 1024 | Pass |
| B | 1024 x 768 | 1024 x 768 | 1024 x 768 | Pass |
| B | 1440 x 900 | 1440 x 900 | 1440 x 900 | Pass |

The same run confirmed the assignment cookie persists across reloads, a forced
variant does not replace it, allowed attribution reaches `/preview-checkout`,
and preview submission makes no POST request. It also confirmed direct checkout
returns HTTP 423 with `preview_locked`, while stateful routes fail closed.
Screenshots and raw measurements are stored in this directory.

## Gates and boundaries

`npm test` and `npm run scan` pass. Production preflight was run and correctly
refused production deployment because preview remains enabled and the production
cart, deadline, D1 identifier, and client-owned copy are deliberately unset.
The exact output is stored in `preflight-output.txt`.

No production route, DNS, D1, Stripe, ThriveCart, payment, customer,
subscription, refund, fulfillment, entitlement, or secret was changed or
exercised. ThriveCart-side behavior was not verified.
