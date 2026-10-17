# Explicit production accounting activation

This policy supersedes historical test-only restrictions in BUSINESS_ACCOUNTS.md.
Accounting remains OFF by default. Keep NODE_ENV=production on Render. Both
BUSINESS_ACCOUNTING_ENABLED=true and BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED=true
are required before OWNER preparation/activation; flags alone activate no shops.
Existing isolated test accounting retains its original flag behavior.

## State, authorization and APIs

Optional Shop.accounting: absent = DISABLED; then PREPARING, ACTIVE or PAUSED.
Records revision, CLEAN_START/RECONCILE strategy, cutoff, setup ID and activation
time. Append-only AccountingActivationEvent records authenticated owner, reason,
request hash and evidence. Indexes: unique (shopId, requestKey); history
(shopId, recordedAt descending, _id descending).

Endpoints under /api/v2/accounts require authenticated same-shop OWNER, valid
subscription and manual access. Server determines shop and actor. CASHIER retains
only existing authorized POS/account selection; ADMIN cannot activate accounting.

- GET /activation: state, revision, strategy, cutoffAt, permitted, latest 30 events.
- POST /activation/prepare: expectedRevision, requestKey, reason, strategy
  (CLEAN_START/RECONCILE), confirmation: PREPARE ACCOUNTING.
- POST /activation/preview: ready, blockers, evidence, expectedRevision,
  previewToken, expiresAt. HMAC binds owner/shop/revision/evidence; five-minute
  expiry. No posting occurs.
- POST /activation/confirm or /activation/resume: expectedRevision, requestKey,
  reason, previewToken, expiresAt, confirmation: ACTIVATE ACCOUNTING.
- POST /activation/pause: expectedRevision, requestKey, reason,
  confirmation: PAUSE ACCOUNTING. Available with server permission removed.
- POST /activation/enroll: expectedRevision, requestKey, reason, accountId,
  amountMinor (nonnegative integer paisa), confirmation: ENROLL ACCOUNT.

Transitions are atomic and claim Shop, conflicting with concurrent posting.
Retry identical requests after uncertain responses; never create another request
key to guess whether money was recorded. Expired/stale previews require review.

## Owner setup and demo policy

Use Existing Business Setup in the OWNER sidebar. Begin preparation, create
cash/bank accounts, save/review/confirm existing setup, then preview readiness
and explicitly activate. Preparation freezes other business mutations so trading
cannot create cutover gaps. Reads/session/account-security stay available.
Starting-point policy can change before opening confirmation only. Confirmed
openings cannot be reset through this workflow.

CLEAN_START never clears records: customer debt and credit must be zero AND
reconciled; supplier receipts need explicit zero-unpaid review. Prior posted
business activity cannot be discarded. Nonzero/unexplained demo balances block
this path. RECONCILE explicitly retains verified genuine balances through existing
setup/cutovers. Unsupported demo cleanup needs separately approved reconciliation.
No fake payments, refunds, sales, investments, historical backfill or migration.

Products/physical stock are preserved. Owner-reviewed inventory value and counted
cash/bank openings use existing opening equity, not revenue or partner capital.
Customer.remainingMoney and existing store-credit records remain authoritative.
Clean-start invoices at/before cutoff stay visible but financially read-only,
preventing old demo refunds/debt changes contaminating active accounts. RECONCILE
keeps verified legacy settlement rules. New source events use LIVE; existing
INTEGRATION_TEST records remain compatible.

ACTIVE uses existing balanced immutable journals and integer-paisa transactions
for routed POS receipts/refunds, supplier Khata/receiving/payments/credits/refunds,
expenses/reversals, partner capital/reversals and history. No second ledger.
Revenue, cash, customer debt, supplier debt and store credit remain distinct.
Activation does not establish complete historical GL or historical COGS/profit.
Clean-start Financial Reports exclude pre-cutoff invoices with an explicit notice.
Original operational Sales and AI histories remain unchanged and can include demo
activity; do not confuse those histories with the new financial opening.

DISABLED shops retain legacy POS. ACTIVE/PAUSED shops never fall back to unposted
sales when flags are off. Pause blocks business mutations; resume requires fresh
readiness. Current legitimate customer debt is not confused with the initial
zero-debt condition on resume. New suppliers remain individually blocked until
opened without preventing global resume. Request-local context cannot select
another shop; transaction writers re-read/claim the authenticated Shop.

## Additional accounts and readiness

Create an unused cash/bank account and enroll it from setup with verified opening
money (zero allowed). Atomic enrollment posts any positive OPENING against existing
opening equity and extends prepared membership. Not a transfer, income or partner
investment: do not count money already held in another prepared account twice.
Used/foreign accounts fail; enrollment is revision-protected and idempotent.
Picker loads the first 100 accounts; larger shops can use an explicit API selection.

Readiness verifies setup, customer/supplier reconciliation, cash memberships,
unique indexes and cash-event/source reconciliation. It never creates indexes.
Guided limits: 1,000 customers, 100 suppliers, 500 accounts, 10,000 invoice events.
Larger/unverifiable histories require separately reviewed reconciliation. Missing
balances stay unavailable, not zero. Coverage excludes unposted legacy activity,
noncash events without journals and incomplete historical inventory valuation.

## Manual deployment and activation

1. Verify Atlas backup/recovery, replica-set transactions/snapshot compatibility,
   and required unique indexes. No paid-tier-only feature is required by this code;
   do not assume backups exist on the chosen tier.
2. Deploy backend with both accounting flags absent/false, then matching frontend.
   Preserve production NODE_ENV, HTTPS, cookies, CORS and frontend API URL.
3. Verify schema indexes have built; readiness fails closed if missing. Index
   management remains deployment/Mongoose-managed, not a data migration here.
4. After explicit approval configure both flags true on Render and restart.
5. Schedule a pause in trading. OWNER reviews one shop's real openings, resolves
   blockers, obtains readiness and explicitly activates.
6. Check controlled POS/customer credit/debt, supplier delivery/payment/refund,
   expenses/capital, statements and reconciliation against actual evidence.
7. For incidents OWNER pauses or server permission is removed. Preserve journals.
   Never roll back to code permitting unposted legacy writes for activated shops.
   Apply a compatible correction and obtain fresh readiness before resume.

No production data/configuration/indexes, deployment or automatic cleanup is
performed by this implementation.
