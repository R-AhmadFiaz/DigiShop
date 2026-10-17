# Shopkeeper usability pass

Frontend only. Existing requests, accounting calculations, role permissions,
preview tokens, request keys and financial confirmations are retained.

## Page audit and changes

| Screen | Main issue | Change |
|---|---|---|
| Shared navigation | Small links; long owner menu lacked its own scrollbar | Larger targets; scrollable desktop sidebar; existing routes retained |
| Dashboard | Small supporting text | Shared readable typography; business identity retained |
| Products and categories | Dense forms/tables | Larger labels, controls and table text; existing fields retained |
| Stock and history | Technical adjustment wording | Change stock; clear signed quantity example; existing history unchanged |
| POS and sales | Nested product scrolling; avoidable account choice | Natural page scrolling; default the sole server-prepared account only |
| Invoice and returns | Technical settlement wording | Return / change invoice; clearer money received/refunded labels; server preview retained |
| Quotations | Same product-list and account-choice friction | Shared scrolling; sole prepared account default; conversion keys unchanged |
| Customers and Khata | Dense balances/history | Shared typography; Receive payment and existing debt/credit separation retained |
| Companies & Suppliers | Business setup confused with financial history | Business details vs Open supplier Khata; plain role explanation |
| Purchases and deliveries | Dense tables and confirmations | Shared readable forms/tables; reference generation and delivery confirmations retained |
| Supplier Khata | Technical payable/credit labels | We owe supplier vs Supplier owes us; one shared credit/refund pool clearly described |
| Supplier starting balance | New suppliers exposed to manual accounting setup | Rs 0 workflow retained; historical/manual account form is optional, expanded for old deliveries |
| Cash & Bank | Technical account code required manual invention | Editable unique account reference filled automatically; unavailable balance stays unavailable |
| Transactions | Debit/credit dominated the detail view | Money movement first; all journal postings remain in optional Accounting details |
| Expenses | Long technical setup explanations | Short setup instruction; totals explicitly remain expenses, not profit |
| Partners & Capital | Investment terminology mixed with cash | Money added / money taken out; cash, capital and loans remain distinct |
| Starting Balances / activation | Excessive opening terminology | Starting balances, Check setup, short next-step guidance; typed confirmations retained |
| Reports | Dense explanations and jargon | Sales after discounts and returns; short limitations; unavailable historical profit retained |
| Staff, Account and registration | Small labels/buttons | Shared readable sizing; validation and upload support unchanged |
| AI Assistant | Nested conversation scrollbar | Natural document scrolling; text/voice behavior unchanged |
| Subscription, payment and blocked screens | Small explanatory text | Shared sizing/contrast only; bank details, QR, WhatsApp and access rules unchanged |
| Receipts and dialogs | Small metadata; focus could jump; long dialogs | Readable screen metadata; compact print styles retained; sticky dialog heading and no-scroll focus |

## Common design

White and sea green retained. Body/forms 17px; buttons 16px with 42px minimum
height; secondary text darkened; numbers use tabular figures. Wide tables retain
horizontal scrolling. The document, desktop sidebar and modal are the intentional
vertical scroll areas; product lists and conversation do not create nested traps.
Smaller viewports wrap headers, tabs and pagination.

## Scope and safeguards

All changes above are frontend conveniences. An account defaults only when the
complete server-prepared payment-account list contains exactly one account.
Paginated supplier account lists do not infer an automatic choice. Financial
reviews, cash-handover checks, historical review acknowledgements, typed phrases
and retry payloads remain mandatory.
Checkout buttons wait while payment-account choices load, avoiding a premature
click and its avoidable error. Existing server validation still applies.

Backend support is still required for automatic historical reconciliation,
missing historical cost/profit evidence, automatic invoice payment allocation,
or server-generated references where the current endpoint requires owner input.
Those are not implemented or guessed here. UTC reporting filters still say UTC;
displayed financial timestamps remain Pakistan time.

## Verification

Run `npm run lint`, `npm test`, `npm run build`.
`node tests/business-workflows.mjs` adapts visible labels in the existing backend
real-browser driver without editing backend files. It starts a disposable
loopback MongoDB replica set and actual Express/Chrome/frontend processes, with
no production fallback. It retains persisted stock, debt, credit, journal,
rollback, permission and retry assertions. Evidence goes to ignored
`tests/artifacts/readability-workflows.json`.

Verified on the final build:

- Lint and production build passed; all 96 frontend automated tests passed.
- Existing fixture-based frontend browser smoke passed, including registration,
  subscription screens, roles, AI, inventory, customers and printing. Its final
  anonymous-cookie checks used a local Express app with no database connection.
- Real supplier/business browser suite: 34 scenario groups passed, including
  activation/setup, partial receiving, supplier payments/credits/refunds, capital,
  expenses, reports, POS cash/credit, customer collection and quotation conversion.
- `node tests/business-workflows.mjs --invoices`: 19 real invoice scenario groups
  passed, including returns, refunds, store credit, insufficient stock, concurrent
  requests, rollback, historical reporting and printable receipts.
- Real browser tests used disposable loopback MongoDB 8.3.4 replica sets, actual
  Express and Chrome, and production-built React. No Atlas connection or
  production writes. Persisted balances, stock and balanced journals were checked.
- Added desktop/sidebar, 390px mobile, narrow/zoom-equivalent viewport and long
  dialog checks. Native browser zoom and scrollbar drag were not manually tested;
  the checks verify overflow, available scrolling and reachable controls.
- Backend working tree remained unchanged; no commits, pushes or deployments.
