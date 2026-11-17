# KBI audited order projection digest v1 (draft, not production-approved)

Status: **Draft / BLOCKED**. This contract is only a safety protocol for PR #69 stacked on PR #52; PR #4 does not yet produce this signed-off projection. Neither a READY preview nor a successful unit test constitutes approval to write CRM grades or RFM to Feishu.

## Input and identity

A private, financially reconciled full-history Shopify export must first validate transactions, refunds, original and shop currency, customer/order GIDs, JSONL parent/line relationships, order counts, and seven separately verified high-value customer samples. Do **not** fabricate or infer missing data.

Only validated **effective positive-net merchandise orders** are passed to `projectAuditedLedger` / `digestAuditedLedger` in this shape: `{ id: "gid://shopify/Order/…", customerId: "gid://shopify/Customer/…", processedAt: ISO time, usdNetAmount: positive two-decimal USD number }`. Invalid, refunded, zero-net, ambiguous, or non-audited rows remain in private raw financial evidence, not the effective-order projection. Unknown monetary evidence remains **unknown**, never zero.

`DIGEST_SCHEME` = `kbi-audited-order-projection-v1`. `digestAuditedLedger(rows,{asOf})` converts amounts to exact integer USD cents, normalizes timestamps to ISO 8601, sorts by exact order GID, and calculates SHA-256 over JSON of `{ scheme, asOf, rows: [[orderGid,customerGid,processedAtIso,usdNetCents],…] }`. Source page order is irrelevant, while every contributing amount, identity, timestamp, and cutoff is bound to the digest.

## Deployment controls

The dedicated producer must publish a private **all-history** stage with `sourceType="full_history_shopify_net_usd"`, `fullHistoryNetUSD=true`, `rolling180dFromSameLedger=true`, `since=null`, `financialLedgerDigestScheme=DIGEST_SCHEME`, `financialLedgerDigest`, and `ledgerAsOf`. The current rolling-180d `orders-stage-state.json` must **not** be relabeled or overwritten to mimic a full-history ledger. Use new namespaced private paths and an explicit migration after separate UAT, leaving previous checkpoints intact.

An independent finance audit and finance-owner approval must both carry the same projection digest, scheme, policy version `2026-11-12`, exact source cutoff, and at least seven audited customer identities. **Source digest is tamper-detection, not independent proof of refund or FX correctness.** Server-only `CRM_FINANCE_WRITEBACK_APPROVED=true` is a final explicit operator switch, not an audit substitute.

Every attempted Feishu batch must recompute the digest from the current private effective-order pages **before reading or reusing the write manifest and before obtaining a Feishu token**; changed pages return `409 audited_ledger_digest_mismatch`. Stale checkpoint/manifest source digest or approval identifiers block replays. No admin UI, public file, log, or API should expose raw customer data, sample IDs, tokens, private blob paths with secrets, or approval documents.

## Outstanding blocker

PR #4 currently outputs `AUDIT_ONLY_NOT_APPROVED_FOR_RFM` or `BLOCKED_FINANCIAL_EVIDENCE_INCOMPLETE`. A validated, private financial ledger producer and independent signed review are still missing. **Do not enable production writeback.**
