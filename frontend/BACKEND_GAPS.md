# Backend limits affecting this frontend

The backend was re-inspected before initial implementation. Manual shop deactivation/reactivation has since been added as a focused backend/frontend feature; other limits below remain.

- No dedicated owner/cashier shop-detail or subscription-status endpoint. Login/current-user now return the authenticated shop's shopName for OWNER/CASHIER and subscriptionExpiry for OWNER only. Registration also returns its newly created shopName. Payment-proof messages still ask the Owner to include their Shop Name. Cashier subscription blocking is detected from the existing business API's subscription rejection, without exposing payment details.
- No quotation retrieval/history endpoint. Quotes stay in memory for the signed-in session; reload/sign-out clears the visible list. The quote remains stored in the backend but cannot be recovered through its current APIs. This limitation is stated in the Quotations screen.
- Quotation conversion omits customerId and discountValue on the resulting invoice. Immediate receipts use the selected customer and server-calculated totals, but historical converted invoices may lack customer information. The frontend does not guess that association.
- Invoice details populate current product/customer names rather than immutable historical snapshots. Reprinted descriptions can differ after future changes. Missing products show Product unavailable, never raw IDs.
- No customer edit/delete, debt collection, customer ledger retrieval, product identity edit/delete, category edit/delete, staff list/edit/disable or configurable subscription duration. No controls are invented for these operations.
- Product search returns an unpaginated list and interprets search as a regular expression. Frontend search escapes regex characters and debounces requests. Very large catalogues will need backend pagination.
- Invoice creation/conversion have no idempotency key. UI disables repeated submissions and does not replay writes for timeouts/network failures. An interrupted response may still mean a sale was saved; an owner should check invoice history before repeating it. Cashiers need owner assistance for that check.
- Subscription middleware is applied inconsistently in the backend, including quotation conversion bypassing it. The frontend blocks Owner business screens at their returned expiry and blocks either shop role when the existing subscription middleware rejects a request. This does not strengthen backend enforcement for unprotected endpoints; full enforcement across all business APIs would require a separately authorized backend fix. Manual deactivation enforcement remains separate and unchanged.
- Refresh errors can use 400/401/500; refresh responses expose a refresh token. The frontend only uses cookies, keeps a whitelisted user object in memory, and never stores returned tokens. Credentialed production deployment still needs matching CORS and cookie SameSite settings. Logout cookie options differ between development creation and clearing; a live-browser check is advisable.
- Cancellation reverses stock/debt, not money already paid. The cancellation confirmation says refunds must be handled separately.
- Stock update on the product endpoint bypasses audit history. Product Edit deliberately edits prices/threshold only; stock changes use the transactional adjustment endpoint.
- Sales require integer quantities even for meter units. The POS uses whole quantities to match the backend; fractional-length sales require a backend decision.
- No currency setting or rounding policy exists. Prices are shown with two decimal places without an invented currency symbol. Backend totals are authoritative; the frontend does not silently alter credit calculations.
- AI Assistant uses UTC calendar days/months because shops have no timezone setting. Recorded sales include credit invoices and exclude quotations/cancellations; they are not cash collections. Product revenue is gross before order discounts. Current-month comparisons compare month-to-date with the complete previous month.
- Historical profit is unavailable: invoice items do not snapshot sale-time cost. Complete customer purchase history is unavailable because anonymous sales and converted invoices may lack customer associations. AI explicitly reports these limitations.
- AI depends on OpenAI availability. Questions/transcriptions are sent for intent classification; database results are formatted locally and are not sent to the AI provider. Audio is removed after processing. Lookup results are capped (20 products, 10 customers, 10 ranked products).
- JSON requests are limited to 16 KB. Unusually large carts can exceed that limit; no bulk sales workflow is promised.

Manual subscription payment instructions are public receiving details only. There are no payment records, payment verification endpoints, automatic renewal, payment/refund services, PDF libraries, or unsupported management functions.

### Business Accounts — Phase 3B frontend boundaries

- Accounts management is OWNER-only. CASHIER retains its existing Customers/POS experience and cannot open Owner Accounts routes; ADMIN is unchanged.
- Companies and customer links reuse existing identities. Product brand text is not an automatic company association; the separate registered-brand links are explicit.
- Supplier purchases, payments and returns are connected in Phase 4D; accounting restrictions are described below.
- Cash/bank creation and prepared account balances/history require explicitly enabled backend test accounting and approved opening/cutover evidence. The frontend does not enable accounting, configure cutover or issue opening balances. Unavailable values are not displayed as zero.
- The financial list endpoint returns paginated account metadata across kinds, without a kind filter. Cash & Bank shows cash/bank rows on each server page and retains that pagination. Transactions can select any listed account, but unsupported/unprepared balances and histories remain blocked by the server.
- Transactions now include the Phase 4A posted-event register and per-account statements. This is not a complete historical financial report. UTC date filters use inclusive From/exclusive Before. Search-filtered running balances may be unavailable; no client-side balance reconstruction is attempted.
- Customer balance details use the existing read-only reconciliation endpoint. Customer debt and store credit remain distinct and no entries or balances are changed by viewing them.


### Supplier workflows - Phase 4D frontend boundaries

- OWNER purchases use existing purchase-order/receiving APIs. Creation and confirmation do not receive stock or create payables. Delivery requests include expected revisions; stock and financial changes wait for confirmed server responses.
- Accounting remains disabled by default and NODE_ENV=test-only. Supplier balances, payments, returns and posted histories require valid backend accounting and cutovers. The UI does not enable accounting or confirm openings. Unavailable balances are not zero.
- Payment accounts are explicitly selected active, prepared cash/bank accounts. Metadata search/pagination is retained because the API has no account-kind filter. Backend routing, funds and payable validations remain authoritative.
- Payments are unapplied at supplier level. Receipt-specific payment allocation, supplier refund-due assets, incoming purchase refunds and carry-forward credits are unsupported. Returns reduce remaining payable only; deferred historical deliveries cannot be returned here.
- Return eligibility is shown only after all receipt-specific history pages, including reversals, load. Histories over 100 pages require review instead of truncated calculations. The server rechecks every quantity and balance.
- User-scoped session storage retains uncertain supplier requests with their original body, timestamp, revision and key. Retry uses that exact request. No automatic retry or new key is generated after an uncertain response. Definite validation/conflict errors require refreshed review.
- The register counts server events once, not postings. Cash/bank movements are distinct from accounting debits/credits. Zero-cost physical returns have settlement history without a fake zero journal. Display dates use Asia/Karachi; reporting filters explicitly remain UTC.
- A return source may have a purchase reference without a document ID. The UI links to purchase search by that reference, without inventing a receipt endpoint. Existing settlement reversal events are displayed; initiating reversals is outside this frontend pass.
- Fixture browser smoke tests use isolated contract responses. Phase 5A additionally verifies the real supplier workflow through Chrome, loopback Express and a disposable local MongoDB replica set. No financial requests are submitted to production Atlas.


### Phase 5A - real local integration verification (2026-10-16)

- Twelve real supplier browser/API scenario groups passed using production-built
  React, actual cookie authentication and disposable MongoDB transactions. Purchase
  creation, partial/full receiving, reviewed supplier opening, post-cutoff posting,
  cash/bank payments, original-cost returns, reversal history and reconciliation
  were verified. No mocked financial responses were used in this runner.
- The main supplier finishes with 13 units in stock, PKR 100 payable, PKR 70 cash
  and PKR 490 bank. Customer debt/store credit remain unchanged. Unavailable
  accounting is displayed as unavailable rather than zero.
- Tests also cover a committed payment with a lost/truncated response and exact-key
  recovery, duplicate/concurrent receiving, late transaction rollback, missing
  openings, deferred gaps, over-receiving/returns/payment, insufficient funds,
  shop/role isolation, browser refresh, search, history pagination, transaction
  details, Pakistan-local display timestamps and responsive layout.
- Existing real invoice/POS browser regressions: 19 groups passed. Backend full
  suite: 343 passed; focused real replica subset rerun: 56 passed. Frontend tests:
  56 passed; lint and production build passed. No application defect was found;
  no frontend runtime code or backend accounting guard changed.
- Accounting remains disabled by default and test-only. Unsupported supplier
  refund-due, incoming refunds, carry-forward credit and receipt payment allocation
  remain unavailable. Production activation and historical reconciliation are not
  authorized by this local verification. No production database was contacted.
- Repeatable supplier runner and local evidence are in the backend repository:
  tests/supplier-browser.integration.mjs and gitignored
  tests/artifacts/supplier-phase5a-evidence.json.


### Expense Management

- OWNER-only /owner/expenses uses /accounts/expenses setup, categories, list/create,
  detail and reverse APIs. No CASHIER/ADMIN expense controls or routes are added.
- Paid expenses are unavailable when accounting is disabled or cash/bank cutover
  is unprepared. Categories may still be created without claiming any payment.
  Production accounting remains disabled and test-only; this module does not
  enable real production expense posting.
- Exact paisa and server totals are authoritative. Monthly/category totals use
  Pakistan calendar months; timestamps display in Asia/Karachi including seconds.
  Reversals reduce expenses on the reversal date, potentially making that month's
  net total negative. Existing sales reporting retains its UTC convention.
- Corrections require confirmed actual restoration of the original funds, followed
  by an immutable reversal to the original account. Record a new corrected expense
  separately. No posted history editing/deletion or partial reversal is offered.
- Retained exact-key requests reuse existing financial confirmation/retry storage
  with an expense-specific scope. A refresh or uncertain outcome must not create a
  new request key. The server revalidates funds and account preparation.
- Existing journal monotonic-date policy applies: an expense cannot predate later
  activity on either participating account. Backdated expense entry, accruals,
  unpaid bills, payroll, tax accounting and profit/loss are outside this module.
- Supplier payments, inventory purchases and customer refunds are not operating
  expenses and are never merged into these totals. No external payment is executed
  or verified by DigiShop; OWNER records an actual payment already made.

- Verified locally: backend build and 358 backend tests; focused expense/deletion
  subset 21 tests; frontend lint/build and 60 tests; 15 real supplier/expense Chrome
  scenario groups. The actual expense page records PKR 12.50 once, shows its source
  and actor, reverses it with actual-funds confirmation, and displays server net
  totals. Cash reconciliation and existing supplier/customer/stock state agree.
  Financial writes used disposable loopback MongoDB replica sets, never Atlas.


### Locked Step 1 - Partners & Capital

- OWNER-only /owner/partners uses /accounts/partners and /accounts/capital APIs.
  Reuses existing BusinessEntity identities, with optional customer/supplier/company
  links through the PARTNER role. No duplicate login or customer balance is created.
- Add/manage partners while accounting is disabled; financial balances show
  Unavailable, not zero. Investments, withdrawals, histories and reversals require
  prepared test-only accounting. Production activation remains prohibited.
- All amounts and balances come from posted journals and immutable event evidence.
  The page shows net contributions/withdrawals and total recorded partner capital,
  independently of cash, sales, expenses, loans, wages or ownership percentages.
- Existing opening cash/bank funds are not automatically allocated to partners.
  Do not record old opening money as new investments. Historical capital allocation
  needs a separate approved reconciliation/reclassification process, not this UI.
- Explicit account selection, confirmation, retained exact-key retry, timestamps,
  details and reversal links reuse existing financial UI patterns. Funds must have
  actually moved; DigiShop neither sends nor verifies bank payments.
- Only full inverse reversals are supported. Cash and partner capital cannot become
  negative. Chronological/cutoff restrictions still apply. Archived partners must
  be reactivated before posting. Archiving requires verified zero capital.
- Linked Customer identity details are not edited in the partner form. Customer
  debt, store credit, supplier payables, purchases and inventory remain unchanged.

- Step 1 verification: backend build and 376 tests passed; focused capital replica
  suite 18 passed; frontend lint/build and 64 tests passed; real Chrome integration
  18 supplier/expense/capital scenario groups passed. Capital cash/equity movements
  and both reversal directions were verified against persisted MongoDB journals,
  while existing supplier, expense, customer and stock balances stayed unchanged.
  All financial test writes used owned disposable loopback replica sets, not Atlas.


### Locked Step 2 - Existing Business Setup

- OWNER-only /owner/existing-setup uses GET/PUT /accounts/existing-setup plus
  /preview and /confirm. It reviews stock, customer debt/credit, cash/bank and
  supplier openings without creating fake sales, investments or historical payments.
- Editable drafts are revision-safe. Confirmation requires a five-minute server
  preview, unchanged source digest, typed CONFIRM EXISTING BUSINESS SETUP and an
  idempotency key retained for uncertain retries. Confirmed openings are immutable.
- Opening inventory uses current stock and Product.costPrice. No stock is added;
  this does not implement ongoing inventory valuation, COGS or profit/loss.
- Customer balances stay in the existing customer ledger; no duplicate AR or credit
  journal is posted. Untraceable balances or missing identities block confirmation.
  Paper customer debt/store-credit import needs a separately approved opening-ledger
  reconciliation design; never create fake invoices as a substitute.
- Cash/bank and supplier openings/cutovers reuse existing backend safeguards.
  Existing valid openings are retained, deferred receipts are explicitly reviewed,
  previous external settlements are not invented as payment records. A zero bank
  opening is supported without a fake zero-value journal.
- Net business value includes preserved customer debt/credit, while journal-backed
  opening equity is shown separately. Equity stays unallocated and does not become
  a new partner investment. Loans/fixed assets/ownership allocation are not covered.
- Posted business activity, prior inventory value or conflicting existing cutovers
  prevent resetting an active shop's books. Reconciliation is required instead.
  The guided review is bounded; backend limits and the existing 16KB request limit
  may require a separately reviewed process for larger businesses.
- Draft review is available with accounting disabled; all financial confirmation
  remains NODE_ENV=test-only. The UI cannot activate production accounting.
- Verified: backend build, complete 390-test suite, final 20-test real setup/deletion
  subset; frontend lint/build and 68 tests; 20 real Chrome integration groups using
  disposable loopback MongoDB only. Source quantities/customer balances and existing
  POS, supplier, expense and capital workflows remain consistent.


## Locked Step 3 - Financial Reports

OWNER /owner/reports reads GET /api/v2/accounts/reports using canonical UTC half-open
ranges; the UI Through date includes that entire UTC day. Timestamps display Pakistan time.
Sales/returns and expense activity are dated flows. Customer balances, supplier payables,
partner capital and stock are clearly current snapshots. Cash/bank range balances are
shown only after confirmed coverage; current prepared balances can remain visible when
selected historical dates are uncovered. Full histories reuse existing statement screens.

Profit/P&L is intentionally unavailable: historical unit costs and continuous costed stock
movements do not exist. Current product cost is shown only as a provisional stock reference
estimate, never historical valuation or profit. Confirmed opening setup remains a separately
dated historical snapshot. No new cost snapshots or valuation workflow were introduced.

Accounting sections remain prepared-test-only; disabled/unprepared/unreconciled amounts are
unavailable, never zero. Supplier totals are unavailable if any supplier needs cutover or
reconciliation. Customer discrepancies are explicitly provisional. Missing legacy sales
metadata/untimed cancellations and bounded evidence scans can make reports incomplete.
No accounting activation or mutations are performed by this page; CASHIER/ADMIN have no
report navigation or access. Existing production financial history is not claimed complete.


## Locked Step 4 - Supplier credit/refund support

The previous limitation blocking returns above payable is superseded. OWNER Supplier
Account now displays outstanding payable and one separate available credit/refund-due
pool, refunds received and credit applications. Partial refunds and applications use the
new /accounts/suppliers/:id/refunds and /credit-applications endpoints with explicit
confirmation and retained idempotent requests. History supports confirmed corrections.
Return entry explains payable-first allocation and excess credit; only an actual refund
increases cash. Financial Reports and Transactions retain separate credit/payable effects.

Still limited to confirmed supplier cutover and prepared test accounting. Deferred historical
receipts remain blocked. No credit openings or automatic backfill, no automatic application
on receiving, and no per-delivery payment/credit allocation are fabricated. Supplier-level
credit/refund due is a single pool, not two assets. A consumed return credit must be restored
before reversing that return. Existing cash-account preparation, chronology, stock and
insufficient-balance checks remain authoritative. Production accounting is not enabled.

Step 4 verification: frontend lint and production build passed; 74 frontend tests passed.
The real browser runner passed 24 integration groups against disposable local MongoDB and
actual Express/React, including supplier credit/refund forms, confirmed corrections and
existing supplier, expense, capital, setup and reporting regressions. No production access
or accounting activation, deployment, commits or pushes were performed.


## Locked Step 5 - First corrections

Business setup now edits existing roles through the revision-protected API; Supplier history
is a distinct navigation action. Explicit product-to-registered-brand linking and current
company-associated stock use existing link APIs and the new paginated entity-products read.
No automatic migration of free-text product brands and no fabricated historical company sales.

Purchase/delivery numbers generate automatically when left blank. Existing references stay
valid. Optional notes and supplier invoice/challan identifiers are saved and displayed.
Supplier Account exposes the existing immutable historical opening review, with explicit
accounts, per-delivery unpaid/external-payment evidence and confirmed cutoff. Confirmation
requires prepared test accounting. Deferred receipts are preserved, not reposted.

Outstanding blockers: reliable COGS needs an approved valuation method, evidenced opening
cutover and continuous costed movement/sale snapshots across ALL stock-changing workflows.
No historical or future profit is enabled merely from current Product.costPrice. Financial
Reports explain actual missing cost evidence. Unverifiable historical customer debt/credit
still requires a separately approved source-linked reconciliation plan; existing authoritative
customer balances are not duplicated or overwritten. See BUSINESS_ACCOUNTS.md Step 5.

Verification: frontend lint/build passed; 79 tests passed; real local browser integration
passed 27 groups, backed by disposable MongoDB/Express (not mocked balances). Full backend
414 tests passed. No production accounting activation, data access, commits or deployment.


## Explicit production accounting activation

Existing Business Setup now provides OWNER-only preparation, readiness, activation, pause/resume, audit history and additional cash/bank enrollment. Both server permissions remain off by default; keep NODE_ENV=production. Historical test-only statements above are superseded by store-backend/ACCOUNTING_ACTIVATION.md.

Clean start never clears demo debt/credit, supplier obligations or history. Nonzero/unreconciled evidence blocks it. Explicit reconciliation retains verified genuine balances only; unsupported demo cleanup remains blocked. Pre-start clean-start invoices stay readable but cannot issue settlements into active accounts. Preparation freezes business mutations until activation. Confirmed openings cannot be reset. Historical GL/COGS/profit remains incomplete.

Enrollment requires verified opening money, not transfers or investments. The picker loads the first 100 accounts; larger shops can use an explicit authenticated API selection. Guided readiness limits are documented; missing evidence fails closed.
