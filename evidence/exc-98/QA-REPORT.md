# EXC-98 independent QA report

## Decision

**PASS.** Both EXC-96 remediations and every required observable staging regression passed against the required artifact. No implementation, account, deployment, DNS, secret, D1, checkout, payment, or customer state was changed.

Tested staging origin: `https://yfbjj-funnel-visual-staging.sebastian-brosche.workers.dev`

Independently queried Cloudflare version: `8dcb708f-ac76-4ea9-bb52-d2101074b0f4`

Cloudflare version message: `EXC-97 revision 80e1a7d2b7a3fc0b9285fd41cfe9a5a72ba92dba`

Required and fetched remediation commit: `80e1a7d2b7a3fc0b9285fd41cfe9a5a72ba92dba`

## Fail-closed preview rule

Preview mode defaults on. Only the exact string `PREVIEW_MODE="false"` may disable preview. Unset, misspelled, `"true"`, or every other value must route every CTA to `/preview-checkout`. This staging artifact also must retain `PREVIEW_NO_D1="true"` and no D1 binding.

The authenticated Cloudflare version query showed `PREVIEW_MODE="true"`, `PREVIEW_NO_D1="true"`, and no D1 binding. The observed `/health` response was HTTP 503 with `{"ok":false,"d1":"intentionally_unbound","preview":true,...}`. The configuration and public behavior therefore agree.

## Remediation re-tests

### Legal and support destinations

| Source | Terms | Privacy | Support |
| --- | --- | --- | --- |
| Forced A | `https://yfbjj.autocreator.ai/legal/terms` | `https://yfbjj.autocreator.ai/legal/privacy` | `mailto:Sebastian@yogaforbjj.net` |
| Forced B | same | same | same |
| Thanks | same | same | `mailto:Sebastian@yogaforbjj.net` |

Terms returned HTTP 200, stayed at the exact destination, had title `Yoga For BJJ`, and contained 2,650 visible text characters. Privacy returned HTTP 200, stayed at the exact destination, had title `Yoga For BJJ`, and contained 2,613 visible text characters. Both are non-placeholder pages on the Yoga for BJJ AutoCreator subdomain. Support is a usable mail link at the official `yogaforbjj.net` domain. Result: **PASS**.

### Preview attribution handoff

The browser began with encoded values for `utm_source`, `utm_medium`, `gclid`, `utm_content`, the forced variant, and an unapproved `evil` parameter. Submitting the lead form produced:

* A: `/preview-checkout?utm_source=source+value&utm_medium=medium%2Fvalue&gclid=abc%2B123&passthrough%5Bvariant%5D=a&utm_content=variant-a`
* B: `/preview-checkout?utm_source=source+value&utm_medium=medium%2Fvalue&gclid=abc%2B123&passthrough%5Bvariant%5D=b&utm_content=variant-b`

Decoded approved values survived exactly. The variant survived in `passthrough[variant]` and the applicable `utm_content=variant-a` or `variant-b` carrier. The unapproved `evil` input did not survive. Result: **PASS**.

## Browser regression matrix

Chromium was run with a normal desktop user agent. Every screenshot is a full-page capture. For all ten forced-variant cases, `scrollWidth - clientWidth = 0`, `scrollHeight - clientHeight = 0`, the CTA was present, no visible text measured below 11px, and the landing page recorded zero console errors, page errors, request failures, or HTTP responses at or above 400.

| Variant | Viewport | Horizontal scroll | Vertical scroll | Landing errors | Screenshot |
| --- | --- | ---: | ---: | ---: | --- |
| A | 375 x 667 | 0 | 0 | 0 | `screenshots/a-375x667.png` |
| A | 375 x 812 | 0 | 0 | 0 | `screenshots/a-375x812.png` |
| A | 768 x 1024 | 0 | 0 | 0 | `screenshots/a-768x1024.png` |
| A | 1024 x 768 | 0 | 0 | 0 | `screenshots/a-1024x768.png` |
| A | 1440 x 900 | 0 | 0 | 0 | `screenshots/a-1440x900.png` |
| B | 375 x 667 | 0 | 0 | 0 | `screenshots/b-375x667.png` |
| B | 375 x 812 | 0 | 0 | 0 | `screenshots/b-375x812.png` |
| B | 768 x 1024 | 0 | 0 | 0 | `screenshots/b-768x1024.png` |
| B | 1024 x 768 | 0 | 0 | 0 | `screenshots/b-1024x768.png` |
| B | 1440 x 900 | 0 | 0 | 0 | `screenshots/b-1440x900.png` |

Visual inspection of the captures found no clipping, overlap, off-screen content, broken image, or unusably small required control. Result: **PASS**.

## State and safety checks

* Natural assignment set `yfbjj_v=a`, reload retained `a`, and forced `?v=b` left the stored cookie as `a`: **PASS**.
* Both submitted forced variants navigated only to `/preview-checkout`: **PASS**.
* Preview lead submission returned HTTP 503 `preview_state_disabled`, then completed the preview handoff. With `/health` reporting D1 intentionally unbound, no D1 write was possible: **PASS**.
* Direct `POST /api/checkout` returned HTTP 423 `preview_locked`: **PASS**.
* Direct `POST /api/lead` returned HTTP 503 `preview_state_disabled`: **PASS**.
* Direct `GET /api/stats` returned HTTP 503 `preview_state_disabled`: **PASS**.
* `/health` returned HTTP 503 with `preview:true` and `d1:intentionally_unbound`: **PASS**.

The console messages saved in `auxErrors` are the expected browser messages produced by those deliberate 423 and 503 negative requests, plus CSP rejection of Google Tag Manager on the external legal pages. They are not landing-page errors. Landing error arrays are separately empty in every matrix case.

## Artifact provenance

An authenticated read-only `wrangler versions view` query returned version `8dcb708f-ac76-4ea9-bb52-d2101074b0f4`, creation time `2026-08-29T10:08:25.356Z`, and message `EXC-97 revision 80e1a7d2b7a3fc0b9285fd41cfe9a5a72ba92dba`. The required commit was fetched and resolved as a commit object. The query also enumerated the exact safe preview bindings and showed no D1 binding.

Downloaded staging HTML is stored under `html/`, with hashes in `artifact-hashes.txt`. Eight of ten newly captured viewport screenshots are byte-identical to screenshots committed by the remediation revision. The remaining two have the same dimensions, content, zero-scroll measurements, and clean browser results. Together, the authenticated version message, fetched commit, durable HTML, screenshot fingerprints, and behavior establish that the exact required artifact was tested. Result: **PASS**.

## Local gates

`npm run scan` passed. Its Wrangler bundle step could not build on this older local checkout, so it scanned source only. `npm run preflight` failed with five expected launch blockers in the older local checkout: cart URL, deadline, preview mode, D1 id, and placeholders. These local results do not characterize the separate staging artifact.

## Explicitly unverified

Production; live checkout or payment; D1 persistence; custom-domain or DNS routing; webhook delivery; fulfillment or entitlements; subscription lifecycle; refunds; ThriveCart-side behavior; real transactions; and any behavior outside the named visual staging Worker.
