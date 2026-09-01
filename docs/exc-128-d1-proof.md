# EXC-128 Cloudflare D1 proof

Verified on 2026-09-01 against Cloudflare account
`cb8ab13b857925cdb9b3c0fd9d4ec4bf`.

## Provisioned databases

| Environment | Database | Database ID |
| --- | --- | --- |
| Production | `yfbjj_funnel` | `0cce4280-1113-45f5-b0da-bd5979f7cace` |
| Staging | `yfbjj_funnel_staging` | `e2ebcc63-f373-451e-84a9-9118f8053f82` |

Both databases were created in Cloudflare's WNAM region. The IDs are non-secret
resource identifiers and are bound as `DB` in `wrangler.toml`.

## Remote migration evidence

Migrations `0001_init.sql` through `0009_certification_offer.sql` applied
successfully to both remote databases. The remote migration ledger reports nine
applied migrations in each environment.

Post-migration inspection confirmed:

- all application, fulfillment, offer-state, and editor tables exist;
- `PRAGMA foreign_key_check` returns no violations;
- `offer_transitions` allows the final `certification` offer and references
  `checkout_flows(flow_hash)`;
- `editor_pages` contains `offer-certification` with title
  `Offer: Certification`.

No Worker deployment, production route change, Stripe object, payment, or
AutoCreator entitlement write occurred as part of this database work.
