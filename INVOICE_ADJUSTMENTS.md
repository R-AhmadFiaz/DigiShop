# Invoice adjustments — backend portion 3: local API integration

## Release boundary

Financial HTTP adapters are now mounted for OWNER only, using verifyJWT,
verifyShopUser and verifyOwner. Core functions remain shared by those adapters and
replica tests. Public mutation requires a server preview confirmationToken, expected
revision and idempotency key. No frontend was changed and nothing was deployed.
The backend is ready for local frontend integration, not a complete production UI.

Existing cash-only POS and quotation conversion retain their financial behavior.
POS creation additionally accepts optional `creditAmount` (PKR) with an identified
customer and `requestKey` (8–100 word/hyphen characters). This uses the existing
authenticated OWNER/CASHIER route, transactional redemption and replay protection.
No frontend sends that option yet. All wallets default to zero. Public issuance is
allowed only as a confirmed OWNER refund/adjustment/cancellation, never as a free
wallet top-up. No migration, seed or historical rewrite runs on startup.

Legacy cancellation remains unchanged for untouched cash invoices. Invoices with
settlementState or nonzero revision get 409 from that route, before stock changes,
because silently using its old 'refund separately' behavior would bypass settlement.
The confirmed cancellation route accepts pending invoices only, restocks only their
remaining units, settles net funding and records a dated cancellation. Delivered
invoices use full returns. Permanent shop deletion now includes adjustment records.

## Local HTTP contract

All paths below are under /api/v2/orders, require active subscribed shop access, and
are OWNER-only. CASHIER cannot read invoice history, reporting or use these mutation
or preview endpoints. ADMIN cannot use shop routes.

- GET /:orderId: existing data.order preserved; additionally returns originalSnapshot
  (null when unavailable) and eligibility (revision, adjustmentEligible,
  paymentEligible, cancellationEligible, originalSnapshotAvailable, reason).
  Legacy response lines receive deterministic legacy-N identifiers without saving.
- GET /:orderId/history?page=1&limit=20: immutable history and bounded pagination;
  optional kind=SALE|ADJUSTMENT|PAYMENT|CANCELLATION or exact requestKey for recovery.
  The response excludes internal requestHash. Read is a consistent transaction.
- GET /sales-summary?period=today|thisMonth|lastMonth: UTC originalSales,
  adjustments, total (net sales), original invoice count, dated event count and
  legacyCancelledExcluded. This is invoice value, not money collected.
- POST /:orderId/adjustments/preview then POST /:orderId/adjustments.
- POST /:orderId/payments/preview then POST /:orderId/payments.
- POST /:orderId/cancellations/preview then POST /:orderId/cancellations.

Use the portion-2 input fields plus requestKey, expectedRevision and reason. For
adjustments send returns and additions arrays. Payment and cancellation use empty
arrays; cancellation returns all remaining units as RESTOCK. Payments may not edit
discounts/items or issue refunds. Cancellation applies only to PENDING invoices.

Preview returns before, proposed, movements, requirements, settlement, canSubmit,
validationMessage and confirmationToken. Requirements show refundable cash funding
after mandatory credit restoration. If refund allocation is incomplete, preview
returns canSubmit=false with no token. Preview NEVER writes even temporary ledger
or customer changes. Prices and balances are read from the authenticated shop.

Submit the same operation with the returned confirmationToken. The token binds
revision, status, item prices, quantities, disposition and monetary settlement;
it grants no authorization. New addition line IDs are provisional in preview and
are generated on commit. Changed prices/status/revision or invalid wallet/stock
requires reviewing a new preview. A failed or lost response is recovered by retrying
the IDENTICAL requestKey/body/token or reading history by requestKey, not creating a
new key blindly. Mutation returns data.event; GET detail supplies current state.

Existing GET /api/v2/customers/ remains OWNER/CASHIER accessible and now selects
storeCreditBalanceMinor separately from remainingMoney (PKR debt). No customer
payment history or owner financial summaries are exposed through that route.
Financial reads, previews and mutations send Cache-Control: no-store.

## Dated reporting

AI sales/compareSales/unitsSold/topProducts/productRevenue use the same scoped
reporting pipelines as the summary read. Base sales use originalSnapshot values
and order.createdAt; legacy active invoices without a snapshot use their stored
values. Dated ADJUSTMENT/CANCELLATION events add salesDeltaMinor on occurredAt.
Payments, SALE funding records and wallet/refund movements add no sales revenue.
Product quantities and gross revenue use original lines plus dated ADD/RETURN
movements, regardless of RESTOCK versus DAMAGED. Gross product revenue is before
invoice discounts; sales totals include invoice discounts. Return-only periods can
correctly have negative net sales or product quantities. UTC boundaries are retained.
Reporting aggregation uses snapshot read concern so one report cannot combine
different transaction states across invoices and events. This requires MongoDB 5.0+
on a replica set/sharded deployment; real verification here used MongoDB 8.3. Check
that production supports it before deployment. New reporting/history indexes must
also be built before production release.

New legacy cash cancellations record cancelledAt and cancellationMode=LEGACY in
their existing transaction. Reporting keeps their base sale on the creation date
and subtracts it on the recorded cancellation date, without guessing any external
cash refund. Settled cancellations use their history event and are not double-counted.
Old untimed cancellations remain excluded as before, with a disclosure count for
affected original-sale periods; neither updatedAt nor creation date is substituted
for a missing cancellation date. No historical documents are backfilled.

## Accounting contract

All new calculations use PKR paisa (100 minor units per rupee). Monetary inputs must
be finite, nonnegative, within safe integer range and representable in paisa. Binary
noise such as 0.1 + 0.2 is accepted; meaningful sub-paisa legacy values are rejected
for verified reconciliation. Percentage discounts are calculated using integer basis
points and BigInt multiplication, rounding half-up once at invoice level. Fixed
discounts are retained unless explicitly replaced, and may not exceed subtotal.

Required invariants:

- totalMinor = subtotalMinor - discountMinor
- totalMinor = netSettledMinor + dueMinor
- outstanding debt and store credit are separate, never a signed shared balance
- refund liability = max(0, prior net settlement - revised total)
- due = max(0, revised total - prior net settlement)
- credit-funded refundable amounts must be restored to credit before cash

`settlementPlan` and `financialSettlement` are pure calculations. Transactional
`settleInvoice` records payments, refunds, debt and wallet changes using those rules.
Net settlement = cashNetMinor + creditNetMinor. Cash net = opening cash + additional
cash - cash refunds - cash-funded credit issued. Credit net = opening credit + credit
redeemed - credit restored. The original snapshot remains unchanged.

`paidAmount` represents current net settlement (cash plus applied credit), not a
replacement for payment history. Additional cash, refund and credit movements have
immutable event records. Physical cash handover must still be confirmed by an OWNER;
MongoDB cannot physically issue a refund or verify that cash was received.

Internal settlement inputs are `cashReceivedAmount`, `creditRedeemedAmount`,
`cashRefundAmount`, `creditIssueAmount` (all PKR, nonnegative paisa-representable),
and optional same-shop `creditRecipientId`. Cash refund + optional issued credit
must exactly equal refundable cash funding AFTER mandatory credit restoration.
Payment cannot exceed the revised outstanding balance. Anonymous additions must
remain fully settled. A recipient can be attached only when issuing credit and can
never replace the original customer or previously recorded recipient.

Customer.remainingMoney is outstanding debt in PKR, never a wallet. The separate
storeCreditBalanceMinor is integer paisa. Ledger rows distinguish DEBT and CREDIT;
missing classification means legacy debt. New rows include signed amountMinor plus
compatible PKR amount, event reference, authenticated actor and invoice reference.
Credit redemption conditionally decrements the wallet inside the invoice transaction.
Credit cannot be spent by issuance in the same operation. No automatic cross-invoice
debt netting occurs. Global customer balances, per-invoice debt, payment funding,
event revision chains and linked credit movements must reconcile before changes.

## Core and history

OWNER identity and membership are checked using the supplied authenticated actor
(future route must pass req.user, never req.body). Shop manual access and subscription
checks are repeated within the transaction. Every invoice/product/customer/ledger
lookup is scoped to that shop. CANCELLED and non-invoice documents are rejected.

Returns reference stable line IDs (legacy line references are deterministic legacy-N
until successfully adjusted). Existing units retain historical prices. Additions get
fresh line IDs and current server product prices, even for the same product. Return
disposition is mandatory. RESTOCK increases sellable stock; DAMAGED creates a zero-
delta audit log with its returned quantity. Gross returns/additions are logged
separately rather than only storing net product differences.

The transaction reconciles settlement and claims the expected invoice revision/status,
conditionally adjusts stock, writes customer/ledger changes and creates one dated
adjustment record. Payment events use the same history with no stock movements. A scoped unique
request-key index plus request hash provides replay protection. POS credit sales also
have a unique shop/kind/request-key index. These indexes must exist before release.
Same-key/different-
request conflicts and concurrent write conflicts return 409; no automatic financial
retry is performed. Caller may retry the identical key after reloading/reconciliation.

Adjustment records are append-only through ordinary Mongoose save/update operations.
Direct collection writes/database administrators are outside this application-level
guard. Original snapshots are immutable through ordinary model updates; the internal
core permits a one-time snapshot only when missing, protected by the revision claim.
Unbounded history is not embedded in the invoice document.

## Legacy restrictions

Old invoices remain readable as before. On successful internal adjustment, an old
invoice receives a labelled LEGACY_BASELINE snapshot; this is not a claim to recover
missing historical data. Totals, discount value and recorded debt must reconcile.
Legacy converted-invoice customer references and missing percentage values are
rejected rather than guessed. Newly converted invoices now retain the customer and
discount value already verified during conversion, without changing conversion
prices, payment, inventory or adding credit redemption. Prior externally collected payments/refunds cannot be
inferred. New creation/quotation conversion calculations are not switched to the new
rounding rules in this portion; incompatible legacy/newly created old-flow amounts
are therefore blocked by the core, not silently changed.

## Verification

Unit/planner tests: `node --test tests/invoice-adjustment.test.mjs` after build.
Real transaction tests: `node --test tests/invoice-adjustment-replica.test.mjs`.
The replica test starts the installed Windows MongoDB 8.3 binary in a fresh temporary
directory on an unused loopback port, initializes a single-member replica set and
uses only digishop_adjustment_test. It never reads MONGO_DB_URI or app startup. It
skips explicitly when that executable is absent. The process and its verified
temporary directory are removed on completion. Run `npm test` for full regression.

## Remaining work before production release

- Verified legacy customer/discount/payment reconciliation rather than inference.
- OWNER editor, settlement confirmation and receipt/revision printing UI.
- Frontend credit redemption (backend POS support is complete), end-to-end release
  checks, durable response/replay UX and operator confirmation of cash movements.
- Credit redemption during quotation conversion remains intentionally unsupported.

Refund/payment/credit/cancellation cores and real replica-set tests are implemented.
Reporting and protected read/preview/mutation APIs are implemented. Frontend and
production end-to-end operator verification remain unfinished. Legacy ambiguity
still blocks mutation instead of guessing missing payment/discount/customer history.
