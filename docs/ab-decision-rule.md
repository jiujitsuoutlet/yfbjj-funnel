# Funnel A/B decision rule

The test stays open until both variants have at least 500 qualified visitors and 30 paid purchases.

The primary metric is paid conversion rate. Revenue per visitor is the tie-breaker. Leads, checkout starts, and offer clicks diagnose friction but do not choose the winner. Purchases and revenue come only from signed Stripe webhook records.

The dashboard reports whether the sample gates are met. It never publishes a winner automatically. Before choosing, verify that the result is not explained by a material source or device imbalance.
