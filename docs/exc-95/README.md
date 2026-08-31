# EXC-95 one-screen landing evidence

## Revision scope

Both landing variants now use one minimal viewport-locked system. Variant A uses the headline "Keep your guard. Get your hips back." Variant B retains "Your guard isn't the problem. Your hips are." Both retain the lead form, bundle price, eight-collection summary, preview banner, and legal and support links.

## Required viewport matrix

The browser audit loaded each locally rendered variant, recorded console and page errors, checked image health, and compared document dimensions with viewport dimensions. Raw results are in `after-results.jsonl`.

| Variant | Viewport | HTTP | Horizontal scroll | Vertical scroll | Console errors |
| --- | --- | ---: | --- | --- | --- |
| A | 375 x 667 | 200 | none | none | none |
| A | 375 x 812 | 200 | none | none | none |
| A | 768 x 1024 | 200 | none | none | none |
| A | 1024 x 768 | 200 | none | none | none |
| A | 1440 x 900 | 200 | none | none | none |
| B | 375 x 667 | 200 | none | none | none |
| B | 375 x 812 | 200 | none | none | none |
| B | 768 x 1024 | 200 | none | none | none |
| B | 1024 x 768 | 200 | none | none | none |
| B | 1440 x 900 | 200 | none | none | none |

The `before/` and `after/` folders contain viewport screenshots for both variants. Before measurements are recorded in `before-results.jsonl`.

## Functional evidence

A real Chromium run confirmed that the assignment cookie survives reload, `?v=` forces the requested variant without overwriting the cookie, the lead request retains its assigned variant, the CTA reaches `/preview-checkout`, and the browser reports no console or page errors.

`POST /api/checkout` remains covered by `test/preview-checkout.test.mjs` and returns HTTP 423 with `preview_locked` in preview mode.

## Deploy gate status

`npm run scan` and `npm test` pass. The full output is stored beside this file. The production preflight correctly remains blocked because this review environment deliberately keeps preview mode on and still lacks production cart, deadline, D1, legal, support, asset, and approved copy values. Its exact output is in `preflight-output.txt`.

The preflight landing completeness check was also proved in both directions. A temporary removal of Variant A's price marker was caught, then the source was restored and both minimal variants passed their completeness checks. The deliberate failure output is in `preflight-negative-output.txt`.

## Not verified

No ThriveCart checkout, payment, upsell, downsell, customer, subscription, refund, or entitlement behavior was exercised. No D1 write was exercised because visual staging intentionally uses `PREVIEW_NO_D1="true"`.
