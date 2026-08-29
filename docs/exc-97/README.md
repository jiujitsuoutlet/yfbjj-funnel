# EXC-97 remediation evidence

## Safety rule and starting revision

Preview mode remains on unless `PREVIEW_MODE` is the exact string `"false"`.
An unset, misspelled, or different value sends every CTA to
`/preview-checkout`. The implementation started from PR 3 revision
`d323d792cc2f0b4b8171f2b4bf04604b8b8d5276`, which contains that failed QA
revision.

## Legal and support provenance

The public Yoga for BJJ property at `https://yfbjj.autocreator.ai/` exposes
footer links to `/legal/terms` and `/legal/privacy`, and publishes
`Sebastian@yogaforbjj.net` as its contact address. Yoga for BJJ's official
`https://yogaforbjj.net/robots.txt` identifies the same AutoCreator property
as its sitemap origin. Both legal pages returned HTTP 200 during this run.

The landing variants and thanks page now use those existing destinations. No
legal text, legal entity, jurisdiction, policy, URL, or address was invented.

## Browser matrix

The browser runner loaded both variants in real Chromium and compared the page
dimensions with each required viewport. It also checked required content,
image health, failed requests, console errors, and page errors.

| Variant | Viewport | No horizontal scroll | No vertical scroll | Browser and asset errors | Result |
| --- | --- | --- | --- | --- | --- |
| A | 375 x 667 | Pass | Pass | None | Pass |
| A | 375 x 812 | Pass | Pass | None | Pass |
| A | 768 x 1024 | Pass | Pass | None | Pass |
| A | 1024 x 768 | Pass | Pass | None | Pass |
| A | 1440 x 900 | Pass | Pass | None | Pass |
| B | 375 x 667 | Pass | Pass | None | Pass |
| B | 375 x 812 | Pass | Pass | None | Pass |
| B | 768 x 1024 | Pass | Pass | None | Pass |
| B | 1024 x 768 | Pass | Pass | None | Pass |
| B | 1440 x 900 | Pass | Pass | None | Pass |

Screenshots are in `screenshots/`. Exact structured measurements are in
`browser-results.json`, and the complete console output is in
`browser-output.txt`.

## Functional results

The browser run proved that `utm_source`, `utm_medium`, and `gclid` reach the
preview checkout. The existing `passthrough[variant]` and `utm_content`
carriers remain on the handoff. Natural assignment persisted across reload,
forced `?v=` rendering did not overwrite the cookie, and the preview lead form
made no POST.

Direct `POST /api/checkout` returned HTTP 423 with `preview_locked`.
`/api/lead` and `/api/stats` returned HTTP 503 with
`preview_state_disabled`, and `/health` returned HTTP 503 with D1 marked
`intentionally_unbound`.

## Deploy gate status

Tests, the ThriveCart build, and the secret scan pass. Production preflight
correctly remains blocked because this visual review profile intentionally has
preview mode enabled and still lacks the production cart URL, deadline, D1
identifier, asset origin, and approved ThriveCart copy. The complete command
outputs are stored in this directory.

## Not verified

Production, live checkout or payment, D1 persistence, custom-domain or DNS
routing, webhook delivery, fulfillment or entitlements, subscription
lifecycle, refunds, real transactions, and ThriveCart-side behavior remain
unverified.
