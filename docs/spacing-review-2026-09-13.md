# Lifetime and certification spacing correction

The owner reported paragraphs and section headings crowded together on the
lifetime OTO and certification pages, plus an oversized certification headline.

Removed the lifetime column's legacy `display:block` override, which disabled
the shared vertical gap. Both long sales pages now have 24px between blocks and
an additional 16px before section headings. Inner heading and paragraph margins
are consistent in the shared editor/public stylesheet. The certification H1
scales with its container, up to 48px, and fits on one line at 768px, 1024px and
1440px. At 375px it wraps without overflow. Saved copy, images, published
documents, and commerce handlers were not changed.

## Verification

Three consecutive full visual passes, 48 page/viewport combinations per pass:

1. Production published documents with local release styles: 48 clean.
2. Same documents with the deployed staging styles: 48 clean.
3. Same documents with the deployed production styles: 48 clean.

All passes covered 12 registered screens at 375, 768, 1024 and 1440px. Checks
include overlap, clipping, horizontal overflow, images/video, content checks,
repeated commerce actions, paragraph gaps, section spacing, and certification
headline wrapping. Screenshots of both affected pages were visually reviewed
at desktop, tablet and mobile sizes. No errors occurred in those three passes;
no restart was needed after the initial correction. These are layout checks
using the published documents and release renderer, not payment-journey proofs.

Artifacts: `/private/tmp/yfbjj-spacing-pass-1`,
`/private/tmp/yfbjj-spacing-pass-2`, `/private/tmp/yfbjj-spacing-pass-3`.

Existing automated suite: 93/93 passed. Secret scan and production/staging
preflight passed. No live card charges or new fulfillment grants were made.

## Deployment

Staging version: `a8d19901-162b-49ec-9ab5-d89498d829e0`.

Production version: `d3526f7b-fde6-478f-8250-9fe9a58dc760`, confirmed active at
100% via Cloudflare deployment read-back. The production CLI uploaded and
activated the Worker, then returned a 403 while listing the existing zone's
Worker routes. No route-permission workaround or route change was attempted.
The custom-domain response contains the exact new stylesheet, and pass 3
used that deployed response as its stylesheet source.

The permanent staging QA code and coupon remain configured.
