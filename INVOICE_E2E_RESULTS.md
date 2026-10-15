# Invoice returns/exchanges: local integration verification

Verified 2026-10-15. No deployment, production database connection, migration,
production environment edit, commit or push was performed.

## Reproduction

After `npm test` in the backend and frontend lint/build/tests:

    node tests/invoice-browser.integration.mjs

Requires the installed Windows MongoDB 8.3 binary and Chrome at the explicit paths
in the runner. Missing binaries fail closed. It creates an unused loopback port,
fresh temporary dbpath, single-member replica set and `digishop_local_browser_test`.
Before seeding, it checks host, port and database name. It does not load a real
backend .env or invoke normal application startup/bootstrapping. All credentials
are disposable test values. API/CORS URLs are process-local overrides only.

Actual compiled Express, actual production-built React/Vite, HTTP cookies, MongoDB
transactions and Chrome are used. There is no browser Fetch interception or mocked
financial response. The temporary database, browser profile, frontend build and
processes are cleaned after each run. Only the runner's verified temporary folder
is recursively removed; existing databases and project build directories are not.

## Verified flows

- Ordinary cash invoice through POS; return RESTOCK; cash refund.
- Damaged identical exchange: old returned units at 50, newly supplied units at 60.
- Addition of another product at current price; extra cash received.
- Full return preserving number, original date, seller and snapshot.
- Partial-payment invoice; debt-first reduction; additional partial/final payments.
- Split cash/store-credit refund and independent credit ledger.
- CASHIER POS credit redemption; OWNER-only financial APIs reject CASHIER.
- Settlement-aware cancellation restores credit funding before cash refund.
- Anonymous damaged return with separate verified credit recipient.
- Duplicate concurrent payment/replay creates exactly one record; stale revision
  returns 409; insufficient stock cannot change persisted records.
- Real database validation failure at the final audit insert rolls back prior
  invoice, customer, ledger, stock and stock-log writes. No model or HTTP mock is
  used for this rollback probe. The temporary validator is removed afterward.
- Other-shop invoice/history requests return 404; other-shop data stays unchanged.
- Quotation creation and cash-only conversion through the real browser.
- Dated history and an actual browser-generated receipt PDF.
- Sales HTTP reporting and AI summary's real database query/formatting path agree.
- Known legacy invoice without snapshot/revision/line ID remains readable and
  adjustable; the baseline is explicitly labeled LEGACY_BASELINE.
- Its original sale remains in the previous month; a real browser return changes
  today's revenue instead. Existing customer without a stored wallet field works
  through debt, credit issuance and redemption without a migration.

## Persisted checks

Assertions run after each financial operation: invoice total equals net settlement
plus due; cash/credit funding reconstructs from opening balances plus immutable
events; revision chains are contiguous; customer debt and wallet each reconcile to
their respective ledgers; stock reconciles to initial quantity plus audit deltas.
The rollback probe compares all affected documents before and after rejection.

Final fixture state: 7 invoices, 13 financial/history events, 19 stock logs, 10
customer-ledger records; customer debt PKR 110; available credit PKR 100; cable
stock 95; switch stock 100; today's net recorded sales PKR 120. Earlier-period
original sales remain PKR 60. These are test fixtures, not shop/business metrics.

## Suite results and boundaries

- Backend TypeScript build and full suite: 181 passed, zero failures/skips.
- Frontend lint and production build: passed; unit/component suite: 48 passed.
- Real browser/HTTP/database integration: 19 scenario groups passed.
- Existing replica suite also exercises concurrent wallet spending, payments versus
  returns/cancellation, duplicate refunds, rollback and ambiguous legacy rejection.

No application defect or financial inconsistency required a source-code change.
Initial runner failures were corrected test waits (wait for committed revision,
and check the actual quotation conversion UI instead of an assumed success label).

AI provider classification/transcription was not called: the real AI summary query
and answer formatter were exercised with a deterministic classified intent. Physical
cash handover and a physical printer cannot be verified by browser automation; PDF
printing and required UI confirmations were exercised. Production domains, HTTPS,
cookies and actual production MongoDB/index state were not accessed or verified.

For controlled release, verify transaction/snapshot-capable MongoDB (5.0+), deployed
model indexes including both idempotency unique indexes, coordinated backend/frontend
versions and a current backup. Keep ambiguous legacy invoices blocked; never infer
missing settlements. Operators must check uncertain results using the retained
request and must not repeat physical cash handovers. Start with a small controlled
shop rollout and verify production-domain authentication before real transactions.
