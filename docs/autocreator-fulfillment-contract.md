# AutoCreator fulfillment contract

Read-only authenticated inspection on 2026-08-31 confirmed the following
non-secret inventory. These references do not unlock checkout by themselves.

| Funnel offer | AutoCreator reference | Confirmed value | Runtime grant key |
| --- | --- | --- | --- |
| Guard Retention | private bundle UUID | `f0b327de-4093-4873-9f47-3113ad50ead0` | exact `bundle_slug` still missing |
| Head to Toes | public bundle UUID | `3c3947f7-cb93-4d40-a8c9-1806b6ed7060` | exact `bundle_slug` still missing |
| Lifetime | published one-time plan Stripe Price | `price_1TdIGeARWKYPSBdfrFBG6rhT` | same Price ID through `members.setMembership` |
| Two-Month then monthly | published Full monthly plan Stripe Price | `price_1TdIGdARWKYPSBdfNJFlXdwy` | same Price ID through `members.setMembership` |

The AutoCreator API base is `https://yfbjj.autocreator.ai/api/v1`. Tools use
`POST /tools/<toolName>` with a dedicated `ac_` bearer key. Never place that key
in source or Wrangler vars.

Confirmed bundle tools:

- `members.grantBundleEntitlement`: `email`, exact `bundle_slug`,
  `source="stripe_purchase"`, and Checkout Session ID in `notes`. Repeating a
  grant is explicitly idempotent and reports `already_existed=true`.
- `members.revokeBundleEntitlement`: soft revoke by `entitlement_id`, or by
  `email` plus exact `bundle_slug`.
- `members.listBundleEntitlements`, `members.checkAccess`, and
  `content.accessCheck`: read-back verification.

Confirmed paid-plan tools:

- `members.setMembership`: local-only, idempotent grant by `email` and the
  AutoCreator plan `price_id`. It may also receive `status`,
  `current_period_end`, `stripe_customer_id`, `stripe_subscription_id`, and
  `create_if_missing`. It does not charge a card, create a Stripe subscription,
  or send an email.
- `members.findByEmail`, `members.checkAccess`, `subscriptions.getActive`,
  `members.syncStatus`, and `content.accessCheck`: required read-back surfaces.

No symmetric local paid-plan revoke tool is documented. `subscriptions.cancel`
changes real Stripe billing and requires `billing:manage` plus confirmation;
`subscriptions.revokeAccess` only clears manual free access. Neither belongs in
this Worker without a separately approved cancellation/refund design.

The dedicated Worker key needs `videos:read`, `members:read`, and
`members:grant`. `tenant:read` is optional. Exact bundle slugs must be retrieved
through authenticated lookup. A bundle UUID must never be guessed to equal its
slug. Arbitrary external Stripe Checkout sessions are not proven to auto-sync;
the Worker must explicitly write the local membership record and verify access.

Runtime stays locked until both bundle slugs are authoritative, the bundle and
plan client paths are implemented, read-back succeeds, retry and lifecycle
behavior pass, and both readiness flags are set to the exact string `true` for
the deployed revision.

Both confirmed grant tools are idempotent at the tool level. No generic
AutoCreator HTTP idempotency header is documented. The D1 event claim and outbox
operation key remain the outer guard for every API action and retry.
