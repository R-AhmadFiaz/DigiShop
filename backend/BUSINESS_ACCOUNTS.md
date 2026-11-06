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


## Phase 4C-2 - Supplier settlements and purchase returns (test only)

All new mutations remain disabled by default. They require
BUSINESS_ACCOUNTING_ENABLED=true and NODE_ENV=test, authenticated OWNER, current
shop membership, active manual access, valid subscription and a clean confirmed
supplier cutover. Existing customer receivables/store credit, POS sales, returns,
quotations and invoice settlement are unchanged. No historical payments or
supplier balances are backfilled. Production activation remains prohibited.

### Policy and authoritative balances

Supplier payments are UNAPPLIED AT SUPPLIER LEVEL. The existing foundation cannot
prove which invoice/receipt an old or new payment settles. No receipt allocation,
opening-debt allocation, FIFO allocation or receipt-level paid/unpaid assertion is
invented. Supplier payable is:

confirmed opening + posted received goods - payments - accepted return credits
+ payment reversals + return reversals.

All quantities are whole units. All financial inputs and snapshots use safe
integer paisa; return value is exact quantity * ORIGINAL receipt unitCostMinor,
checked with BigInt sums and safe-range bounds. Current Product costPrice is not
used. Original goods receipt, purchase quantities and history remain unchanged;
a purchase return does not reopen the original purchase order for receiving.

Payment: Dr SUPPLIER_PAYABLE / Cr selected CASH or BANK. Requires an explicitly
selected active prepared cash/bank account; preparation must use the existing
cash cutover workflow. No account is silently selected. Supplier and cash cutoffs
must precede the payment timestamp. Amount must be positive, no more than the
reconciled payable, and no more than available cash/bank funds. Cash cannot go
negative. This records an actual payment, not a promise to pay.

Return credit: Dr SUPPLIER_PAYABLE / Cr PURCHASES_CLEARING. Physically returned
quantities leave sellable stock and produce PURCHASE_RETURN logs. Returns do NOT
increase cash, bank, customer store credit or a second supplier balance. They
reduce the supplier-level payable, not an assumed unpaid amount on a receipt.
Only post-cutover POSTED / zero-cost NO_PAYABLE receipts for the same supplier
are eligible. Partial and multiple returns are supported. Net returned quantities
(after explicit reversals) cannot exceed the original receipt quantities; stock
cannot go negative. Creating a purchase order, confirming it, or paying a supplier
does not change inventory.

IMPORTANT DEFERRED SCENARIO: returns exceeding remaining supplier payable are
rejected with 409 BEFORE any stock/history changes. This includes a positive-value
return when the supplier has been fully paid. A supplier refund-due asset,
carry-forward supplier credit, actual incoming refund and splitting a return
between payable reduction/refund due are NOT implemented. Do not return goods
physically under this workflow if the application rejects the settlement. A paid
receipt can reduce other debt to the SAME supplier only when a positive supplier
payable remains and the supplier accepts that credit; receipt allocation is not
claimed. Never create negative AP or fictitious money received to force a return.

Historical DEFERRED receipts (even reviewed at opening) remain immutable and are
not eligible for this return workflow. They need an approved historical/gap
reconciliation process. There is no automatic repair, second opening or repost.

### Endpoints and request examples

Base /api/v2/accounts. Existing authenticated OWNER middleware applies to every
route; CASHIER and ADMIN cannot call supplier financial operations. JSON uses the
existing response envelope. All mutations require stable requestKey, unique
shop-wide reference, canonical nonfuture UTC occurredAt and reason. Unknown
fields, including unsupported allocations or cash refund requests, are rejected.
Client actor IDs/names and recorded timestamps are never accepted.

POST /suppliers/:id/payments
{
  "requestKey":"supplier-payment-0001",
  "reference":"PAY-0001",
  "occurredAt":"2026-10-16T12:00:00.000Z",
  "reason":"Bank transfer actually sent to supplier",
  "amountMinor":20000,
  "accountId":"<active prepared own-shop cash/bank account>"
}

POST /suppliers/:id/returns
{
  "requestKey":"supplier-return-0001",
  "reference":"RET-0001",
  "occurredAt":"2026-10-16T12:01:00.000Z",
  "reason":"Supplier accepted returned goods as credit against payable",
  "receiptId":"<original same-supplier posted receipt>",
  "items":[{"productId":"<received product>","quantity":2}]
}

Both return data.settlement (immutable source) and data.replayed. Return snapshots
include original receipt reference, purchase reference, product name, quantity,
original unit cost and exact total. Source records identify payable and offset
accounts, amountMinor/currency, business-effective occurredAt, server recordedAt,
and authenticated actor ID/name/OWNER-role snapshot. Zero-cost returns still have
stock/source history but deliberately no fake zero-value journal.

POST /suppliers/:id/settlements/:eventId/reverse
{
  "requestKey":"supplier-reversal-0001",
  "reference":"REV-0001",
  "occurredAt":"2026-10-16T12:02:00.000Z",
  "reason":"Confirmed original goods or funds have actually been restored",
  "confirmation":"CONFIRM SUPPLIER REVERSAL"
}

Reversal is a full, exact, linked correction, once per original PAYMENT or RETURN.
It never edits or deletes the original. PAYMENT reversal requires actual funds
restored to the ORIGINAL active prepared payment account: Dr CASH/BANK, Cr AP.
RETURN reversal requires original goods actually restored to stock: Dr purchases
clearing, Cr AP, and PURCHASE_RETURN_REVERSAL stock logs. Original receipt return
eligibility is restored. Reversals of reversals, alternate accounts, partial
reversals and standalone generic-journal reversals of supplier sources are not
allowed. Correct a mistaken amount by explicitly reversing the original and
recording a new accurate event. Reversal confirmation is an owner attestation;
DigiShop does not verify a bank transfer or physical delivery automatically.

GET /suppliers/:id/settlements
Supports page/limit (max100), UTC [from,to), escaped q reference/reason search,
type=PAYMENT|RETURN|REVERSAL and sourceId (settlement, original settlement or
receipt). Returns entries, pagination and allocation:UNAPPLIED_SUPPLIER_LEVEL.
This includes zero-value physical returns, which have no journal row.

GET /suppliers/:id/balance and /reconciliation retain Phase 4C-1 contracts.
GET /financial/:payableAccountId/history and /history/:entryId retain Phase 4A
contracts and include SUPPLIER_PAYMENT, SUPPLIER_RETURN and SUPPLIER_REVERSAL.
Global /transactions counts one event per journal, not one per posting. It can
search settlement/receipt/purchase references and receipt/original settlement IDs.
Transaction details expose original/reversal relationships, source settlement and
received-goods links, actor snapshots and item movements. Running and range
opening/closing balances remain derived from authoritative posted journals in
stable (occurredAt,_id) order. Filtered running balances retain the existing null
semantics; range opening/closing balances describe the entire selected period.
Cash posting moneyOutMinor reflects payments; payment reversals show moneyInMinor.
Return credit has no cash posting and therefore is not described as cash received.
Coverage is still an incomplete test subledger, not a complete production ledger.

Example supplier statement in paisa:
  Opening payable                         +100000
  Received goods                           +50000
  Payment from bank                        -20000
  Goods returned as supplier payable credit -10000
  Closing payable                          120000
Cash/bank decreased by 20000 only; the 10000 return credit did not create cash.

### Atomicity, idempotency and reconciliation

SupplierSettlement is append-only with unique (shopId,requestKey),
(shopId,reference) and partial (shopId,reversalOf) indexes. Chronological supplier
and receipt indexes support history/eligibility. Each positive settlement has one
unique balanced journal source referencing that event ID. Stock logs use separate
supplierSettlementId/sourceReceiptId fields, never fake sale/invoice references,
with a unique shop/event/product index. Source-derived journal request keys,
account revision claims, conditional stock changes and the existing shop write
claim serialize competing operations in snapshot/majority MongoDB transactions.
Overpayment, over-return, duplicate references or late journal errors abort all
settlement, stock, log, account and journal writes together.

Retry an uncertain mutation with its IDENTICAL key and payload, never a fresh key.
An exact replay returns its original source without applying another effect.
Reused keys with changed details and competing mutations return controlled 409s.
Effective timestamps cannot precede supplier/cash cutoffs, the original receipt
or reversal source, or affected accounts' latest activity. They cannot be future
or noncanonical. Recorded time and actor identity always come from the server.

Supplier reconciliation verifies settlement journals, exact direction/accounts,
amounts/dates, receipt cost and net returned quantities, reversal source snapshots,
stock audits and final nonnegative AP. Missing or inconsistent evidence blocks
balance reads and all new enabled supplier mutations; nothing is auto-repaired.
Cash/bank reconciliation now separately includes supplierReconciliation and
orphanedSupplierCashJournals, since supplier payments do not flow through invoice
settlement clearing. Existing invoice reconciliation fields remain unchanged.
The existing authorized deactivated-shop deletion cascades the new immutable
collection inside the same transaction, preserving the established exception.

### Remaining limitations / next work

Supplier refund-due assets, cash/bank refunds received for purchase returns,
advance payments, overpayments, receipt/opening-debt allocations and deferred
history/gap settlement remain unsupported. Full inventory valuation/COGS remains
out of scope. No production accounting activation, migration, frontend, payment
gateway or automatic external verification is implemented. These policies need
approval and dedicated tests before extending the supported settlement states.

Real tests: tests/supplier-settlements-replica.test.mjs uses isolated loopback
MongoDB with replica-set transactions and actual HTTP, not mocked financial
responses. It covers partial/full cash/bank payments, duplicates, overpayment,
insufficient funds, competing payments, partial/multiple/zero-cost returns,
insufficient stock, paid-supplier rejection, reversals, original costs, forced
late rollback, chronological statements, source links, permissions, shop isolation,
missing evidence and disabled/production guards. Existing suites remain regression
coverage for customer debt/credit, invoices, POS, purchase receiving and cutovers.


## Phase 5A - verified local supplier integration (2026-10-16)

The supported supplier workflow passed against real Express HTTP, production-built
React, Chrome, cookie authentication and disposable MongoDB 8.3.4 replica-set
transactions (Node v24.15.0). tests/supplier-browser.integration.mjs creates its
own verified loopback database and temporary Vite preview. It disables dotenv
loading of the real environment, never imports production database startup, uses
test-only accounting, and removes its owned temporary database/processes afterward.
No Atlas connection, production write, migration or accounting activation occurred.

Twelve supplier browser/API scenario groups passed: supplier and product setup;
purchase creation/confirmation; partial and complete deferred deliveries; reviewed
supplier opening; post-cutoff payable posting; cash payment with a committed but
truncated HTTP response and exact-key recovery; original-cost returns; bank
payments and payment reversal; statements/register/details; concurrent receiving
and injected late transaction rollback; role/shop isolation; missing openings,
deferred gaps, refresh, responsive layout and final reconciliation.

Verified main scenario (PKR; stock in units):

| Evidence | Result |
| --- | --- |
| Reviewed pre-cutoff receipts | 10 units, PKR 100; PKR 80 unpaid opening and PKR 20 externally settled evidence |
| Confirmed opening cash / bank | 100 / 500 |
| Post-cutoff receipt | 5 units at PKR 20; payable increases by 100 |
| Cash supplier payment | 30 |
| Return at original received cost | 2 units at PKR 20, despite current product cost changing to 99 |
| Net bank payment after traced reversal | 10 |
| Final stock | 13 |
| Final supplier payable | 100 |
| Final cash / bank | 70 / 490 |

The payable equation is 80 + 100 - 30 - 40 - 10 - 100 + 100 = 100.
Three main supplier receipts, five settlement records, seven payable journal
events and four product stock logs were verified. All persisted journals balance;
stock agrees with stock-log movements. Supplier and cash/bank reconciliation agree.
Seeded customer debt and store credit are unchanged; no CustomerLedger entry was
created. Historical deferred receipts remain deferred, without automatic reposting.

Executed verification:
- Backend TypeScript build: passed.
- Complete backend suite, serialized: 343 passed, zero failures/skips.
- Focused purchase/payable/settlement replica suites: 56 passed, zero failures/skips
  (a subset rerun, not 56 additional distinct backend tests).
- New real supplier browser runner: 12 scenario groups passed.
- Existing real invoice/POS browser runner: 19 scenario groups passed, including
  returns, refunds, credit, cancellation, quotations, legacy compatibility and
  dated/AI summaries. External AI provider calls are not part of this verification.
- Frontend lint and production build: passed; frontend tests: 56 passed.

Repeat after npm run build with node tests/supplier-browser.integration.mjs.
The runner requires the existing local mongod, Chrome and installed dependencies;
it does not install packages. Local evidence is written to the gitignored
 tests/artifacts/supplier-phase5a-evidence.json and verification logs. No runtime
application correction was necessary; only the repeatable integration test and
verification documentation were added.

Phase 5A is complete for supported local workflows. This is not approval to enable
production accounting. Accounting stays disabled by default and NODE_ENV=test-only.
Receipt allocations, supplier refund-due assets, incoming purchase refunds and
carry-forward supplier credits remain unsupported. Returns above remaining payable
are rejected. Unresolved historical receipt overlap/gaps still require explicit
review. Production configuration, Atlas backups/indexes and any future activation
require separate approval and verification; none were inspected remotely here.


## Expense Management - operating costs (2026-10-16)

OWNER-only routes under /api/v2/accounts/expenses reuse verifyJWT,
verifyShopUser (subscription/manual access), verifyOwner and businessTransaction.
No CASHIER or ADMIN expense access is granted. All references are resolved inside
the authenticated shop; client actor identities and journal postings are ignored.

Endpoints:
- GET /setup: {available,message,accounts}. With disabled accounting, available is
  false and accounts is empty. With missing cutover, returns a controlled setup
  error. Prepared account selection is explicit; there is no implicit cash account.
- GET /categories: {entries}; POST /categories: {name}, returns the category.
  Names are trimmed, case-insensitively unique per shop, maximum 80 characters.
  Up to 200 categories per shop. Existing matching category creation is idempotent.
- POST /: {requestKey,categoryId,accountId,amountMinor,occurredAt,description,
  reference?}. Positive safe integer paisa, canonical non-future UTC timestamp,
  description up to 300 characters, reference up to 100. Example amountMinor 1250
  means PKR 12.50. Returns {expense,journalId,replayed}; replay returns the same
  expense without a second posting. Keys have 8-100 letters/digits/underscore/hyphen.
- GET /: q,categoryId,month=YYYY-MM,page,limit (max 100). Returns entries,
  pagination, totalMinor and breakdown [{categoryId,category,netMinor}]. Search
  covers category/description/reference/payment-account name and escapes regex.
- GET /:id: {expense,reversal,journal}, all scoped to the authenticated shop.
- POST /:id/reverse: {requestKey,occurredAt,description,reference?,confirmation:
  'CONFIRM EXPENSE REVERSAL'}. Returns a new immutable inverse event and journal.
- GET /reconciliation: paginated expense-to-journal issues plus an all-shop
  orphanedJournalCount. Review every page; this is not an automatic repair.

Expense and reversal records snapshot category, account/payment method, actor name
and OWNER role. Effective occurredAt is owner-entered; recordedAt is server-set.
The request hash binds the actor and normalized details. Unique indexes enforce
(shopId,requestKey), and one reversal per original (shopId,reversalOf). Other
indexes cover shop/effective-time ordering and category/date filtering. Categories
use unique (shopId,key). Existing journal request/source uniqueness is reused.

Posting is available ONLY under the unchanged test-only accounting guard and a
prepared active cash/bank cutover. Disabled accounting cannot save a paid expense.
A dedicated JOURNAL EXPENSE account (code OPERATING_EXPENSE) is created atomically
on the first expense. A conflicting reserved code/classification fails closed.
Expense: debit EXPENSE / credit selected CASH or BANK. Reversal: exact inverse,
restoring the original account after the owner confirms funds actually returned.
Original source journal integrity is checked before reversal. Standalone generic
journal reversal is prohibited for expense sources. Correction means reversal,
then a separately confirmed replacement expense; no edits/deletions to history.

The expense event, dedicated-account setup, account revision claims and balanced
source journal commit in one MongoDB snapshot/majority transaction. Existing
posting checks prevent insufficient funds, inactive/foreign accounts, pre-cutoff
posting, backdating before account activity and concurrent double spending. Exact
request replay is safe; uncertain outcomes must retain the original request key.
The UI reuses retained-request confirmation with an expense-specific storage scope.

Monthly expense reporting uses Pakistan calendar months (UTC+05:00, Asia/Karachi),
with half-open boundaries. Stored timestamps remain UTC. Reversals affect their
actual effective month rather than silently changing the original month. Totals
use decimal aggregation plus checked integer conversion. Negative net monthly
expenses are possible when reversing a previous month's expense. These are only
operating expense totals, NOT profit/loss, supplier purchasing, invoice refunds or
inventory valuation. Existing sales/AI UTC reporting remains unchanged.

Expense journals appear once per event in the existing global register and cash/
bank statements, including source references, actor snapshots and reversal links.
Expense reconciliation reports missing/mismatched journals and orphaned journals;
it does not invent payments or repair history. Permanent ADMIN shop deletion also
removes these shop-owned records inside its existing deletion transaction.

Frontend: /owner/expenses, OWNER sidebar Expenses. Categories, confirmation-based
payment/reversal, details, Pakistan timestamps, monthly/category totals, search and
pagination. Disabled/missing accounting is visibly unavailable, never zero or paid.
No new dependencies, production activation, migration or external bank integration.


Expense verification results:
- TypeScript build passed; complete backend suite: 358 passed, zero failed/skipped
  (node --test --test-concurrency=1 tests/*.test.mjs).
- Focused expenses plus permanent-deletion tests: 21 passed, zero failed/skipped.
  Expense tests use real HTTP and an owned disposable loopback MongoDB replica set.
  They cover precision, balanced journals, cash/bank, idempotency, concurrency,
  insufficient funds, rollback, immutable history, source integrity, permissions,
  shop isolation, production guards and Pakistan month-boundary reversals.
- Frontend lint/build passed; 60 frontend tests passed.
- Extended tests/supplier-browser.integration.mjs: 15 real Chrome scenario groups
  passed, exit status 0. This includes all 12 supplier groups plus actual expense
  unavailable/category/payment/detail/search/reversal/net-total/register/role flows.
  It verifies PKR 12.50 reduces cash from 70 to 57.50 exactly once and reversal
  restores 70, with two immutable expense events and clean expense reconciliation.
  Supplier payable remains PKR 100, bank PKR 490, product stock 13, and customer
  debt/credit unchanged. No mocked financial responses or production connection.
- Existing deletion test doubles were updated to include the new collections;
  the first regression attempt exposed that missing fixture, then focused and
  complete reruns passed. No accounting restriction was relaxed to pass tests.

Local runner: npm run build, then node tests/supplier-browser.integration.mjs.
All replica-set runners create and destroy their own local databases; never point
these tests at an existing database. No commit, push, deployment or migration was
performed. Production expense posting remains unavailable until a separately
approved live-accounting activation/cutover is implemented.


## Locked Step 1 of 5 - Business Partners & Capital

OWNER-only module: /owner/partners, sidebar Partners & Capital. Existing business
identities gain a PARTNER role, including the shop owner as an ordinary named
partner. No User/login is created and no ownership percentage is implied. An
existing customer/supplier/company identity can gain PARTNER without duplication;
customer debt, supplier payable and store credit remain separate. New standalone
partners and their names/contact details can be managed while accounting is off.
Linked Customer identity fields are not overwritten. Revision checks protect
metadata updates. A zero-capital partner can be archived/reactivated; financial
posting requires an active partner. Archiving requires prepared test accounting
and a verified zero capital balance. No partner or history deletion is exposed.

All API paths below are under /api/v2/accounts and use verifyJWT, verifyShopUser
(subscription/manual access) and verifyOwner:
- GET /partners/setup -> {available,accounts,message}; accounts are prepared cash/
  bank selections. Accounting off gives available:false and no payment accounts.
- GET /partners?q=&page=1&limit=20 -> {entries,available,message,total,pagination}.
  Each entry is an existing BusinessEntity plus capital:{authoritative:true,
  contributionsMinor,withdrawalsMinor,balanceMinor}, or capital:null when unavailable.
  total uses the same shape across ALL partners, independent of search/pagination.
- POST /partners -> {key,name,phoneNo?,address?} for a new identity; or
  {entityId,expectedRevision} to reuse an existing identity and add PARTNER.
- PATCH /partners/:id -> {expectedRevision,name?,phoneNo?,address?,partnerActive?}.
  Linked customers cannot be renamed here. Names/contact collisions require review.
- POST /capital -> {requestKey,partnerId,direction:'CONTRIBUTION'|'WITHDRAWAL',
  amountMinor,accountId,occurredAt,description,reference?}.
- GET /capital?partnerId=&q=&page=1&limit=20 -> {entries,pagination}; complete
  chronological history is accessible through deterministic timestamp/_id pagination.
- GET /capital/:id -> {event,reversal,journal}.
- POST /capital/:id/reverse -> {requestKey,occurredAt,description,reference?,
  confirmation:'CONFIRM CAPITAL REVERSAL'}.
Financial writes return {event,journalId,replayed}; identical replay returns the
original event without reposting. Effective timestamps are canonical non-future
UTC, recorded timestamps and actor identity are server-controlled. Display dates
use Asia/Karachi. Limit is capped at 100, text search is escaped/bounded.

Each partner has one JOURNAL PARTNER_CAPITAL account, normal side CREDIT, linked
by entityId (existing unique shop/entity/kind index). CapitalEvent is immutable,
with partner/account/actor snapshots, dated source identity, request hash/key and
original reversal reference. Unique shop/requestKey and shop/reversalOf indexes
prevent duplicate events/reversals. Shop/date and shop/partner/date indexes support
history. Existing journal source and request uniqueness remains authoritative.

Contribution: debit selected CASH/BANK, credit PARTNER_CAPITAL.
Withdrawal: debit PARTNER_CAPITAL, credit selected CASH/BANK.
Reversal is the exact inverse to the original accounts, only after confirmation
that the real funds have moved back. Original records remain immutable. Full
reversals only; correct with a separate new posting afterward. Reversals of
reversals, standalone generic journal reversals, manual capital journals and
capital opening journals are rejected. Capital accounts cannot lose their partner
role once financial records exist. Negative partner capital is not supported.

Transactions use the existing MongoDB snapshot/majority transaction boundary,
shop/account revision claims and balance checks. The source event and both journal
postings commit atomically. Insufficient cash/bank OR partner capital is rejected,
including reversal of an investment that has already been withdrawn. Prepared
cash/bank cutoffs and chronological account posting apply unchanged. Exact-key
replay is safe; the UI retains uncertain requests under capital-operation and
never creates a new key to retry an uncertain result.

Capital summaries reconcile immutable event totals with source journals, journal
counts and actual capital-account balances; missing/unmatched history fails closed
rather than being repaired. Contributions/withdrawals are net of their linked
reversals. Balances are derived, never stored as a second authoritative balance.
Global transaction history and per-account statements include capital events,
source references, actors and reversal relationships. Capital never enters sales,
operating expenses, supplier debt or customer credit. Permanent shop deletion also
removes CapitalEvent in its existing transaction.

IMPORTANT COMPATIBILITY: totals cover recorded partner movements only. Existing
cash/bank opening funds are NOT automatically attributed to any partner. Never
re-enter those old funds as a new investment: that would double-count cash. A
historical partner-capital opening/reclassification requires a separately approved
reconciliation plan and is not implemented. No production accounting activation,
loans, profit distribution, salary calculation or ownership-share tracking is added.
Production accounting remains disabled; BUSINESS_ACCOUNTING_ENABLED is unchanged
and can only be true under NODE_ENV=test. Missing cutover is an explicit unavailable
state, not a zero balance. Tests never connect to Atlas or an existing database.


Step 1 verification (disposable loopback replica sets only):
- TypeScript build passed. Complete backend suite: 376 passed, zero failed/skipped.
- Focused capital replica-set suite: 18 passed. Covers OWNER/foreign-shop guards,
  identity reuse, disabled/prepared modes, balanced cash/bank directions, separate
  customer debt/credit, duplicate and concurrent requests, rollback, insufficient
  cash/capital, historical snapshots, archive/revision checks, journal mismatch,
  source-linked history, manual-journal rejection and production restrictions.
- Frontend lint/build passed; 64 frontend tests passed.
- Real Chrome supplier/expense/capital runner: 18 scenario groups passed, exit 0.
  Capital scenario: cash PKR 70 -> investment 20 -> cash 90 / capital 20 ->
  withdrawal 5 -> cash 85 / capital 15 -> withdrawal reversal -> cash 90 /
  capital 20 -> contribution reversal -> cash 70 / capital 0. Four immutable events
  remain. Metadata rename preserves historical partner-name snapshots. Zero-capital
  archive succeeds and CASHIER is denied both UI and backend management access.
- Existing supplier payable PKR 100, bank PKR 490, stock 13, expense net zero and
  customer debt/credit remain unchanged. Existing sale/invoice/stock regressions
  pass in the complete backend and frontend suites.
- No application guard was relaxed. Initial new-test fixture issues (missing Order
  import and an earlier cash-routing guard masking the intended capital guard)
  were corrected, followed by passing focused and complete reruns.

Repeat with npm run build; node --test tests/capital-replica.test.mjs; and
node tests/supplier-browser.integration.mjs. The browser runner requires existing
local mongod/Chrome and installed frontend dependencies. It bypasses production
.env loading and creates/deletes only its own verified local database and temp
files. No secrets/environment files, Atlas data, branches, commits, pushes or
deployments were changed. Locked Step 1 ends here; no later phase is implemented.


## Locked Step 2 of 5 - Existing Business Setup

OWNER page /owner/existing-setup adds a guided opening REVIEW and one-time
confirmation, not a migration or historical transaction generator. It reuses
Product stock/cost, Customer and CustomerLedger, supplier cutover/receipt evidence,
FinancialAccount, recordOpeningBalance, prepareCashBankCutover and
initializeSupplierCutover. Step 1 partner capital remains untouched.

New routes, under /api/v2/accounts, use the existing verifyJWT, verifyShopUser and
verifyOwner middleware:
- GET /existing-setup -> {setup,evidence}. DRAFT evidence is freshly read. CONFIRMED
  evidence is the immutable opening snapshot, never today's recomputed balances.
- PUT /existing-setup -> {expectedRevision,input}; returns {setup,evidence}.
  Draft corrections do not post money or change quantities/customer balances.
- POST /existing-setup/preview -> {expectedRevision}; returns {setup,evidence,
  previewToken,expectedRevision}. The token expires after five minutes.
- POST /existing-setup/confirm -> {expectedRevision,previewToken,requestKey,
  confirmation:'CONFIRM EXISTING BUSINESS SETUP'}; returns {setup,replayed}.

Draft input:
{cutoffAt:'canonical non-future UTC timestamp',reason:'owner review note',
 cash:[{accountId,amountMinor}],
 suppliers:[{supplierId,otherOpeningMinor,reviews:[{receiptId,unpaidMinor,reason}]}],
 expectedNetAssetsMinor:19200,acknowledgeLegacyCustomerBalances:true,
 acknowledgeUnallocatedEquity:true}
All balances use integer paisa. Only expectedNetAssetsMinor can be negative.
Suppliers with a confirmed opening are reused, not re-opened. Every other supplier
must explicitly review all existing deferred receipts and other historical debt.
Delivery unpaid amounts cannot exceed original values; zero means externally
settled evidence, not a fabricated payment. Core supplier cutover validation is
still authoritative. All active shop cash/bank accounts need explicit balances;
missing/foreign/inactive selections are blocked.

Evidence includes inventory rows (quantity, unitCostMinor, valueMinor), existing
customer debts and store credit with reconciliation issues, cash setup status,
supplier setup status/deliveries, totals, blockers and a source digest. Missing
amounts are null/unavailable rather than assumed zero. The initial guided review
supports at most 1000 products/customers, 100 suppliers, 100 receipts per supplier,
20 selected cash/bank accounts, 500 financial accounts, 1000 journal records and
10000 receipts/ledger/invoice records. Larger reviews fail closed; the existing
16KB HTTP request limit also applies. Do not split openings to bypass these limits.

Opening equations (supported records only):
assets = existing stock value + verified cash/bank + existing customer debt;
liabilities = reviewed supplier payable + existing customer store credit;
net business value = assets - liabilities;
review difference = net business value - owner-declared expected net value.
Nonzero differences and unresolved evidence prevent confirmation. This is not a
complete trial balance, profit/loss, loan register or fixed-asset valuation.

Confirmation uses a MongoDB snapshot/majority transaction, revision-safe singleton
BusinessSetup (unique shopId), expiring server preview/source digest, explicit typed
acknowledgement and exact-key idempotency. Stock/customer records are claimed for
transaction conflict protection by updating their metadata timestamp; quantities,
prices, remainingMoney, storeCreditBalanceMinor and customer ledgers are NOT
increased or rewritten. Concurrent relevant record changes force fresh review.
The owner should pause trading and receiving during opening review.

Posting policy:
- Existing stock is valued once at reviewed current Product.costPrice x existing
  quantity. Debit dedicated opening INVENTORY / credit unallocated OPENING_EQUITY.
  No stock increment or fake stock log. Zero inventory has a confirmed snapshot,
  without a fake zero-value journal. This is an opening snapshot, NOT perpetual
  inventory valuation or historical cost-of-goods-sold accounting.
- New positive cash/bank openings reuse Dr CASH/BANK / Cr OPENING_EQUITY. Zero
  account balances use existing zero cutover evidence without zero-value journals.
  Existing prepared cash/bank openings must match and are not posted again.
- Supplier openings reuse Dr OPENING_EQUITY / Cr SUPPLIER_PAYABLE. Deferred receipts
  stay deferred; they are not reposted. New receiving after cutoff retains the
  existing source-linked payable policy.
- Customer debt/store credit remain authoritative in their existing ledger. No
  duplicate receivable/liability journal is created. Journal-backed opening equity
  (stock + cash - suppliers) and preserved net customer balances are shown
  separately. Their sum gives supported net business value.
- Opening equity is UNALLOCATED; no CapitalEvent or partner contribution is created.
  Assigning historical equity to partners requires a separate approved policy.

Financial confirmation requires the unchanged test-only accounting flag. It
atomically creates/reuses required accounts, posts openings and prepares cash/bank
cutover before commit. Missing setup remains incomplete/blocked; production
accounting cannot be enabled by this page. Existing posted business activity or
inventory journals block initial setup rather than reconstructing an old cutoff.
Extra accounts cannot silently extend an immutable existing cash cutover.

Customer history mismatches, missing customer identities, outstanding invoices
without a valid customer, missing supplier identities and invalid precision block
confirmation without repairing data. Importing paper customer debts/credits without
traceable existing records is NOT implemented: it requires an approved customer
opening-ledger reconciliation design compatible with invoice settlement. Do not
create dummy invoices to bypass this blocker.

Drafts can be corrected until confirmation. Confirmed input/evidence are immutable;
there is no reset/delete route. Prepared cash, supplier openings and the confirmed
inventory opening cannot be undone using generic standalone reversal. Corrections
require separately reviewed reconciliation. Permanent ADMIN shop deletion remains
the sole tenant-wide deletion exception and now includes BusinessSetup.

Verification:
- Backend TypeScript build passed; complete suite 390 passed, zero failed/skipped.
- Final focused setup/deletion replica tests: 20 passed. Verified existing stock,
  real pre-cutover invoice debt and refund-issued store credit, supplier deferred
  receipts/openings, cash/bank including zero and previously prepared balances,
  revisions, expired/stale previews, concurrent stock and duplicate confirmation,
  late rollback, cross-shop/role isolation, immutable confirmation, no duplicate
  customer balances/stock/openings, and post-setup POS/purchasing compatibility.
- Main replica scenario preserves 21 units, customer debt PKR 20 and credit PKR 10.
  Opening stock value PKR 42 + cash/bank PKR 150 + customer debt PKR 20 minus
  supplier payable PKR 10 and store credit PKR 10 = net PKR 192. Journal-backed
  opening equity is PKR 182; preserved net customer balances PKR 10 are NOT posted
  again. No capital investment or extra sales/stock/customer-ledger record appears.
- Frontend lint/build passed and 68 tests passed. Real Chrome runner passed 20
  supplier/expense/capital/setup scenario groups. A separate fresh shop confirms
  stock PKR 60, cash PKR 100, empty bank PKR 0, supplier opening PKR 10 and net
  PKR 150 through the actual UI. Stock remains 6 units; exactly three journals,
  no capital event, and exact confirmation replay creates no additional postings.
- All financial tests use owned disposable loopback replica sets, never Atlas.
  No production records, environment secrets, branches, commits, pushes or
  deployments were changed. Step 1 work is preserved. Step 3 is not started.


## Locked Step 3 - Financial Reports

OWNER-only GET /api/v2/accounts/reports?from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z.
Uses the existing authenticated shop, manual access, subscription and OWNER middleware.
No client shop selection and no financial mutations. All component reads share a snapshot
transaction. Responses have Cache-Control: no-store and the existing apiResponse envelope.
Dates must be canonical UTC, start inclusive/end exclusive, in a positive range up to 366 days.
The frontend Through date is inclusive and translated to the following UTC midnight.
Displayed timestamps are Pakistan-local; reporting date boundaries remain explicitly UTC.

Response data: currency, asOf, range, coverage, sales, expenses, cashBank, customers,
suppliers, capital, inventory, opening, profit. All monetary fields ending Minor are
integer paisa; checked BigInt sums reject overflow. Legacy PKR inputs must round-trip to
paisa without inventing precision. A section with insufficient evidence returns status
UNAVAILABLE and a message, not a fabricated zero. Other sections remain readable.

- sales: originalGrossMinor, originalDiscountsMinor, additionsMinor, returnsMinor,
  discountChangesMinor, netDiscountsMinor, revenueMinor, invoiceCount, adjustmentCount,
  excludedUntimedCancellations. Original snapshots belong to original creation dates;
  ADJUSTMENT/CANCELLATION item and discount deltas belong to occurredAt. Dated LEGACY
  cancellations reverse on cancelledAt. Untimed legacy cancellations retain their existing
  excluded policy and are counted when their original invoice is in range (INCOMPLETE).
  Other missing original snapshots, incompatible money or contradictory movement evidence
  fail the section closed. Quotations and PAYMENT events do not count as sales. Cash
  receipts, refunds and credit movements are never added again as revenue.
- expenses: prepared test accounting required. Source-linked event/journal postings and
  timestamps are checked. spentMinor, reversedMinor and netMinor plus categories with
  totalMinor use actual expense/reversal dates. Purchases, supplier payments, customer
  refunds, capital and openings are not operating expenses.
- cashBank: each same-shop cash/bank account has currentBalanceMinor and, where covered,
  selected-range openingMinor, closingMinor, netMovementMinor and first five chronological
  transactions. Existing paginated statements provide full history. All are derived from
  posted journals, not inferred invoice totals. Openings, transfers and capital movements
  are retained as their actual event types, not reclassified as revenue. Ranges starting
  before confirmed preparation or entirely in the future return null range amounts with
  rangeAvailable=false, while a prepared current balance remains visible. Through-today
  statement reads cap their end at now (existing statements reject future boundaries).
  An unprepared account is unavailable, not zero. Inactive accounts are not silently omitted.
- customers: current authoritative stored debtMinor and storeCreditMinor, separately,
  checked through existing customer reconciliation. Any discrepancy marks totals
  PROVISIONAL and individual customers Needs review; reading never repairs balances.
- suppliers: current posted payable per supplier after existing cutover/reconciliation.
  Any unresolved supplier makes totalMinor=null and status INCOMPLETE. Deferred receipts
  are evidence only, never added as debt. Individual unavailable reasons remain visible.
- capital: current reconciled contributionsMinor, withdrawalsMinor, balanceMinor per
  partner and overall, using the existing capital/event reconciliation including reversals.
  Neither partner capital nor unallocated opening equity is revenue or profit.
- inventory: current same-shop product quantities and referenceValueMinor = current
  quantity times current product cost, explicitly PROVISIONAL. This is a reference estimate,
  NOT historical valuation or COGS. Confirmed setup provides a separate HISTORICAL opening
  snapshot at its original cutoff; it is never rolled forward as if it were current value.
- profit: UNAVAILABLE. Order lines do not snapshot historical purchase costs. Purchase
  receipts preserve receipt costs but do not allocate costed layers to sold units; opening
  stock, manual changes, damaged returns and cost changes lack continuous valuation.
  No profit or sales-minus-expenses approximation is presented. Reliable future COGS would
  require a separately approved valuation/cutover policy and auditable costed movements.

Selected dates apply only to sales, expense activity and cash statements. Customer debt,
supplier debt, partner capital and stock are CURRENT snapshots, not historical balances.
Posted accounting sections remain disabled by default, test-only and preparation-gated.
Sales, customer and inventory reads can still show existing shop evidence when accounting
is disabled. No production accounting activation, migrations or historical backfills.

Bounded scans: at most 1,000 evidence rows per query; 500 customers; 100 suppliers,
partners or cash/bank accounts. Above the bound, that section is unavailable rather than
silently truncated. Use narrower flow dates or existing paginated detailed screens.
Missing/untimed historical records and incomplete test journal coverage prevent presenting
this module as a complete historical production financial statement.

Verification: focused arithmetic and disposable real MongoDB/HTTP report checks cover
precision, discounts, dated returns, cancellation previews, partial payment/debt, separate
store credit, opening snapshots, expense/capital reversals, cash range balances, disabled
states, read-only behavior and role/shop isolation. The existing real Chrome supplier
runner includes two Financial Reports groups in addition to prior business regressions.


## Locked Step 4 - Supplier Credits & Refunds

This section supersedes earlier statements that paid-goods returns, supplier credits and
refunds are unsupported. Accounting remains disabled by default and NODE_ENV=test-only.
All supplier financial APIs remain OWNER-only, authenticated, shop/subscription checked.

A supplier has two independent journal-derived balances: SUPPLIER_PAYABLE (credit-normal)
and SUPPLIER_CREDIT (debit-normal asset, unique per shop/entity). Credit is created only
from accepted, eligible post-cutover goods returns. The Supplier Account labels this asset
"available credit / refund due": these are the SAME pool, never two additive balances.
No supplier opening credit is invented, no historical receipts are reposted, and no existing
customer debt/store-credit accounting is changed.

Return value at original received unit cost is split: min(return value, current payable)
debits payable; the remainder debits supplier credit; purchases clearing is credited with
the complete return value. Stock, audit logs, immutable settlement and journal commit in
one existing MongoDB transaction. Creating/confirming an order still does not post money.
Receiving new goods still creates payable, not an automatic credit application.

New endpoints under /api/v2/accounts/suppliers/:id:
- POST /refunds: requestKey, reference, reason, occurredAt (canonical UTC), amountMinor,
  accountId and confirmation="CONFIRM SUPPLIER REFUND RECEIVED". Dr selected prepared
  cash/bank, Cr supplier credit. Record only money actually received. Not sales revenue.
- POST /credit-applications: requestKey, reference, reason, occurredAt, amountMinor and
  confirmation="CONFIRM SUPPLIER CREDIT APPLICATION". Dr payable, Cr supplier credit;
  no cash and no operating expense. Amount cannot exceed either current balance.
Existing POST /returns now allows excess over payable. Existing
POST /settlements/:eventId/reverse supports PAYMENT, RETURN, REFUND and CREDIT_APPLICATION.
Explicit confirmation remains "CONFIRM SUPPLIER REVERSAL". It records the exact inverse
with authenticated actor and actual reversal date; it never edits the original event.

Balance/reconciliation responses add creditAccountId, creditMinor, refundDueMinor (same
amount, alias for clarity), refundsReceivedMinor and creditAppliedMinor (net of reversals).
Both balances must reconcile before any new settlement. Unavailable remains null, not zero.
Financial Reports now show payable and supplier credit separately; credits/refunds never
enter sales, expenses or partner capital totals. Credit statements use the existing account
history APIs and global register, with new SUPPLIER_REFUND and SUPPLIER_CREDIT_APPLICATION
source kinds, source references, actor snapshots and reversal links.

Settlement history adds payableReductionMinor, creditMovementMinor and creditAccountId.
Magnitude fields retain their original values on reversal; kind/originalKind determine the
inverse direction. Existing PAYMENT/RETURN records without split fields retain their old
meaning: entire amount reduced payable, no credit. No migration or read-time rewrite.

Corrections fail if they would make credit, payable, cash/bank or stock invalid. In
particular a return's credited portion must still be available before reversal. Reverse
its consumed refunds/applications first (and restore actual money/goods). A refund reversal
requires enough actual cash/bank to return that money. Credits are fungible at supplier
level; applications/payments remain UNAPPLIED_SUPPLIER_LEVEL, not guessed allocations to
specific receipts or opening debt. Original receipt/return/payment references remain intact.

Shared shop/account revision claims, conditional stock writes, unique request/reference
indexes and immutable source journals prevent concurrent double spending. Failed or
conflicting writes roll back atomically. Identical requests replay the original result;
uncertain network outcomes retain the exact key in the existing SupplierAction workflow.
Chronological account posting guards and supplier/cash cutoffs remain enforced. Deferred
historical deliveries are still excluded from return/credit creation pending reconciliation.

OWNER use: Purchases -> delivery -> Return details; then Supplier Account -> Use supplier
credit -> Supplier refunded money (choose receiving cash/bank) or Apply credit to outstanding
payable. Review and explicitly confirm. History -> Correct -> Review reversal records a
traceable inverse after actual funds/goods have been restored. Full credit statements remain
available through the existing Transactions screen; no duplicate financial module was added.

Step 4 verification: TypeScript build passed; complete backend suite 411 passed, zero
failures/skips. Focused supplier replica-set suite 31 passed (included in the full suite).
Real Chrome/HTTP/MongoDB 8.3.4 integration passed 24 scenario groups, including paid-goods
returns, partial refunds/applications, identical replay and UI reversals. Tests explicitly
verify legacy split-field compatibility, reports excluding refunds from revenue/expenses,
concurrent refund-versus-application, journal rollback (including first credit-account
creation), actual foreign-account rejection and unchanged customer/partner balances.
Production environment files were bypassed; databases were disposable loopback replica sets.


## Locked Step 5 - First round corrections (safe portions and explicit blockers)

1. Existing business roles use PATCH /api/v2/accounts/entities/:id/roles with
expectedRevision. The OWNER UI exposes it without replacing the entity. Customer role
follows its existing customer link; supplier/partner history removal guards remain intact.
Business setup (identity, roles, brands) and Supplier history (financial activity) are separate
labels/links, not duplicate identities or ledgers.

2. Purchase/receiving reference is now optional. Omitted/empty reference generates
PO-AUTO-N or GR-AUTO-N using purchaseCounter/receiptCounter on the existing Shop model,
in the SAME purchase/receiving transaction. Legacy shops need no migration: incrementing
a missing counter starts at 1. Existing occupied identifiers are skipped (bounded 1,000
attempts, otherwise fail closed). Unique shop/reference indexes remain authoritative.
Manual references remain accepted for compatibility, unchanged; existing documents are not
renumbered. Exact request replay is checked before allocating a number. Aborted writes do
not issue an identifier or advance the committed counter; committed identifiers are never
reused. Concurrent conflicts require the existing identical-key retry policy.
Both order and receipt support optional notes (500 chars) and supplierDocumentNo (100
chars). Metadata participates in idempotency identity and is displayed/searchable. Supplier
invoice/challan identifiers are evidence, not assumed unique internal references. Legacy
hashes without optional metadata remain compatible. Generated receipt references are also
saved on corresponding stock logs, preserving all source integrations.

3. Explicit linking uses the existing registered-brand and product-brand APIs. Product
free-text brand must match the chosen same-shop registered brand; nothing is auto-migrated.
New OWNER-only GET /api/v2/accounts/entities/:id/products?page=1&limit=10 provides entries
(_id, name, brand, unit, stockQuantity, brandId), pagination and sales.status/message.
Each query/lookup is shop-scoped. Only explicit, currently matching links count; deleted
products and stale text/brand mismatches are excluded. At most 100 results per page and
1,000 associated brands are supported; larger reviews fail closed. Brand association does
not prove purchase supplier. Historical company sales remain UNAVAILABLE because mutable
company/brand associations were not captured on original sales.

4. Valuation audit: order/original/adjustment lines snapshot SELLING prices, not purchase
costs. Goods receipts snapshot agreed original receipt costs, but do not identify costed
units consumed by sales. Stock logs track quantities, not continuous inventory value.
Product.costPrice is mutable; manual/opening quantities and damaged returns do not create
complete cost layers. Existing setup is a dated owner-confirmed opening snapshot, not a
continuously maintained valuation ledger. Therefore no reliable historical or prospective
COGS/profit rollout was improvised in this corrections pass. Financial Reports add actual
shop/date-scoped evidence counts (invoicesInRange, receiptCostRecordsInRange,
quantityOnlyStockRecordsInRange) and explicit false costAtSaleSnapshots /
continuousCostedStockLedger. Gross AND operating profit remain unavailable, never current
cost multiplied into historical sales or sales-minus-expenses presented as profit.

Required separate valuation implementation: agree FIFO versus moving weighted average,
confirm physical quantity and evidenced opening cost at an explicit per-shop/product cutoff,
then atomically maintain immutable costed movements and sale-unit cost snapshots across
receiving, manual changes, POS, quotation conversion, returns (RESTOCK versus DAMAGED),
exchanges, cancellations and supplier returns/reversals. Supplier return original-cost versus
remaining-layer differences and damaged write-off policy require explicit rules. Cost changes
must not rewrite consumed costs. Reconcile stock quantities AND value; only complete periods
can expose gross profit, then reconciled operating expenses produce operating profit. Missing
cost evidence must block completion. This is a significant accounting/cutover extension,
not safe to substitute with present product prices or a destructive historical migration.
No inventory/COGS financial mutation or historical backfill was added in this pass.

5. Supplier Account now exposes the existing /cutover-preview and /cutover workflow for
verified historical openings, even when whole-business setup can no longer be reset.
OWNER reviews every deferred delivery, states unpaid amount (0 if externally settled),
records evidence notes and other verified debt, chooses explicit same-shop payable,
purchases-clearing and opening-equity accounts, acknowledges no double count, then confirms.
Account creation is explicit, uses existing test-only APIs, and itself posts no balance.
No account routing is guessed. Backend digest, cutoff, immutable opening, unique keys and
balanced atomic journal safeguards are reused unchanged. Original deferred receipts stay
DEFERRED and are not reposted; later eligible receiving posts normally. UI bound matches
existing maximum 100 reviewed receipts; larger/ambiguous reviews remain blocked.
Existing verified customer debt/store credit remain their existing authoritative balances;
customer review now lists actual reconciliation issues and warns against duplicate openings.
Unlinked/inconsistent customer invoice/ledger evidence is NOT repaired merely by owner text.
A separate approved source-linked customer opening/reconciliation plan is still required for
such records; no fictitious sale, receipt, payment, purchase or partner investment was created.

Verification: TypeScript build passed; full backend suite 414 passed, zero failures/skips.
Focused real-replica purchase suite 19 passed (included). Frontend lint/build and 79 tests
passed. Actual Chrome/HTTP/disposable MongoDB integration passed 27 scenario groups,
including existing regressions, role editing, explicit product-brand stock association,
automatic references/notes/challan, legacy collision skipping, duplicate replay, concurrent
numbering, transactional counter rollback and owner-reviewed deferred supplier openings.
The review test recorded only the verified unpaid 75 paisa of a 100-paisa deferred receipt,
kept that receipt unchanged, and subsequently posted a new 100-paisa delivery as payable
(total 175), without inventing the externally settled 25-paisa payment. Main existing stock,
cash/bank, supplier, customer, expense and capital balances remained consistent.
Accounting is still disabled by default and test-only. No production data access/migration,
branches, commits, pushes, deployment or full-project survey occurred.


## Production activation policy update

See [ACCOUNTING_ACTIVATION.md](ACCOUNTING_ACTIVATION.md) for the current explicit production permission, per-shop activation, clean-start/reconciliation, account enrollment, pause/resume and deployment contracts. This supersedes historical test-only restrictions above. Defaults remain disabled; no automatic demo cleanup or production migration is provided.

### Simplified supplier starting balances

The supplier opening UI now asks whether the supplier is new or existing. New
suppliers still explicitly confirm zero debt and no historical deliveries.
Existing suppliers review every deferred delivery and separately declare other
previous debt; the displayed total is reviewed unpaid deliveries plus other debt.
The server verifies this total, evidence digest and cutoff before recording it.

`POST /api/v2/accounts/suppliers/:id/cutover` now accepts historical openings
without account IDs. It reuses the supplier payable account and the supplier's
`RECEIVED_<supplierId>` / `EQUITY_<supplierId>` account codes, creating missing
accounts transactionally. It never guesses another shop-level clearing/equity
account. Conflicting codes, inactive accounts and existing payable activity fail
closed. Existing API callers can still supply all three manual account IDs;
partial overrides are rejected. Exceptional account selection remains available
through that existing API, not the normal shopkeeper form.

The journal remains Dr OPENING_EQUITY / Cr SUPPLIER_PAYABLE for positive openings.
Zero openings have confirmation evidence but no journal. No stock, purchase,
payment or partner investment is created. Deferred receipts are not reposted.
No schema/index migration or historical financial rewrite is required.
