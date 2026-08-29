# EXC-96 independent QA decision

## Decision

**FAIL. The reviewed artifact is not release-ready.**

The one-screen layouts pass the required viewport checks, but two release criteria fail:

1. Terms, Privacy, and Support are visible but unusable because the deployed page contains literal `[[TERMS_URL]]`, `[[PRIVACY_URL]]`, and `[[SUPPORT_EMAIL]]` placeholders.
2. The allowed `utm_source`, `utm_medium`, and `gclid` query carriers are dropped when the lead CTA hands off to `/preview-checkout`.

No implementation was changed. A remediation issue should replace the three legal and support placeholders with approved values and preserve the allowed attribution query carriers on the fail-closed preview handoff. Both fixes need another independent run of this full matrix against a newly recorded revision and Cloudflare version.

## Artifact identity and safety

- Tested Git revision: `d323d792cc2f0b4b8171f2b4bf04604b8b8d5276`.
- Tested Cloudflare version: `51febbf4-abe8-413d-b0ba-5a2171239a97`.
- Tested origin: `https://yfbjj-funnel-visual-staging.sebastian-brosche.workers.dev`.
- Wrangler reports that the version message names the exact EXC-95 revision.
- Byte comparison of locally rendered variants from the exact commit against staging is exact for both A and B. See `artifact-match.txt`.
- Staging remained `PREVIEW_MODE="true"` and `PREVIEW_NO_D1="true"` throughout this read-only QA.

The fail-closed rule is: preview mode is on unless `PREVIEW_MODE` is the exact string `"false"`. If it is unset, misspelled, or has any other value, every CTA must route to `/preview-checkout`. This rule was not changed or bypassed.

## Browser matrix

Every row was loaded independently in real Chromium. Each screenshot is viewport-sized rather than full-page, so its dimensions are durable evidence that the page has no hidden page scroll. The browser measurements in `browser-results.json` prove equal scroll and client dimensions, all required regions inside the viewport, healthy images, and no console errors, page errors, or failed asset requests. Manual screenshot review found no clipped or overlapping content and confirmed readable type and usable form controls.

| Variant | Viewport | No page scroll | Required content in viewport | Assets and browser errors | Legal/support usable | Result |
| --- | --- | --- | --- | --- | --- | --- |
| A | 375 x 667 | Pass | Pass | Pass | **Fail** | **Fail** |
| A | 375 x 812 | Pass | Pass | Pass | **Fail** | **Fail** |
| A | 768 x 1024 | Pass | Pass | Pass | **Fail** | **Fail** |
| A | 1024 x 768 | Pass | Pass | Pass | **Fail** | **Fail** |
| A | 1440 x 900 | Pass | Pass | Pass | **Fail** | **Fail** |
| B | 375 x 667 | Pass | Pass | Pass | **Fail** | **Fail** |
| B | 375 x 812 | Pass | Pass | Pass | **Fail** | **Fail** |
| B | 768 x 1024 | Pass | Pass | Pass | **Fail** | **Fail** |
| B | 1024 x 768 | Pass | Pass | Pass | **Fail** | **Fail** |
| B | 1440 x 900 | Pass | Pass | Pass | **Fail** | **Fail** |

Each row shows identity, variant headline, support copy, approved guard-pass visual, the eight-collection summary, `$14`, lead form, CTA, preview notice, and legal/support labels. Screenshots are under `screenshots/` with names matching the table.

## Functional matrix

| Check | Evidence | Result |
| --- | --- | --- |
| Exact revision and version | Wrangler metadata names both identifiers; both rendered variant bodies are byte-equal to the exact local commit | Pass |
| Natural assignment persists | Assigned `yfbjj_v=b`; reload and later natural visit remained B | Pass |
| Forced variants work without overwriting assignment | `?v=a` rendered A while cookie remained B; both forced variants also passed every viewport layout measurement | Pass |
| Allowed attribution carriers survive CTA handoff | Started with `utm_source`, `utm_medium`, and `gclid`; arrived at bare `/preview-checkout` | **Fail** |
| Every landing CTA is fail-closed | The only landing CTA in each minimal variant routes to `/preview-checkout`; submitted form arrived there | Pass |
| `POST /api/checkout` | HTTP 423 with `preview_locked` | Pass |
| Preview form makes no write | Browser observed no POST during valid lead-form handoff | Pass |
| Other stateful routes fail closed | `/api/lead` and `/api/stats` return 503 `preview_state_disabled`; `/health` returns 503 with D1 `intentionally_unbound` | Pass |
| EXC-95 evidence matches staging | Its ten viewport dimension records match this run, and the fresh screenshots show the same one-screen composition | Pass |

## Commands and durable output

- `run-browser-qa.mjs` is the reproducible browser runner. Its intentional exit code is 1 because required QA checks failed.
- `browser-results.json` is the structured output. `browser-output.txt` is the exact console output.
- `artifact-match.txt` contains source-to-deployment SHA-256 comparisons and the Wrangler version record.
- `test-output.txt`, `scan-output.txt`, and `preflight-output.txt` contain exact command output.
- `npm test` passed.
- `npm run scan` passed.
- `npm run preflight` correctly failed because this is a preview configuration and because production values remain intentionally unset. No deploy was attempted.

## Explicitly unverified

This QA does not verify production, live checkout or payment, D1 persistence, custom-domain or DNS routing, webhook delivery, fulfillment or entitlements, subscription lifecycle, refunds, or any real transaction behavior. It also does not verify ThriveCart-side behavior.
