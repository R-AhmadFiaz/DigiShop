# Record tables and Khata presentation

Frontend presentation only. No backend, API contracts, mutation payloads,
accounting calculations, permission guards or stored records changed.

## Page review and implementation

| Page / records | Presentation |
|---|---|
| Transactions — shop-wide | One row per returned event: date, action, source, event amount, actor; click/Enter or View transaction opens the existing detail endpoint. No journal-posting duplication or global cash balance. |
| Transactions — selected account | Current server balance above the table; date, action, source, balance added/reduced, server running balance. Range opening/closing and existing filters/pagination retained. |
| Supplier Khata | Prominent authoritative outstanding amount; supplier credit kept separate. Settlement register with dates, actions, references, values, delivery links and expandable portions/notes/actor/reversal references. Correct remains visible. Full dated debt movements are in the linked supplier account statement. |
| Companies & Suppliers | Shared business directory table; click row or Business details opens existing details. Supplier history remains separate; product stock stays a numeric table. |
| Customers | Shared customer Khata directory; debt and store credit stay separate. OWNER row/details opens existing balances and invoice register with dates, totals, paid/settled and due. Receive Payment links to the existing invoice settlement. CASHIER gains no detail action. |
| Cash & Bank | Shared account table, selected confirmed balance above it; click row or View balance. Existing Transactions link retained. |
| Partners & Capital | Current business and partner balances retained. Capital history separates capital added/reduced, including the inverse direction for reversals. Clicking opens existing details/correction form. These are capital movements, not revenue. |
| Expenses | Server monthly/search total at top. Date, category, action, money paid/restored, account and reference. Notes/actor and reversal form remain in the existing detail modal. |
| Purchase orders | Shared dated register: order value, supplier, actual receiving progress, status, original notes/document details. Order creation is not a money or stock movement. |
| Purchase details / deliveries | Order value highlighted; goods receipts are expandable table rows with dates, references, goods values and accounting status. Product quantities/original costs, notes/challan and receiving actor expand below. Return details remains visible. Deferred goods value is explicitly not confirmed supplier debt. |
| Supplier goods returns | Return/correction register replaces paragraph records; original cost and item quantities expand below. Existing return form and eligibility table retained. |
| Invoice adjustments / customer returns | Dated register separates money received/refunded and invoice due after each event. Product returns/additions use a table; store-credit movements stay separately labeled in details. Print action remains visible. |
| Sales | Shared dated invoice register with bill value, paid/settled, due, status and existing invoice links. No fabricated period totals. |
| Quotations | Shared dated session register with quoted value/status and existing View/Make sale actions. Product quantities/prices expand below. No quotation cash or running balance implied. |
| Stock history | Shared quantity register separates stock added/reduced; source references and damaged/restocked metadata expand below. Zero-stock-change damaged records are retained. No money columns or guessed historical stock balance. |
| Financial Reports | Existing authoritative report tables share numeric alignment, headers and empty-state presentation. No new calculations. |
| Receipts / original invoices | Existing product tables, totals, seller, shop identity and original/current snapshot controls retained. Printable adjustment item movements now use a table. |
| Setup, Staff, Products, activation | Keep their existing forms, summaries and directories; they are not transaction registers. No financial actions removed. |

## Shared behavior

`src/components/RecordTable.jsx` accepts columns and authoritative rows in their
supplied order. It never sorts, totals, infers dates, calculates balances or makes
requests. Numeric cells are right-aligned. Rows have keyboard-accessible details
and an explicit button; clicking existing links/actions does not also open details.
Wide registers scroll horizontally inside the page on mobile. Forms and useful
summaries stay outside the primary record table.

## Data limitations — no invented balances

- Account statements use `accountPosting.balanceDeltaMinor` (or the matching
  returned posting), `runningBalanceMinor`, `balanceMinor` and range balances.
  Signed balance changes follow that account's meaning; supplier debt is not cash.
  Filtered or unsupported running balances remain unavailable.
- Supplier settlement lists do not include the whole opening/receiving history or
  per-row running payable balances. They are not presented as a complete statement.
  Missing payable/credit portions are Unavailable, never replaced by event value.
  The already-supported financial account statement provides the posted history.
- Customer reconciliation returns current debt/credit and issues, not a complete
  dated customer ledger. The existing customer invoice list is shown honestly;
  detailed payments/returns are available on each invoice. A direct full customer
  Khata would need a supported customer-specific statement read or reliably
  returned existing financial-account IDs, without creating duplicate accounts.
- Capital events and expenses do not return reliable per-event running balances.
  Their paginated records must not be summed to invent one. Existing current totals
  remain authoritative and separate from cash balances.
- Stock logs lack authoritative historical before/after stock snapshots. Quantity
  changes are displayed as stored; a paginated subset cannot reconstruct stock.
- Purchase/sales/quotation list APIs do not provide complete filtered summary totals.
  Page subtotals are not presented as business totals.
- Product brand/company sales attribution and historical cost/profit limitations
  remain unchanged. No new supplier/customer cash flows are inferred.

## Verification commands

- `npm run lint`, `npm test`, `npm run build`
- `node tests/business-workflows.mjs`
- `node tests/business-workflows.mjs --invoices`

Real browser runners use disposable loopback MongoDB replica sets, actual Express
and production-built React. They never fall back to Atlas. Additional checks compare
displayed account directions/balances with actual API postings, exercise row keyboard
details and mobile horizontal scrolling, and verify detail expansion writes nothing.

Verified for this pass:

- Frontend lint and production build passed; 100 automated tests passed.
- Existing fixture-based frontend browser smoke passed, including role permissions,
  subscription states, POS, customer accounts, stock filters, quotations and printing.
  Anonymous checks used local Express without a database connection.
- 35 real business/browser groups passed against a disposable MongoDB 8.3.4 replica
  set, including actual persisted stock, customer/supplier balances, journals,
  idempotency, rollback and the new register-specific checks.
- 19 real invoice/return browser groups passed, including printable PDFs,
  settlement history, refunds, credit, stale previews, concurrency and rollback.
- Backend working tree remained unchanged. No production connections, commits,
  pushes or deployments were performed.
