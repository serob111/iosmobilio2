# Payment via Paddle as Merchant of Record

**Date:** 2026-11-22 (approximate — no Paddle integration code exists yet; closest signal in
the repo is the pricing page landing, `ae5294f`, which this decision feeds into).

**Decision:** Handle payment through Paddle, acting as the Merchant of Record for every sale
— not a payment processor Mobilio itself has to be the merchant of record for (e.g. raw
Stripe).

**Why:** A Merchant of Record handles sales tax/VAT compliance across every jurisdiction a
customer might be in, which is otherwise a significant ongoing compliance burden for a small
team selling a subscription product internationally. Paddle also makes the plan tiers on the
pricing page ([[2026-11-22-pricing-below-median-proposed]]) directly sellable without building
a bespoke billing/tax engine first.

**Rejected:** A raw payment processor (Stripe directly) where Mobilio itself remains the
merchant of record and has to handle tax compliance per jurisdiction itself.

See [[STATUS]].
