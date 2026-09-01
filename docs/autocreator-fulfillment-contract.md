# AutoCreator fulfillment contract

Read-only authenticated inspection on 2026-09-01 confirmed the following
non-secret inventory and exact runtime grant keys. These mappings do not unlock
checkout by themselves.

| Funnel offer | AutoCreator reference | Confirmed value | Runtime grant key |
| --- | --- | --- | --- |
| Guard Retention | bundle UUID `f0b327de-4093-4873-9f47-3113ad50ead0` | `14-guard-retention-bundle` | same slug through `members.grantBundleEntitlement` |
| Head to Toes | bundle UUID `3c3947f7-cb93-4d40-a8c9-1806b6ed7060` | `yoga-for-rocks-head-to-toes` | same slug through `members.grantBundleEntitlement` |
| Lifetime | published one-time plan | `price_1TdIGeARWKYPSBdfrFBG6rhT` | same Price ID through `members.setMembership` |
| Two-Month then monthly | published Full monthly plan | `price_1TdIGdARWKYPSBdfNJFlXdwy` | same Price ID through `members.setMembership` |
| Certification Level 1 | bundle UUID `231686c4-5ba9-4053-90dd-7411f608676b` | `level-1-instructors-course` | grant as part of the Certification offer |
| Certification Level 2 | bundle UUID `b5bee770-e110-4c5b-abfd-ed43d6a09749` | `level-2-instructor-course` | grant as part of the Certification offer |
| Certification Level 3 | bundle UUID `3801c1a9-8405-48b0-93ea-fffcbfdc00c8` | `level-3-instructors-course` | grant as part of the Certification offer |

The $297 Certification offer is one funnel purchase with three required bundle
grants. Success requires exact active read-back for all three levels. A partial
grant or partial read-back is failure and remains retryable through the stable
D1 outbox operation key.

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
`members:grant`. `tenant:read` is optional. The key used for the 2026-09-01
inspection authenticated successfully and included the required scopes. The
secret value belongs only in the deployed Worker's Cloudflare Secret, never in
source or documentation. A bundle UUID must never be substituted for its slug.
Arbitrary external Stripe Checkout sessions are not proven to auto-sync; the
Worker must explicitly write the local membership record and verify access.

The mappings and client contract are now authoritative. Runtime stays locked
until a deployed staging revision proves bundle and plan grants, exact
read-back, retry, and revocation behavior, and both readiness flags are set to
the exact string `true` for that proven revision.

Both confirmed grant tools are idempotent at the tool level. No generic
AutoCreator HTTP idempotency header is documented. The D1 event claim and outbox
operation key remain the outer guard for every API action and retry.
