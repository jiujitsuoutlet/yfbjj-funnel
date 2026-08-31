# EXC-106 recovery evidence

This directory records the browser and command evidence for the revision that restores Paul's approved first-page copy to both variants.

The browser matrix covers variants A and B at 375x667, 375x812, 768x1024, 1024x768, and 1440x900. It checks the approved copy appears exactly once, value copy is at least 16px, assets load, the browser reports no console or page errors, and there is no horizontal overflow. Vertical scrolling is expected in all ten cells, including 1440x900, so the complete copy remains readable at an accessible size.

The same run verifies forced variants, the persistent `yfbjj_v` cookie, attribution handoff, fail-closed preview checkout, no preview form write, and stateful-route blocking before D1 access.

Production checkout, payments, D1 persistence, DNS, webhooks, fulfillment, entitlements, subscriptions, refunds, real transactions, and ThriveCart-side behavior were not verified.
