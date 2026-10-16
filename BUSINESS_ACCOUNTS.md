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

## Phase 3A: OWNER account-management and read APIs

All paths below are relative to `/api/v2/accounts`. All use verifyJWT,
verifyShopUser (manual access and subscription checks), and verifyOwner. Every
operation re-verifies the database user/shop through businessTransaction and uses
one snapshot/majority MongoDB transaction. Responses use the existing envelope:
`{statusCode:200,data:...,messege:"Success"}` and `Cache-Control: no-store`.
CASHIER and ADMIN receive 403. CASHIER retains only the existing balance-free
`GET /api/v2/orders/payment-accounts` for permitted POS/conversion routing.

| Method | Path | Request / purpose |
| --- | --- | --- |
| POST | /entities | key, roles, and standalone name/optional phoneNo,address; or existing customerId with CUSTOMER role |
| GET | /entities | q, role, page, limit; search name/contact/key including linked Customer details |
| GET | /entities/:id | Own-shop identity with live linked customer details |
| PATCH | /entities/:id/roles | roles, expectedRevision; retain linked CUSTOMER and existing supplier-account role |
| PATCH | /entities/:id/customer | customerId, expectedRevision, confirmation="LINK EXISTING CUSTOMER" |
| POST | /brands | name, entityIds; explicit company/brand links, not inferred supplier identity |
| GET | /brands | q, page, limit |
| PUT | /products/:id/brand | brandId; existing Product.brand must match, same shop only |
| GET | /products/:id/brand | Explicit matching brand and linked entities, or null |
| POST | /financial | code, name, kind, optional entityId; test-enabled only |
| GET | /financial | q, entityId, page, limit; metadata only, no misleading inferred balances |
| GET | /financial/:id | Metadata plus authoritative balanceMinor/currency/authority |
| GET | /financial/:id/history | q, from, to, page, limit; account statement |
| POST | /financial/:id/opening | requestKey,equityAccountId,amountMinor,occurredAt,reason,confirmation="CONFIRM OPENING BALANCE"; test-enabled only |
| POST | /cutover/prepare | clearingAccountId,cutoffAt,accounts:[{accountId,confirmedBalanceMinor}],confirmation="PREPARE CASH BANK CUTOVER"; test-enabled only |
| GET | /reconciliation | clearingAccountId,page,limit; test-enabled prepared-cutover preview, never repair |
| GET | /customers/:id/reconciliation | Existing verified customer debt/store-credit reconciliation, never repair |

### Identity and account rules

COMPANY is added alongside CUSTOMER, SUPPLIER, MANUFACTURER and OTHER. Roles can
coexist. CUSTOMER must link an existing same-shop Customer; no duplicate Customer
or second financial identity is created. Customer details are resolved live.
Identity keys are stable, case-normalized and unique within the shop; exact
standalone name/contact conflicts with another key require review (409). Linked
customer uniqueness is additionally enforced by the existing unique index. Name
similarity is not a safe automatic merge; intentional homonyms require review.
Role edits use expectedRevision. Links cannot replace an already linked customer.
Existing brand services keep Product.brand distinct and unchanged.

Example create: `POST /entities` with
`{"key":"eagle-cables","name":"Eagle Cables","roles":["COMPANY","SUPPLIER"]}`.
Example linked identity:
`{"key":"existing-buyer","customerId":"<existing-customer-id>","roles":["CUSTOMER","SUPPLIER"]}`.
Repeat identical key/details returns the existing record; differing details conflict.
No generic entity deletion, journal editing, journal posting or historical repair
endpoint is exposed.

Financial account creation supports CASH, BANK, CUSTOMER_RECEIVABLE,
STORE_CREDIT_LIABILITY, SUPPLIER_PAYABLE, OPENING_EQUITY and SETTLEMENT_CLEARING.
Party kinds require a valid linked entity and role. Customer accounts always use
LEGACY_CUSTOMER authority. Existing code/entity-kind indexes prevent duplicates.
Example: `{"code":"TILL_1","name":"Counter cash","kind":"CASH"}`.
All financial setup/opening/cutover mutations require
BUSINESS_ACCOUNTING_ENABLED=true AND NODE_ENV=test. Disabled mode returns a clear
409; a true flag outside test returns 503. No production accounting is enabled.

### Balance and history contract

Money is integer paisa, currency PKR. Customer receivable and credit balances are
separate verified reads of existing Customer/CustomerLedger, never journal copies.
Example account detail data:
`{account:{...},authority:"LEGACY_CUSTOMER",balanceMinor:125000,currency:"PKR",livePostingEnabled:false}`.
Journal cash/bank detail/history requires the test flag and membership in a
prepared cutover. Unprepared accounts return 409, not a fictitious zero live balance.
Supplier and other unintegrated journal balances/history return 409 until their
posting/cutover coverage is approved; their metadata remains listable.
Historical inactive prepared cash/bank accounts remain readable by OWNER.

List responses contain entries and pagination:
`{currentPage:1,limit:20,recordCount:42,totalPages:3}`. Maximum limit=100;
page is 1..100000, q is at most 100 characters and regex-escaped. Statements are
oldest-first. from/to are canonical UTC ISO strings (inclusive/exclusive,
non-future); omitted dates include all available records. Journal search matches
reason, source kind and actor-name snapshot. Customer history search matches
description, invoice number and source reference. Source references are stable
IDs, not fabricated invoice numbers; clients can use existing invoice APIs.
Journal entries return occurredAt/recordedAt, source, actor snapshot and separate
debitMinor/creditMinor. Legacy entries retain their stored signed amount,
description, invoiceNo, referenceId, actor ID and createdAt; no missing actor name
or historical timestamp is invented.

Unfiltered statements provide exact opening/running balances. Search-filtered
journal history returns null openingBalanceMinor and runningBalanceMinor rather
than summing only matching entries as if they were the complete history. Legacy
running balances still include every original row; its search opening is null.
Current balance remains separately available and never means the filtered total.
Existing full legacy-ledger reconciliation scans remain a known scaling limit.

### Frontend integration and remaining rollout limits

Use credentials/include, existing role protection, and handle 403/409/503 plainly.
Retain stable identity keys, account codes and opening requestKey for retries;
never retry a financial operation with a new key after an uncertain result.
Opening amounts and cutover confirmations require explicit owner review. Customer
opening balances remain forbidden; they are already authoritative legacy records.
Cash/bank openings and cutover must use the identical confirmed UTC cutoff, before
any integrated financial activity. The existing services enforce this evidence.
All reconciliation pages must be inspected; a single clean page is not complete
reconciliation. No read request repairs or creates historical financial events.

Safe for local Accounts frontend integration: identity/brand metadata and customer
reconciliation/read APIs; account setup, prepared cash/bank reads, opening and
cash reconciliation only in explicitly enabled disposable test environments.
No LIVE rollout, supplier purchases/payments, historical import, account-status
mutation, general-ledger mutation or production cutover is implemented here.
Phase 3B can build the frontend against these contracts without enabling live
accounting. Production opening/cutover requires the separately approved rollout
and reconciliation process documented above.

Existing brand company links can also be edited through OWNER-only
`PATCH /brands/:id/entities` with `{entityIds:[...],expectedEntityIds:[...]}`.
The expected list must match the current links; stale changes return 409. Exact
replays return the saved links. All linked entities are verified within the shop,
maximum 20, and updates use the existing transaction and shop-write claim.
Product.brand and product financial behavior remain unchanged.

## Phase 4A � Transaction history and audit read foundation

No accounting activation or new financial mutation endpoints. Existing settlement,
stock, invoice and customer authorities remain unchanged. No history is rewritten.
New optional BusinessTransaction.createdByRole records the verified database actor's
role for newly posted journals. Existing journal/adjustment append-only hooks and
unique source/idempotency indexes remain in force. No migration is required.
The existing shop/date/_id and shop/account/date indexes support deterministic
chronology; source-kind/reference and request-key uniqueness prevent duplicate
postings. Index deployment verification remains required before any live rollout.

### OWNER-only routes

All use existing JWT, verifyShopUser and verifyOwner, plus the existing verified
shop/user transaction wrapper. Responses have Cache-Control:no-store and use the
existing `{statusCode:200,data:...,messege:"Success"}` envelope.

- `GET /api/v2/accounts/transactions`: posted-journal register; page,limit,q,type,
  from,to,sourceId,accountId. One row per BusinessTransaction, not per posting.
- `GET /api/v2/accounts/transactions/:id`: journal detail and linked original
  transaction when this is a reversal.
- `GET /api/v2/accounts/financial/:id/history/:entryId`: detail restricted to that
  account's own journal posting or legacy customer debt/credit ledger entry.
- Existing `GET /api/v2/accounts/financial/:id/history` retains entries, balanceMinor,
  openingBalanceMinor and pagination. It adds normalized transactions,
  rangeOpeningBalanceMinor, rangeClosingBalanceMinor, rangeNetChangeMinor, coverage,
  and optional type/sourceId filters. Existing Phase 3B frontend reads remain valid.

CASHIER/ADMIN cannot access these owner financial routes. Manual deactivation and
subscription expiry remain enforced first. Journal register/detail require the
existing enabled test flag; disabled gives 409, true outside NODE_ENV=test gives
503. Cash/bank statement/detail still require prepared cutover. Legacy customer
statements/details remain available without accounting activation, using verified
existing customer debt and wallet records. Supplier/unintegrated account statements
remain unavailable; this does not invent purchasing or supplier payments.

### Standard transaction representation

Journal register entries and `history.transactions` use:

```json
{
  "eventId": "<immutable-record-id>",
  "recordKind": "BUSINESS_JOURNAL",
  "eventType": "INVOICE_RECEIPT",
  "currency": "PKR",
  "occurredAt": "2026-10-16T10:00:00.000Z",
  "recordedAt": "2026-10-16T10:00:00.100Z",
  "timestampBasis": "EFFECTIVE_AND_RECORDED",
  "actor": {"_id":"<actor-id>","name":"Ali","role":"CASHIER"},
  "source": {"kind":"INVOICE_RECEIPT","referenceId":"<invoice-event-id>"},
  "sourceDocument": {"orderId":"<invoice-id>","invoiceNo":"INV-10","eventId":"<invoice-event-id>","eventType":"SALE","sourceQuotationId":null},
  "counterparty": {"customerId":"<customer-id>","name":"Customer name","entityId":null},
  "amountMinor": 5000,
  "postings": [
    {"accountId":"<cash-id>","account":{"_id":"<cash-id>","name":"Counter cash","kind":"CASH","normalSide":"DEBIT"},"businessEntity":null,"debitMinor":5000,"creditMinor":0,"balanceDeltaMinor":5000,"moneyInMinor":5000,"moneyOutMinor":0},
    {"accountId":"<clearing-id>","account":{"_id":"<clearing-id>","name":"Settlement control","kind":"SETTLEMENT_CLEARING","normalSide":"CREDIT"},"businessEntity":null,"debitMinor":0,"creditMinor":5000,"balanceDeltaMinor":5000,"moneyInMinor":null,"moneyOutMinor":null}
  ],
  "reversalOf": null,
  "reversedBy": [],
  "runningBalanceMinor": null
}
```

Metadata unavailable in a legacy source is null, never a current-user substitute.
Names/roles of journal actors use immutable snapshots. If a legacy journal lacks
its role, an existing same-actor source-event role snapshot may supply it; today's
User role is never consulted. Legacy customer PURCHASE actor names may use the
same-actor invoice creator snapshot. Other absent actor names/roles remain null.
Account/entity/counterparty labels are current same-shop directory metadata, not
newly invented historical name snapshots. Missing linked account/entity records
fail closed for reconciliation; missing source documents/metadata are not fabricated.
All enrichment queries, including source quotation and reversal queries, are scoped
to the authenticated shop. Actor IDs in old records do not imply the user still exists.

Journal amountMinor is total debit counted ONCE for the balanced event; it is NOT
revenue or net cash. Individual postings contain debitMinor,creditMinor and signed
balanceDeltaMinor according to normalSide. Only CASH/BANK postings have non-null
moneyInMinor/moneyOutMinor. Receivables, store-credit liability and clearing are
not physical money. A transfer is one event with two account effects, not two sales.
A return/exchange can produce both receipt and refund journals linked to the SAME
invoice action. They are distinct money directions, not repeated sales/return totals.
Do not sum an invoice action's financial summary once per linked journal.

Journal details return `{coverage,transaction,originalTransaction}`. The transaction
also includes businessAction when a verified source event exists: eventId,eventType,
occurredAt,financial,movements,revisionBefore,revisionAfter. This traces original
payments, added/returned units, refunds, cancellation and credit effects through
existing immutable InvoiceAdjustment, without creating another authority.
reversalOf points to the original journal; the original exposes reversedBy records.
Invoice financial corrections remain separate dated invoice events, not journal
rewrites. No standalone reversal mutation route is added.

Legacy normalized records use recordKind=CUSTOMER_LEDGER, eventType=description,
a single account effect and existing source invoice/event references. They are NOT
new double-entry postings. An effective timestamp is supplied only from a verified
linked invoice event. Otherwise occurredAt=null, recordedAt=existing createdAt and
timestampBasis=RECORDED_ONLY. No original-sale time is guessed from invoice identity.
Legacy correctionEventId identifies a linked adjustment/cancellation when known;
unknown original/reversal relationships remain null/empty. Legacy detail responses
contain `{coverage,transaction}` and do not invent a historical running balance.

### Filters, order and balances

Ordering is oldest-first (occurredAt,_id) for journals, (createdAt,_id) for legacy
statements; the ID breaks equal-timestamp ties deterministically. Each request uses
a MongoDB snapshot, but separate page requests do not freeze a changing database.
Client refresh is needed if concurrent postings change the selected dataset.
page=1..100000, limit=1..100 (default20). q is escaped text, maximum100 characters.
from/to are canonical UTC ISO timestamps, inclusive start/exclusive end, non-future;
invalid ranges/types/source IDs return400. sourceId/accountId must be ObjectIds.

Journal type filters: MANUAL, OPENING, REVERSAL, INVOICE_RECEIPT, INVOICE_REFUND,
TRANSFER. Legacy type filters: PURCHASE,CANCELLATION,PAYMENT,ADJUSTMENT,CREDIT_ISSUED,
CREDIT_REDEEMED,CREDIT_RESTORED, limited to the selected debt/credit account.
Journal search matches reason, actor-name snapshot, journal type, invoice number
and exact journal/source IDs. sourceId matches source invoice event/invoice ID in
statements and additionally journal ID in the register. Legacy search matches
stored description/invoice number/reference/event ID; sourceId matches original
invoice or adjustment reference. Nothing searches across shops.

Statement rangeOpeningBalanceMinor is the complete authoritative balance strictly
before from (zero when omitted); rangeClosingBalanceMinor is the complete balance
strictly before to (current balance when omitted). rangeNetChangeMinor is their
checked integer difference. These fields depend only on account/date range, NOT
page, search or type filters. They are not totals of filtered search matches.
Legacy ranges use RECORDED timestamps because complete historical effective dates
are unavailable. Existing openingBalanceMinor remains the compatibility page-start
balance, not the new date-range opening; it is null when journal filters omit rows.
Unfiltered journal running balances include all preceding postings. Filtered journal
running balances remain null, never sums of only matching rows. Legacy running
balances include the complete preceding ledger, even when search/type hides entries.
Current balanceMinor is separate from range/page balances. All money remains safe
integer paisa; accumulation/checked output uses existing BigInt/Decimal128 utilities.

Example register query:
`GET /accounts/transactions?type=INVOICE_REFUND&from=2026-10-01T00:00:00.000Z&limit=20&page=1`.
Example statement: `GET /accounts/financial/<id>/history?sourceId=<invoice-id>`.
Register data is `{coverage,entries,pagination}`; statement data retains raw entries
and additionally normalized transactions. For a selected journal statement,
normalized rows also include accountPosting and the applicable runningBalanceMinor.
No client should compute a shop-wide running balance by combining different accounts.

### Coverage and frontend readiness

The global register coverage is explicitly `{mode:"INTEGRATION_TEST",complete:false,
livePostingEnabled:false,records:"BUSINESS_JOURNAL",excludes:[...]}`. It does NOT merge
legacy customer rows, unposted historical sales, noncash settlement events without
journals, or unsupported supplier activity into a fake complete financial register.
Current invoice-event detail remains the source for those noncash financial effects.
Reconciliation continues detecting missing/duplicate source postings and existing
wallet/debt discrepancies; these read APIs never repair or synthesize absent events.
Existing journal indexes, transaction idempotency and append-only hooks are reused.

Ready for a professional transaction-history frontend for this SUPPORTED subset.
Use coverage and null metadata explicitly, distinguish event rows from postings,
use range balances rather than the compatibility page opening, and request details
by eventId/recordKind (account-history detail for legacy entries). Preserve customer
debt/store credit separation and the test-only gates. No frontend, production data,
LIVE accounting, migration or supplier workflow is changed in Phase 4A.

Phase 4A verification also checks that separate snapshot reads cannot observe an
uncommitted journal and that aborted postings remain absent from details/register
and balances. Existing write-path rollback/concurrency regression tests still run.
Legacy CustomerLedger continues its existing model/append-by-service behavior;
Phase 4A does not add journal-style mutation hooks to that model or change platform
shop deletion. These read APIs expose no ledger edit/delete route. Database-level
administrators are outside application append-only protections.

## Phase 4B � Supplier purchase orders and actual goods receiving

### Implemented boundary and accounting policy

Purchasing/stock receiving works with accounting disabled (the unchanged default).
Receipt documents preserve evidence of the original received-goods obligation,
not a second authoritative supplier balance. Full payable integration is deliberately
DEFERRED: the existing system has no approved supplier opening/cutover or complete
purchase inventory valuation coverage. Do not reuse the cash cutover as approval
for supplier payable integration or treat customer debt/store credit as supplier debt.

- Drafting or confirming an order changes NO stock, customer debt, credit, payable
  balance or cash. It only records an agreed order and confirmation history.
- Physically received quantities create an immutable GoodsReceipt and matching
  stock movements. Received quantity times original agreed cost is captured in paisa.
  That receipt is the permanent source event for later payable posting/reconciliation.
- GoodsReceipt.accountingStatus is DEFERRED and obligationType is RECEIVED_GOODS.
  Receipt totalMinor and PO receivedValueMinor are received-goods COST VALUE, not
  proof of today's unpaid supplier balance. External payments or prior supplier
  arrangements are unknown; none are invented or inferred.
- No FinancialAccount balance, BusinessTransaction journal, Customer.remainingMoney,
  store-credit wallet or CustomerLedger entry is changed by these purchase APIs.
  Supplier account balance/history APIs retain their existing unavailable response.
- If BUSINESS_ACCOUNTING_ENABLED=true in NODE_ENV=test, a NEW receipt fails with409:
  "Supplier payable cutover is not approved; receiving with accounting enabled is unavailable".
  Thus stock cannot commit while required enabled-mode accounting is skipped.
  An exact replay of an already committed deferred receipt returns that original
  record without new stock/postings. True outside test retains the existing503 guard.
- Payment fields (paidAmount/paymentAmount/cashAmount/creditAmount and payment or
  cash-account routing) are rejected. Supplier payments and purchase returns are NOT
  implemented. Viewing orders/receipts does not imply payment or activate accounting.

### OWNER APIs

Relative to `/api/v2/purchases`. Existing JWT, verifyShopUser and verifyOwner apply;
CASHIER/ADMIN cannot use these APIs. Owner identity and shop membership are verified
again inside the existing snapshot/majority businessTransaction. Mutations claim
a real shop write to conflict with concurrent shop deletion/deactivation. Existing
callers keep unchanged behavior; the wrapper's new write opt-in defaults to false.
All responses use `{statusCode:200,data:...,messege:"Success"}`, Cache-Control:no-store.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | / | Create draft, never receive stock |
| GET | / | Paginated purchase-order history |
| GET | /:id | Original ordered items, received counts/value, revision and actions |
| POST | /:id/confirm | Confirm a draft at its expected revision |
| POST | /:id/cancel | Cancel draft or outstanding remainder; never return received stock |
| POST | /:id/receipts | Record one actual delivery |
| GET | /:id/receipts | Paginated immutable delivery history |

Create body:
```json
{"requestKey":"purchase-create-unique","reference":"PO-100","supplierId":"<same-shop-supplier-entity>","items":[{"productId":"<same-shop-product>","quantity":10,"unitCostMinor":1234}]}
```
Confirm body: `{"requestKey":"confirm-po-100","expectedRevision":0}`.
Receive body:
```json
{"requestKey":"delivery-unique-key","reference":"GR-100-A","expectedRevision":1,"items":[{"productId":"<ordered-product>","quantity":4}]}
```
Cancel body:
`{"requestKey":"cancel-po-100","expectedRevision":2,"reason":"Remaining delivery no longer required"}`.

Supplier must already be an existing same-shop SUPPLIER BusinessEntity; COMPANY
and CUSTOMER can coexist. Linked customer identity is reused without copying any
financial balances. Supplier role cannot be removed once purchase history exists.
One product per order/receipt line, 1..100 lines, whole positive safe-integer quantities.
All costs are explicitly nonnegative integer paisa, not floating-point PKR inputs:
1234 means PKR12.34. Free items (zero cost) retain a zero-value source, not fictional
money. BigInt multiplication/sums are checked before safe-integer storage. No taxes,
freight, purchase discounts, fractional units, cost averaging or currency conversion
are silently added. Existing Product.costPrice and selling prices are NOT overwritten.
Products with ambiguous fractional/overflowing stock must be reconciled first.

References are explicit shop-local unique references (1..50 letters/numbers/slashes/
dashes/underscores), trimmed and uppercased. They are not shared invoice counters.
Request keys are stable 8..100 word/dash characters. Do not submit a new key after
an uncertain response: retry the identical body/key. Changed payload/key reuse gives
409. Items are canonicalized by product ID for retry identity. Actor and timestamps
come from the verified database user/server, ignoring forged creator/date input.
Receipt unit costs and product snapshots always come from the original purchase,
never the receive request or today's changed Product cost.

### States and recorded structures

DRAFT -> CONFIRMED -> PARTIALLY_RECEIVED -> RECEIVED. A single complete delivery
can go directly CONFIRMED -> RECEIVED. Each mutation increments revision. Confirm
and cancel append dated actor-snapshotted actions with their stable request identity.
CANCELLED locks new deliveries. Cancelling a partly received order cancels ONLY
its outstanding remainder: prior received quantities, receipts, stock and original
obligation evidence stay intact. Fully received orders cannot be cancelled; a
future purchase-return workflow will be needed. Draft editing is not implemented;
cancel an incorrect draft and create a replacement. Agreed products/quantities/costs
are never edited by these endpoints.

PurchaseOrder contains shop/reference, supplier ID/name snapshot, original product
name/brand/unit snapshots, quantity,unitCostMinor,totalMinor,receivedQuantity per line,
totalMinor,receivedValueMinor,currency,status,revision, creator ID/name/role, createdAt,
updatedAt and confirmation/cancellation actions. GoodsReceipt contains its own ID
and reference, source purchase ID/reference, supplier snapshot, actual received
items/costs, totalMinor/currency, DEFERRED obligation status, revisionBefore/After,
creator ID/name/role, occurredAt and recordedAt (server UTC dates).

Mutation data returns `{purchaseOrder,replayed,accounting}` or for receiving
`{receipt,purchaseOrder,replayed,accounting}`. Read detail is `{purchaseOrder,accounting}`.
Accounting explicitly returns
`{status:"DEFERRED",supplierBalanceAvailable:false,cashMovementMinor:0}`.
A replay returns the ORIGINAL immutable receipt and the CURRENT purchase state;
its revision may have advanced after subsequent deliveries.

Lists return `{entries,pagination,accounting}` with pagination
`{currentPage,limit,recordCount,totalPages}`. page=1..100000, limit=1..100 (default20).
Filters: q (escaped reference/supplier-snapshot name, max100), supplierId, from,to;
PO lists additionally support status. UTC from is inclusive, to exclusive, canonical
ISO and non-future. Orders sort (createdAt desc,_id desc), receipts (occurredAt desc,
_id desc). No unbounded receiving-history response is embedded in a detail request.

### Atomicity, audit and indexes

One MongoDB transaction contains receipt insert, every conditional product increment,
per-product StockLog, PO received summaries and revision/status transition. Over-receipt,
stale revision, missing/foreign records and any late failure abort all changes.
Concurrent receipts conflict on shop, purchase and product writes; retry only after
checking current state. Same-key receipt replay never restocks twice. Unique shop
receipt reference also prevents an accidental duplicate delivery under a new key.
A genuinely identical delivery submitted under BOTH a new key and a different new
reference cannot be recognized as the same physical event; the owner must not do so.

GoodsReceipt has journal-style append-only save/update/delete/bulk guards. Corrections
must not edit receipts. StockLog uses reason PURCHASE_RECEIVED, purchaseReceiptId,
purchaseReference and receivingReference, with the server receipt event date.
It does not fake Order.referenceId, invoiceNo or saleType to satisfy sales schemas.
New optional fields preserve existing sale/manual stock-history behavior.

Required indexes: PurchaseOrder unique(shopId,reference), unique(shopId,requestKey),
(shopId,createdAt desc,_id desc), (shopId,supplierId,createdAt desc,_id desc),
(shopId,status,createdAt desc,_id desc). GoodsReceipt unique(shopId,reference),
unique(shopId,requestKey), (shopId,purchaseOrderId,occurredAt desc,_id desc),
(shopId,supplierId,occurredAt desc,_id desc). StockLog has partial unique
(shopId,purchaseReceiptId,productId), only when purchaseReceiptId is an ObjectId.
Verify these indexes before enabling public receiving. No migration/backfill runs.
Existing ADMIN permanent deletion now includes new purchase orders and receipts
inside its existing transaction, without changing deactivation/authorization rules.
This remains the sole platform deletion exception for immutable receipt records.

### Verification and Phase 4C dependency

Disposable loopback MongoDB replica tests use actual HTTP and persisted data,
including partial/full deliveries, historical agreed prices, changed products,
replay, over-receiving, concurrent revisions, duplicate delivery references, late
rollback, owner-only/cross-shop gates, subscription/manual access and shop deletion.
Existing POS/invoice/return/credit and journal tests remain regression coverage.

Before Phase 4C can pay suppliers: approve supplier payable/inventory valuation
cutover and opening policy; reconcile deferred receipts against externally settled
amounts without fabricating payment history; implement source-unique balanced
purchase posting in the same receiving transaction; and verify balances/reversal
policy. Never sum these deferred receipts and label that an authoritative payable.
Existing prepared cash accounts alone do NOT approve supplier integration.
No supplier payments, purchase returns, LIVE accounting, frontend, production data,
commits, pushes, deployment or automatic follow-on phase is included here.

The receipt's DEFERRED accountingStatus records its status at creation and is
immutable. A future approved posting must reference that source ID and derive
posting status from verified journal linkage; it must not rewrite the original
receipt or treat its value as evidence of an unpaid opening balance.


## Phase 4C-1 - Supplier payable cutover (test integration only)

This section supersedes Phase 4B's blanket rejection of enabled receiving.
Accounting remains OFF by default. BUSINESS_ACCOUNTING_ENABLED=true is permitted
only with NODE_ENV=test; production activation still returns 503. No historical
migration, supplier payment, purchase return, inventory valuation or COGS workflow
is added. Customer debt and store credit retain their existing authority.

### Opening policy

Each SUPPLIER BusinessEntity has a separate JOURNAL/SUPPLIER_PAYABLE account
(normal credit). Multi-role entities retain separate customer receivables,
store-credit liabilities and supplier payables; these balances are never netted.
Create an active PURCHASES_CLEARING account (normal debit) and OPENING_EQUITY
account through the existing test-only financial account API. Cash/bank cutover
alone does not authorize supplier debt.

The OWNER previews and explicitly reviews EVERY existing goods receipt for that
supplier, including externally paid deliveries. Each receipt requires unpaidMinor
between zero and its received value plus a review reason. Zero means no opening
debt from that receipt; it is an owner attestation, not an invented payment event.
Other historical debt is declared separately as otherOpeningMinor, with an opening
reason explaining it. The exact integer-paisa equation is:

openingBalanceMinor = sum(reviewed receipt unpaidMinor) + otherOpeningMinor.

The owner must compare external payment records and verify that other debt does
not overlap reviewed deliveries. DigiShop cannot prove an external settlement.
No amounts are inferred or silently corrected. A fresh evidenceDigest prevents
initializing from a stale receipt list. All existing receipts must be DEFERRED
and dated AT OR BEFORE the canonical UTC cutoff. Existing receipts AFTER the
cutoff block opening. Review supports at most 100 receipts per supplier; larger
histories require a separately approved review workflow. Normal Express JSON size
limits still apply. Preview is paginated: review all pages before confirmation.

Immutable SupplierCutover records include accounts, cutoff, exact reviews,
digest, reason, actor/name/OWNER snapshot and server confirmation/recording dates.
Unique indexes: (shopId,supplierId), (shopId,payableAccountId), (shopId,requestKey).
One opening only: exact request replay succeeds; changed details/key cannot reset
it. Existing payable activity blocks initialization. Positive opening posts Dr
OPENING_EQUITY / Cr SUPPLIER_PAYABLE, source SUPPLIER_OPENING referencing cutover.
Zero opening has confirmation evidence but no fake zero journal. Shared equity
keeps the posting engine's chronological guard: cutoff cannot precede its latest
posting. Do not falsify historical dates to bypass that guard.

### OWNER APIs

Base: /api/v2/accounts. Existing JWT, OWNER, shop membership, manual-access and
subscription middleware apply. Existing response envelope is retained.

GET /suppliers/:id/cutover-preview?page=1&limit=20
Returns supplier, cutover, evidenceDigest, paginated receipt entries, pagination,
authoritative:false, reviewRequired:true and policy. Historical evidence only,
not a payable balance; available with accounting disabled.

POST /suppliers/:id/cutover
Test-only atomic initialization. Example body (replace placeholder IDs/digest):

{
  "requestKey":"supplier-opening-confirm-001",
  "confirmation":"CONFIRM SUPPLIER OPENING",
  "cutoffAt":"2026-10-16T00:00:00.000Z",
  "payableAccountId":"<own supplier payable>",
  "offsetAccountId":"<own purchases clearing>",
  "equityAccountId":"<own opening equity>",
  "openingBalanceMinor":110000,
  "otherOpeningMinor":10000,
  "reviews":[{"receiptId":"<existing receipt>","unpaidMinor":100000,"reason":"Verified remaining debt after external settlement"}],
  "evidenceDigest":"<fresh preview digest>",
  "reason":"Reviewed supplier statement and payments; other debt is separate"
}

Returns cutover and replayed. Zero opening requires the same explicit confirmation.

GET /suppliers/:id/reconciliation
Returns authoritative, cutover, accountId, balanceMinor (null if incomplete/off),
currency, issues (reference/problem) and deferredCount. Before initialization:
no balance, explicit cutover issue. Never repairs or posts missing records.

GET /suppliers/:id/balance
Same reconciled result; 409 unless enabled, initialized and fully reconciled.

GET /financial/:payableAccountId
GET /financial/:payableAccountId/history
GET /financial/:payableAccountId/history/:entryId
Existing APIs now allow reconciled supplier accounts. Disabled accounting or any
unresolved gap blocks these reads. Existing page/limit, UTC [from,to), type,
sourceId and escaped reference search apply. Source IDs include receipt/PO IDs.

### New receiving and dated statements

Existing POST /api/v2/purchases/:id/receipts contract is unchanged. Enabled
receiving requires a clean supplier cutover and SERVER receipt date STRICTLY
AFTER cutoff. No client-controlled receiving timestamp. Actual quantities use
agreed PO integer unit costs, never current product cost prices. Each positive
receipt posts exactly one PURCHASE_RECEIPT journal: Dr PURCHASES_CLEARING / Cr
SUPPLIER_PAYABLE for received value. Receipt, product increment, StockLog, PO
revision, account revision and journal share one snapshot/majority transaction.
Shop write claims, revision checks and unique source/request indexes protect
concurrency and duplicate submissions. Any failure rolls back all changes.
PO creation/confirmation still posts nothing; cash movement remains zero.

New positive receipts are immutable POSTED records linked to the cutover.
Zero-cost receipts are NO_PAYABLE: physical stock/logs change, no zero journal.
The purchases clearing debit is an offset, NOT full inventory valuation or COGS.

Statements reuse Phase 4A (occurredAt,_id) ordering, UTC range opening/closing
balances, pagination and actor-role snapshots. Receipt rows identify goods receipt
and PO references; details include received item/cost snapshots. Opening rows
reference the cutoff confirmation. The global register counts journals once,
not individual double-entry postings. Supplier liability increases are not cash:
moneyInMinor/moneyOutMinor are null. Pre-cutoff statement balances describe this
subledger only, not unavailable historical balances. Coverage remains test-only
and incomplete for the whole business.

### Deferred evidence and Phase 4C-2

All old DEFERRED receipts stay unchanged and cannot be reposted, including retries.
Reviewed unpaid portions appear ONCE through the confirmed opening. Reconciliation
checks opening/receipt journals, amounts, dates, accounts, source links, missing
reviewed evidence, unexpected postings and derived AP totals. Any unreviewed
DEFERRED receipt or missing/inconsistent journal blocks authoritative balance and
enabled receiving. Turning accounting off preserves ordinary receiving (DEFERRED).
Turning it on again after such a gap fails closed; no automatic repair or second
opening exists. Do not treat deferred receipt totals as authoritative debt.

Phase 4C-2 must define deliberate immutable gap resolution, supplier payment
sources, explicit cash/bank routing, AP debits, reversals and reconciliation to
external statements. Advances/overpayments, purchase returns and full inventory
valuation remain unsupported. Current payable is confirmed opening plus posted
received obligations; no supplier payment is claimed or inferred. Production
accounting stays disabled pending broader rollout approval.

Tests: tests/supplier-payables-replica.test.mjs starts a disposable loopback-only
MongoDB replica set and explicitly creates indexes. Actual HTTP and persistence
checks cover openings, UTC boundaries, stock/journals, replay/concurrency, forced
late rollback, statements, role/shop gates and customer separation. The existing
permanent shop deletion transaction includes cutovers as the documented native
collection-delete exception to immutable financial history.
