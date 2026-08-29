# Visual staging evidence

The PNG files in this directory were captured from the local
`wrangler.preview.toml` Worker in headless Chromium. They cover both landing
variants plus `/thanks` and `/preview-checkout` at 375, 768, 1024, and 1440
CSS pixels. Each capture used a 900-pixel viewport height with visible browser
scrollbars and a full-page screenshot.

The browser check also asserted that every page had no console or page errors,
no horizontal overflow, successful asset loads, and a 200 response. It checked
all landing CTAs in both variants, cookie stability across a reload, and that a
forced `?v=` variant did not overwrite the stored variant.

These files prove only visual and interaction behavior. They do not prove any
ThriveCart, Stripe, D1, webhook, customer portal, order, entitlement, or
AutoCreator behavior. Those integrations are intentionally unreachable in this
preview-only profile.
