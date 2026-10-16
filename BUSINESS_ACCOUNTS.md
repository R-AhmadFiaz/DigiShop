# Business Accounts & Ledger — Phases 1, 2A and 2B

Backend foundation, internal primitives and disabled shop write-path adapters.
No live accounting, purchase posting, supplier payments, frontend, migrations or
production data changes. Phase 2C below supersedes earlier coverage limitations.

## Existing sources of truth

Customer._id remains the financial customer identity used by orders, adjustments,
CustomerLedger and store credit. Customer.remainingMoney is outstanding debt in
PKR; storeCreditBalanceMinor is a separate integer-paisa liability. Existing
invoice settlement, history, refunds, stock logs and dated reporting are unchanged.
Existing Product.brand remains a string; no company or supplier is inferred from it.

BusinessEntity links at most one existing Customer, with one unique linked profile
per shop/customer. Customer details are resolved live rather than copied. A supplier
or manufacturer can also become a customer through an explicitly confirmed link;
the existing Customer ID and balances never change. The service does not create
Customer records or guess RETAIL/WHOLESALE classification. Standalone parties do
not pollute existing customer searches. A stable shop-local identity key prevents
request duplicates; spelling/name similarity cannot establish real-world identity.
Future identity matching/merging requires explicit review.

## Accounts and authority

FinancialAccount classifies CASH, BANK, CUSTOMER_RECEIVABLE, SUPPLIER_PAYABLE,
STORE_CREDIT_LIABILITY, INVENTORY, REVENUE, EXPENSE and OPENING_EQUITY.
Cash/bank and general accounts belong to the shop; receivable, payable and credit
accounts belong to a shop entity. One account per entity/kind prevents duplicate
party balances. Multiple named cash/bank accounts are allowed by unique account code.

Receivable and credit accounts have LEGACY_CUSTOMER authority: reads reuse
checkedCustomer reconciliation and existing ledger entries. New journal postings
and opening balances against them are prohibited. No customer balance is copied,
netted, imported or maintained twice. Inconsistent historical balances fail closed.
Supplier payable is separate even when the same party is also a customer.

JOURNAL balances are derived from postings, with no cached money field. These
accounts are NOT complete live business balances until source adapters and an
approved cutover exist. Phase 1 cannot claim that all current cash or stock is
accounted for. An INVENTORY journal account is financial classification only and
does not change stock or constitute a purchase workflow.

## Journal and precision

BusinessTransaction embeds 2–100 balanced postings atomically in one immutable
document. Each posting has one positive debit OR credit, and an account appears
once. All amounts are nonnegative safe-integer paisa; totals and balances use
BigInt, Decimal128 aggregation and checked conversion back to safe integers.
Existing PKR numbers use the existing moneyMinor utility: binary rounding noise
is tolerated, meaningful sub-paisa amounts are rejected rather than rounded silently.

Sources currently supported: MANUAL (the journal's own ID), OPENING (target account
ID), REVERSAL (original journal ID), TRANSFER (the journal's own ID),
INVOICE_RECEIPT and INVOICE_REFUND (verified immutable InvoiceAdjustment ID).
No public invoice/purchase adapter is enabled. Unique shop/request key plus canonical payload hash gives exact replay
or conflict; unique shop/source kind/source ID prevents duplicate openings/reversals.
Actor ID/name come from the verified database user, not supplied name snapshots.
Occurrences use explicit canonical UTC ISO dates; actual recording time is separate.
Postings cannot predate an affected account's last posting, and cash/bank cannot
become negative. This conservative ordering policy avoids retroactive cash deficits;
future backdated imports require a separate reviewed reconciliation policy.

Statements are shop/account scoped, oldest-first by occurrence/ID, with bounded
pages (maximum 100), opening and running balances. Date range is inclusive start,
exclusive end. Current balance is separate from range opening/running values.
Legacy statement reconciliation retains existing full-ledger scanning; returned
pages are bounded, but large legacy histories may need optimization later.

Save/update/delete/bulk mutations of posted history are rejected by model hooks.
Corrections append an exact inverse linked to the original; originals remain intact.
Only one reversal is permitted, and a reversal cannot itself be reversed. A corrected
replacement is a new transaction. Direct database access can bypass application
hooks; deployment DB permissions and controlled maintenance remain necessary.

## Transactions and opening balances

Internal service calls require an active transaction and a verified OWNER who
owns the same active, subscribed shop. businessTransaction uses snapshot reads,
majority writes, commits/aborts and controlled conflicts. Writes claim existing
shop metadata and account revisions to serialize concurrent activity and conflict
with permanent deletion/deactivation. Unknown commit outcomes must be reconciled
or replayed with the IDENTICAL key/payload, never a new key.

Opening balances require the exact owner confirmation, reason, cutoff timestamp,
positive verified amount and an OPENING_EQUITY contra-account. Only unused target
accounts accept an opening. Zero needs no fabricated transaction. Opening equity
is not sales revenue and cannot be used in ordinary manual journals. Debt/credit
opening imports are disabled; they require an approved customer reconciliation
and integration cutoff to prevent counting existing balances twice. No historical
activity is invented by Phase 1.

Future adapters must pass the SAME session to stock, document, settlement and
journal writes. Credit sales debit receivables, not cash. Credit purchases credit
payables, not cash. Issuing store credit creates a liability, not a cash withdrawal.
Actual payments/refunds alone move cash/bank; do not post the sale again on payment.
Existing store-credit-funded invoice accounting must be mapped explicitly before
enabling any adapter. Preserve document source/revision keys for reconciliation.

## Brands, deletion and indexes

BusinessBrand is distinct from parties and can optionally link several same-shop
companies. ProductBrandLink is an optional sidecar for existing products; links
require matching brand text and become inactive when that text changes. It makes
no assumption that a manufacturer is the purchasing supplier.

All indexes are declared on the new schemas: unique shop/entity key and customer
link; unique shop/account code and entity/kind; unique shop/journal request and
source; journal date/account statement indexes; unique shop/brand name and product
link. Real tests explicitly create indexes. No production index creation or migration
was executed. Verify/build these indexes before future route enablement if production
disables autoIndex.

Existing ADMIN permanent deletion of an explicitly deactivated shop also removes
these five collections within the existing transaction. Raw journal collection
deletion is used only for that existing whole-shop destruction exception; ordinary
ledger deletion remains forbidden. Other shops and platform ADMINs remain protected.

## Next phase

Agree on account setup, verified opening cutoff and legacy reconciliation. Design
one-to-one invoice/revision/payment/refund adapters with atomic writes and unique
source keys, including precise store-credit mapping and backfill exclusion. Then
implement purchase/inventory/payable posting and supplier payments in separately
tested stages. Add public OWNER APIs and UI only after integration is validated.

## Phase 2A — reconciliation and prepared cash/bank integration

### Authority map and reconciliation

* Outstanding customer debt: existing Customer.remainingMoney, reconciled against
  signed DEBT CustomerLedger rows (missing balanceType means legacy DEBT).
  It must also agree with identifiable outstanding invoice amounts. Do not create
  another receivable balance in BusinessTransaction.
* Store credit: existing Customer.storeCreditBalanceMinor, reconciled against
  CREDIT CustomerLedger rows and invoice credit issuance/redemption/restoration
  events. It is not cash and never offsets displayed customer debt automatically.
* Current invoice obligation and funding: Order and originalSnapshot, revision
  sequence and immutable InvoiceAdjustment financial history, validated through
  verifiedInvoiceFunding. paidAmount includes both money and redeemed credit;
  cashNetMinor can fall on credit issuance without physical cash leaving the shop.
* Financial activity dates and actor: InvoiceAdjustment.occurredAt and its stored
  actor; business journal recordedAt is separate. Original sale dates stay intact.
* Sellable inventory: Product.stockQuantity and existing StockLog/adjustment item
  movements. New financial journal accounts do not replace those records.
* Cash/bank: no authoritative pre-existing balance or bank routing exists. Only
  verified owner openings and newly source-linked money movements establish these
  new balances. They remain incomplete until all production adapters are connected.

reconcileBusinessCustomer is read-only: it checks customer/ledger balances, linked
invoice funding and per-invoice debt, returning discrepancy codes, never fixes.
It flags orphan/foreign invoice references and ambiguous converted invoices.
Legacy cancellation reversed ledger debt but left old invoice amountDue intact;
cancelled legacy debt is zero for reconciliation, not a fresh receivable. Its old
paidAmount is NOT proof of a cash refund: a paid legacy cancellation is flagged
LEGACY_CANCELLATION_CASH_UNKNOWN. Unsupported money precision fails closed.
These checks retain the existing full-history scan; this is an internal diagnostic,
not a new public bulk reporting endpoint.

### Prepared cutoff and openings

Create named cash/bank accounts and one shop-local SETTLEMENT_CLEARING account.
SETTLEMENT_CLEARING is a migration/settlement control account, NOT customer debt,
store credit, revenue or spendable cash. It holds the other side of physical
invoice receipts/refunds while customer balances remain in the legacy ledger.
It can be negative (e.g. refund of a pre-cutover payment); cash and bank cannot.
Its balance must not be used as a customer statement, sales report or full general
ledger. Never plug its balance into revenue. A later full-GL cutover needs explicit
mapping/reconciliation, not a second posting of receipts or historical balances.

Owner-confirm positive opening balances against OPENING_EQUITY using the existing
recordOpeningBalance. All selected openings must occur at the SAME canonical UTC
cutoff, and no other activity may precede preparation. prepareCashBankCutover
requires exact PREPARE CASH BANK CUTOVER confirmation, explicit selected accounts
and their owner-confirmed integer-paisa balances. Zero openings require explicit
zero confirmation but no fabricated zero journal. Preparation locks each selected
account to the clearing account and cutoff, recording actor/time and revision
claims; replay accepts only identical cutoff, accounts and original opening amounts.
Existing generic manual postings/openings cannot bypass prepared-account controls.
Prepared openings cannot be reversed silently. Transfers are allowed only between
distinct prepared accounts of that same cutover.

The configuration is PREPARED ONLY. No LIVE state, activation endpoint, background
posting, account defaults or production-controller calls exist in Phase 2A.
Preparation is not proof that operational cutover is safe. Do not run it on
production as an activation substitute.

### Event adapters and directions

Internal services (all require a verified OWNER and the caller's active transaction):

* selectCashBankAccounts: bounded same-shop selection; never guesses a bank/till.
* prepareCashBankCutover: records validated prepared opening/cutoff evidence.
* postInvoiceCashMovement: takes eventId, selected cashAccountId, RECEIPT/REFUND and
  requestKey. It fetches and validates the SAME-SHOP immutable event and complete
  current invoice funding. Amount, date and reason come from the source, not caller
  amounts. Receipt: debit cash/bank, credit clearing. Refund: debit clearing,
  credit cash/bank. Each direction has its own unique source kind/event ID, preventing
  duplicate postings under a different request key or into another bank/till.
* transferCashBank: debit destination, credit source for positive integer paisa;
  stable request key/payload, no revenue or clearing movement, no negative funds.
* reconcileCashBank: paginated event-to-journal coverage, amount/direction/date
  validation, orphan journal/undated event detection, current cash/bank balances, and missing
  initial SALE-event counts. Missing, mismatched or invalid records are returned,
  not automatically posted. Results are page-scoped, never a global certification.

Only event.cashReceivedMinor/cashRefundMinor create physical money postings.
creditIssuedMinor/creditRedeemedMinor/creditRestoredMinor create NONE. A zero-cash
direction returns NO_CASH_MOVEMENT and creates no fake journal. Refunds of credit
funding follow existing settlement priority; only the actual cash refund is posted.
Source-linked cash entries cannot be independently reversed: corrections must be
authorized invoice settlement events to avoid disagreement with funding history.
Normal transfer reversal remains supported through the existing reversal service.

Pre-cutover events (occurredAt < cutoff) are rejected, not backfilled. A pre-cutover
invoice can receive a post-cutover payment/refund: post ONLY that new event, not its
original paidAmount or total. A revision/history/legacy mismatch stops posting.
Current chronological account restrictions still apply: do not batch old events
after newer cash activity. Reconcile/drain in date order or stop for review.

### Atomic adapter contract, retry and gaps

Future controllers must write settlement/customer ledger, invoice revision, item
stock/log changes, immutable event AND cash journal within the SAME session and
commit. The primitive intentionally does not create a second transaction. Do not
call it after a production invoice transaction commits and call that atomic. Tests
compose the real existing settleInvoice utility and real database writes in one
transaction; this is an integration harness, not public-controller completion.

Use the financial operation's stable key/revision for invoice idempotency and a
stable derived direction-specific cash key; also enforce unique event/direction
sources. On uncertain commit, query/replay the IDENTICAL operation, account, date
and key. Never retry with a new event ID/new operation key. Unique source protection
is not a replacement for invoice idempotency. Balance updates and journal insertion
roll back together; account revision and shop claims prevent concurrent overdrafts.

reconcileCashBank reports missing initial payment events because ordinary cash-only
sale creation and quotation conversion currently lack immutable SALE funding
events. It cannot infer a payment date/channel from current paidAmount. Production
adapters and immutable source events for those paths, and handling of legacy
cancellation, are REQUIRED before enabling live accounting. Existing routes remain
unchanged and their current behavior continues during this phase.

### Required operational/business decisions before live enablement

1. Approve the selected tills/banks, real counted opening amounts and UTC cutoff.
   The old cashReceivedAmount field has no bank instrument: new payment UIs/APIs
   must explicitly choose a validated same-shop account. Never assume historical
   receipts were bank deposits or current cash still equals all past receipts.
2. Reconcile customer ledgers, invoice amounts, refunds and credit; unresolved
   legacy mismatches block the affected invoice/account. Do not invent missing
   payments, cash refunds, timestamps or store-credit obligations.
3. Pause financial writes across ALL shop sessions, drain in-flight requests and
   uncertain commits, deploy ALL source adapters and build/verify unique indexes.
   Confirm openings immediately BEFORE accepting the first new event at/after the
   cutoff. The PREPARED timestamp alone cannot prevent an old controller or in-flight
   transaction from crossing that barrier. No automatic live toggle is supplied.
4. Validate coverage of sales, conversion, payment, adjustment, refund, cancellation
   and credit-funded variants. Reconcile every page and all initial-event/orphan
   counts. Verify external bank/cash counts independently. Resume only with an
   approved rollout/rollback plan; never run old non-posting writers alongside live
   adapters. Missing events after the cutoff must stop activation, not become an
   inferred historical import.

Next implementation: add explicit payment-account selection and one atomic adapter
to each existing write path, starting with sale/payment, then returns/cancellation
and quotation conversion. Include same-transaction SALE event creation and gap
checks. Keep debt/credit authoritative in the existing ledger until a separately
approved full-GL reconciliation/cutover. No production activation is safe yet.

## Phase 2B — OWNER financial writers, test-only integration

### Feature gate and compatibility

BUSINESS_ACCOUNTING_ENABLED is OFF by default (only the exact string `true` opts
in). Even when set, NODE_ENV must be `test`; non-test environments reject financial
writers with controlled 503. No environment files were changed. There is still no
LIVE cutover state, activation route or production enablement mechanism. The flag
is exercised only in disposable replica-set tests, not against real shops.

With the flag absent/false, ordinary existing sales, store-credit POS, conversion,
returns, payments and cancellation follow their existing calculations and routing
without new account requirements or initial cash-sale events. Body account fields
are ignored in that mode. An invoice already touched by enabled integration has
accountingMode=INTEGRATION_TEST; disabling the flag locks its further previewed
financial mutations rather than silently permitting an unposted adjustment. Legacy
cancellation already rejects its settlementState. This protects test cutovers;
it is not a complete production downgrade procedure.

### Actual write-path inventory and implemented coverage

| Existing operation | Financial effects | Phase 2B enabled test-mode behavior |
| --- | --- | --- |
| OWNER direct/POS invoice, retail/wholesale | Actual money received; optional debt and credit redemption | Integrated in original sale transaction; new immutable SALE event, source-linked receipt for money only |
| OWNER quotation conversion | Money received and optional customer debt | Integrated; new SALE event references sourceQuotationId; quotation claim, stock, debt, counter and receipt commit together |
| Invoice payment | Additional money and/or existing credit redemption; reduced debt | Integrated through existing OWNER payment core |
| Return, exchange, add/remove items, discount adjustment | Stock, invoice value, debt reduction/addition, optional money received/refund, credit issuance/restoration | Integrated through existing OWNER adjustment core; original pricing and settlement equations unchanged |
| Previewed settlement-aware cancellation | Remaining stock restoration, outstanding debt reversal, settlement refund/credit | Integrated through same existing OWNER core |
| Old PATCH invoice/cancel | Legacy stock/debt reversal without verified physical cash-refund history | Rejected in enabled mode; use previewed settlement-aware cancellation, which still rejects ambiguous funding |
| CASHIER sale or quotation conversion | Money/debt/credit | Explicitly unsupported and rejected before writes in enabled mode; normal disabled-mode permissions/workflows unchanged |
| Quotation creation/status-only updates | No physical money movement | Existing behavior; no cash journal |
| Customer creation/profile | Zero initial balances or identity data | Existing behavior; no fabricated financial event |
| Internal owner openings/transfers | Confirmed opening equity or money moved between tills/banks | Existing Phase 1/2A services; no new public API |
| Supplier purchase/payment, free-standing customer collection or credit issuance | Not existing supported write paths | Not added; no inferred postings |
| ADMIN subscription/payment management | Platform access control, not shop cash | Unchanged and excluded |

Customer payment collection currently means payment against a specific invoice;
there is no separate customer balance-collection endpoint. Inventory-only manual
stock adjustments do not prove a cash purchase and create no cash journal. Existing
customer debt and store-credit records remain the sole authority; the settlement
clearing account is not a second customer balance or revenue account.

### Request/source contract in enabled local tests

Use existing endpoints, not new financial routes. All sale/conversion requests
require a stable 8–100 character requestKey. Existing adjustment/payment/cancellation
revision, reason, preview and request-key requirements remain.

New optional request fields are receiptAccountId and refundAccountId. Each positive
money direction requires its explicitly selected same-shop prepared cash/bank
account. A zero-money direction must omit its account. Do not infer an account from
the last sale, owner, shop, cashReceivedAmount, or the first available bank. Combined
cash plus store-credit payment is supported in POS/payment where previously supported;
credit redemption on quotation conversion remains unsupported and is explicitly
rejected in enabled mode. There is no arbitrary split between two bank/cash accounts
for a single money direction in this portion.

Preview tokens bind routing as well as the existing financial/stock proposal;
changing an account requires another preview. New immutable event.cashRouting stores
server-validated account selections and test provenance. Direct-sale and conversion
request hashes bind routing too, so retrying the same key against a different bank
does not create another payment. Prices, amounts, shop and actor are never taken
from client-supplied journal postings or creator fields.

Initial SALE events are created only with a NEW enabled invoice, even when initial
payment is zero; they record actual creation time and funding, not historical guesses.
For POS credit funding the existing credit-redemption event ID is reused, preserving
CustomerLedger linkage. Conversion creates a separate invoice/event and retains the
quotation creator. A new partial-payment conversion retains its customer/debt linkage.
The per-shop/invoice unique SALE index supplements existing request and journal-source
indexes. Audit existing duplicates before building it in any future deployment; do
not delete or consolidate historical events automatically if index creation fails.

No initial events are backfilled when a legacy invoice is adjusted. A pre-cutover
invoice with verified funding can receive a new post-cutover payment/refund; only
the actual new money is posted. A post-cutover invoice without one integration-created
initial SALE event is rejected for reconciliation, including an old credit-sale event
that lacks integration provenance. Missing initial history is not silently repaired.

### Atomicity, retries and reconciliation

The adapters use the existing controller session. Enabled writers use snapshot reads
and majority writes; the business writes, source event and journal complete before
the same commit. The low-level journal does not start or commit a separate transaction.
Source creation refuses calls without an active transaction. Cash/bank balances
cannot go negative. Existing invoice revision, stock, credit, debt and account claims
remain effective; failure of the final journal insert rolls back everything earlier.
Conversion reloads/claims the DRAFT quotation within the transaction in enabled mode,
preventing concurrent conversion from decrementing stock or collecting money twice.

Stable source-derived receipt/refund keys plus unique source indexes protect the
cash journal; original operation idempotency prevents duplicate business writes.
Conflicts return 409. Unknown commit outcomes return controlled 503 guidance: check
or retry the IDENTICAL operation/key, never a new operation key. A replay returns
the existing result without trying to reconstruct missing journal records. Actual
network/failover unknown-commit injection is not claimed by the local tests; the
retry classification is tested and real duplicate/concurrent commits are exercised.

reconcileCashBank now checks duplicate journals per source/direction, immutable route
versus posted account, missing/duplicate initial SALE events, converted-quotation
source links, and the existing date/amount/funding/orphan checks. It remains paginated,
read-only and PREPARED, with livePostingEnabled=false. It never fixes a missing event
by interpreting current paidAmount as a new receipt. Coverage of disabled-mode
activity is intentionally reported as incomplete. The new single-initial-SALE index
prevents duplicates; diagnostics also detect them if required indexes were absent.

### Remaining gaps and safe future activation plan

This is a coherent OWNER integration subset, NOT production-ready live accounting.
Before a later release can introduce live enablement:

1. Add a narrowly authorized CASHIER POS adapter and cashier-safe account selection
   without exposing balances/owner financial management. Do not impersonate OWNER
   to reuse the current posting services. Test credit-funded and anonymous variants.
2. Add frontend account selection/preview routing, explicit cash-refund confirmation
   and stable sale/conversion retry handling. Existing frontend remains untouched.
3. Review till/bank setup, customer reconciliation, legacy cancellation ambiguities,
   precision discrepancies, and all required unique indexes. No historical writes
   or invented refunds are allowed. The current ledger is a cash subledger bridged
   to legacy settlement, not a full-GL replacement or supplier purchasing system.
4. Design an approved per-shop LIVE transition and enforce it across every writer.
   Do not merely remove the NODE_ENV safety guard or set the global flag. Freeze
   financial requests, drain uncertain/in-flight operations, confirm real openings
   and UTC cutoff, deploy every required adapter, reconcile all pages and external
   cash/bank evidence, and only then resume the approved shop cohort.
5. Prepare an explicit downgrade procedure: stop writers and reconcile committed
   events before changing flags/code. Never blindly switch to old non-posting writers
   or resubmit an uncertain initial sale using a new key. Test-mode locking alone
   does not make mixed-version production writers safe.

Real tests use fresh loopback MongoDB replica sets and actual HTTP controllers;
they verify persisted invoices, stock/logs, customer debt/credit, event history and
cash journals, including late database failures, concurrent submissions, conversion
and idempotent replays. No production URI, migration, deployment, secrets change,
new dependency or frontend change is part of Phase 2B.

## Phase 2C: complete existing financial write-path coverage (local tests only)

This section supersedes the Phase 2B CASHIER and quotation-credit limitations.
BUSINESS_ACCOUNTING_ENABLED remains disabled by default. Setting it to true is
accepted only with NODE_ENV=test; production enablement is still rejected.

### Supported flows and permissions

| Existing operation | OWNER | CASHIER | Accounting coverage |
| --- | --- | --- | --- |
| POST /api/v2/orders/create-order | Yes | Yes | Initial SALE source; actual cash/bank receipt and optional credit redemption |
| PATCH /api/v2/orders/:quotationId | Yes | Yes | Initial SALE source; actual cash/bank receipt and optional credit redemption |
| Preview/submit invoice payments | Yes | No | Additional cash/credit settlement, source-linked receipt |
| Preview/submit invoice adjustments | Yes | No | Returns/exchanges, debt reduction, cash refund and credit issuance/restoration |
| Preview/submit settlement cancellation | Yes | No | Settlement-aware stock/debt/credit/refund reversal |
| Account setup, opening balances, transfers, statements/reconciliation | Yes | No | Existing internal services; no public management mutation APIs |

CASHIER posting requires a server-created SALE event attributed to that exact
same-shop authenticated cashier and invoice. Stored createdByRole records the
historical role; no owner impersonation or current-viewer identity is used.
Cashier SALE events cannot issue credit, restore credit or refund cash. Existing
route permissions for adjustments, later payments and cancellation remain OWNER-only.
ADMIN cannot operate a shop's financial workflows.

Quotation conversion accepts creditAmount (PKR number) in enabled mode, matching
POS naming. paidAmount remains actual cash received; invoice paidAmount records
cash plus redeemed credit. The existing quotation prices, discount and total are
preserved. Credit requires a verified same-shop customer and sufficient wallet
balance. Redemption uses the initial SALE event ID in the existing customer ledger,
inside the same transaction as invoice creation, debt, stock and cash postings.
creditRedeemedAmount is not an alternative request field. Credit-only conversion
has no cash receipt posting or receipt account. With accounting disabled, existing
cash-only conversion behavior remains unchanged; no new credit redemption is enabled.

### Explicit routing and active accounts

GET /api/v2/orders/payment-accounts uses existing JWT and verifyShopUser checks,
including subscription and manual shop access. OWNER/CASHIER receive only _id,
name and kind of active CASH/BANK accounts configured in the prepared same-shop
cutover. No balances, postings or owner management information are returned.
Disabled mode returns accountingEnabled=false and an empty accounts array.
Enabled mode still requires a prepared clearing account; no account is guessed.

FinancialAccount.isActive defaults to true. Missing legacy values remain active;
explicit false prevents new postings and removes the account from selection.
An inactive clearing account also prevents new posting. OWNER can still read
historical balances of inactive accounts. No public account-status mutation API
was introduced. Positive cash directions require an explicit same-shop prepared
account; zero directions must omit it. No arbitrary multi-bank split is supported.
Preview tokens and operation hashes bind routing; changing selection requires a
new preview. Accounts are revalidated on submission. Successful replay returns the
original result without reposting, even if its account was subsequently disabled.

### Coverage audit and reconciliation

All existing money-changing invoice endpoints have adapters in enabled mode.
Delivery-status updates change no money; quotation creation reserves no stock and
collects no payment. Customer creation starts with zero balances. Manual stock
adjustments are not proof of purchases and create no fictitious money movement.
There is no independent customer collection, supplier payment or purchase-posting
endpoint to integrate. Legacy direct cancellation remains rejected in enabled mode:
use the previewed settlement cancellation, not an ambiguous historical refund.
Disabled-mode legacy cancellation behavior is unchanged.

Reconciliation checks missing/duplicate source postings, exact cash route and
amount, initial SALE provenance, quotation links and existing customer wallet/debt
ledger consistency. It also flags CASHIER_EVENT_PERMISSION_MISMATCH for a stored
cashier event outside its allowed initial-sale funding boundary. Historical checks
do not require the cashier account to still exist. Reconciliation is paginated,
read-only and never repairs history. Existing settlement/customer records remain
authoritative; clearing postings do not duplicate debt or store-credit balances.

### Verification and rollout prerequisites

Real disposable loopback MongoDB replica-set HTTP tests cover OWNER/CASHIER sales,
partial and mixed/credit-only payments, conversion, refunds and cancellation,
account inactivity, foreign shops, permission rejection, concurrent wallet use,
idempotent retries and late journal-insert rollback. Persisted stock, source events,
wallets, customer debt, invoice counters and cash balances are asserted. Disabled
mode compatibility and existing invoice-adjustment regression suites remain covered.

Ready for local frontend integration of these financial workflows behind the test
flag, not production accounting activation. Frontend account selection and stable
sale/conversion retry keys remain to be implemented. Public owner account setup and
approved per-shop LIVE cutover remain future work. Supplier purchasing and payments
are not implemented. Legacy ambiguity/precision discrepancies must be reconciled,
not guessed. All required indexes and every reconciliation page must be verified
before any approved cutover. Follow the Phase 2B freeze/drain, confirmed openings,
UTC cutoff and downgrade procedure; do not simply remove the test-only guard.
No production migration, historical repair or production enablement is included.
